import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_SHOP, DEFAULT_TRIM_PER_EDGE } from '../model/defaults.js';
import { checkerboard } from '../generators/checkerboard.js';
import { TICKS_PER_INCH, inches, toInches } from '../units/ticks.js';
import {
  evaluate,
  boardDimensions,
  maxSlices,
  volumeCuIn,
  workpieceVolumeBySpecies,
} from './evaluate.js';
import { area } from './polygon.js';
import { checkTiling } from './partition.js';

const shop = DEFAULT_SHOP;

/* -------------------------------------------------------------------------- */
/* Golden case G1 — CBDJS published defaults                                   */
/* -------------------------------------------------------------------------- */

describe('golden case G1: CBDJS defaults', () => {
  // CBDJS reports slices 12, end-grain length 14.4, leftover 0.625 for
  // L=20, D=1.2, s=1.5, kerf=0.125. Reproducing all three exactly is the
  // anchor for the whole dimensional model (KB-A03).
  const L = inches(20);
  const D = inches(1.2);
  const s = inches(1.5);
  const kerf = inches(0.125);

  it('computes 12 slices', () => {
    expect(maxSlices(L, s, kerf)).toBe(12);
  });

  it('computes a finished length of exactly 14.4"', () => {
    const slices = maxSlices(L, s, kerf);
    const length = slices * D;
    expect(length).toBe(115_200);
    expect(toInches(length)).toBe(14.4);
  });

  it('computes a leftover of exactly 0.625"', () => {
    const slices = maxSlices(L, s, kerf);
    const leftover = L - (slices * s + (slices - 1) * kerf);
    expect(toInches(leftover)).toBe(0.625);
  });

  it('stays exact in integer arithmetic', () => {
    // 1.2" is 9600 ticks exactly. On a 1/1024 base it would not be, and this
    // golden case could not be reproduced without rounding.
    expect(D).toBe(9600);
    expect(Number.isInteger(12 * D)).toBe(true);
  });

  it('applies the +1 correction the naive floor misses', () => {
    // The naive floor assumes a kerf after the last slice. With a remainder
    // between one slice and one slice plus a kerf, it under-counts by one.
    const panel = inches(3.125);
    const slice = inches(1.5);
    expect(Math.floor(panel / (slice + kerf))).toBe(1);
    expect(maxSlices(panel, slice, kerf)).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Golden case G4 — Old Line Woodcraft's calculator                            */
/* -------------------------------------------------------------------------- */

/**
 * The second independent source, and the only one that runs the arithmetic
 * BACKWARDS: you state the finished board and it returns the slab to build.
 * G1 runs forwards (slab -> board), so between them the dimensional model is
 * pinned from both ends (KB-A13).
 *
 * Our generators are grid-first -- you set cells, and the finished size is
 * derived -- so the two tools place the squaring allowance on opposite sides of
 * the same number. Old Line ADDS it to the slab; we SUBTRACT it from the grid.
 * Asserting their raw slab dimensions would therefore encode our convention as
 * if it were theirs. What is genuinely shared, and what is asserted here, is
 * the slab length consumed by crosscutting and the SIZE of the reserve.
 */
describe('golden case G4: Old Line, planning backwards from the finished board', () => {
  const kerf = DEFAULT_SHOP.kerf;
  const squaring = 2 * DEFAULT_TRIM_PER_EDGE;

  // Their square-up end-trim is 1/8", applied once. Ours is 1/16" per edge.
  // The two conventions only line up because the totals agree, so if either
  // default moves, this equality is the thing that should fail first.
  it('reserves the same total for squaring, however it is apportioned', () => {
    expect(squaring).toBe(inches(0.125));
  });

  /**
   * Their shipped defaults: finished 18" x 12" x 1-1/2" from a 3/4" slab,
   * kerf 1/8", cleanup 1/8" per face, end-trim 1/8". Reported: a slab
   * 44-7/8" x 12-1/8" x 3/4", crosscut 1-3/4", 24 segments, 2.83 BF.
   *
   * Mapped onto a checkerboard: the pitch IS the cell, so a 3/4" cell with 16
   * columns and 24 rows is the same board.
   */
  describe('their default board, as a 16 x 24 grid of 3/4" cells', () => {
    const { derived } = checkerboard(
      {
        cellSize: inches(0.75),
        speciesA: 'hard-maple',
        speciesB: 'black-walnut',
        columns: 16,
        rows: 24,
        boardThickness: inches(1.5),
      },
      shop,
    );

    it('crosscuts at 1-3/4" for a 1-1/2" board', () => {
      // finished thickness + 2 faces of cleanup. Both tools default to 1/8".
      expect(toInches(derived.sliceLength)).toBe(1.75);
    });

    it('consumes 44-7/8" of slab length for 24 segments', () => {
      // n*s + (n-1)*kerf = 24*1.75 + 23*0.125. The (n-1) is the same fact the
      // +1 correction in G1 expresses from the other direction: there is no
      // kerf after the final slice.
      expect(toInches(derived.panelLength - squaring)).toBe(44.875);
    });

    it('loses 2-7/8" to the blade across 23 crosscuts', () => {
      expect(toInches(23 * kerf)).toBe(2.875);
    });

    it('carries the preserved dimension straight through the slab', () => {
      // Their slab is 12-1/8" and yields 12"; ours is 12" and yields 11-7/8".
      // Same reserve, opposite side of the finished number.
      expect(toInches(derived.panelWidth)).toBe(12);
      expect(derived.panelWidth - derived.finishedWidth).toBe(squaring);
    });

    it('builds the segment-built dimension out of whole pitches', () => {
      expect(toInches(24 * inches(0.75))).toBe(18);
      expect(derived.finishedLength).toBe(inches(18) - squaring);
    });
  });

  /**
   * A second capture at a different segment count, because one fixture cannot
   * distinguish the (n-1) kerf rule from an n-kerf rule that happens to agree.
   * Finished 16.3" x 12" from a 1" slab: they report 17 segments and a
   * 31-3/4" slab -- and a finished length of 17", having rounded the request
   * UP to a whole pitch rather than down.
   */
  describe('a second capture at n = 17, from a 1" slab', () => {
    const { derived } = checkerboard(
      {
        cellSize: inches(1),
        speciesA: 'hard-maple',
        speciesB: 'black-walnut',
        columns: 12,
        rows: 17,
        boardThickness: inches(1.5),
      },
      shop,
    );

    it('consumes 31-3/4" of slab length', () => {
      expect(toInches(derived.panelLength - squaring)).toBe(31.75);
    });

    it('reaches the same crosscut width from a different slab thickness', () => {
      // The crosscut depends only on the finished thickness, never on the
      // pitch. Easy to get wrong, and the two captures disagree on the pitch.
      expect(toInches(derived.sliceLength)).toBe(1.75);
    });
  });

  it('quantises the built dimension, which is why we take cells as the input', () => {
    // Their 16.3" request became a 17" board: ceil(16.3 / 1), not round. A
    // finished-first front end has to decide what to do with that 0.7", and
    // taking the grid as the input means the question never arises -- the
    // tradeoff being that the finished size is then the derived quantity.
    expect(Math.ceil(16.3 / 1)).toBe(17);
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end checkerboard                                                     */
/* -------------------------------------------------------------------------- */

describe('checkerboard, end to end', () => {
  const params = {
    cellSize: inches(1.5),
    speciesA: 'hard-maple',
    speciesB: 'black-walnut',
    columns: 8,
    rows: 10,
    boardThickness: inches(1.5),
  } as const;

  const { graph, derived } = checkerboard(params, shop);
  const result = evaluate(graph, shop);

  it('produces an end-grain board', () => {
    expect(result.workpiece.orientation).toBe('endGrain');
  });

  it('cuts slices oversize by the flattening allowance', () => {
    // 1.5" finished + 2 x 1/8" removed = 1.75" at the saw.
    expect(toInches(derived.sliceLength)).toBe(1.75);
  });

  it('finishes at the expected dimensions', () => {
    const dims = boardDimensions(result.workpiece);
    // 8 cells x 1.5" = 12.0" panel, less 1/16" trim per edge.
    expect(toInches(dims.width)).toBe(11.875);
    // 10 slices x 1.5" pitch = 15.0", less trim.
    expect(toInches(dims.length)).toBe(14.875);
    expect(toInches(dims.thickness)).toBe(1.5);
  });

  it('tiles its face with no gaps or overlaps', () => {
    expect(checkTiling(result.workpiece.crossSection).ok).toBe(true);
  });

  it('produces a true checkerboard, not stripes', () => {
    // Sample the face on a grid at cell centres and confirm neighbours differ.
    const cell = inches(1.5);
    const speciesAt = (col: number, row: number): string => {
      const x = col * cell + cell / 2;
      const y = row * cell + cell / 2;
      const face = result.workpiece.crossSection.faces.find((f) => pointInPolygon(f.polygon, x, y));
      return face?.species ?? 'none';
    };

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 7; col++) {
        expect(speciesAt(col, row)).not.toBe('none');
        expect(speciesAt(col, row)).not.toBe(speciesAt(col + 1, row));
        expect(speciesAt(col, row)).not.toBe(speciesAt(col, row + 1));
      }
    }
  });

  it('conserves mass across the whole graph', () => {
    const output = workpieceVolumeBySpecies(result.workpiece);
    const { input, kerf, removed, offcut } = result.ledger;

    for (const id of Object.keys(input)) {
      const accounted =
        (output[id] ?? 0) + (kerf[id] ?? 0) + (removed[id] ?? 0) + (offcut[id] ?? 0);
      expect(Math.abs(accounted - input[id]!) / input[id]!).toBeLessThan(1e-9);
    }
  });

  it('needs more lumber than the finished board, as end grain always does', () => {
    const output = workpieceVolumeBySpecies(result.workpiece);
    const totalIn = Object.values(result.ledger.input).reduce((s, v) => s + v, 0);
    const totalOut = Object.values(output).reduce((s, v) => s + v, 0);
    expect(totalIn).toBeGreaterThan(totalOut);
  });
});

/* -------------------------------------------------------------------------- */
/* The odd-column problem                                                      */
/* -------------------------------------------------------------------------- */

describe('odd column counts', () => {
  // Rotating a slice reverses its species sequence, which only produces an
  // offset when the count is even. An odd count needs two inverted panels.
  const odd = checkerboard(
    {
      cellSize: inches(1.5),
      speciesA: 'hard-maple',
      speciesB: 'black-walnut',
      columns: 7,
      rows: 6,
      boardThickness: inches(1.5),
    },
    shop,
  );

  it('builds two stage-1 panels', () => {
    expect(odd.derived.panelCount).toBe(2);
  });

  it('still produces a true checkerboard', () => {
    const result = evaluate(odd.graph, shop);
    const cell = inches(1.5);
    const speciesAt = (col: number, row: number): string => {
      const face = result.workpiece.crossSection.faces.find((f) =>
        pointInPolygon(f.polygon, col * cell + cell / 2, row * cell + cell / 2),
      );
      return face?.species ?? 'none';
    };
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        expect(speciesAt(col, row)).not.toBe(speciesAt(col + 1, row));
        expect(speciesAt(col, row)).not.toBe(speciesAt(col, row + 1));
      }
    }
  });

  it('uses a single panel when the count is even', () => {
    const even = checkerboard(
      {
        cellSize: inches(1.5),
        speciesA: 'hard-maple',
        speciesB: 'black-walnut',
        columns: 8,
        rows: 6,
        boardThickness: inches(1.5),
      },
      shop,
    );
    expect(even.derived.panelCount).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Conservation of mass, over arbitrary designs                                */
/* -------------------------------------------------------------------------- */

describe('conservation of mass (property)', () => {
  // A physical conservation law holds for ANY graph, so it catches a whole
  // class of defects without anyone anticipating the specific failure: a bevel
  // with the wrong sign, kerf counted per strip instead of per cut, a dropped
  // offcut, a flatten removing from the wrong axis.
  it('holds for arbitrary checkerboard parameters', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.integer({ min: 2, max: 9 }),
        fc.integer({ min: 4000, max: 16_000 }),
        fc.integer({ min: 9000, max: 20_000 }),
        (columns, rows, cellSize, boardThickness) => {
          const { graph } = checkerboard(
            {
              cellSize: cellSize as never,
              speciesA: 'hard-maple',
              speciesB: 'black-walnut',
              columns,
              rows,
              boardThickness: boardThickness as never,
            },
            shop,
          );
          const result = evaluate(graph, shop);
          const output = workpieceVolumeBySpecies(result.workpiece);
          const { input, kerf, removed, offcut } = result.ledger;

          for (const id of Object.keys(input)) {
            const accounted =
              (output[id] ?? 0) + (kerf[id] ?? 0) + (removed[id] ?? 0) + (offcut[id] ?? 0);
            expect(Math.abs(accounted - input[id]!) / input[id]!).toBeLessThan(1e-9);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('volumeCuIn', () => {
  it('converts tick area and length to cubic inches', () => {
    const a = inches(12) * inches(1.5); // sq ticks
    expect(volumeCuIn(a, inches(14.4))).toBeCloseTo(12 * 1.5 * 14.4, 6);
  });

  it('matches polygon area for a rectangle', () => {
    const w = inches(3);
    const h = inches(2);
    expect(area([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ])).toBe(w * h);
    expect((w * h) / (TICKS_PER_INCH * TICKS_PER_INCH)).toBe(6);
  });
});

/** Ray-cast point-in-polygon, for sampling the face pattern in tests. */
function pointInPolygon(poly: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
