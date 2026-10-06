import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { boardDimensions, evaluate, workpieceVolumeBySpecies } from '../geometry/evaluate.js';
import { checkTiling, laminateButted, leftEdgeAtTableFace, normalisePartition, singleFacePartition } from '../geometry/partition.js';
import { area, rectangle, width as polyWidth } from '../geometry/polygon.js';
import { cutPartition } from '../geometry/partition.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { degrees, inches, toInches } from '../units/ticks.js';
import { chevron, diagonalAccent, snakeSkin, spiral, stochastic, stripes, threeWoodBands, zigZag } from './patterns.js';

const S = DEFAULT_SHOP;
const WOODS = ['hard-maple', 'black-walnut'];

const PATTERNS = [
  ['stripes', () => stripes(WOODS, inches(1.5), 8, S)],
  ['threeWoodBands', () => threeWoodBands('hard-maple', 'black-walnut', 'black-cherry', inches(1.5), 9, S)],
  ['diagonalAccent', () => diagonalAccent('hard-maple', 'black-walnut', inches(1.5), 8, [3], degrees(12), S)],
  ['stochastic', () => stochastic([...WOODS, 'black-cherry'], inches(1.5), 8, 42, S)],
  ['zigZag', () => zigZag(WOODS, inches(1.5), 8, degrees(15), S)],
  ['chevron', () => chevron(WOODS, inches(1.5), 8, degrees(15), S)],
  ['snakeSkin', () => snakeSkin(WOODS, inches(1.5), 8, degrees(20), S)],
  ['spiral', () => spiral(WOODS, inches(1.5), 8, degrees(25), S)],
] as const;

describe('every pattern builds a valid board', () => {
  it.each(PATTERNS.map(([name]) => name))('%s evaluates', (name) => {
    const make = PATTERNS.find(([n]) => n === name)![1];
    const { graph } = make();
    const result = evaluate(graph, S);
    expect(result.workpiece.orientation).toBe('endGrain');
  });

  it.each(PATTERNS.map(([name]) => name))('%s tiles its face exactly', (name) => {
    const make = PATTERNS.find(([n]) => n === name)![1];
    const result = evaluate(make().graph, S);
    expect(checkTiling(result.workpiece.crossSection).ok).toBe(true);
  });

  it.each(PATTERNS.map(([name]) => name))('%s conserves mass', (name) => {
    const make = PATTERNS.find(([n]) => n === name)![1];
    const result = evaluate(make().graph, S);
    const out = workpieceVolumeBySpecies(result.workpiece);
    const { input, kerf, removed, offcut } = result.ledger;
    for (const id of Object.keys(input)) {
      const accounted = (out[id] ?? 0) + (kerf[id] ?? 0) + (removed[id] ?? 0) + (offcut[id] ?? 0);
      expect(Math.abs(accounted - input[id]!) / input[id]!).toBeLessThan(1e-9);
    }
  });

  it.each(PATTERNS.map(([name]) => name))('%s stays inside the end-grain material band', (name) => {
    const make = PATTERNS.find(([n]) => n === name)![1];
    const result = evaluate(make().graph, S);
    const d = boardDimensions(result.workpiece);
    const finished = toInches(d.width) * toInches(d.length) * toInches(d.thickness);
    const input = Object.values(result.ledger.input).reduce((s, v) => s + v, 0);
    // End-grain construction runs 1.5x to 2.5x the finished volume (KB-A12).
    expect(input / finished).toBeGreaterThan(1.4);
    expect(input / finished).toBeLessThan(2.6);
  });
});

/* -------------------------------------------------------------------------- */
/* Bevel geometry                                                              */
/* -------------------------------------------------------------------------- */

describe('bevelled strips', () => {
  it('produces the expected trapezoid from a square-edged billet', () => {
    const T = inches(1.5);
    const billet = singleFacePartition(rectangle(0, 0, inches(12), T), 'hard-maple', 'p', 'quartersawn');
    const cut = cutPartition(billet, { atBase: inches(1.5), bevel: degrees(15), kerf: inches(0.125) });
    // Square left edge from the billet; slanted right edge from the blade.
    expect(toInches(polyWidth(cut.keep.outline))).toBeCloseTo(1.5 + 1.5 * Math.tan((15 * Math.PI) / 180), 3);
  });

  it('conserves area exactly even with a bevel', () => {
    const billet = singleFacePartition(rectangle(0, 0, inches(12), inches(1.5)), 'hard-maple', 'p', 'quartersawn');
    const before = area(billet.outline);
    const cut = cutPartition(billet, { atBase: inches(3), bevel: degrees(30), kerf: inches(0.125) });
    const after = area(cut.keep.outline) + area(cut.offcut.outline) + cut.kerfArea;
    expect(Math.abs(after - before) / before).toBeLessThan(1e-6);
  });

  it('measures the fence setting at the table face, not the bounding box', () => {
    // For a left edge leaning away from the table the two differ by
    // thickness x tan(angle). Using the bounding box broke every
    // varying-angle pattern while uniform ones happened to work.
    const T = inches(1.5);
    const billet = singleFacePartition(rectangle(0, 0, inches(12), T), 'hard-maple', 'p', 'quartersawn');
    const first = cutPartition(billet, { atBase: inches(2), bevel: degrees(-20), kerf: inches(0.125) });
    const leaning = normalisePartition(first.offcut);

    const bboxMin = Math.min(...leaning.outline.map((p) => p.x));
    const tableFace = leftEdgeAtTableFace(leaning);
    expect(tableFace).toBeGreaterThan(bboxMin);
    expect(toInches(tableFace - bboxMin)).toBeCloseTo(1.5 * Math.tan((20 * Math.PI) / 180), 3);
  });
});

describe('butted lamination', () => {
  function strips(bevelDeg: number, count: number) {
    let remaining = singleFacePartition(
      rectangle(0, 0, inches(24), inches(1.5)), 'hard-maple', 'p', 'quartersawn',
    );
    const out = [];
    for (let i = 0; i < count; i++) {
      const c = cutPartition(remaining, {
        atBase: leftEdgeAtTableFace(remaining) + inches(1.5),
        bevel: degrees(bevelDeg),
        kerf: inches(0.125),
      });
      out.push(normalisePartition(c.keep));
      remaining = normalisePartition(c.offcut);
    }
    return out;
  }

  it('does not overlap slanted members', () => {
    // Placing by bounding box made 15-degree strips overlap by 68%: slanted
    // strips interlock, so their boxes do not.
    const result = laminateButted(strips(15, 4));
    expect(result.gapArea).toBeGreaterThanOrEqual(0);
    expect(Math.abs(result.gapArea)).toBeLessThan(result.tolerance);
  });

  it('butts against the previous member, not the running union', () => {
    // The union's outline is a bounding box whose right edge sits outside the
    // true slanted edge; butting against it pushes each strip further out than
    // the last and the error compounds along the panel.
    const result = laminateButted(strips(15, 4));
    const expected = 4 * 1.5 + 1.5 * Math.tan((15 * Math.PI) / 180);
    expect(toInches(polyWidth(result.partition.outline))).toBeCloseTo(expected, 3);
  });

  it('is exact for square cuts', () => {
    expect(laminateButted(strips(0, 4)).gapArea).toBe(0);
  });

  it('scales its tolerance with member count, not just the outline', () => {
    // Each member carries its own sub-tick boundary error, so stacking members
    // multiplies it. A bound taken from the outline alone is ~4.5x too tight
    // for a ten-slice board.
    const few = laminateButted(strips(15, 2));
    const many = laminateButted(strips(15, 8));
    expect(many.tolerance).toBeGreaterThan(few.tolerance);
  });
});

/* -------------------------------------------------------------------------- */
/* Stock sizing                                                                */
/* -------------------------------------------------------------------------- */

describe('stock sizing for bevelled cuts', () => {
  it('allows for the sideways drift across the thickness', () => {
    // Stock sized from table-face widths alone runs out at the top face and
    // truncates the last strip to the wrong SHAPE. Mass is still conserved, so
    // that check cannot see it; the tiling check is what catches it.
    const { graph } = spiral(WOODS, inches(1.5), 8, degrees(25), S);
    expect(() => evaluate(graph, S)).not.toThrow();
  });

  it('refuses a rip it cannot deliver rather than returning what is left', () => {
    const { graph } = spiral(WOODS, inches(1.5), 6, degrees(20), S);
    const starved = {
      ...graph,
      nodes: Object.fromEntries(
        Object.entries(graph.nodes).map(([id, node]) => [
          id,
          node.op.kind === 'billet'
            ? { ...node, op: { ...node.op, milled: { ...node.op.milled, width: inches(2) } } }
            : node,
        ]),
      ),
    };
    expect(() => evaluate(starved, S)).toThrow(/too narrow/);
  });
});

/* -------------------------------------------------------------------------- */
/* Pattern semantics                                                           */
/* -------------------------------------------------------------------------- */

describe('pattern semantics', () => {
  it('chevron mirrors where zig-zag rotates', () => {
    // Different operations with different results. Conflating them is a common
    // way to get the wrong pattern.
    const z = zigZag(WOODS, inches(1.5), 8, degrees(15), S);
    const c = chevron(WOODS, inches(1.5), 8, degrees(15), S);
    const zOp = Object.values(z.graph.nodes).filter((n) => n.op.kind === 'laminate').pop()!;
    const cOp = Object.values(c.graph.nodes).filter((n) => n.op.kind === 'laminate').pop()!;
    if (zOp.op.kind !== 'laminate' || cOp.op.kind !== 'laminate') throw new Error('expected laminates');
    expect(zOp.op.members.some((m) => m.rotate180)).toBe(true);
    expect(zOp.op.members.some((m) => m.mirrored)).toBe(false);
    expect(cOp.op.members.some((m) => m.mirrored)).toBe(true);
    expect(cOp.op.members.some((m) => m.rotate180)).toBe(false);
  });

  it('glues angled panels row by row, since angled joints slide', () => {
    const { graph } = zigZag(WOODS, inches(1.5), 8, degrees(15), S);
    const panel = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.placement === 'butted',
    );
    expect(panel).toBeDefined();
    if (panel?.op.kind === 'laminate') expect(panel.op.sequence).toBe('rowByRow');
  });

  it('needs no setup cuts when every boundary is square', () => {
    expect(stripes(WOODS, inches(1.5), 8, S).derived.setupCuts).toBe(0);
  });

  it('needs a setup cut per differing boundary when angles vary', () => {
    // Varying angles genuinely cost material: each strip needs its own pair of
    // bevel settings, and the ledger shows it rather than hiding it.
    expect(snakeSkin(WOODS, inches(1.5), 8, degrees(20), S).derived.setupCuts).toBeGreaterThan(1);
  });

  it('is reproducible from its seed', () => {
    const a = stochastic(WOODS, inches(1.5), 8, 7, S);
    const b = stochastic(WOODS, inches(1.5), 8, 7, S);
    expect(JSON.stringify(a.graph)).toBe(JSON.stringify(b.graph));
  });

  it('keeps the panel rectangular by squaring both outer edges', () => {
    // CBDJS leaves the far edge ragged and reports the maximum width; squaring
    // it means nothing has to be trimmed off the sides.
    const result = evaluate(zigZag(WOODS, inches(1.5), 8, degrees(20), S).graph, S);
    const d = boardDimensions(result.workpiece);
    expect(toInches(d.width)).toBeCloseTo(8 * 1.5 - 0.125, 6);
  });
});

describe('angled patterns over arbitrary parameters', () => {
  it('conserve mass and tile for any angle and count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: -30_000, max: 30_000 }),
        (count, angleMilli) => {
          const { graph } = zigZag(WOODS, inches(1.5), count, angleMilli as never, S);
          const result = evaluate(graph, S);
          expect(checkTiling(result.workpiece.crossSection).ok).toBe(true);
          const out = workpieceVolumeBySpecies(result.workpiece);
          const { input, kerf, removed, offcut } = result.ledger;
          for (const id of Object.keys(input)) {
            const accounted =
              (out[id] ?? 0) + (kerf[id] ?? 0) + (removed[id] ?? 0) + (offcut[id] ?? 0);
            expect(Math.abs(accounted - input[id]!) / input[id]!).toBeLessThan(1e-9);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
