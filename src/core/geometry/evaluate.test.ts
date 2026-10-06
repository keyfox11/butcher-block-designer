import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_SHOP } from '../model/defaults.js';
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
