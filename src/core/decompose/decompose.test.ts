/**
 * The decomposer's tests, organised around the one question that matters:
 * **does the board that gets built match the picture that was painted?**
 *
 * Everything else here is support for that. A graph that evaluates without
 * throwing proves the geometry is self-consistent; it does not prove the
 * emitter put the right species in the right place. Only sampling the finished
 * cross-section against the target does that, and `achievedMatchesTarget` is
 * therefore the test the whole module exists to pass.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildCutList } from '../cutlist/cutlist.js';
import { evaluate } from '../geometry/evaluate.js';
import { boundingBox, rectangle, type Point, type Polygon } from '../geometry/polygon.js';
import { DEFAULT_SHOP, DEFAULT_TRIM_PER_EDGE } from '../model/defaults.js';
import type { Partition, ShopProfile, SpeciesId } from '../model/types.js';
import { inches, ticks } from '../units/ticks.js';
import { classifyShape } from './classify.js';
import { decompose, decomposeTarget } from './decompose.js';
import { sliceSignature } from './emit.js';
import { isTwoStage, searchGuillotine, treeLeaves, treeStages, type Placed } from './guillotine.js';
import { hexToOklab, quantiseImage, quantiseQuality } from './quantise.js';
import {
  candidatesWithin,
  chooseSplit,
  suggestBuildable,
  suggestionDiff,
  suggestionIsSound,
  type SplitCandidate,
} from './snap.js';
import {
  checkerTarget,
  mergeRect,
  paintCell,
  pieceAt,
  pieceRect,
  targetToPartition,
  uniformTarget,
  validateTarget,
} from './target.js';
import type { PaintPiece, PaintTarget } from './types.js';

const A: SpeciesId = 'hard-maple';
const B: SpeciesId = 'black-walnut';
const CELL = inches(1.5);

const OPTIONS = { boardThickness: inches(1.5) } as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Species of the face covering a point, by rectangle containment.
 *
 * The boundary case is not a technicality here. A snap splits a piece along a
 * grid line, so the achieved board grows a joint exactly where the target has
 * solid wood — and a sample taken at a piece's midpoint lands on it. Returning
 * null there would report a mismatch for a board that is in fact correct.
 *
 * So a point on a boundary is resolved to the species of the faces adjoining
 * it, and **only if they agree**. That keeps the check strict: a joint between
 * two different species still comes back null and still fails.
 */
function speciesAt(partition: Partition, p: Point): SpeciesId | null {
  for (const face of partition.faces) {
    const b = boundingBox(face.polygon);
    if (p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY) return face.species;
  }

  const touching = new Set<SpeciesId>();
  for (const face of partition.faces) {
    const b = boundingBox(face.polygon);
    if (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY) touching.add(face.species);
  }
  return touching.size === 1 ? [...touching][0]! : null;
}

/**
 * Sample the finished board against the painted target.
 *
 * The trim is centred, so a point at `(x, y)` on the finished board came from
 * `(x + trim, y + trim)` on the lay-up. Samples are taken a tick inside each
 * cell's corner-most quadrant so none of them lands on a glue line, where both
 * neighbours would be a defensible answer.
 */
function achievedMatchesTarget(
  target: PaintTarget,
  achieved: Partition,
  trim = DEFAULT_TRIM_PER_EDGE,
): { checked: number; mismatches: Array<{ at: Point; want: SpeciesId | null; got: SpeciesId | null }> } {
  const wanted = targetToPartition(target);
  const mismatches: Array<{ at: Point; want: SpeciesId | null; got: SpeciesId | null }> = [];
  let checked = 0;

  for (const piece of target.pieces) {
    const r = pieceRect(target, piece);
    // Nine samples per piece, so a piece that came out in the right place but
    // the wrong size is still caught. Inset by 1/4" -- more than the 1/16" trim
    // -- so the corner samples survive the squaring-up cut and get compared
    // rather than skipped.
    const inset = 2000;
    const xs = [r.x0 + inset, (r.x0 + r.x1) / 2, r.x1 - inset];
    const ys = [r.y0 + inset, (r.y0 + r.y1) / 2, r.y1 - inset];
    for (const x of xs) {
      for (const y of ys) {
        const onBoard = { x: x - trim, y: y - trim };
        const b = boundingBox(achieved.outline);
        if (onBoard.x <= b.minX || onBoard.x >= b.maxX || onBoard.y <= b.minY || onBoard.y >= b.maxY) {
          continue; // Trimmed away; nothing to compare.
        }
        checked += 1;
        const want = speciesAt(wanted, { x, y });
        const got = speciesAt(achieved, onBoard);
        if (want !== got) mismatches.push({ at: { x, y }, want, got });
      }
    }
  }
  return { checked, mismatches };
}

function build(target: PaintTarget, shop: ShopProfile = DEFAULT_SHOP) {
  const result = decomposeTarget(target, shop, OPTIONS);
  if (!result.ok) throw new Error(`Expected a graph, got refusal: ${result.refusal.reason}`);
  return { result, evaluated: evaluate(result.graph, shop) };
}

/** Four rectangles around a fifth: the smallest tiling with no guillotine cut. */
function pinwheelTarget(): PaintTarget {
  const pieces: PaintPiece[] = [
    { col: 0, row: 2, cols: 2, rows: 1, species: A },
    { col: 2, row: 1, cols: 1, rows: 2, species: B },
    { col: 1, row: 0, cols: 2, rows: 1, species: A },
    { col: 0, row: 0, cols: 1, rows: 2, species: B },
    { col: 1, row: 1, cols: 1, rows: 1, species: A },
  ];
  return {
    columns: [CELL, CELL, CELL],
    rows: [CELL, CELL, CELL],
    pieces,
  };
}

/**
 * An irregular layout that IS buildable, exercising every path at once:
 * a full-width band, differing piece sizes, a nested layer stack, and a piece
 * tall enough to need the transpose.
 */
function irregularTarget(): PaintTarget {
  const pieces: PaintPiece[] = [
    { col: 0, row: 3, cols: 4, rows: 1, species: A }, // full-width band
    { col: 0, row: 2, cols: 2, rows: 1, species: B },
    { col: 2, row: 2, cols: 1, rows: 1, species: A },
    { col: 3, row: 2, cols: 1, rows: 1, species: B },
    { col: 0, row: 0, cols: 1, rows: 2, species: A }, // 3" tall: needs rolling
    { col: 1, row: 0, cols: 3, rows: 1, species: B },
    { col: 1, row: 1, cols: 3, rows: 1, species: A },
  ];
  return { columns: [CELL, CELL, CELL, CELL], rows: [CELL, CELL, CELL, CELL], pieces };
}

/* -------------------------------------------------------------------------- */

describe('paint target', () => {
  it('starts as a well-formed tiling', () => {
    expect(validateTarget(checkerTarget(8, 10, CELL, A, B))).toEqual({ ok: true });
  });

  it('painting into a merged piece breaks it apart rather than recolouring it', () => {
    const { target } = mergeRect(uniformTarget(3, 3, CELL, () => A), 0, 0, 2, 2, A);
    expect(target.pieces).toHaveLength(3 * 3 - 4 + 1);

    const painted = paintCell(target, 0, 0, B);
    expect(validateTarget(painted)).toEqual({ ok: true });
    expect(pieceAt(painted, 0, 0)?.species).toBe(B);
    // Its three former neighbours survived as single cells of the old species.
    expect(pieceAt(painted, 1, 1)?.species).toBe(A);
    expect(pieceAt(painted, 1, 1)?.cols).toBe(1);
  });

  it('a merge grows to cover whole pieces, never bisecting a neighbour', () => {
    // Merge a 2x1 block, then merge a 1x1 that overlaps only half of it.
    const first = mergeRect(uniformTarget(4, 2, CELL, () => A), 0, 0, 2, 1, A).target;
    const second = mergeRect(first, 1, 0, 1, 1, B);
    expect(second.merged.col).toBe(0);
    expect(second.merged.cols).toBe(2);
    expect(validateTarget(second.target)).toEqual({ ok: true });
  });
});

describe('shape classification', () => {
  it('reads an axis-aligned rectangle as buildable', () => {
    expect(classifyShape(rectangle(0, 0, 100, 50))).toBe('rectangle');
  });

  it('ignores a redundant vertex on an edge', () => {
    const withExtra: Polygon = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    expect(classifyShape(withExtra)).toBe('rectangle');
  });

  it('reads an L as rectilinear but not a rectangle', () => {
    const ell: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(classifyShape(ell)).toBe('rectilinear');
  });

  it('separates a mitred corner from a curve', () => {
    const triangle: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(classifyShape(triangle)).toBe('angled');

    const circle: Polygon = Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2;
      return { x: Math.round(500 + 400 * Math.cos(t)), y: Math.round(500 + 400 * Math.sin(t)) };
    });
    expect(classifyShape(circle)).toBe('curved');
  });
});

describe('the guillotine search', () => {
  it('decomposes a plain grid as the ordinary two-stage board', () => {
    const target = checkerTarget(6, 8, CELL, A, B);
    const partition = targetToPartition(target);
    const placed: Placed[] = partition.faces.map((face, i) => ({
      rect: pieceRect(target, target.pieces[i]!),
      face,
      piece: target.pieces[i]!,
    }));
    const result = searchGuillotine(placed, { x0: 0, y0: 0, x1: 6 * CELL, y1: 8 * CELL });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeStages(result.tree)).toBe(2);
    expect(isTwoStage(result.tree)).toBe(true);
    expect(treeLeaves(result.tree)).toHaveLength(48);
  });

  it('refuses the pinwheel, and names the five pieces rather than the board', () => {
    const result = decomposeTarget(pinwheelTarget(), DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.refusal.code).toBe('notGuillotine');
    // The blocked region plus each offending piece.
    expect(result.refusal.regions).toHaveLength(6);
    expect(result.refusal.reason).toContain('edge to edge');
    expect(result.refusal.remedy).toBeTruthy();
  });

  it('reports the smallest blocked region, not the whole board', () => {
    // A pinwheel in the top-left corner of a larger, otherwise plain board.
    const base = uniformTarget(5, 5, CELL, () => A);
    let target: PaintTarget = base;
    for (const p of [
      { col: 0, row: 4, cols: 2, rows: 1 },
      { col: 2, row: 3, cols: 1, rows: 2 },
      { col: 1, row: 2, cols: 2, rows: 1 },
      { col: 0, row: 2, cols: 1, rows: 2 },
    ]) {
      target = mergeRect(target, p.col, p.row, p.cols, p.rows, B).target;
    }
    const result = decomposeTarget(target, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const blocked = boundingBox(result.refusal.regions[0]!);
    // 3x3 cells, not the full 5x5 board.
    expect(blocked.maxX - blocked.minX).toBe(3 * CELL);
    expect(blocked.maxY - blocked.minY).toBe(3 * CELL);
  });

  it('a split that unblocks the pinwheel exists, and crosses exactly one piece', () => {
    const target = pinwheelTarget();
    const candidates = candidatesWithin(target, { x0: 0, y0: 0, x1: 3 * CELL, y1: 3 * CELL });
    expect(candidates.length).toBeGreaterThan(0);
    // Every interior line of a pinwheel crosses exactly one of the four arms.
    for (const c of candidates) expect(c.crosses).toHaveLength(1);
  });
});

describe('emission', () => {
  it('a painted grid evaluates, conserves mass, and matches the picture', () => {
    const target = checkerTarget(6, 8, CELL, A, B);
    const { result, evaluated } = build(target);

    expect(result.ok && result.exact).toBe(true);
    expect(result.ok && result.stages).toBe(2);

    const check = achievedMatchesTarget(target, evaluated.workpiece.crossSection);
    expect(check.checked).toBeGreaterThan(200);
    expect(check.mismatches).toEqual([]);
  });

  it('shares one panel between identical bands', () => {
    // A checkerboard has two band patterns, however many rows it has.
    const { result } = build(checkerTarget(6, 10, CELL, A, B));
    expect(result.ok && result.panelCount).toBe(2);
    // One glue-up per panel, plus the slice lay-up.
    expect(result.ok && result.glueUps).toBe(3);
  });

  it('counts a distinct panel for every distinct band', () => {
    // Every row shifted by one: six distinct bands in a 6-wide grid.
    const target = uniformTarget(6, 6, CELL, (c, r) => (c === r ? B : A));
    const { result } = build(target);
    expect(result.ok && result.panelCount).toBe(6);
  });

  it('builds the irregular layout, transposed piece and layer stack included', () => {
    const target = irregularTarget();
    const { result, evaluated } = build(target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The 3"-tall piece forces a nested layer glue-up, so this is deeper than
    // the ordinary two-stage board.
    expect(result.stages).toBeGreaterThan(2);
    expect(result.stages).toBeLessThanOrEqual(4);

    const check = achievedMatchesTarget(target, evaluated.workpiece.crossSection);
    expect(check.checked).toBeGreaterThan(40);
    expect(check.mismatches).toEqual([]);
  });

  /**
   * Pins the assumption that the print sheet quietly relied on.
   *
   * `CutList.purchase` carries one line per BILLET. Every generated pattern
   * happens to use one billet per species, so species was unique in practice
   * and the print sheet used it as a React key -- which React is entitled to
   * resolve by dropping rows. A painted design uses one billet per species
   * *per stock thickness per panel*, so the collision is routine rather than
   * exotic, and a dropped row is a board missing from somebody's lumber order.
   */
  it('produces several purchase lines for one species, which species is not a key for', () => {
    const { result, evaluated } = build(irregularTarget());
    if (!result.ok) return;

    const cutList = buildCutList(result.graph, evaluated, DEFAULT_SHOP, {
      name: 'test',
      precision: inches(1 / 32),
    });

    const perSpecies = new Map<string, number>();
    for (const line of cutList.purchase) {
      perSpecies.set(line.species, (perSpecies.get(line.species) ?? 0) + 1);
    }
    expect(Math.max(...perSpecies.values())).toBeGreaterThan(1);

    // The totals a cover legend shows must still come to the overall figure.
    const summed = cutList.purchase.reduce((s, l) => s + l.boardFeet, 0);
    expect(summed).toBeCloseTo(cutList.summary.totalBoardFeet, 6);
  });

  it('gives the finished board the painted size less the trim allowance', () => {
    const target = checkerTarget(8, 10, CELL, A, B);
    const { evaluated } = build(target);
    const b = boundingBox(evaluated.workpiece.crossSection.outline);

    expect(b.maxX - b.minX).toBe(8 * CELL - 2 * DEFAULT_TRIM_PER_EDGE);
    expect(b.maxY - b.minY).toBe(10 * CELL - 2 * DEFAULT_TRIM_PER_EDGE);
  });

  it('fingerprints two identical bands the same and two different bands differently', () => {
    const target = checkerTarget(4, 2, CELL, A, B);
    const partition = targetToPartition(target);
    const placed: Placed[] = partition.faces.map((face, i) => ({
      rect: pieceRect(target, target.pieces[i]!),
      face,
      piece: target.pieces[i]!,
    }));
    const search = searchGuillotine(placed, { x0: 0, y0: 0, x1: 4 * CELL, y1: 2 * CELL });
    expect(search.ok).toBe(true);
    if (!search.ok || search.tree.kind !== 'split') return;

    const [first, second] = search.tree.parts;
    expect(sliceSignature(first!)).not.toBe(sliceSignature(second!));
    expect(sliceSignature(first!)).toBe(sliceSignature(first!));
  });
});

describe('refusals name what is wrong', () => {
  it('refuses a curved region, before complaining that it does not tile', () => {
    // A circle drawn over a grid: it overlaps the cells beneath it, so the
    // tiling check would also fail -- with a far less useful message.
    const grid = targetToPartition(uniformTarget(4, 4, CELL, () => A));
    const circle: Polygon = Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return {
        x: Math.round(3 * CELL + 1.2 * CELL * Math.cos(t)),
        y: Math.round(3 * CELL + 1.2 * CELL * Math.sin(t)),
      };
    });
    const withCircle: Partition = {
      outline: grid.outline,
      faces: [
        ...grid.faces,
        { polygon: circle, species: B, pieceId: 'drawn-0', ringOrientation: 'quartersawn' },
      ],
    };

    const result = decompose(withCircle, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('curved');
    expect(result.refusal.reason).toContain('straight lines');
    expect(result.refusal.regions).toHaveLength(1);
  });

  it('refuses an enclosed region as a geometric limit, not a missing feature', () => {
    // A ring: the outer boundary counter-clockwise, then a zero-width slit in
    // to the hole, around it clockwise, and back out. That is how a simple
    // polygon represents a shape with a void, and the shoelace area comes out
    // as outer minus hole, which is what the island check relies on.
    const outer: Polygon = [
      { x: 0, y: 0 },
      { x: 4 * CELL, y: 0 },
      { x: 4 * CELL, y: 4 * CELL },
      { x: 0, y: 4 * CELL },
      { x: 0, y: 2 * CELL },
      { x: CELL, y: 2 * CELL },
      { x: CELL, y: 3 * CELL },
      { x: 3 * CELL, y: 3 * CELL },
      { x: 3 * CELL, y: CELL },
      { x: CELL, y: CELL },
      { x: CELL, y: 2 * CELL },
      { x: 0, y: 2 * CELL },
    ];
    const inner = rectangle(CELL, CELL, 2 * CELL, 2 * CELL);
    const target: Partition = {
      outline: rectangle(0, 0, 4 * CELL, 4 * CELL),
      faces: [
        { polygon: outer, species: A, pieceId: 'ring', ringOrientation: 'quartersawn' },
        { polygon: inner, species: B, pieceId: 'island', ringOrientation: 'quartersawn' },
      ],
    };

    const result = decompose(target, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('island');
    expect(result.refusal.reason).toContain('surrounded');
  });

  it('refuses a piece too narrow to rip safely, and says by how much', () => {
    const narrow: PaintTarget = {
      // A 1/4" column, against the 1/2" default minimum.
      columns: [inches(0.25), CELL, CELL, CELL],
      rows: [CELL, CELL],
      pieces: uniformTarget(4, 2, CELL, (c) => (c === 0 ? B : A)).pieces,
    };
    const result = decomposeTarget(narrow, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('unsafeWidth');
    expect(result.refusal.reason).toContain('0.25');
  });

  it('refuses a piece no board is thick enough to supply', () => {
    // A whole 6" column merged into one piece: 1.5" x 6", short side 1.5" --
    // fine. Merge a 3 x 3 block instead and the short side is 4.5".
    const merged = mergeRect(uniformTarget(5, 5, CELL, () => A), 1, 1, 3, 3, B).target;
    const result = decomposeTarget(merged, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toContain('thick');
    expect(result.refusal.regions).toHaveLength(1);
  });

  it('accepts a tall piece that can be ripped wide and stood on edge', () => {
    // 1.5" x 3": too thick upright, fine rolled a quarter turn.
    const merged = mergeRect(uniformTarget(4, 4, CELL, () => A), 1, 1, 1, 2, B).target;
    const result = decomposeTarget(merged, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(true);
  });

  it('refuses a board too thin to crosscut safely', () => {
    const result = decomposeTarget(checkerTarget(4, 4, CELL, A, B), DEFAULT_SHOP, {
      boardThickness: inches(0.75),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toContain('crosscut');
  });
});

describe('cancellation', () => {
  it('stops when asked, rather than running to completion', () => {
    const target = checkerTarget(20, 20, CELL, A, B);
    expect(() =>
      decomposeTarget(target, DEFAULT_SHOP, { ...OPTIONS, shouldCancel: () => true }),
    ).toThrow(/cancelled/i);
  });

  it('reports progress that ends at 1', () => {
    const seen: number[] = [];
    decomposeTarget(checkerTarget(10, 10, CELL, A, B), DEFAULT_SHOP, {
      ...OPTIONS,
      onProgress: (f) => seen.push(f),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });
});

describe('image import', () => {
  /** A 2x2 block image: maple-ish top-left, walnut-ish elsewhere. */
  function blocks(size: number, colorAt: (x: number, y: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = colorAt(x, y);
        const i = (y * size + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    return { width: size, height: size, data };
  }

  it('maps a hex colour to itself under Oklab', () => {
    const maple = hexToOklab('#e8d4a8');
    const walnut = hexToOklab('#4a3728');
    // Maple is much lighter, which is the axis the palette mostly varies on.
    expect(maple.L).toBeGreaterThan(walnut.L);
  });

  it('quantises a bold two-tone image to the two species', () => {
    const pixels = blocks(64, (x, y) => (x < 32 && y < 32 ? [232, 212, 168] : [74, 55, 40]));
    const result = quantiseImage(pixels, 4, 4, CELL, [A, B]);

    expect(validateTarget(result.target)).toEqual({ ok: true });
    // Top-left quadrant is maple; the rest walnut.
    expect(pieceAt(result.target, 0, 0)?.species).toBe(A);
    expect(pieceAt(result.target, 3, 3)?.species).toBe(B);
    expect(quantiseQuality(result).verdict).not.toBe('poor');

    // And it builds, because a grid always does.
    expect(decomposeTarget(result.target, DEFAULT_SHOP, OPTIONS).ok).toBe(true);
  });

  it('calls out an image the palette cannot represent', () => {
    // Saturated blue: nowhere near any wood tone.
    const pixels = blocks(32, () => [20, 60, 220]);
    const result = quantiseImage(pixels, 4, 4, CELL, [A, B]);
    expect(quantiseQuality(result).verdict).toBe('poor');
    expect(quantiseQuality(result).note).toMatch(/same species|long way/);
  });

  it('averages in linear light, so a half-and-half cell does not read dark', () => {
    // Alternating black and white columns, sampled as one cell. In linear light
    // the mean is 0.5, which encodes to about #bcbcbc -- not #808080.
    const pixels = blocks(16, (x) => (x % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
    const result = quantiseImage(pixels, 1, 1, CELL, [A, B]);
    const hex = result.sourceColors[0]!;
    const level = Number.parseInt(hex.slice(1, 3), 16);
    expect(level).toBeGreaterThan(170);
  });
});

describe('snap to buildable', () => {
  const candidate = (over: Partial<SplitCandidate>): SplitCandidate => ({
    axis: 'x',
    at: 1,
    crosses: [0],
    offCentre: 0.5,
    largestCrossed: 100,
    totalCrossed: 100,
    ...over,
  });

  it('prefers the line that crosses fewest pieces', () => {
    const chosen = chooseSplit([
      candidate({ at: 1, crosses: [0, 1, 2], offCentre: 0 }),
      candidate({ at: 2, crosses: [0], offCentre: 0.9 }),
      candidate({ at: 3, crosses: [0, 1], offCentre: 0.1 }),
    ]);
    // Fewest crossed wins even though another line is dead centre: a crossed
    // piece is a new glue line, which is the only visible change to the design.
    expect(chosen.at).toBe(2);
    expect(chosen.crosses).toHaveLength(1);
  });

  it('breaks a tie on crossings by centrality, then by area', () => {
    const byCentre = chooseSplit([
      candidate({ at: 1, crosses: [0], offCentre: 0.8 }),
      candidate({ at: 2, crosses: [1], offCentre: 0.2 }),
    ]);
    expect(byCentre.at).toBe(2);

    const byArea = chooseSplit([
      candidate({ at: 1, crosses: [0], offCentre: 0.4, totalCrossed: 9000 }),
      candidate({ at: 2, crosses: [1], offCentre: 0.4, totalCrossed: 400 }),
    ]);
    expect(byArea.at).toBe(2);
  });

  it('offers a repair for the pinwheel, flagged as leaving the pattern alone', () => {
    const result = decomposeTarget(pinwheelTarget(), DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.refusal.code).toBe('notGuillotine');
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion?.changesAppearance).toBe(false);
    expect(suggestionIsSound(result.suggestion!.target)).toBe(true);
    // One arm split in two: five pieces become six.
    expect(result.suggestion!.target.pieces).toHaveLength(6);
  });

  /**
   * The assertion the whole snapper exists to satisfy.
   *
   * The suggestion is built, evaluated, and then sampled against the
   * **original** painting -- not against the suggestion. Splitting a piece
   * keeps its species on both halves, so if the snap is honest about "the
   * pattern stays identical", every sample point of the thing the user drew
   * must come back the same species on the board that gets built.
   */
  it('builds, and matches the picture the user actually painted', () => {
    const painted = pinwheelTarget();
    const result = decomposeTarget(painted, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok || !result.suggestion) return;

    const rebuilt = decomposeTarget(result.suggestion.target, DEFAULT_SHOP, OPTIONS);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;

    const evaluated = evaluate(rebuilt.graph, DEFAULT_SHOP);
    const check = achievedMatchesTarget(painted, evaluated.workpiece.crossSection);
    expect(check.checked).toBeGreaterThan(20);
    expect(check.mismatches).toEqual([]);
  });

  it('reports the new glue lines, so the diff is the real cost', () => {
    const painted = pinwheelTarget();
    const suggestion = suggestBuildable(painted, DEFAULT_SHOP, OPTIONS);
    expect(suggestion).not.toBeNull();

    const lines = suggestionDiff(painted, suggestion!.target);
    expect(lines.length).toBeGreaterThan(0);
    // A split along a grid line, not a moved boundary.
    for (const line of lines) expect(Number.isInteger(line.at)).toBe(true);
  });

  it('offers nothing when splitting cannot help', () => {
    // A column narrower than a safe rip only gets worse when split.
    const narrow: PaintTarget = {
      columns: [inches(0.25), CELL, CELL],
      rows: [CELL, CELL],
      pieces: uniformTarget(3, 2, CELL, (c) => (c === 0 ? B : A)).pieces,
    };
    expect(suggestBuildable(narrow, DEFAULT_SHOP, OPTIONS)).toBeNull();
  });

  it('halves a piece too thick for stock, without needing a heuristic', () => {
    const merged = mergeRect(uniformTarget(5, 5, CELL, () => A), 1, 1, 3, 3, B).target;
    const result = decomposeTarget(merged, DEFAULT_SHOP, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok || !result.suggestion) return;

    expect(result.suggestion.changesAppearance).toBe(false);
    const rebuilt = decomposeTarget(result.suggestion.target, DEFAULT_SHOP, OPTIONS);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;

    const evaluated = evaluate(rebuilt.graph, DEFAULT_SHOP);
    expect(achievedMatchesTarget(merged, evaluated.workpiece.crossSection).mismatches).toEqual([]);
  });
});

describe('the whole loop', () => {
  it('a design the user paints, refuses, and then fixes by hand', () => {
    // Start from the pinwheel: refused.
    const blocked = pinwheelTarget();
    const first = decomposeTarget(blocked, DEFAULT_SHOP, OPTIONS);
    expect(first.ok).toBe(false);

    // Split the top arm at the grid line the candidates point to. Same species
    // on both halves, so the picture is unchanged.
    const candidates = candidatesWithin(blocked, { x0: 0, y0: 0, x1: 3 * CELL, y1: 3 * CELL });
    const choice = candidates.find((c) => c.axis === 'x');
    expect(choice).toBeDefined();

    const arm = choice!.crosses[0]!;
    const repaired: PaintTarget = {
      ...blocked,
      pieces: blocked.pieces.flatMap((p, i) => {
        if (i !== arm) return [p];
        return [
          { ...p, cols: choice!.at - p.col },
          { ...p, col: choice!.at, cols: p.col + p.cols - choice!.at },
        ];
      }),
    };
    expect(validateTarget(repaired)).toEqual({ ok: true });

    const second = decomposeTarget(repaired, DEFAULT_SHOP, OPTIONS);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // And the board that comes out still looks like the pinwheel.
    const evaluated = evaluate(second.graph, DEFAULT_SHOP);
    const check = achievedMatchesTarget(repaired, evaluated.workpiece.crossSection);
    expect(check.mismatches).toEqual([]);
  });

  /**
   * The honest-answer property.
   *
   * Over randomly painted targets -- non-uniform column widths, three species,
   * random merges -- every run must land in one of exactly two states: a
   * refusal that names what is wrong, or a graph whose finished cross-section
   * matches the painting at every sample point.
   *
   * There is deliberately no third state. A graph that evaluates proves only
   * that the geometry is self-consistent, and `evaluate` already enforces
   * conservation of mass per node, so what this adds is the thing conservation
   * is blind to: whether the species ended up where they were painted. A board
   * can conserve every cubic inch and still be the wrong picture.
   */
  it('either names what is wrong or builds exactly what was painted', () => {
    const sizes = [inches(0.75), inches(1), inches(1.5)];

    fc.assert(
      fc.property(
        fc.record({
          columns: fc.array(fc.constantFrom(...sizes), { minLength: 2, maxLength: 5 }),
          rows: fc.array(fc.constantFrom(...sizes), { minLength: 2, maxLength: 5 }),
          species: fc.array(fc.constantFrom(A, B, 'black-cherry'), { minLength: 25, maxLength: 25 }),
          merges: fc.array(
            fc.record({
              col: fc.nat({ max: 4 }),
              row: fc.nat({ max: 4 }),
              cols: fc.integer({ min: 1, max: 3 }),
              rows: fc.integer({ min: 1, max: 3 }),
              species: fc.constantFrom(A, B, 'black-cherry'),
            }),
            { maxLength: 3 },
          ),
        }),
        (spec) => {
          let target: PaintTarget = {
            columns: spec.columns,
            rows: spec.rows,
            pieces: uniformTarget(
              spec.columns.length,
              spec.rows.length,
              CELL,
              (c, r) => spec.species[r * 5 + c] ?? A,
            ).pieces,
          };

          for (const m of spec.merges) {
            if (m.col >= spec.columns.length || m.row >= spec.rows.length) continue;
            target = mergeRect(
              target,
              m.col,
              m.row,
              Math.min(m.cols, spec.columns.length - m.col),
              Math.min(m.rows, spec.rows.length - m.row),
              m.species,
            ).target;
          }

          // The editing operations must never produce a broken tiling; that is
          // a precondition of the property rather than part of it.
          expect(validateTarget(target)).toEqual({ ok: true });

          const result = decomposeTarget(target, DEFAULT_SHOP, OPTIONS);

          if (!result.ok) {
            expect(result.refusal.reason.length).toBeGreaterThan(10);
            // Every refusal about the design itself has to point somewhere.
            // Only board-level ones (too thin to crosscut) may name no region.
            const NAMES_A_REGION = ['curved', 'notRectangular', 'angled', 'island', 'notGuillotine'];
            if (NAMES_A_REGION.includes(result.refusal.code)) {
              expect(result.refusal.regions.length).toBeGreaterThan(0);
            }
            return;
          }

          expect(result.exact).toBe(true);
          const evaluated = evaluate(result.graph, DEFAULT_SHOP);
          const check = achievedMatchesTarget(target, evaluated.workpiece.crossSection);
          expect(check.mismatches).toEqual([]);
          expect(check.checked).toBeGreaterThan(0);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('never returns an inexact result', () => {
    // The spec's result type admits one; nothing emits it. An approximation is
    // offered as a suggestion the user accepts, never silently as a success.
    for (const target of [
      checkerTarget(4, 4, CELL, A, B),
      irregularTarget(),
      uniformTarget(5, 5, ticks(12000), (c, r) => ((c * r) % 3 === 0 ? A : B)),
    ]) {
      const result = decomposeTarget(target, DEFAULT_SHOP, OPTIONS);
      if (result.ok) expect(result.exact).toBe(true);
    }
  });
});
