/**
 * The P0 rule set: safety, tooling, dimensions, grain, food safety, material.
 *
 * Rules are ordered by category. Each one resolves its own rationale from the
 * knowledge base, so a finding always carries the reason it fired.
 */

import { boardDimensions } from '../geometry/evaluate.js';
import { kb, type KbId } from '../knowledge/kb.js';
import { SPECIES } from '../knowledge/species.js';
import type { NodeId } from '../model/types.js';
import { formatTicks, inches, toInches } from '../units/ticks.js';
import type { Finding, Rule, Severity, ValidationContext } from './types.js';

function finding(
  rule: { id: string; cites: readonly KbId[] },
  severity: Severity,
  parts: {
    nodes?: readonly NodeId[];
    message: string;
    remedy: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
  },
): Finding {
  const primary = rule.cites[0];
  return {
    ruleId: rule.id,
    severity,
    nodes: parts.nodes ?? [],
    message: parts.message,
    remedy: parts.remedy,
    rationale: primary ? kb(primary).text : '',
    cites: rule.cites,
    data: parts.data ?? {},
    ...(parts.dedupeKey === undefined ? {} : { dedupeKey: parts.dedupeKey }),
  };
}

/* -------------------------------------------------------------------------- */
/* V-SAFE — always blocking                                                    */
/* -------------------------------------------------------------------------- */

const SAFE_010: Rule = {
  id: 'V-SAFE-010',
  category: 'safety',
  cites: ['KB-A08'],
  check(ctx) {
    // FlattenOp has no thicknessPlaner variant, so a normally-constructed
    // graph cannot express this. The rule is defence in depth against an
    // imported, migrated, or hand-edited project file.
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'flatten') continue;
      const method = node.op.method as string;
      if (method === 'thicknessPlaner' || method === 'planer') {
        out.push(
          finding(SAFE_010, 'error', {
            nodes: [node.id],
            message: 'This design flattens end-grain stock with a thickness planer.',
            remedy: 'Use a drum sander, or a router sled taking no more than 1/32" per pass.',
          }),
        );
      }
    }
    return out;
  },
};

const SAFE_020: Rule = {
  id: 'V-SAFE-020',
  category: 'safety',
  cites: ['KB-A08', 'KB-D04'],
  check(ctx) {
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'flatten' || node.op.method !== 'drumSander') continue;
      const passes = Math.ceil(node.op.removePerFace / ctx.shop.drumSanderRemovalPerPass);
      if (passes < 1) continue;
      // Informational rather than blocking: the removal is achievable, it just
      // takes more passes than someone might expect.
      if (node.op.removePerFace > ctx.shop.drumSanderRemovalPerPass) {
        out.push(
          finding(SAFE_020, 'info', {
            nodes: [node.id],
            message: `Flattening removes ${formatTicks(node.op.removePerFace)} per face, which is ${passes} drum-sander passes.`,
            remedy: 'Take light passes. Heavier cuts burn end grain and load the belt.',
            data: { passes, perPass: ctx.shop.drumSanderRemovalPerPass },
          }),
        );
      }
    }
    return out;
  },
};

const SAFE_030: Rule = {
  id: 'V-SAFE-030',
  category: 'safety',
  cites: ['KB-D02'],
  check(ctx) {
    // Aggregated per node rather than per strip. Eight strips at the same
    // unsafe width are one problem with eight instances; listing them
    // separately buries every other finding in the panel.
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'rip') continue;
      const narrow = node.op.strips.filter((s) => s.width < ctx.shop.minSafeRipWidth);
      if (narrow.length === 0) continue;

      const widths = [...new Set(narrow.map((s) => formatTicks(s.width)))];
      out.push(
        finding(SAFE_030, 'error', {
          nodes: [node.id],
          message:
            `${narrow.length} strip${narrow.length === 1 ? '' : 's'} at ${widths.join(', ')} ` +
            `fall below the ${formatTicks(ctx.shop.minSafeRipWidth)} minimum safe rip width.`,
          remedy:
            'Widen the strips, or rip them from wider stock with a jig or sled rather than freehand.',
          data: { count: narrow.length, widths },
          dedupeKey: `narrow-rip:${widths.join(',')}`,
        }),
      );
    }
    return out;
  },
};

const SAFE_040: Rule = {
  id: 'V-SAFE-040',
  category: 'safety',
  cites: ['KB-D03'],
  check(ctx) {
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'crosscut') continue;
      if (node.op.sliceLength < ctx.shop.minSafeCrosscutLength) {
        out.push(
          finding(SAFE_040, 'error', {
            nodes: [node.id],
            message:
              `Slices are ${formatTicks(node.op.sliceLength)} long, below the ` +
              `${formatTicks(ctx.shop.minSafeCrosscutLength)} minimum safe crosscut length.`,
            remedy: 'Cut thicker slices, or use a stop block and hold-down on the sled.',
            data: { sliceLength: node.op.sliceLength },
          }),
        );
      }
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* V-TOOL — tooling envelope                                                   */
/* -------------------------------------------------------------------------- */

const TOOL_050: Rule = {
  id: 'V-TOOL-050',
  category: 'tooling',
  cites: ['KB-D04'],
  check(ctx) {
    const dims = boardDimensions(ctx.evaluated.workpiece);
    const narrow = Math.min(dims.width, dims.length);
    if (narrow <= ctx.shop.drumSanderWidth) return [];
    // A warning rather than an error: an open-end sander can do it in two
    // passes, at the cost of a registration ridge. Discovering this after the
    // final glue-up is a uniquely bad moment, which is why it is checked here.
    return [
      finding(TOOL_050, 'warning', {
        message:
          `The board is ${formatTicks(narrow)} across its narrow dimension, wider than the ` +
          `${formatTicks(ctx.shop.drumSanderWidth)} drum sander.`,
        remedy:
          'Reduce the board, or flatten in two passes on an open-end sander and accept a possible registration ridge.',
        data: { boardWidth: narrow, sanderWidth: ctx.shop.drumSanderWidth },
      }),
    ];
  },
};

const TOOL_060: Rule = {
  id: 'V-TOOL-060',
  category: 'tooling',
  cites: ['KB-D04'],
  check(ctx) {
    const dims = boardDimensions(ctx.evaluated.workpiece);
    if (dims.thickness <= ctx.shop.drumSanderMaxThickness) return [];
    return [
      finding(TOOL_060, 'error', {
        message: `The board is ${formatTicks(dims.thickness)} thick, beyond the drum sander's capacity.`,
        remedy: 'Reduce the thickness, or flatten by another means.',
        data: { thickness: dims.thickness },
      }),
    ];
  },
};

const TOOL_090: Rule = {
  id: 'V-TOOL-090',
  category: 'tooling',
  cites: ['KB-C02', 'KB-C04'],
  check(ctx) {
    const out: Finding[] = [];
    const t = ctx.project.edgeTreatments;
    // A chamfer is a 45-degree bevel rip on the table saw, so it needs no
    // extra tooling. A roundover and a juice groove both need a router.
    const needsRouter = [t.roundover && 'roundover', t.juiceGroove && 'juice groove'].filter(
      Boolean,
    ) as string[];
    if (needsRouter.length > 0 && !ctx.shop.hasRouter) {
      out.push(
        finding(TOOL_090, 'warning', {
          message: `This design includes a ${needsRouter.join(' and ')}, which needs a router.`,
          remedy: 'Add a router to the shop profile, or use a chamfer, which is a 45-degree bevel rip.',
          data: { features: needsRouter },
        }),
      );
    }
    if (t.feet && !ctx.shop.hasDrill) {
      out.push(
        finding(TOOL_090, 'warning', {
          message: 'This design includes feet, which need a drill.',
          remedy: 'Add a drill to the shop profile, or omit the feet.',
          data: { features: ['feet'] },
        }),
      );
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* V-GRAIN                                                                     */
/* -------------------------------------------------------------------------- */

const GRAIN_010: Rule = {
  id: 'V-GRAIN-010',
  category: 'grain',
  cites: ['KB-B02'],
  check(ctx) {
    if (ctx.evaluated.workpiece.orientation !== 'endGrain') return [];
    const orientations = new Set(
      ctx.evaluated.workpiece.crossSection.faces
        .map((f) => f.ringOrientation)
        .filter((o) => o !== 'unspecified'),
    );
    if (orientations.size <= 1) return [];
    // An error rather than a warning, deliberately. General panel advice says
    // to ALTERNATE ring direction; that advice is correct for panels and
    // actively harmful here, so someone applying remembered knowledge builds a
    // board that fails.
    return [
      finding(GRAIN_010, 'error', {
        message: `This end-grain board mixes ${[...orientations].join(' and ')} faces.`,
        remedy:
          'Use one ring orientation throughout. This is the opposite of edge-grain panel practice, where alternating ring direction correctly cancels cupping.',
        data: { orientations: [...orientations] },
      }),
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* V-DIM                                                                       */
/* -------------------------------------------------------------------------- */

const MIN_THICKNESS = inches(1.5);
const MIN_THICKNESS_WITH_GROOVE = inches(1.75);
const MAX_GROOVE_FRACTION = 0.25;

const DIM_010: Rule = {
  id: 'V-DIM-010',
  category: 'dimension',
  cites: ['KB-C01'],
  check(ctx) {
    const { thickness } = boardDimensions(ctx.evaluated.workpiece);
    if (thickness >= MIN_THICKNESS) return [];
    return [
      finding(DIM_010, 'error', {
        message: `Finished thickness is ${formatTicks(thickness)}, below the 1 1/2" minimum.`,
        remedy: `Increase the crosscut slice length to at least ${formatTicks(inches(1.75))}.`,
        data: { thickness, minimum: MIN_THICKNESS },
      }),
    ];
  },
};

const DIM_020: Rule = {
  id: 'V-DIM-020',
  category: 'dimension',
  cites: ['KB-C02'],
  check(ctx) {
    const groove = ctx.project.edgeTreatments.juiceGroove;
    if (!groove) return [];
    const { thickness } = boardDimensions(ctx.evaluated.workpiece);
    if (groove.depth <= thickness * MAX_GROOVE_FRACTION) return [];
    return [
      finding(DIM_020, 'error', {
        message:
          `The juice groove is ${formatTicks(groove.depth)} deep, more than 25% of the ` +
          `${formatTicks(thickness)} board thickness.`,
        remedy: 'Make the groove shallower, or the board thicker.',
        data: { depth: groove.depth, thickness },
      }),
    ];
  },
};

const DIM_040: Rule = {
  id: 'V-DIM-040',
  category: 'dimension',
  cites: ['KB-C01', 'KB-C02'],
  check(ctx) {
    if (!ctx.project.edgeTreatments.juiceGroove) return [];
    const { thickness } = boardDimensions(ctx.evaluated.workpiece);
    if (thickness >= MIN_THICKNESS_WITH_GROOVE) return [];
    return [
      finding(DIM_040, 'warning', {
        message: `A board with a juice groove should be at least 1 3/4" thick; this one is ${formatTicks(thickness)}.`,
        remedy: 'Increase the thickness so enough material remains below the groove.',
        data: { thickness },
      }),
    ];
  },
};

const DIM_060: Rule = {
  id: 'V-DIM-060',
  category: 'dimension',
  cites: ['KB-C04'],
  check(ctx) {
    const t = ctx.project.edgeTreatments;
    if (t.chamfer ?? t.roundover) return [];
    return [
      finding(DIM_060, 'info', {
        message: 'No edge treatment is specified.',
        remedy: 'Add a chamfer or roundover. Sharp end-grain arrises are fragile and chip.',
      }),
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* V-FOOD                                                                      */
/* -------------------------------------------------------------------------- */

const FOOD_010: Rule = {
  id: 'V-FOOD-010',
  category: 'food',
  cites: ['KB-B06'],
  check(ctx) {
    return speciesInUse(ctx)
      .filter((s) => SPECIES[s]?.foodSafety === 'avoid')
      .map((s) =>
        finding(FOOD_010, 'error', {
          message: `${SPECIES[s]!.name} is not suitable for a food-contact surface.`,
          remedy: SPECIES[s]!.foodSafetyNote ?? 'Choose a species with a kitchen service record.',
          data: { species: s },
        }),
      );
  },
};

const FOOD_020: Rule = {
  id: 'V-FOOD-020',
  category: 'food',
  cites: ['KB-B06'],
  check(ctx) {
    return speciesInUse(ctx)
      .filter((s) => SPECIES[s]?.foodSafety === 'openPore')
      .map((s) =>
        finding(FOOD_020, 'warning', {
          message: `${SPECIES[s]!.name} is open-pored, which makes a poor cutting surface.`,
          remedy: SPECIES[s]!.foodSafetyNote ?? 'Prefer a closed-pore hardwood.',
          data: { species: s },
        }),
      );
  },
};

const FOOD_030: Rule = {
  id: 'V-FOOD-030',
  category: 'food',
  cites: ['KB-B06'],
  check(ctx) {
    // Contested, not decided. Blocking it would be presumptuous; permitting it
    // silently would withhold information. State the disagreement.
    return speciesInUse(ctx)
      .filter((s) => SPECIES[s]?.foodSafety === 'contested')
      .map((s) =>
        finding(FOOD_030, 'info', {
          message: `Sources disagree about ${SPECIES[s]!.name} for food contact.`,
          remedy: SPECIES[s]!.foodSafetyNote ?? 'Read the sources and decide for yourself.',
          data: { species: s },
        }),
      );
  },
};

const FOOD_040: Rule = {
  id: 'V-FOOD-040',
  category: 'food',
  cites: ['KB-B06'],
  check(ctx) {
    const out: Finding[] = [];
    for (const id of speciesInUse(ctx)) {
      const s = SPECIES[id];
      if (!s) continue;
      if (s.jankaLbf < 900) {
        out.push(
          finding(FOOD_040, 'info', {
            message: `${s.name} is soft at ${s.jankaLbf} lbf and will scar sooner.`,
            remedy: 'Acceptable, but expect visible knife marks earlier than with a harder species.',
            data: { species: id, janka: s.jankaLbf },
          }),
        );
      } else if (s.jankaLbf > 1800) {
        out.push(
          finding(FOOD_040, 'info', {
            message: `${s.name} is hard at ${s.jankaLbf} lbf and will dull knives faster.`,
            remedy: 'Acceptable, but a softer species is kinder to edges.',
            data: { species: id, janka: s.jankaLbf },
          }),
        );
      }
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* V-MAT                                                                       */
/* -------------------------------------------------------------------------- */

const CUBIC_INCHES_PER_BOARD_FOOT = 144;

const MAT_010: Rule = {
  id: 'V-MAT-010',
  category: 'material',
  cites: ['KB-A12'],
  check(ctx) {
    const boardFeet = Object.entries(ctx.evaluated.ledger.input).map(([species, volume]) => ({
      species,
      boardFeet: volume / CUBIC_INCHES_PER_BOARD_FOOT,
    }));
    const total = boardFeet.reduce((s, b) => s + b.boardFeet, 0);
    return [
      finding(MAT_010, 'info', {
        message: `This design needs about ${total.toFixed(2)} board feet of rough stock.`,
        remedy: 'Buy with a margin; yield from rough stock is typically around 65%.',
        data: { boardFeet, total },
      }),
    ];
  },
};

const MAT_020: Rule = {
  id: 'V-MAT-020',
  category: 'material',
  cites: ['KB-A12'],
  check(ctx) {
    if (ctx.evaluated.workpiece.orientation !== 'endGrain') return [];
    const input = sum(Object.values(ctx.evaluated.ledger.input));
    const finished = finishedVolume(ctx);
    if (finished <= 0) return [];
    const ratio = input / finished;
    // A sanity check on the whole plan rather than on any one node. If an
    // end-grain board claims to need about as much lumber as an edge-grain
    // one, something upstream is wrong.
    if (ratio >= 1.4 && ratio <= 2.6) return [];
    return [
      finding(MAT_020, 'warning', {
        message:
          `This design uses ${ratio.toFixed(2)}x the finished volume in rough stock. ` +
          'End-grain boards normally run 1.5x to 2.5x.',
        remedy:
          ratio < 1.4
            ? 'Check the milling and trim allowances; this looks too efficient for end grain.'
            : 'Consider longer panels or fewer offcuts to reduce waste.',
        data: { ratio },
      }),
    ];
  },
};

const MAT_040: Rule = {
  id: 'V-MAT-040',
  category: 'material',
  cites: ['KB-A12'],
  check(ctx) {
    const input = sum(Object.values(ctx.evaluated.ledger.input));
    const offcut = sum(Object.values(ctx.evaluated.ledger.offcut));
    if (input <= 0) return [];
    const fraction = offcut / input;
    if (fraction < 0.25) return [];
    return [
      finding(MAT_040, 'info', {
        message: `${(fraction * 100).toFixed(0)}% of the stock ends up as offcuts.`,
        remedy: 'Adjusting the strip widths or slice count to suit standard board widths would waste less.',
        data: { fraction },
      }),
    ];
  },
};

/* -------------------------------------------------------------------------- */

function speciesInUse(ctx: ValidationContext): string[] {
  return [...new Set(ctx.evaluated.workpiece.crossSection.faces.map((f) => f.species))];
}

function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function finishedVolume(ctx: ValidationContext): number {
  const dims = boardDimensions(ctx.evaluated.workpiece);
  return toInches(dims.width) * toInches(dims.length) * toInches(dims.thickness);
}

export const RULES: readonly Rule[] = [
  SAFE_010,
  SAFE_020,
  SAFE_030,
  SAFE_040,
  TOOL_050,
  TOOL_060,
  TOOL_090,
  GRAIN_010,
  DIM_010,
  DIM_020,
  DIM_040,
  DIM_060,
  FOOD_010,
  FOOD_020,
  FOOD_030,
  FOOD_040,
  MAT_010,
  MAT_020,
  MAT_040,
];
