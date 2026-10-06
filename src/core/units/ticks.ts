/**
 * Exact length arithmetic.
 *
 * All lengths are integer counts of 1/8000 inch.
 *
 * 8000 = LCM(64, 1000), chosen so both input families a woodworker actually
 * types are exactly representable:
 *
 *   - binary fractions to 1/64"  -> 1/64 = 125 ticks, 1/32 = 250, 1/16 = 500
 *   - decimals to three places   -> 0.001" = 8 ticks
 *
 * Neither obvious alternative works. A power-of-two base such as 1/1024 handles
 * the fractions but cannot represent 1.2". A decimal base such as 1/1000 handles
 * the decimals but cannot represent 1/32" (= 31.25), which is the default
 * measurement precision -- the tool would be unable to express its own default.
 *
 * Resolution is 0.000125", roughly 1/40th of the tolerance a well-tuned table
 * saw can hold, so rounding here is never the limiting factor on a real cut.
 */

export const TICKS_PER_INCH = 8000;

/** An exact length: an integer count of 1/8000 inch. */
export type Ticks = number & { readonly __brand: 'Ticks' };

/** An exact angle: an integer count of 1/1000 degree. */
export type MilliDeg = number & { readonly __brand: 'MilliDeg' };

/** Common measurement precisions, in ticks. */
export const PRECISION = {
  /** 1/16" */ SIXTEENTH: 500 as Ticks,
  /** 1/32" — the default */ THIRTY_SECOND: 250 as Ticks,
  /** 1/64" */ SIXTY_FOURTH: 125 as Ticks,
} as const;

export class UnitError extends Error {}

/** Wrap an integer tick count. Throws if it is not a safe integer. */
export function ticks(n: number): Ticks {
  if (!Number.isSafeInteger(n)) {
    throw new UnitError(`Ticks must be a safe integer, got ${n}`);
  }
  return n as Ticks;
}

/** Convert inches to ticks, rounding to the nearest tick. */
export function inches(n: number): Ticks {
  return ticks(Math.round(n * TICKS_PER_INCH));
}

export function toInches(t: Ticks | number): number {
  return t / TICKS_PER_INCH;
}

export function milliDeg(n: number): MilliDeg {
  if (!Number.isSafeInteger(n)) {
    throw new UnitError(`MilliDeg must be a safe integer, got ${n}`);
  }
  return n as MilliDeg;
}

export function degrees(n: number): MilliDeg {
  return milliDeg(Math.round(n * 1000));
}

export function toDegrees(a: MilliDeg | number): number {
  return a / 1000;
}

export function toRadians(a: MilliDeg | number): number {
  return (toDegrees(a) * Math.PI) / 180;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

export interface ParsedLength {
  ticks: Ticks;
  /**
   * Whether the input was exactly representable. False means the value was
   * rounded -- e.g. "1/3" or a 5-decimal input. Callers surface this rather
   * than discarding it, so a cut list never silently reports a wrong number.
   */
  exact: boolean;
  /** The original text, retained for error messages. */
  input: string;
}

const FRACTION_ONLY = /^(\d+)\s*\/\s*(\d+)$/;
const MIXED_NUMBER = /^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a woodworking length. Accepts every form a user may reasonably type:
 *
 *   1 1/2    1-1/2    1 1/2"    3/4    1.5    12    0.001
 *
 * Decimals are parsed through integer arithmetic on the digit string rather
 * than through parseFloat, so "1.2" yields exactly 9600 ticks rather than
 * whatever 1.2 * 8000 produces in binary floating point.
 */
export function parseLength(input: string): ParsedLength {
  const text = input.trim().replace(/["”]+$/, '').replace(/\s+in(ch(es)?)?$/i, '').trim();

  if (text === '') throw new UnitError('Empty length');

  const negative = text.startsWith('-') && !MIXED_NUMBER.test(text);
  const body = negative ? text.slice(1).trim() : text;

  const result = parsePositive(body, input);
  // Multiplication rather than unary negation: the branded Ticks type is not
  // assignable to the operand of unary minus.
  return negative ? { ...result, ticks: ticks(result.ticks * -1) } : result;
}

function parsePositive(body: string, input: string): ParsedLength {
  const mixed = MIXED_NUMBER.exec(body);
  if (mixed) {
    const [, whole, num, den] = mixed;
    return fromFraction(
      Number(whole) * Number(den) + Number(num),
      Number(den),
      input,
    );
  }

  const fraction = FRACTION_ONLY.exec(body);
  if (fraction) {
    const [, num, den] = fraction;
    return fromFraction(Number(num), Number(den), input);
  }

  const decimal = DECIMAL.exec(body);
  if (decimal) {
    const [, whole, frac = ''] = decimal;
    // Exact integer arithmetic on the digit string: "1.2" -> 12 * 8000 / 10.
    const scaled = Number(`${whole}${frac}`);
    const divisor = 10 ** frac.length;
    return fromFraction(scaled, divisor, input);
  }

  throw new UnitError(`Cannot parse "${input}" as a length`);
}

function fromFraction(numerator: number, denominator: number, input: string): ParsedLength {
  if (denominator === 0) throw new UnitError(`Division by zero in "${input}"`);

  const exactTicks = (numerator * TICKS_PER_INCH) / denominator;
  const rounded = Math.round(exactTicks);
  return {
    ticks: ticks(rounded),
    exact: Number.isInteger(exactTicks),
    input,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Format ticks as a woodworking fraction: 12000 -> `1 1/2"`.
 *
 * Rounds to `precision` first, since that is the increment the user can
 * actually measure to. Fractions are fully reduced.
 */
export function formatTicks(value: Ticks | number, precision: Ticks = PRECISION.THIRTY_SECOND): string {
  const rounded = roundToPrecision(value, precision);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);

  const whole = Math.floor(abs / TICKS_PER_INCH);
  const remainder = abs - whole * TICKS_PER_INCH;

  if (remainder === 0) return `${sign}${whole}"`;

  const divisor = gcd(remainder, TICKS_PER_INCH);
  const numerator = remainder / divisor;
  const denominator = TICKS_PER_INCH / divisor;

  return whole === 0
    ? `${sign}${numerator}/${denominator}"`
    : `${sign}${whole} ${numerator}/${denominator}"`;
}

/** Format as a decimal inch value, for machine settings where that reads better. */
export function formatInches(value: Ticks | number, places = 3): string {
  return `${toInches(value).toFixed(places)}"`;
}

/**
 * Format a machine limit or capability.
 *
 * Limits FLOOR rather than round, and display at 1/64". Rounding a limit to the
 * nearest increment can overstate it: 1/64" shown at 1/32" precision rounds UP
 * to 1/32", which would tell someone they may remove twice what their machine
 * allows. A stated limit must be achievable by definition, so error is only
 * ever taken toward the safe side.
 */
export function formatLimit(value: Ticks | number): string {
  const floored = Math.floor(value / PRECISION.SIXTY_FOURTH) * PRECISION.SIXTY_FOURTH;
  if (floored !== 0) return formatTicks(ticks(floored), PRECISION.SIXTY_FOURTH);

  // Below one 64th there is no useful fraction, so fall back to decimal --
  // truncated, not toFixed, which would round 0.00075 up to 0.0008 and
  // overstate the limit by exactly the amount this function exists to prevent.
  const places = 4;
  const scale = 10 ** places;
  return `${(Math.floor(toInches(value) * scale) / scale).toFixed(places)}"`;
}

export function roundToPrecision(value: Ticks | number, precision: Ticks): Ticks {
  if (precision <= 0) throw new UnitError(`Precision must be positive, got ${precision}`);
  return ticks(Math.round(value / precision) * precision);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/* -------------------------------------------------------------------------- */
/* Dimensions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A derived length together with what the builder will actually measure.
 *
 * Geometry involving a bevel goes through `tan`, so the underlying value may
 * not be an integer number of ticks. Rather than hiding that, a Dimension
 * carries both the computed value and the rounded one, plus the error between
 * them -- so the cut list can show "1 1/2" (+0.003")" instead of a number that
 * quietly lies.
 */
export interface Dimension {
  /** Computed value in ticks. May be fractional when derived through trig. */
  value: number;
  /** Rounded to the user's measurement precision. What they cut to. */
  asMeasured: Ticks;
  /** asMeasured - value, in ticks. Signed. */
  roundingError: number;
  /** True when no rounding was needed. */
  exact: boolean;
}

export function dimension(value: number, precision: Ticks = PRECISION.THIRTY_SECOND): Dimension {
  const asMeasured = roundToPrecision(value, precision);
  const roundingError = asMeasured - value;
  return {
    value,
    asMeasured,
    roundingError,
    exact: roundingError === 0,
  };
}

/**
 * Accumulated tolerance across a multi-cut assembly.
 *
 * Reports random and systematic bounds separately because they call for
 * different actions: random error means trim to final size at the end, while
 * systematic error means check the fence BEFORE cutting twenty strips. A board
 * that comes out 1/8" narrow is nearly always systematic.
 */
export interface ToleranceBand {
  nominal: Ticks;
  /** Independent per-cut errors: grows with sqrt(n). */
  randomWorstCase: number;
  /** A mis-set fence repeated every cut: grows with n. */
  systematicWorstCase: number;
  cutCount: number;
}

export function toleranceBand(
  nominal: Ticks,
  cutCount: number,
  perCutTolerance: number,
): ToleranceBand {
  return {
    nominal,
    randomWorstCase: Math.sqrt(cutCount) * perCutTolerance,
    systematicWorstCase: cutCount * perCutTolerance,
    cutCount,
  };
}
