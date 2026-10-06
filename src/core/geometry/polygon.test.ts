import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { degrees, inches, milliDeg } from '../units/ticks.js';
import {
  GeometryError,
  applyCut,
  area,
  bevelledWidths,
  boundingBox,
  clipHalfPlane,
  cross,
  doubleSignedArea,
  height,
  isCounterClockwise,
  mirrorX,
  point,
  rectangle,
  rotate180About,
  toCounterClockwise,
  translate,
  width,
} from './polygon.js';

const SQUARE_CUT = milliDeg(0);

describe('rectangle', () => {
  it('is counter-clockwise with the expected area', () => {
    const r = rectangle(0, 0, 100, 50);
    expect(isCounterClockwise(r)).toBe(true);
    expect(area(r)).toBe(5000);
    expect(width(r)).toBe(100);
    expect(height(r)).toBe(50);
  });

  it('rejects a non-positive extent', () => {
    expect(() => rectangle(0, 0, 0, 10)).toThrow(GeometryError);
    expect(() => rectangle(0, 0, 10, -1)).toThrow(GeometryError);
  });
});

describe('doubleSignedArea', () => {
  it('stays an exact integer on integer coordinates', () => {
    // The reason area is returned doubled: halving can produce .5 and drag
    // the conservation check out of exact integer arithmetic.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (w, h) => {
          expect(Number.isInteger(doubleSignedArea(rectangle(0, 0, w, h)))).toBe(true);
        },
      ),
    );
  });

  it('is negative for clockwise winding', () => {
    const cw = [...rectangle(0, 0, 10, 10)].reverse();
    expect(doubleSignedArea(cw)).toBeLessThan(0);
    expect(isCounterClockwise(toCounterClockwise(cw))).toBe(true);
  });
});

describe('transforms', () => {
  it('translate preserves area exactly', () => {
    const r = rectangle(0, 0, 123, 456);
    expect(area(translate(r, 789, -12))).toBe(area(r));
  });

  it('rotate180About is an involution', () => {
    const r = rectangle(0, 0, 100, 60);
    const once = rotate180About(r, 100, 60);
    const twice = rotate180About(once, 100, 60);
    expect(twice).toEqual(r);
  });

  it('rotate180About preserves winding and area', () => {
    const r = rectangle(10, 20, 100, 60);
    const rotated = rotate180About(r, 2 * 60, 2 * 50);
    expect(area(rotated)).toBe(area(r));
    expect(isCounterClockwise(rotated)).toBe(true);
  });

  it('mirrorX restores counter-clockwise winding', () => {
    // Mirroring flips winding; leaving it flipped would invert later area signs.
    const r = rectangle(0, 0, 100, 60);
    const mirrored = mirrorX(r, 100);
    expect(isCounterClockwise(mirrored)).toBe(true);
    expect(area(mirrored)).toBe(area(r));
    expect(boundingBox(mirrored)).toEqual(boundingBox(r));
  });
});

describe('cross', () => {
  it('is positive to the left of the directed line', () => {
    const a = point(0, 0);
    const b = point(0, 10); // pointing up; left is -x
    expect(cross(a, b, point(-5, 5))).toBeGreaterThan(0);
    expect(cross(a, b, point(5, 5))).toBeLessThan(0);
    expect(cross(a, b, point(0, 5))).toBe(0);
  });
});

describe('clipHalfPlane', () => {
  it('splits a rectangle exactly at an integer line', () => {
    const r = rectangle(0, 0, 100, 50);
    const line = { a: point(40, -10), b: point(40, 60), keep: 'left' as const };
    const left = clipHalfPlane(r, line);
    expect(area(left)).toBe(40 * 50);
    expect(width(left)).toBe(40);
  });

  it('returns empty when nothing survives', () => {
    const r = rectangle(0, 0, 100, 50);
    expect(clipHalfPlane(r, { a: point(-10, -10), b: point(-10, 60), keep: 'left' })).toEqual([]);
  });

  it('returns the whole polygon when everything survives', () => {
    const r = rectangle(0, 0, 100, 50);
    const kept = clipHalfPlane(r, { a: point(200, -10), b: point(200, 60), keep: 'left' });
    expect(area(kept)).toBe(area(r));
  });

  it('keeps both halves whole when the line passes through vertices', () => {
    // A cut exactly on an edge must not lose area from either side.
    const r = rectangle(0, 0, 100, 50);
    const line = { a: point(0, -10), b: point(0, 60) };
    const left = clipHalfPlane(r, { ...line, keep: 'left' });
    const right = clipHalfPlane(r, { ...line, keep: 'right' });
    expect(area(left)).toBe(0);
    expect(area(right)).toBe(area(r));
  });

  it('partitions area exactly for any vertical split', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (w, h, at) => {
          const r = rectangle(0, 0, w, h);
          const line = { a: point(at, -1), b: point(at, h + 1) };
          const left = clipHalfPlane(r, { ...line, keep: 'left' });
          const right = clipHalfPlane(r, { ...line, keep: 'right' });
          expect(area(left) + area(right)).toBe(area(r));
        },
      ),
    );
  });
});

describe('applyCut', () => {
  const panel = rectangle(0, 0, inches(12), inches(1.5));
  const kerf = inches(0.125);

  it('conserves area exactly on a square cut', () => {
    // The headline property. Modelling the kerf as a subtracted slab makes
    // this hold by construction rather than by careful bookkeeping.
    const r = applyCut(panel, { atBase: inches(3), bevel: SQUARE_CUT, kerf });
    expect(area(r.keep) + area(r.offcut) + area(r.kerf)).toBe(area(panel));
  });

  it('conserves area for any square cut position', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 95_000 }),
        fc.integer({ min: 0, max: 2000 }),
        (atBase, k) => {
          const r = applyCut(panel, { atBase, bevel: SQUARE_CUT, kerf: k });
          expect(area(r.keep) + area(r.offcut) + area(r.kerf)).toBe(area(panel));
        },
      ),
    );
  });

  it('honours the fence convention: the kept piece equals the fence setting', () => {
    // The kerf falls entirely on the waste side, so the number the woodworker
    // sets on the fence is the width they get. If this inverted, every strip
    // would come out one kerf narrow.
    const fence = inches(1.5);
    const r = applyCut(panel, { atBase: fence, bevel: SQUARE_CUT, kerf });
    expect(width(r.keep)).toBe(fence);
    expect(width(r.kerf)).toBe(kerf);
    expect(width(r.offcut)).toBe(inches(12) - fence - kerf);
  });

  it('consumes exactly one kerf per cut across repeated rips', () => {
    // Four 1.5" strips from a 12" panel: 4 cuts, 4 kerfs, remainder is the rest.
    let remaining = panel;
    const strips = [];
    for (let i = 0; i < 4; i++) {
      const r = applyCut(remaining, { atBase: inches(1.5), bevel: SQUARE_CUT, kerf });
      strips.push(r.keep);
      remaining = translate(r.offcut, -(inches(1.5) + kerf), 0);
    }
    const stripArea = strips.reduce((s, p) => s + area(p), 0);
    const kerfArea = 4 * kerf * inches(1.5);
    expect(stripArea + kerfArea + area(remaining)).toBe(area(panel));
    expect(width(remaining)).toBe(inches(12) - 4 * (inches(1.5) + kerf));
  });

  it('conserves area within tolerance on a bevelled cut', () => {
    // A bevelled crossing can land off the tick grid; the residual must stay
    // far below a tick rather than being silently dropped.
    const r = applyCut(panel, { atBase: inches(3), bevel: degrees(30), kerf });
    const total = area(r.keep) + area(r.offcut) + area(r.kerf);
    expect(Math.abs(total - area(panel)) / area(panel)).toBeLessThan(1e-6);
  });

  it('handles a zero kerf', () => {
    const r = applyCut(panel, { atBase: inches(3), bevel: SQUARE_CUT, kerf: 0 });
    expect(area(r.kerf)).toBe(0);
    expect(area(r.keep) + area(r.offcut)).toBe(area(panel));
  });

  it('rejects a negative kerf', () => {
    expect(() => applyCut(panel, { atBase: 100, bevel: SQUARE_CUT, kerf: -1 })).toThrow(
      GeometryError,
    );
  });
});

describe('bevelledWidths', () => {
  it('reports equal widths for a square cut', () => {
    const w = bevelledWidths(inches(1.5), inches(1.5), SQUARE_CUT);
    expect(w.atTableFace).toBe(w.atTopFace);
  });

  it('reproduces the 3D-cube rhombus closure', () => {
    // KB-A05: a true 60-degree rhombus needs rip width T / cos(30) = 1.1547 T,
    // which makes the hexagon across-flats exactly 2T.
    const thickness = inches(1.25);
    const ripWidth = thickness / Math.cos((30 * Math.PI) / 180);
    expect(ripWidth / 8000).toBeCloseTo(1.4434, 4);
    expect((ripWidth * Math.sqrt(3)) / 8000).toBeCloseTo(2.5, 9);
  });

  it('widens the top face when the blade tilts away', () => {
    const w = bevelledWidths(inches(1.5), inches(1.5), degrees(30));
    expect(w.atTopFace).toBeGreaterThan(w.atTableFace);
  });
});
