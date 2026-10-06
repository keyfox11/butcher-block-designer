/**
 * Named patterns, each a thin wrapper over the layered-panel generator.
 *
 * Keeping them thin is the point: a pattern is a choice of layer widths,
 * species and boundary angles, not a separate construction. Anything that
 * needed its own geometry would be a sign the operation vocabulary is too
 * narrow, not that the pattern deserves special-casing.
 */

import type { MilliDeg, ShopProfile, SpeciesId, Ticks } from '../model/types.js';
import { degrees, inches, milliDeg, ticks } from '../units/ticks.js';
import { layeredBoard, type Layer, type LayeredResult } from './layered.js';

const SQUARE = milliDeg(0);

export interface CommonParams {
  readonly rows: number;
  readonly boardThickness: Ticks;
  readonly sourceThickness: Ticks;
}

const defaults = {
  rows: 10,
  boardThickness: inches(1.5),
  sourceThickness: inches(1.5),
} as const;

/* -------------------------------------------------------------------------- */
/* Square-boundary patterns                                                    */
/* -------------------------------------------------------------------------- */

/** Uniform stripes. Slices are not transformed, so columns run straight. */
export function stripes(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const layers: Layer[] = Array.from({ length: count }, (_, i) => ({
    species: species[i % species.length]!,
    width: stripWidth,
    trailingAngle: SQUARE,
  }));
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'none' }, shop);
}

/** Three species in a repeating band. */
export function threeWoodBands(
  a: SpeciesId,
  b: SpeciesId,
  c: SpeciesId,
  stripWidth: Ticks,
  count: number,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  return stripes([a, b, c], stripWidth, count, shop, common);
}

/**
 * A field of one species with contrasting accent strips at a bevel.
 *
 * The accent's boundaries are angled, so it reads as a diagonal band across the
 * finished face rather than as a straight stripe.
 */
export function diagonalAccent(
  field: SpeciesId,
  accent: SpeciesId,
  stripWidth: Ticks,
  count: number,
  accentAt: readonly number[],
  angle: MilliDeg,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const accents = new Set(accentAt);
  const layers: Layer[] = Array.from({ length: count }, (_, i) => ({
    species: accents.has(i) ? accent : field,
    width: stripWidth,
    // Angle only the boundaries that bound an accent strip.
    trailingAngle: accents.has(i) || accents.has(i + 1) ? angle : SQUARE,
  }));
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'none' }, shop);
}

/**
 * Seeded random species assignment on a square grid.
 *
 * Always buildable, since the geometry is a plain grid -- which makes it the
 * gentlest introduction to designing freely: creative latitude with no risk of
 * an unbuildable result. The seed is part of the design, so a board can be
 * shared and rebuilt exactly.
 */
export function stochastic(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  seed: number,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const random = mulberry32(seed);
  const layers: Layer[] = Array.from({ length: count }, () => ({
    species: species[Math.floor(random() * species.length)]!,
    width: stripWidth,
    trailingAngle: SQUARE,
  }));
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'rotateAlternate' }, shop);
}

/* -------------------------------------------------------------------------- */
/* Angled patterns                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Zig-zag: every boundary at the same angle, alternate slices rotated.
 *
 * Rotating reverses a slice's sequence, so the angled boundaries of adjacent
 * rows lean against each other and the pattern reads as a zig-zag rather than
 * as a uniform shear.
 */
export function zigZag(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  angle: MilliDeg,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const layers: Layer[] = Array.from({ length: count }, (_, i) => ({
    species: species[i % species.length]!,
    width: stripWidth,
    trailingAngle: angle,
  }));
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'rotateAlternate' }, shop);
}

/**
 * Chevron: as zig-zag, but alternate slices are MIRRORED rather than rotated.
 *
 * Mirroring reflects the sequence instead of reversing it, so the angled
 * boundaries meet point to point and form a V. Conflating flip with rotate is a
 * common way to get the wrong pattern, which is why they are separate options.
 */
export function chevron(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  angle: MilliDeg,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const layers: Layer[] = Array.from({ length: count }, (_, i) => ({
    species: species[i % species.length]!,
    width: stripWidth,
    trailingAngle: angle,
  }));
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'flipAlternate' }, shop);
}

/**
 * Snake skin: boundary angles progress across the panel.
 *
 * Each layer leans a little more than the last, so the boundaries fan out and
 * the finished face reads as overlapping scales. Every boundary differs, so
 * each strip needs its own pair of bevel settings -- the cut list shows the
 * setup cuts that implies.
 */
export function snakeSkin(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  maxAngle: MilliDeg,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const layers: Layer[] = Array.from({ length: count }, (_, i) => {
    // Sweep from -max to +max across the stack.
    const t = count < 2 ? 0 : (i / (count - 1)) * 2 - 1;
    return {
      species: species[i % species.length]!,
      width: stripWidth,
      trailingAngle: milliDeg(Math.round(maxAngle * t)),
    };
  });
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'none' }, shop);
}

/**
 * Spiral: angles sweep in one direction and slices alternate.
 *
 * This is CBDJS's angled-layer spiral, achievable in a single stage. It is NOT
 * the multi-stage pinwheel, which rotates finished end-grain tiles 90 degrees
 * about the vertical axis and needs a third glue-up.
 */
export function spiral(
  species: readonly SpeciesId[],
  stripWidth: Ticks,
  count: number,
  maxAngle: MilliDeg,
  shop: ShopProfile,
  common: Partial<CommonParams> = {},
): LayeredResult {
  const layers: Layer[] = Array.from({ length: count }, (_, i) => {
    const t = count < 2 ? 0 : i / (count - 1);
    return {
      species: species[i % species.length]!,
      width: stripWidth,
      trailingAngle: milliDeg(Math.round(maxAngle * t)),
    };
  });
  return layeredBoard({ ...defaults, ...common, layers, sliceTransform: 'rotateAlternate' }, shop);
}

/* -------------------------------------------------------------------------- */

/** Small, fast, well-distributed PRNG. Seeded so designs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { degrees, inches, ticks };
