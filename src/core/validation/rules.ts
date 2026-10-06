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
import { formatLimit, formatTicks, inches, ticks, toDegrees, toInches, toRadians } from '../units/ticks.js';
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
            remedy: `Take passes of no more than ${formatLimit(ctx.shop.drumSanderRemovalPerPass)}. Heavier cuts burn end grain and load the belt.`,
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

/**
 * Maximum depth of cut at a given bevel.
 *
 * Interpolated between the shop profile's two MEASURED points rather than
 * computed from cos(bevel). A typical 10" saw cuts 3 1/8" at 90 degrees and
 * 2 1/4" at 45 -- a ratio of 0.72 against cosine's 0.707, so the cosine model
 * overstates the saw's reach. Overstating a limit is the dangerous direction.
 */
export function maxCutDepth(shop: ValidationContext['shop'], bevel: number): number {
  const degrees = Math.abs(toDegrees(bevel));
  const t = Math.min(degrees, 45) / 45;
  return shop.bladeDepthAt90 + t * (shop.bladeDepthAt45 - shop.bladeDepthAt90);
}

const TOOL_010: Rule = {
  id: 'V-TOOL-010',
  category: 'tooling',
  cites: ['KB-D01'],
  check(ctx) {
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'rip') continue;
      const thickness = ripStockThickness(ctx, node.op.input);
      for (const [index, strip] of node.op.strips.entries()) {
        const available = maxCutDepth(ctx.shop, strip.bevel);
        if (thickness > available) {
          out.push(
            finding(TOOL_010, 'error', {
              nodes: [node.id],
              message:
                `Cut ${index + 1} must pass through ${formatTicks(ticks(thickness))} of stock, but ` +
                `at ${toDegrees(strip.bevel).toFixed(1)}° the saw reaches only ` +
                `${formatLimit(ticks(Math.round(available)))}.`,
              remedy: 'Use thinner stock, a shallower bevel, or a larger blade.',
              data: { thickness, available, bevel: strip.bevel },
              dedupeKey: 'cut-depth',
            }),
          );
        }
      }
    }
    return out;
  },
};

const TOOL_030: Rule = {
  id: 'V-TOOL-030',
  category: 'tooling',
  cites: ['KB-D02'],
  check(ctx) {
    const out: Finding[] = [];
    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'rip') continue;
      for (const [index, strip] of node.op.strips.entries()) {
        if (Math.abs(strip.bevel) > ctx.shop.maxBevel) {
          out.push(
            finding(TOOL_030, 'error', {
              nodes: [node.id],
              message:
                `Cut ${index + 1} needs a ${Math.abs(toDegrees(strip.bevel)).toFixed(1)}° bevel, ` +
                `beyond the saw's ${toDegrees(ctx.shop.maxBevel).toFixed(0)}° limit.`,
              remedy: 'Reduce the pattern angle.',
              data: { bevel: strip.bevel, maxBevel: ctx.shop.maxBevel },
              dedupeKey: 'bevel-range',
            }),
          );
        }
      }
    }
    return out;
  },
};

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
/* V-GEOM — constructibility                                                   */
/* -------------------------------------------------------------------------- */

/** Thickness of the stock a rip consumes, in ticks. */
function ripStockThickness(ctx: ValidationContext, input: { node: string; port: number }): number {
  const piece = ctx.evaluated.nodeOutputs.get(input.node)?.[input.port];
  if (!piece) return 0;
  const ys = piece.crossSection.outline.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
}

const GEOM_030: Rule = {
  id: 'V-GEOM-030',
  category: 'geometry',
  cites: ['KB-A06', 'KB-D02'],
  check(ctx) {
    const out: Finding[] = [];

    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'rip') continue;
      const thickness = ripStockThickness(ctx, node.op.input);
      if (thickness <= 0) continue;

      // A bevelled strip has a DIFFERENT width at each face: the boundary
      // drifts sideways by thickness x tan(angle) as it crosses the stock.
      // Checking only the fence setting misses a strip that tapers away inside
      // the panel -- which is not a risky cut but a cut the saw cannot make.
      // CBDJS checks one direction only; both are needed.
      let leftBevel = 0;
      for (const [index, strip] of node.op.strips.entries()) {
        const drift = thickness * (Math.tan(toRadians(strip.bevel)) - Math.tan(toRadians(leftBevel)));
        const atTable = strip.width;
        const atTop = strip.width + drift;
        leftBevel = strip.bevel;

        if (Math.min(atTable, atTop) <= 0) {
          out.push(
            finding(GEOM_030, 'error', {
              nodes: [node.id],
              message:
                `Strip ${index + 1} tapers to nothing inside the panel: ` +
                `${formatTicks(ticks(Math.round(atTable)))} at the table face but ` +
                `${formatTicks(ticks(Math.round(atTop)))} at the top.`,
              remedy: 'Widen the strip, or reduce the difference between its two boundary angles.',
              data: { stripIndex: index, atTable, atTop },
              dedupeKey: 'taper-negative',
            }),
          );
        } else if (Math.min(atTable, atTop) < ctx.shop.minSafeRipWidth) {
          out.push(
            finding(GEOM_030, 'error', {
              nodes: [node.id],
              message:
                `Strip ${index + 1} is ${formatTicks(ticks(Math.round(Math.min(atTable, atTop))))} ` +
                `at its narrow face, below the ${formatTicks(ctx.shop.minSafeRipWidth)} minimum. ` +
                'A bevelled strip is narrower at one face than the fence setting suggests.',
              remedy: 'Widen the strip, use a shallower bevel, or rip it with a jig.',
              data: { stripIndex: index, atTable, atTop },
              dedupeKey: 'taper-narrow',
            }),
          );
        }
      }
    }
    return out;
  },
};

/**
 * Corners, ignoring vertices that merely sit along a straight edge.
 *
 * The union outline splits edges wherever a neighbour's corner lands on them,
 * so a hexagon can arrive with eight or ten vertices and still be a hexagon.
 * Counting direction changes rather than points is what makes the shape test
 * mean what it says.
 */
function cornerCount(outline: readonly { x: number; y: number }[]): number {
  let corners = 0;
  for (let i = 0; i < outline.length; i++) {
    const previous = outline[(i - 1 + outline.length) % outline.length]!;
    const current = outline[i]!;
    const next = outline[(i + 1) % outline.length]!;
    const turn =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    // Scaled by the edge lengths, so a long edge with a one-tick kink still
    // reads as straight rather than as a corner.
    const scale = Math.hypot(current.x - previous.x, current.y - previous.y) *
      Math.hypot(next.x - current.x, next.y - current.y);
    if (scale > 0 && Math.abs(turn) / scale > 1e-3) corners++;
  }
  return corners;
}

function extentOf(outline: readonly { x: number; y: number }[]): { w: number; h: number } {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function outputOf(ctx: ValidationContext, ref: { node: NodeId; port: number }) {
  return ctx.evaluated.nodeOutputs.get(ref.node)?.[ref.port];
}


/**
 * How far the built hexagon may sit from 2T before the rhombi are not rhombi.
 *
 * A 64th of an inch. The arithmetic floor is one tick (1/8000"), because
 * T x tan(30) lands almost exactly between two ticks and the rhombus's two
 * slanted edges round opposite ways, so this leaves a factor of 125 of
 * headroom. It still catches a rip width that is wrong by more than 0.6%,
 * where the cubes begin to visibly fail to close.
 */
const HEX_CLOSURE_TOLERANCE = 125;

const GEOM_040: Rule = {
  id: 'V-GEOM-040',
  category: 'geometry',
  cites: ['KB-A11', 'KB-A04'],
  check(ctx) {
    const out: Finding[] = [];

    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'laminate') continue;
      // Only free placement can interlock in two directions at once. Members
      // laid side by side along one axis always have a clamping axis.
      if (node.op.placement !== 'free') continue;
      if (node.op.sequence !== 'simultaneous') continue;

      const placements = ctx.evaluated.memberPlacements.get(node.id) ?? [];
      if (placements.length < 3) continue;

      // Does any pair of members sit diagonally to each other? If so no single
      // clamping axis closes every joint: pressure along x leaves the y joints
      // open and vice versa.
      const boxes = placements.map((p) => extentOf(p.outline));
      void boxes;
      const centres = placements.map((p) => {
        const xs = p.outline.map((q) => q.x);
        const ys = p.outline.map((q) => q.y);
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      });
      const spreadX = Math.max(...centres.map((c) => c.x)) - Math.min(...centres.map((c) => c.x));
      const spreadY = Math.max(...centres.map((c) => c.y)) - Math.min(...centres.map((c) => c.y));
      if (spreadX === 0 || spreadY === 0) continue;

      out.push(
        finding(GEOM_040, 'error', {
          nodes: [node.id],
          message:
            `This glue-up places ${placements.length} pieces in two directions at once, but asks ` +
            'for them to be clamped simultaneously. No single clamping axis closes every joint: ' +
            'pressure across the board leaves the joints along it open, and the pieces slide.',
          remedy:
            'Glue it row by row with a cure between rows, or wrap it in tape as a tension band — ' +
            'which is the documented technique for a honeycomb of hex pucks.',
          data: { members: placements.length, spreadX, spreadY },
          dedupeKey: 'no-clamping-axis',
        }),
      );
    }

    return out;
  },
};

/**
 * The free correctness check.
 *
 * Three 60-degree rhombi close into a regular hexagon exactly when the rip
 * width is T / cos(30 degrees), and that condition shows up as a dimension
 * anybody can put a rule on: across the flats, the hexagon is exactly twice the
 * stock thickness. One comparison catches the single most common way a 3D cube
 * board goes wrong.
 *
 * Measured off the evaluated geometry, never read back from the generator's
 * own arithmetic -- otherwise it would only confirm that the generator agrees
 * with itself.
 */
const GEOM_050: Rule = {
  id: 'V-GEOM-050',
  category: 'geometry',
  cites: ['KB-A05'],
  check(ctx) {
    const out: Finding[] = [];

    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'laminate' || node.op.members.length !== 3) continue;

      const result = ctx.evaluated.nodeOutputs.get(node.id)?.[0];
      if (!result) continue;
      // Three strips glued into a panel are a quadrilateral and not this rule's
      // business; only a six-sided result is a hexagon attempt.
      if (cornerCount(result.crossSection.outline) !== 6) continue;

      const members = node.op.members
        .map((m) => outputOf(ctx, m.piece))
        .filter((w): w is NonNullable<typeof w> => w !== undefined);
      if (members.length !== 3) continue;
      if (members.some((m) => cornerCount(m.crossSection.outline) !== 4)) continue;

      // The stock thickness is the rhombus stick's own thickness, before any
      // turn: the dimension the planer set.
      const stockThickness = Math.min(...members.map((m) => extentOf(m.crossSection.outline).h));
      const hex = extentOf(result.crossSection.outline);
      const acrossFlats = Math.min(hex.w, hex.h);
      const acrossCorners = Math.max(hex.w, hex.h);
      const expected = 2 * stockThickness;
      const error = Math.abs(acrossFlats - expected);

      if (error > HEX_CLOSURE_TOLERANCE) {
        const impliedRip = acrossFlats / Math.sqrt(3);
        out.push(
          finding(GEOM_050, 'error', {
            nodes: [node.id],
            message:
              `The hex prism measures ${formatTicks(ticks(Math.round(acrossFlats)))} across the ` +
              `flats, but a true 60° rhombus from ${formatTicks(ticks(Math.round(stockThickness)))} ` +
              `stock gives exactly ${formatTicks(ticks(Math.round(expected)))}. The rhombi will ` +
              'not close into a hexagon: gaps will open in the glue-up and the cubes will not read ' +
              'as cubes.',
            remedy:
              `Set the rip fence to ${formatTicks(ticks(Math.round(stockThickness / Math.cos(Math.PI / 6))))} ` +
              `(T ÷ cos 30°), not ${formatTicks(ticks(Math.round(impliedRip)))}, and check the blade ` +
              'is 30° from vertical — 60° to the table.',
            data: { acrossFlats, acrossCorners, stockThickness, expected },
            dedupeKey: 'hex-closure',
          }),
        );
      }
    }

    return out;
  },
};

/**
 * The ragged honeycomb border, caught where it actually matters.
 *
 * The first version of this rule asked whether a `trim` existed downstream of
 * the honeycomb, which is the wrong question twice over: a trim can be present
 * in the graph and not on the path to the board, and a trim can be present and
 * still leave the border ragged if it is too generous. The question that
 * matters is simply whether the FINISHED board has straight sides.
 */
const GEOM_060: Rule = {
  id: 'V-GEOM-060',
  category: 'geometry',
  cites: ['KB-A05'],
  check(ctx) {
    const board = ctx.evaluated.workpiece.crossSection.outline;
    // A rectangle needs no resolving. Anything else is a board whose edge is
    // not a straight line, which is not a cutting board.
    if (cornerCount(board) <= 4) return [];

    const culprits = Object.values(ctx.project.graph.nodes)
      .filter((n) => n.op.kind === 'laminate' && n.op.placement === 'free')
      .map((n) => n.id);
    if (culprits.length === 0) return [];

    return [
      finding(GEOM_060, 'error', {
        nodes: culprits,
        message:
          `The finished board has ${cornerCount(board)} corners rather than four. The honeycomb's ` +
          'ragged border was never resolved, so the board would come off the bench with a zigzag ' +
          'edge instead of straight sides.',
        remedy:
          'Choose an edge resolution: trim through the outer ring of cells and accept partial ' +
          'cubes, or grow the board to a whole number of lattice periods so the pattern repeats ' +
          'across the cut.',
        data: { corners: cornerCount(board) },
        dedupeKey: 'ragged-edge',
      }),
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* V-GRAIN                                                                     */
/* -------------------------------------------------------------------------- */

const GRAIN_020: Rule = {
  id: 'V-GRAIN-020',
  category: 'grain',
  cites: ['KB-A07'],
  check(ctx) {
    const out: Finding[] = [];

    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'crosscut' || node.op.miter === 0) continue;

      const miter = Math.abs(toDegrees(node.op.miter));
      out.push(
        finding(GRAIN_020, 'warning', {
          nodes: [node.id],
          message:
            `This crosscut is mitered ${miter.toFixed(1)}°, which shears the piece rather than ` +
            'rotating it. The grain is no longer perpendicular to the working face, so the board ' +
            `loses the self-healing that is the reason to choose end grain, tears out when ` +
            `flattened, and shows a face ${(1 / Math.cos(toRadians(node.op.miter))).toFixed(2)}× ` +
            'longer than the square cut would.',
          remedy:
            'Square the crosscut and reach the pattern with a multi-stage sub-assembly instead — ' +
            'rotating a finished end-grain block keeps the grain vertical, a miter does not.',
          data: { miterDegrees: miter },
          dedupeKey: 'mitered-crosscut',
        }),
      );
    }

    return out;
  },
};

const GRAIN_030: Rule = {
  id: 'V-GRAIN-030',
  category: 'grain',
  cites: ['KB-B01'],
  check(ctx) {
    const out: Finding[] = [];

    for (const node of Object.values(ctx.project.graph.nodes)) {
      if (node.op.kind !== 'laminate') continue;

      const orientations = new Set(
        node.op.members
          .map((m) => outputOf(ctx, m.piece)?.orientation)
          .filter((o): o is NonNullable<typeof o> => o !== undefined),
      );
      if (orientations.size <= 1) continue;

      out.push(
        finding(GRAIN_030, 'error', {
          nodes: [node.id],
          message:
            'This glue-up mixes long-grain and end-grain pieces. Their grain runs at 90° to each ' +
            'other, so they move against each other across every seasonal cycle and the glue line ' +
            'between them is loaded in shear until it fails.',
          remedy:
            'Rotate every member to end grain before this glue-up, or none of them. A board is ' +
            'one or the other, never both.',
          data: { orientations: [...orientations] },
          dedupeKey: 'mixed-grain-axis',
        }),
      );
    }

    return out;
  },
};

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
  cites: ['KB-A12', 'KB-A04'],
  check(ctx) {
    if (ctx.evaluated.workpiece.orientation !== 'endGrain') return [];
    const { input, kerf, removed, offcut } = ctx.evaluated.ledger;
    const total = sum(Object.values(input));
    const finished = finishedVolume(ctx);
    if (finished <= 0 || total <= 0) return [];
    const ratio = total / finished;
    // A sanity check on the whole plan rather than on any one node. If an
    // end-grain board claims to need about as much lumber as an edge-grain
    // one, something upstream is wrong.
    if (ratio >= 1.4 && ratio <= 2.6) return [];

    // Naming where the wood goes turns a number into a decision. The three
    // destinations have completely different remedies, and which one dominates
    // is not guessable from the ratio.
    const share = (v: Record<string, number>) => (sum(Object.values(v)) / total) * 100;
    const parts = [
      { what: 'sawdust', pct: share(kerf), fix: 'A thinner kerf blade, or fewer and wider pieces.' },
      {
        what: 'milling, flattening and trim',
        pct: share(removed),
        fix: 'Buy stock closer to final thickness, and build fewer separate sub-assemblies — each one pays its own milling allowance.',
      },
      {
        what: 'offcuts',
        pct: share(offcut),
        fix: 'Longer panels, or more pieces per billet. A bevelled rip also throws away one setup strip per board to establish its first slanted edge, so more strips from each billet spreads that cost.',
      },
    ].sort((a, b) => b.pct - a.pct);
    const worst = parts[0]!;

    return [
      finding(MAT_020, 'warning', {
        message:
          `This design uses ${ratio.toFixed(2)}x the finished volume in rough stock, against the ` +
          '1.5x to 2.5x an ordinary end-grain board runs. ' +
          parts.map((p) => `${p.pct.toFixed(0)}% ${p.what}`).join(', ') +
          '. Multi-stage patterns legitimately sit above the band — a honeycomb trims its whole ' +
          'border away — so this is a cost to plan for rather than necessarily a mistake.',
        remedy:
          ratio < 1.4
            ? 'Check the milling and trim allowances; this looks too efficient for end grain.'
            : `Most of it is ${worst.what}. ${worst.fix}`,
        data: { ratio, kerfPct: share(kerf), removedPct: share(removed), offcutPct: share(offcut) },
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
  TOOL_010,
  TOOL_030,
  TOOL_050,
  TOOL_060,
  TOOL_090,
  GEOM_030,
  GEOM_040,
  GEOM_050,
  GEOM_060,
  GRAIN_010,
  GRAIN_020,
  GRAIN_030,
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
