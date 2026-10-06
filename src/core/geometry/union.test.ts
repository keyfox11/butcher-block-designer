import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Polygon } from './polygon.js';
import { GeometryError, area, isCounterClockwise, rectangle, translate } from './polygon.js';
import { WELD_TICKS, singleOutline, unionOutline } from './union.js';

/** Pointy-top hexagon on the exact integer lattice derived in KB-A05. */
function hexagon(cx: number, cy: number, acrossFlatsHalf: number, quarterDiagonal: number) {
  const t = acrossFlatsHalf;
  const h = quarterDiagonal;
  return [
    { x: cx + t, y: cy - h },
    { x: cx + t, y: cy + h },
    { x: cx, y: cy + 2 * h },
    { x: cx - t, y: cy + h },
    { x: cx - t, y: cy - h },
    { x: cx, y: cy - 2 * h },
  ];
}

describe('unionOutline', () => {
  it('returns the polygon itself for a single member', () => {
    const r = rectangle(0, 0, 100, 50);
    const u = unionOutline([r]);
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(0);
    expect(u.area).toBe(5000);
  });

  it('merges two rectangles sharing a full edge', () => {
    const left = rectangle(0, 0, 100, 50);
    const right = rectangle(100, 0, 100, 50);
    const u = unionOutline([left, right]);
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(0);
    expect(area(u.outer[0]!)).toBe(10_000);
    expect(isCounterClockwise(u.outer[0]!)).toBe(true);
  });

  it('merges across a T-junction, where no two edges match end to end', () => {
    // One tall block against two short ones: the long edge has a corner
    // landing halfway along it, so cancellation only works after splitting.
    const tall = rectangle(0, 0, 100, 100);
    const lowerRight = rectangle(100, 0, 100, 50);
    const upperRight = rectangle(100, 50, 100, 50);
    const u = unionOutline([tall, lowerRight, upperRight]);
    expect(u.holes).toHaveLength(0);
    expect(u.outer).toHaveLength(1);
    expect(area(u.outer[0]!)).toBe(20_000);
  });

  it('keeps a concave union concave rather than filling it to a bounding box', () => {
    const foot = rectangle(0, 0, 200, 50);
    const upright = rectangle(0, 50, 50, 150);
    const u = unionOutline([foot, upright]);
    expect(u.outer).toHaveLength(1);
    // An L, not its 200x200 bounding box.
    expect(area(u.outer[0]!)).toBe(200 * 50 + 50 * 150);
  });

  it('finds an enclosed gap as a hole, not as an area discrepancy', () => {
    // Eight cells of a 3x3 grid. The missing centre is surrounded by material.
    const cells: Polygon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        cells.push(rectangle(col * 100, row * 100, 100, 100));
      }
    }
    const u = unionOutline(cells);
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(1);
    expect(area(u.holes[0]!)).toBe(10_000);
    expect(u.area).toBe(80_000);
  });

  it('reports disconnected members rather than pretending they are one board', () => {
    const a = rectangle(0, 0, 100, 100);
    const b = rectangle(500, 0, 100, 100);
    const u = unionOutline([a, b]);
    expect(u.outer).toHaveLength(2);
    expect(u.area).toBe(20_000);
  });

  it('traces two cells touching at a single corner as one ring', () => {
    const lower = rectangle(0, 0, 100, 100);
    const upper = rectangle(100, 100, 100, 100);
    const u = unionOutline([lower, upper]);
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(0);
    expect(area(u.outer[0]!)).toBe(20_000);
  });

  it('welds corners that disagree by less than the weld radius', () => {
    const left = rectangle(0, 0, 100, 50);
    // Butted a tick short -- the rounding a rotation leaves behind, not a gap.
    const right = translate(rectangle(0, 0, 100, 50), 100 - 1, 0);
    const u = unionOutline([left, right]);
    expect(u.outer).toHaveLength(1);
    expect(u.holes).toHaveLength(0);
  });

  it('does not weld a genuine gap shut', () => {
    const left = rectangle(0, 0, 100, 50);
    const right = translate(rectangle(0, 0, 100, 50), 100 + 10 * WELD_TICKS, 0);
    const u = unionOutline([left, right]);
    expect(u.outer).toHaveLength(2);
  });

  it('rejects an empty member list', () => {
    expect(() => unionOutline([])).toThrow(GeometryError);
  });
});

describe('unionOutline on a honeycomb', () => {
  // The exact integer hexagon of KB-A05: across-flats 2T, and the lattice
  // spacings written in terms of the same integer h so mating edges coincide
  // by construction rather than by luck.
  const T = 10_000;
  const h = Math.round(T / Math.sqrt(3));

  it('tiles a lattice row with no holes', () => {
    const cells = [0, 1, 2, 3].map((i) => hexagon(i * 2 * T, 0, T, h));
    const u = unionOutline(cells);
    expect(u.holes).toHaveLength(0);
    expect(u.outer).toHaveLength(1);
    const expected = cells.reduce((sum, c) => sum + area(c), 0);
    expect(u.area).toBeCloseTo(expected, 6);
  });

  it('closes across offset rows, which is where the lattice is actually tested', () => {
    const cells: Polygon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        cells.push(hexagon(col * 2 * T + (row % 2) * T, row * 3 * h, T, h));
      }
    }
    const u = unionOutline(cells);
    expect(u.holes).toHaveLength(0);
    const expected = cells.reduce((sum, c) => sum + area(c), 0);
    expect(u.area).toBeCloseTo(expected, 6);
  });

  it('catches a single missing puck in the middle of a honeycomb', () => {
    const cells: Polygon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        cells.push(hexagon(col * 2 * T + (row % 2) * T, row * 3 * h, T, h));
      }
    }
    const u = unionOutline(cells);
    expect(u.holes).toHaveLength(1);
    expect(area(u.holes[0]!)).toBeGreaterThan(0);
  });
});

describe('singleOutline', () => {
  it('names the gap rather than returning a plausible outline', () => {
    const cells: Polygon[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        cells.push(rectangle(col * 100, row * 100, 100, 100));
      }
    }
    expect(() => singleOutline(cells, 'test')).toThrow(/encloses 1 gap/);
  });

  it('names a split assembly', () => {
    expect(() =>
      singleOutline([rectangle(0, 0, 10, 10), rectangle(500, 0, 10, 10)], 'test'),
    ).toThrow(/disconnected/);
  });
});

describe('unionOutline properties', () => {
  it('conserves area for any run of butted rectangles', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 50, max: 5000 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 50, max: 5000 }),
        (widths, height) => {
          let x = 0;
          const cells = widths.map((w) => {
            const r = rectangle(x, 0, w, height);
            x += w;
            return r;
          });
          const u = unionOutline(cells);
          expect(u.holes).toHaveLength(0);
          expect(u.outer).toHaveLength(1);
          expect(u.area).toBe(x * height);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('conserves area for any sub-rectangle of a grid that stays connected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 10, max: 900 }),
        (cols, rows, cell) => {
          const cells: Polygon[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) cells.push(rectangle(c * cell, r * cell, cell, cell));
          }
          const u = unionOutline(cells);
          expect(u.holes).toHaveLength(0);
          expect(u.area).toBe(cols * rows * cell * cell);
        },
      ),
      { numRuns: 200 },
    );
  });
});
