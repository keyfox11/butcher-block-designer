/**
 * V-MOVE — wood movement.
 *
 * The only rules in the validator whose threshold is a judgement call rather
 * than a machine limit or a geometric fact, which is why the derivation is
 * written out rather than asserted.
 *
 * An end-grain board moves in BOTH face dimensions, not just across the width
 * ([KB-B01](../../../docs/spec/01-woodworking-domain.md)). Rotating a blank to
 * end grain puts the tangential and radial axes in the face plane, so the
 * thickness becomes remarkably stable and both face dimensions become live.
 * That is the inverse of an edge-grain panel, and it is why these boards want
 * to grow in two directions at once with glue lines running both ways.
 *
 * ## Choosing the metric
 *
 * Two obvious metrics both fail, in opposite directions:
 *
 * - **Coefficient ratio** `C_max / C_min` is scale-free, so it flags a 6"
 *   maple/padauk board (which is fine) and stays silent on a 30" one (which is
 *   not).
 * - **Raw coefficient gap x board size** ignores proportion, so a maple board
 *   with a 2% padauk pinstripe scores the same as a 50/50 maple/padauk board.
 *
 * The fix for the second is to weight by how much of the board each species
 * actually occupies. The board as a whole moves at a composite coefficient --
 * the share-weighted mean -- and each species is strained by its deviation from
 * that composite. So the quantity that matters is the share-weighted mean
 * absolute deviation:
 *
 *     C_bar  = sum( share_i * C_i )
 *     MAD    = sum( share_i * |C_i - C_bar| )
 *     spread = 2 * MAD
 *
 * The factor of 2 is for interpretability, not physics: it makes `spread`
 * exactly equal the plain coefficient gap for a balanced two-species board, so
 * the number means what a woodworker would expect, while still collapsing
 * toward zero for a thin accent stripe.
 */

import { boardDimensions } from '../geometry/evaluate.js';
import { SPECIES } from '../knowledge/species.js';
import type { SpeciesId } from '../model/types.js';
import { area } from '../geometry/polygon.js';
import { toInches } from '../units/ticks.js';
import { finding } from './finding.js';
import type { Finding, Rule, ValidationContext } from './types.js';

/**
 * Differential movement above which the mix is flagged, in inches.
 *
 * Anchored on empirical practice rather than an invented stress limit: the
 * maple/walnut/cherry palette is known-good across a century of use at normal
 * board sizes, so it must pass. Computed at a 6% moisture swing:
 *
 *     mix                        12"     16"     20"     24"
 *     maple / walnut 50:50       0.057   0.076   0.095   0.114
 *     classic three-wood, equal  0.059   0.079   0.098   0.118
 *     cherry / walnut 50:50      0.019   0.025   0.031   0.037
 *     maple / padauk 50:50       0.125   0.166   0.208   0.249
 *     maple + 2% padauk stripe   0.010   0.013   0.016   0.020
 *
 * 0.150" separates them cleanly: the classic palette stays silent out to 24",
 * maple/padauk flags from 16" upward, and the pinstripe is correctly ignored.
 * The three-wood mix also scores BELOW the maple/cherry pair alone, which is
 * physically right -- walnut sits between them and pulls the composite toward
 * the middle.
 */
const DIFFERENTIAL_WARN_IN = 0.15;

/** Above this the wording escalates. Still a warning: it is the maker's wood. */
const DIFFERENTIAL_SEVERE_IN = 0.3;

/** Above this ratio the problem is the palette rather than the board's size. */
const RATIO_MISMATCH = 1.5;

/**
 * Absolute seasonal movement worth stating, in inches.
 *
 * A 12" maple board cycling 6% to 12% moves about 1/4" (KB-B04), and that is
 * NORMAL. An eighth of an inch is where it starts to matter for anything that
 * has to fit -- a drawer, a sink cut-out, a snug shelf -- so that is where the
 * note begins. It is `info`, never a warning: a tool that alarms about normal
 * behaviour teaches people to ignore it.
 */
const ABSOLUTE_NOTE_IN = 0.125;

/**
 * Absolute seasonal movement beyond common practice, in inches.
 *
 * This is the one number in the movement rules chosen rather than derived, so
 * it is worth saying how it was chosen and what would change it.
 *
 * Half an inch is a 24" maple board at a 6% swing. Boards that size get built
 * regularly and get used for decades, so the line has to sit above it. Five
 * eighths is a 30" maple board, which is past cutting-board practice and into
 * furniture butcher-block territory — where the construction is different
 * anyway: banding, breadboard ends, or a steel rod through the assembly.
 *
 * Because it scales with the composite coefficient rather than with raw inches,
 * it also allows a larger board in a gentler wood, which is the behaviour the
 * rule's own title asks for: "far beyond typical FOR THE SPECIES MIX". Cherry
 * moves 30% less than maple, so it earns about 12" more board before this fires.
 */
const ABSOLUTE_WARN_IN = 0.625;

interface MovementProfile {
  /** Share-weighted mean coefficient: how the board moves as a whole. */
  readonly composite: number;
  /** Share-weighted mean absolute deviation, doubled. */
  readonly spread: number;
  readonly ratio: number;
  /** The larger face dimension, in inches. Both move, so the worse one governs. */
  readonly maxDim: number;
  readonly moistureSwing: number;
  readonly shares: ReadonlyMap<SpeciesId, number>;
  /** Species in the board with no sourced coefficient. */
  readonly unknown: readonly SpeciesId[];
}

/**
 * Share of the board's face area held by each species.
 *
 * Area rather than strip count, because a 2% pinstripe and a 50% field are not
 * the same risk and counting pieces cannot tell them apart.
 */
function faceShares(ctx: ValidationContext): Map<SpeciesId, number> {
  const byArea = new Map<SpeciesId, number>();
  let total = 0;
  for (const face of ctx.evaluated.workpiece.crossSection.faces) {
    const a = area(face.polygon);
    byArea.set(face.species, (byArea.get(face.species) ?? 0) + a);
    total += a;
  }
  if (total <= 0) return new Map();
  return new Map([...byArea].map(([id, a]) => [id, a / total]));
}

function profile(ctx: ValidationContext): MovementProfile | null {
  if (ctx.evaluated.workpiece.orientation !== 'endGrain') return null;

  const shares = faceShares(ctx);
  if (shares.size === 0) return null;

  const unknown = [...shares.keys()].filter((id) => SPECIES[id]?.movementCoefficient == null);
  const known = [...shares].filter(([id]) => SPECIES[id]?.movementCoefficient != null);
  if (known.length === 0) return null;

  // Normalise over the species we can actually assess. Shares should sum to 1,
  // but a partial palette or a rounding drift upstream must not silently scale
  // the result.
  const shareTotal = known.reduce((sum, [, s]) => sum + s, 0);
  if (shareTotal <= 0) return null;

  const coefficient = (id: SpeciesId) => SPECIES[id]!.movementCoefficient!;
  const composite = known.reduce((sum, [id, s]) => sum + (s / shareTotal) * coefficient(id), 0);
  const mad = known.reduce(
    (sum, [id, s]) => sum + (s / shareTotal) * Math.abs(coefficient(id) - composite),
    0,
  );

  const values = known.map(([id]) => coefficient(id));
  const dims = boardDimensions(ctx.evaluated.workpiece);

  return {
    composite,
    spread: 2 * mad,
    ratio: Math.max(...values) / Math.min(...values),
    maxDim: Math.max(toInches(dims.width), toInches(dims.length)),
    moistureSwing: ctx.shop.moistureSwingPercent,
    shares,
    unknown,
  };
}

function inches(value: number): string {
  return `${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}"`;
}

function nameOf(id: SpeciesId): string {
  return SPECIES[id]?.name ?? id;
}

/* -------------------------------------------------------------------------- */

const MOVE_010: Rule = {
  id: 'V-MOVE-010',
  category: 'movement',
  cites: ['KB-B03', 'KB-B04'],
  check(ctx) {
    const p = profile(ctx);
    if (!p) return [];

    const out: Finding[] = [];

    // Say so rather than quietly assessing the rest. The species table holds
    // null where no source supports a value, and a movement verdict that
    // silently ignored a third of the board would be worse than none.
    if (p.unknown.length > 0) {
      out.push(
        finding(MOVE_010, 'info', {
          message:
            `No sourced movement data for ${p.unknown.map(nameOf).join(', ')}, so the mix cannot ` +
            'be fully assessed. The figure below covers only the species with published ' +
            'coefficients.',
          remedy:
            'Treat the result as a lower bound. If that species is a large share of the board, ' +
            'keep the board smaller than you otherwise would until it has been through a full ' +
            'humidity cycle.',
          data: { unknown: p.unknown },
          dedupeKey: 'movement-unknown-species',
        }),
      );
    }

    const known = [...p.shares.keys()].filter((id) => SPECIES[id]?.movementCoefficient != null);
    // A single species has no differential by definition. Guarded rather than
    // left to the arithmetic, so a missing share cannot fake a pass.
    if (known.length < 2) return out;

    const differential = p.maxDim * p.spread * p.moistureSwing;
    if (differential <= DIFFERENTIAL_WARN_IN) return out;

    const sorted = [...known].sort(
      (a, b) => SPECIES[a]!.movementCoefficient! - SPECIES[b]!.movementCoefficient!,
    );
    const lowest = nameOf(sorted[0]!);
    const highest = nameOf(sorted[sorted.length - 1]!);

    // Which lever actually fixes it. A mismatched palette wants a species swap;
    // a compatible palette on a large board wants a smaller board. Reporting
    // the wrong remedy is worse than reporting none.
    const driver = p.ratio > RATIO_MISMATCH ? 'palette' : 'size';
    const severe = differential > DIFFERENTIAL_SEVERE_IN;
    const severeNote = severe
      ? ' This is well beyond the range demonstrated by common practice: expect visible seasonal ' +
        'gapping, and keep the board diligently oiled.'
      : '';

    out.push(
      finding(MOVE_010, 'warning', {
        message:
          driver === 'palette'
            ? `${highest} and ${lowest} differ in seasonal movement by ${p.ratio.toFixed(2)}×. ` +
              `Across ${inches(p.maxDim)} at a ${p.moistureSwing}% moisture swing that is about ` +
              `${inches(differential)} of differential movement, which loads every glue line ` +
              `between them in shear.${severeNote}`
            : `These species are reasonably matched (${p.ratio.toFixed(2)}×), but at ` +
              `${inches(p.maxDim)} the board is large enough that the remaining difference adds ` +
              `up to about ${inches(differential)} of differential movement.${severeNote}`,
        remedy:
          driver === 'palette'
            ? `Substituting a species closer to ${highest} would reduce this. The classic ` +
              'maple/walnut/cherry palette spans only 1.42×, which is why it has held up for a ' +
              'century.'
            : 'Reducing the largest dimension, or keeping the board in a more stable humidity ' +
              'environment, would both help.',
        data: {
          differential,
          spread: p.spread,
          ratio: p.ratio,
          maxDim: p.maxDim,
          moistureSwing: p.moistureSwing,
          tier: severe ? 'severe' : 'elevated',
          driver,
          lowest: sorted[0],
          highest: sorted[sorted.length - 1],
        },
        dedupeKey: 'movement-mismatch',
      }),
    );

    return out;
  },
};

const MOVE_020: Rule = {
  id: 'V-MOVE-020',
  category: 'movement',
  cites: ['KB-B04', 'KB-B01'],
  check(ctx) {
    const p = profile(ctx);
    if (!p) return [];

    const movement = p.maxDim * p.composite * p.moistureSwing;
    if (movement < ABSOLUTE_NOTE_IN) return [];

    return [
      finding(MOVE_020, 'info', {
        message:
          `Expect this board to move about ${inches(movement)} across ${inches(p.maxDim)} over a ` +
          `${p.moistureSwing}% seasonal moisture swing — and in both face directions, not just ` +
          'one. That is normal behaviour for end grain, not a fault.',
        remedy:
          'Allow for it in anything that has to fit: a drawer, a sink cut-out, a snug shelf. ' +
          'Fasten feet through slotted or oversized holes so the board can move under them.',
        data: { movement, composite: p.composite, maxDim: p.maxDim },
        dedupeKey: 'movement-absolute',
      }),
    ];
  },
};

const MOVE_030: Rule = {
  id: 'V-MOVE-030',
  category: 'movement',
  cites: ['KB-B01', 'KB-B04'],
  check(ctx) {
    const p = profile(ctx);
    if (!p) return [];

    const movement = p.maxDim * p.composite * p.moistureSwing;
    if (movement <= ABSOLUTE_WARN_IN) return [];

    return [
      finding(MOVE_030, 'warning', {
        message:
          `At ${inches(p.maxDim)} this board is predicted to move about ${inches(movement)} each ` +
          'season — beyond what common practice demonstrates for end grain. Because an end-grain ' +
          'board moves in both face directions at once, with glue lines running both ways, a ' +
          'board this large spends every year cycling real strain through every joint.',
        // State where the demonstrated range ends, not how far over this board
        // is. A board a tenth of an inch past the line would otherwise be told
        // to shrink by a tenth of an inch, which is true and useless.
        remedy:
          `For these species the demonstrated range tops out around ` +
          `${inches(ABSOLUTE_WARN_IN / (p.composite * p.moistureSwing))} on the long dimension. ` +
          'Above that, build it the way large butcher blocks are built — keep it in a humidity-' +
          'controlled room, oil it diligently, and never let one face dry faster than the other, ' +
          'which is what cups a board this size.',
        data: { movement, maxDim: p.maxDim, limit: ABSOLUTE_WARN_IN },
        dedupeKey: 'movement-oversize',
      }),
    ];
  },
};

export const MOVEMENT_RULES: readonly Rule[] = [MOVE_010, MOVE_020, MOVE_030];
