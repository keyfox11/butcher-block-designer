/**
 * Defaults describing a common hobby shop.
 *
 * Deliberately conservative: a design that validates here should be buildable
 * by most people, and anyone with better equipment raises the limits rather
 * than discovering them mid-glue-up.
 */

import { PRECISION, degrees, inches } from '../units/ticks.js';
import type { ShopProfile } from './types.js';

export const DEFAULT_SHOP: ShopProfile = {
  /** Full-kerf 10" blade. */
  kerf: inches(0.125),

  // Two measured points from a typical 10" cabinet saw. Depth is interpolated
  // between them rather than computed from cos(bevel), which overstates reach.
  bladeDepthAt90: inches(3.125),
  bladeDepthAt45: inches(2.25),
  maxBevel: degrees(45),

  minSafeRipWidth: inches(0.5),
  minSafeCrosscutLength: inches(1.5),
  sledCapacity: inches(24),

  drumSanderWidth: inches(16),
  drumSanderMaxThickness: inches(4),
  drumSanderRemovalPerPass: inches(1 / 64),

  clampCount: 6,
  clampForceEach: 600,
  clampMaxReach: inches(24),

  /** Heated winter to humid summer, a typical kitchen swing. */
  moistureSwingPercent: 6,
  /** A well-tuned saw holds about five thousandths. */
  perCutTolerance: inches(0.005),

  hasRouter: false,
  hasDrill: false,
};

/** Flattening allowance per face. */
export const DEFAULT_FLATTEN_PER_FACE = inches(0.125);

/** Trim removed from each edge when squaring up. */
export const DEFAULT_TRIM_PER_EDGE = inches(1 / 16);

/**
 * Milling allowance: how much oversize rough stock must be to clean up to the
 * milled dimension.
 */
export const DEFAULT_MILLING_ALLOWANCE = {
  thickness: inches(0.125),
  width: inches(0.25),
  length: inches(1),
};

export const DEFAULT_MEASUREMENT_PRECISION = PRECISION.THIRTY_SECOND;
