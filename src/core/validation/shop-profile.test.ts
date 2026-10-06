import { describe, expect, it } from 'vitest';
import { buildCutList } from '../cutlist/cutlist.js';
import { buildInstructions } from '../cutlist/instructions.js';
import { checkerboard } from '../generators/checkerboard.js';
import { tumblingBlock } from '../generators/tumbling.js';
import { evaluate } from '../geometry/evaluate.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import type { ShopProfile } from '../model/types.js';
import { PRECISION, degrees, inches, ticks } from '../units/ticks.js';
import { validate } from './validate.js';

/**
 * Every shop-profile setting must change something.
 *
 * This test exists because of a specific failure. `moistureSwingPercent` sat in
 * the shop profile, was editable in the UI, and was read by nothing at all for
 * three phases — the `V-MOVE-*` rules that consume it were specified and never
 * implemented. A control that does nothing is worse than an absent one: the
 * user sets the moisture swing to 10%, sees no warning, and reasonably concludes
 * the board has been checked for seasonal movement. It had not been.
 *
 * Nothing caught it. The citation-integrity test checks that rules cite
 * knowledge-base entries that exist; there was no equivalent check in the other
 * direction, that every input the user can set is consumed by something.
 *
 * The check is behavioural rather than static: push each setting to a value that
 * would have to matter, regenerate the findings, cut list and instructions, and
 * require the output to differ. A setting nothing reads cannot change anything.
 */

/** A value for each setting that must make a difference if anything reads it. */
const PROBES: Record<keyof ShopProfile, Partial<ShopProfile>> = {
  kerf: { kerf: inches(0.25) },
  bladeDepthAt90: { bladeDepthAt90: inches(1) },
  // Deep enough a cut that the 30° bevel in the tumbling block runs out of
  // blade. The depth is INTERPOLATED between the two measured points, so a
  // gentle probe gets diluted by the distance from 45° and bites on nothing.
  bladeDepthAt45: { bladeDepthAt45: inches(0.25) },
  maxBevel: { maxBevel: degrees(5) },
  minSafeRipWidth: { minSafeRipWidth: inches(3) },
  minSafeCrosscutLength: { minSafeCrosscutLength: inches(12) },
  sledCapacity: { sledCapacity: inches(2) },
  drumSanderWidth: { drumSanderWidth: inches(4) },
  drumSanderMaxThickness: { drumSanderMaxThickness: inches(0.5) },
  drumSanderRemovalPerPass: { drumSanderRemovalPerPass: ticks(10) },
  clampCount: { clampCount: 1 },
  clampForceEach: { clampForceEach: 50 },
  clampMaxReach: { clampMaxReach: inches(2) },
  moistureSwingPercent: { moistureSwingPercent: 20 },
  perCutTolerance: { perCutTolerance: 400 },
  hasRouter: { hasRouter: true },
  hasDrill: { hasDrill: true },
};

/**
 * Settings nothing reads yet, and the rule each one is waiting for.
 *
 * Listed explicitly so the gap is visible rather than implied by a silent pass,
 * and so implementing the rule forces this list to shrink — the test asserts
 * these really are inert, so a stale entry fails just as loudly as a new one.
 */
const KNOWN_UNREAD: Array<[keyof ShopProfile, string]> = [
  ['sledCapacity', 'V-TOOL: crosscut capacity vs the panel being sliced'],
  ['clampMaxReach', 'V-TOOL: clamp reach vs the assembly width'],
  // `toleranceBand()` exists in core/units and is called by nothing.
  ['perCutTolerance', 'V-TOL: accumulated tolerance across n cuts'],
];

function fingerprint(shop: ShopProfile): string {
  const designs = [
    checkerboard(
      {
        cellSize: inches(1.5),
        speciesA: 'hard-maple',
        speciesB: 'black-walnut',
        columns: 8,
        rows: 10,
        boardThickness: inches(1.5),
      },
      shop,
    ).graph,
    tumblingBlock(
      {
        stockThickness: inches(1.25),
        speciesTop: 'hard-maple',
        speciesLeft: 'black-walnut',
        speciesRight: 'black-cherry',
        targetWidth: inches(10),
        targetLength: inches(14),
        boardThickness: inches(1.5),
      },
      shop,
    ).graph,
  ];

  return designs
    .map((graph) => {
      const evaluated = evaluate(graph, shop);
      const project = {
        ...createProject({
          name: 'probe',
          graph,
          speciesPalette: ['hard-maple', 'black-walnut', 'black-cherry'],
          shopProfile: shop,
        }),
        // Edge treatments are part of the probe, not an afterthought: the
        // settings that gate on tooling the shop may not own (`hasRouter`,
        // `hasDrill`) are only consulted when the design asks for a groove or
        // feet. A probe without them would report those settings as dead.
        edgeTreatments: {
          juiceGroove: { inset: inches(0.75), width: inches(0.375), depth: inches(0.375) },
          feet: { kind: 'rubber' as const, diameter: inches(0.75), inset: inches(1), count: 4 },
        },
      };
      return JSON.stringify([
        validate({ project, evaluated, shop }).findings.map((f) => [f.ruleId, f.message, f.remedy]),
        buildCutList(graph, evaluated, shop, { name: 'probe', precision: PRECISION.THIRTY_SECOND }),
        // Safety notes as well as bodies. The clamp-count shortfall is a note,
        // not prose, so a fingerprint of bodies alone misses it entirely.
        buildInstructions(graph, evaluated, shop).map((s) => [s.title, s.body, s.safety]),
      ]);
    })
    .join('\n');
}

describe('the shop profile', () => {
  const baseline = fingerprint(DEFAULT_SHOP);
  const unread = new Set(KNOWN_UNREAD.map(([field]) => field));

  const live = (Object.keys(PROBES) as Array<keyof ShopProfile>).filter((f) => !unread.has(f));

  it.each(live)('%s changes the generated plan', (field) => {
    const probed = fingerprint({ ...DEFAULT_SHOP, ...PROBES[field] });
    expect(
      probed,
      `Nothing reads shop.${field}. Either a rule is missing, or the setting should be removed ` +
        'from the profile and from the Shop panel.',
    ).not.toBe(baseline);
  });

  it.each(KNOWN_UNREAD)('%s is still unread — waiting on %s', (field) => {
    // Asserted rather than skipped, so that implementing the rule breaks this
    // test and forces the list to be updated.
    const probed = fingerprint({ ...DEFAULT_SHOP, ...PROBES[field] });
    expect(
      probed,
      `shop.${field} now affects the output. Remove it from KNOWN_UNREAD.`,
    ).toBe(baseline);
  });

  it('covers every field in the profile, so a new setting cannot slip in untested', () => {
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(DEFAULT_SHOP).sort());
  });
});
