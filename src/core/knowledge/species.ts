/**
 * Species data.
 *
 * Values are only present where a source actually supports them. Where
 * shrinkage data was not found, the field is `null` rather than estimated --
 * the movement check reports "cannot assess" instead of inventing a number,
 * because a confident wrong answer about wood movement is worse than no answer.
 */

import type { SpeciesId } from '../model/types.js';

export type FoodSafety =
  /** Closed-pore hardwood with a long kitchen service record. */
  | 'safe'
  /** Not toxic, but the pores hold residue and stain. A poor cutting surface. */
  | 'openPore'
  /** Sources genuinely disagree. Present the disagreement; do not pick a side. */
  | 'contested'
  /** Toxic or high-allergen. */
  | 'avoid';

export interface Species {
  readonly id: SpeciesId;
  readonly name: string;
  /** Approximate face colour, for the palette and 2-D preview. */
  readonly color: string;
  /** SVG hatch id, so species stay distinguishable in monochrome print. */
  readonly hatch: string;
  readonly jankaLbf: number;
  /** Green-to-oven-dry radial shrinkage, percent. */
  readonly radialShrinkage: number | null;
  /** Green-to-oven-dry tangential shrinkage, percent. */
  readonly tangentialShrinkage: number | null;
  /**
   * Dimensional change coefficient: fractional movement per 1% change in
   * moisture content, over the usable 6-14% range.
   *
   *     deltaDimension = dimension * C * deltaMoistureContentPercent
   */
  readonly movementCoefficient: number | null;
  readonly foodSafety: FoodSafety;
  /** Shown when food safety is anything other than 'safe'. */
  readonly foodSafetyNote?: string;
  readonly provenance: string;
}

/** Nominal fibre saturation point, used to sanity-check added rows. */
export const FIBRE_SATURATION_POINT = 28;

export const SPECIES: Readonly<Record<SpeciesId, Species>> = {
  'hard-maple': {
    id: 'hard-maple',
    name: 'Hard maple',
    color: '#e8d4a8',
    hatch: 'hatch-none',
    jankaLbf: 1450,
    radialShrinkage: 4.8,
    tangentialShrinkage: 9.9,
    movementCoefficient: 0.00353,
    foodSafety: 'safe',
    provenance:
      'Engineers Edge / USDA lineage. Sources differ on sugar maple: 4.8/9.9 and 4.9/9.5 both appear. The spread is small but real and is not averaged away.',
  },
  'black-walnut': {
    id: 'black-walnut',
    name: 'Black walnut',
    color: '#5c4433',
    hatch: 'hatch-diagonal',
    jankaLbf: 1010,
    radialShrinkage: 5.5,
    tangentialShrinkage: 7.8,
    movementCoefficient: 0.00274,
    foodSafety: 'safe',
    provenance: 'Engineers Edge / USDA lineage.',
  },
  'black-cherry': {
    id: 'black-cherry',
    name: 'Black cherry',
    color: '#a9633f',
    hatch: 'hatch-dots',
    jankaLbf: 950,
    radialShrinkage: 3.7,
    tangentialShrinkage: 7.1,
    movementCoefficient: 0.00248,
    foodSafety: 'safe',
    foodSafetyNote: 'At 950 lbf it is at the soft end of the useful range and will scar sooner.',
    provenance: 'Engineers Edge / USDA lineage.',
  },
  padauk: {
    id: 'padauk',
    name: 'African padauk',
    color: '#b4442a',
    hatch: 'hatch-cross',
    jankaLbf: 1970,
    radialShrinkage: 2.9,
    tangentialShrinkage: 5.2,
    movementCoefficient: 0.0018,
    foodSafety: 'safe',
    foodSafetyNote: 'Safe in use. The dust is a known irritant; wear a respirator when machining.',
    provenance: 'Glamorwood / Wood Database lineage.',
  },
  purpleheart: {
    id: 'purpleheart',
    name: 'Purpleheart',
    color: '#5b3a6e',
    hatch: 'hatch-vertical',
    jankaLbf: 1860,
    radialShrinkage: 3.8,
    tangentialShrinkage: 6.4,
    movementCoefficient: 0.00212,
    foodSafety: 'contested',
    foodSafetyNote:
      'Widely sold in finished boards and widely used, but some sources report irritant or leaching concerns. Sources disagree; the choice is yours.',
    provenance: 'Glamorwood. Janka is quoted across a wide 1860-2520 range.',
  },
  sapele: {
    id: 'sapele',
    name: 'Sapele',
    color: '#8c4a2f',
    hatch: 'hatch-horizontal',
    jankaLbf: 1410,
    radialShrinkage: null,
    tangentialShrinkage: null,
    movementCoefficient: null,
    foodSafety: 'safe',
    provenance: 'Janka from Bell Forest. Shrinkage data not sourced; left null rather than estimated.',
  },
  beech: {
    id: 'beech',
    name: 'Beech',
    color: '#d9b48a',
    hatch: 'hatch-grid',
    jankaLbf: 1300,
    radialShrinkage: null,
    tangentialShrinkage: null,
    movementCoefficient: null,
    foodSafety: 'safe',
    provenance: 'Janka approximate. Shrinkage data not sourced; left null rather than estimated.',
  },
  'red-oak': {
    id: 'red-oak',
    name: 'Red oak',
    color: '#b08258',
    hatch: 'hatch-wave',
    jankaLbf: 1290,
    radialShrinkage: null,
    tangentialShrinkage: null,
    movementCoefficient: null,
    foodSafety: 'openPore',
    foodSafetyNote:
      'Open pores hold food residue and stain, and are hard to clean properly. Not toxic — simply a poor cutting surface.',
    provenance: 'Janka from Bell Forest. Pore structure from Woodworker’s Journal.',
  },
  cocobolo: {
    id: 'cocobolo',
    name: 'Cocobolo',
    color: '#7a2f1d',
    hatch: 'hatch-dense',
    jankaLbf: 1136,
    radialShrinkage: null,
    tangentialShrinkage: null,
    movementCoefficient: null,
    foodSafety: 'avoid',
    foodSafetyNote: 'High allergen content. Not suitable for a food-contact surface.',
    provenance: 'Woodworker’s Journal, woods to avoid for cutting boards.',
  },
};

export function species(id: SpeciesId): Species {
  const found = SPECIES[id];
  if (!found) throw new Error(`Unknown species: ${id}`);
  return found;
}

/**
 * Sanity check for added rows: the published coefficient should be close to
 * tangential shrinkage divided by the fibre saturation point. Hard maple gives
 * 9.9 / 28 = 0.00354 against a published 0.00353.
 */
export function coefficientLooksConsistent(s: Species): boolean | null {
  if (s.tangentialShrinkage === null || s.movementCoefficient === null) return null;
  const derived = s.tangentialShrinkage / FIBRE_SATURATION_POINT / 100;
  return Math.abs(derived - s.movementCoefficient) / s.movementCoefficient < 0.15;
}
