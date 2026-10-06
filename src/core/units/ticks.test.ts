import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  PRECISION,
  TICKS_PER_INCH,
  UnitError,
  dimension,
  degrees,
  formatInches,
  formatTicks,
  inches,
  parseLength,
  roundToPrecision,
  ticks,
  toInches,
  toleranceBand,
} from './ticks.js';

describe('tick base', () => {
  // The whole point of 8000: both input families are exactly representable.
  // If this fails, the "exact arithmetic" claim is false at the first input.
  it.each([
    ['1/64"', 1 / 64, 125],
    ['1/32"', 1 / 32, 250],
    ['1/16"', 1 / 16, 500],
    ['1/8"', 1 / 8, 1000],
    ['1/4"', 1 / 4, 2000],
    ['1/2"', 1 / 2, 4000],
    ['1"', 1, 8000],
  ])('represents %s exactly', (_label, value, expected) => {
    expect(value * TICKS_PER_INCH).toBe(expected);
  });

  it.each([
    ['0.001"', 0.001, 8],
    ['0.125"', 0.125, 1000],
    ['1.2"', 1.2, 9600],
    ['1.5"', 1.5, 12000],
  ])('represents %s exactly via string parsing', (label, _value, expected) => {
    const parsed = parseLength(label.replace('"', ''));
    expect(parsed.ticks).toBe(expected);
    expect(parsed.exact).toBe(true);
  });

  it('is the least base that satisfies both families', () => {
    // 1/1024 fails on decimals; 1/1000 fails on 1/32". Guards the choice
    // against a well-meaning "just use a power of two" refactor.
    expect(Number.isInteger(1.2 * 1024)).toBe(false);
    expect(Number.isInteger((1 / 32) * 1000)).toBe(false);
    expect(Number.isInteger(1.2 * TICKS_PER_INCH)).toBe(true);
    expect(Number.isInteger((1 / 32) * TICKS_PER_INCH)).toBe(true);
  });
});

describe('ticks()', () => {
  it('rejects non-integers', () => {
    expect(() => ticks(1.5)).toThrow(UnitError);
  });

  it('rejects unsafe integers', () => {
    expect(() => ticks(Number.MAX_SAFE_INTEGER + 2)).toThrow(UnitError);
  });

  it('round-trips through inches', () => {
    expect(toInches(inches(1.5))).toBe(1.5);
  });
});

describe('parseLength', () => {
  it.each([
    ['1 1/2', 12000],
    ['1-1/2', 12000],
    ['1 1/2"', 12000],
    ['3/4', 6000],
    ['1.5', 12000],
    ['12', 96000],
    ['0.001', 8],
    ['1 15/16', 15500],
    ['  2 1/4  ', 18000],
    ['1.5 in', 12000],
    ['1.5 inches', 12000],
  ])('parses %s', (input, expected) => {
    const parsed = parseLength(input);
    expect(parsed.ticks).toBe(expected);
    expect(parsed.exact).toBe(true);
  });

  it('flags inexact input rather than silently rounding', () => {
    // 1/3" is not representable in any finite base. The flag is how the cut
    // list avoids reporting a number it cannot actually deliver.
    const parsed = parseLength('1/3');
    expect(parsed.exact).toBe(false);
    expect(parsed.ticks).toBe(2667);
  });

  it('flags decimals finer than the tick', () => {
    expect(parseLength('0.00001').exact).toBe(false);
  });

  it('handles negatives', () => {
    expect(parseLength('-1.5').ticks).toBe(-12000);
  });

  it.each([[''], ['abc'], ['1/0'], ['--3']])('rejects %s', (input) => {
    expect(() => parseLength(input)).toThrow(UnitError);
  });
});

describe('formatTicks', () => {
  it.each([
    [12000, '1 1/2"'],
    [8000, '1"'],
    [6000, '3/4"'],
    [0, '0"'],
    [250, '1/32"'],
    [15500, '1 15/16"'],
    [-12000, '-1 1/2"'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatTicks(ticks(value), PRECISION.THIRTY_SECOND)).toBe(expected);
  });

  it('reduces fractions fully', () => {
    expect(formatTicks(ticks(4000))).toBe('1/2"');
    expect(formatTicks(ticks(2000))).toBe('1/4"');
  });

  it('rounds to the requested precision', () => {
    // 125 ticks is 1/64"; at 1/32" precision it rounds up to 1/32".
    expect(formatTicks(ticks(125), PRECISION.THIRTY_SECOND)).toBe('1/32"');
    expect(formatTicks(ticks(125), PRECISION.SIXTY_FOURTH)).toBe('1/64"');
  });

  it('formats decimal inches for machine settings', () => {
    expect(formatInches(ticks(12000))).toBe('1.500"');
  });
});

describe('roundToPrecision', () => {
  it('rejects a non-positive precision', () => {
    expect(() => roundToPrecision(100, 0 as never)).toThrow(UnitError);
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (v) => {
        const once = roundToPrecision(v, PRECISION.THIRTY_SECOND);
        const twice = roundToPrecision(once, PRECISION.THIRTY_SECOND);
        expect(twice).toBe(once);
      }),
    );
  });

  it('never moves a value by more than half the precision', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (v) => {
        const rounded = roundToPrecision(v, PRECISION.THIRTY_SECOND);
        expect(Math.abs(rounded - v)).toBeLessThanOrEqual(PRECISION.THIRTY_SECOND / 2);
      }),
    );
  });
});

describe('format/parse round-trip', () => {
  it('survives any value on the precision grid', () => {
    // A number shown to the user must parse back to the same number, or the
    // displayed cut list and the stored model have diverged.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4000 }), (steps) => {
        const value = ticks(steps * PRECISION.THIRTY_SECOND);
        const text = formatTicks(value, PRECISION.THIRTY_SECOND);
        expect(parseLength(text).ticks).toBe(value);
      }),
    );
  });
});

describe('dimension', () => {
  it('reports no error for an on-grid value', () => {
    const d = dimension(12000, PRECISION.THIRTY_SECOND);
    expect(d.exact).toBe(true);
    expect(d.roundingError).toBe(0);
    expect(d.asMeasured).toBe(12000);
  });

  it('reports the signed error for an off-grid value', () => {
    const d = dimension(12100, PRECISION.THIRTY_SECOND);
    expect(d.exact).toBe(false);
    expect(d.asMeasured).toBe(12000);
    expect(d.roundingError).toBe(-100);
  });

  it('keeps asMeasured on the precision grid for any input', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (v) => {
        const d = dimension(v, PRECISION.THIRTY_SECOND);
        expect(d.asMeasured % PRECISION.THIRTY_SECOND).toBe(0);
        expect(d.asMeasured - d.value).toBeCloseTo(d.roundingError, 9);
      }),
    );
  });
});

describe('toleranceBand', () => {
  it('separates random from systematic error', () => {
    // These prescribe different actions, which is why they are reported apart.
    const band = toleranceBand(ticks(96000), 20, 40);
    expect(band.randomWorstCase).toBeCloseTo(Math.sqrt(20) * 40, 9);
    expect(band.systematicWorstCase).toBe(800);
    expect(band.systematicWorstCase).toBeGreaterThan(band.randomWorstCase);
  });
});

describe('angles', () => {
  it('stores degrees as exact millidegrees', () => {
    expect(degrees(30)).toBe(30_000);
    expect(degrees(45.5)).toBe(45_500);
  });
});
