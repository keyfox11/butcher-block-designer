/**
 * Build instructions.
 *
 * Generated from a topological walk of the construction graph, with text
 * rendered from templates that pull from the knowledge base. Change a figure in
 * the knowledge base and every instruction that depends on it changes too.
 *
 * Safety notes are derived from graph structure rather than authored into
 * templates, so no design can omit them.
 */

import { boardDimensions, type EvalResult } from '../geometry/evaluate.js';
import { kb, type KbId } from '../knowledge/kb.js';
import { SPECIES } from '../knowledge/species.js';
import type { Graph, NodeId, ShopProfile, Ticks } from '../model/types.js';
import { formatLimit, formatTicks, toInches } from '../units/ticks.js';
import { analyze } from './analyze.js';
import { describeSetting, type MachineSetting } from './cutlist.js';

export type Phase =
  | 'prepare'
  | 'mill'
  | 'stage1'
  | 'crosscut'
  | 'stage2'
  | 'flatten'
  | 'features'
  | 'finish';

export const PHASE_TITLES: Record<Phase, string> = {
  prepare: '0 — Prepare',
  mill: '1 — Mill the stock',
  stage1: '2 — Stage-1 glue-up',
  crosscut: '3 — Crosscut',
  stage2: '4 — Stage-2 glue-up',
  flatten: '5 — Flatten and square',
  features: '6 — Features',
  finish: '7 — Finish',
};

export interface SafetyNote {
  readonly cites: KbId;
  /** `critical` renders as a blocking callout that cannot be collapsed. */
  readonly severity: 'critical' | 'important';
  readonly text: string;
}

export interface Step {
  readonly number: number;
  readonly phase: Phase;
  readonly title: string;
  readonly body: string;
  readonly machineSetting?: MachineSetting;
  readonly nodes: readonly NodeId[];
  readonly safety: readonly SafetyNote[];
  /** Cure times and acclimation waits, shown as a timeline. */
  readonly wait?: { duration: string; reason: string };
  /** Something to verify before continuing. */
  readonly checkpoint?: string;
  readonly cites: readonly KbId[];
}

/** Hardwood target clamping pressure, psi. */
const TARGET_CLAMP_PRESSURE = 200;

export function buildInstructions(
  graph: Graph,
  evaluated: EvalResult,
  shop: ShopProfile,
): readonly Step[] {
  const a = analyze(graph);
  const steps: Omit<Step, 'number'>[] = [];
  const dims = boardDimensions(evaluated.workpiece);

  // Nodes downstream of the rotation are end grain, which is what the
  // never-planer gate keys on.
  const endGrainNodes = endGrainClosure(graph);

  /* ---- Phase 0: prepare -------------------------------------------------- */

  steps.push({
    phase: 'prepare',
    title: 'Check and acclimate the stock',
    body: kb('KB-C05').text,
    nodes: [],
    safety: [],
    checkpoint: 'Confirm the stock is acclimated and at a stable moisture content.',
    cites: ['KB-C05'],
  });

  steps.push({
    phase: 'prepare',
    title: 'Tune the crosscut sled',
    body:
      'Square the sled with the five-cut method before any crosscutting. ' + kb('KB-A09').text,
    nodes: [],
    safety: [
      {
        cites: 'KB-A09',
        severity: 'important',
        text: 'Clamping pressure will not cure a poor cut. Forcing a bad joint closed stores stress that reappears later as a split.',
      },
    ],
    cites: ['KB-A09'],
  });

  /* ---- Phase 1: mill ----------------------------------------------------- */

  for (const billet of a.billets) {
    const { species, rough, milled } = billet.op;
    const name = SPECIES[species]?.name ?? species;
    steps.push({
      phase: 'mill',
      title: `Mill the ${name}`,
      body:
        `Flatten and square ${formatTicks(rough.thickness)} × ${formatTicks(rough.width)} × ` +
        `${formatTicks(rough.length)} rough stock down to ${formatTicks(milled.thickness)} × ` +
        `${formatTicks(milled.width)} × ${formatTicks(milled.length)}. ` +
        'Milling to the cell size is what makes the finished cells square: the face cell is ' +
        '(rip width) × (stock thickness).',
      nodes: [billet.id],
      safety: [],
      cites: ['KB-A02', 'KB-A12'],
    });
  }

  /* ---- Phase 2: rip and glue the stage-1 panel --------------------------- */

  for (const rip of a.rips) {
    const bevelled = rip.op.strips.some((s) => s.bevel !== 0);
    steps.push({
      phase: 'stage1',
      title: rip.label ?? 'Rip strips',
      body:
        `Rip ${rip.op.strips.length} strips. Each fence setting is the width of the strip you keep; ` +
        'the kerf falls on the waste side.' +
        (bevelled
          ? ' Tilt the blade AWAY from the fence so the workpiece is not trapped. A mirrored bevel produces a mirrored pattern.'
          : ''),
      nodes: [rip.id],
      safety: bevelled
        ? [
            {
              cites: 'KB-D02',
              severity: 'important',
              text: 'A tilted blade loses vertical reach and the kept piece has two different face widths. Check both against the cut list.',
            },
          ]
        : [],
      cites: ['KB-D02'],
    });
  }

  for (const panel of a.stagePanels) {
    steps.push(glueStep(panel.id, panel.label ?? 'Glue the stage-1 panel', 'stage1', panel.op.members.length, dims.width, dims.thickness, shop, panel.op.sequence));
  }

  /* ---- Phase 3: crosscut -------------------------------------------------- */

  for (const cut of a.crosscuts) {
    const count = cut.op.count ?? 0;
    steps.push({
      phase: 'crosscut',
      title: cut.label ?? 'Crosscut into slices',
      body:
        `Crosscut ${count} slices at ${formatTicks(cut.op.sliceLength)}, using a stop block so ` +
        'every slice is identical. This dimension becomes the board’s thickness after the ' +
        'rotation, and it is deliberately oversize by what flattening will remove.',
      machineSetting: {
        machine: 'sled-crosscut',
        stopBlockSetting: { value: cut.op.sliceLength, asMeasured: cut.op.sliceLength, roundingError: 0, exact: true },
        count,
        miter: cut.op.miter,
      },
      nodes: [cut.id],
      safety: [],
      checkpoint:
        'Verify the panel is flat and its ends are square before cutting. An out-of-square crosscut is the dominant cause of gapped end-grain glue-ups, and the error doubles when adjacent slices are flipped.',
      cites: ['KB-A09', 'KB-A02'],
    });
  }

  /* ---- Phase 4: rotate and glue the board -------------------------------- */

  if (a.finalLaminate) {
    const members = a.finalLaminate.op.members;
    const rotatedCount = members.filter((m) => m.rotate !== 0).length;

    steps.push({
      phase: 'stage2',
      title: 'Rotate every slice to end grain',
      body:
        'Turn each slice 90° so the end grain faces up. ' +
        (rotatedCount > 0
          ? `Then rotate ${rotatedCount} of them 180° in the face plane, as marked on the assembly map — that reversal is what offsets the pattern.`
          : 'Each slice is drawn from the panel that gives it the correct offset.'),
      nodes: [a.finalLaminate.id],
      safety: [],
      checkpoint:
        'Confirm growth-ring orientation is consistent across all slices. Mixing quartersawn and flatsawn faces shears every glue line — the opposite of edge-grain panel practice.',
      cites: ['KB-B02'],
    });

    steps.push({
      phase: 'stage2',
      title: 'Dry fit against the assembly map',
      body:
        'Lay out every slice and compare it to the assembly map before any glue is opened. ' +
        'Label each piece. One slice turned the wrong way ruins the board after the glue is spread.',
      nodes: [a.finalLaminate.id],
      safety: [],
      cites: ['KB-A05'],
    });

    steps.push(
      glueStep(
        a.finalLaminate.id,
        'Glue the slices into the board',
        'stage2',
        members.length,
        dims.width,
        dims.thickness,
        shop,
        a.finalLaminate.op.sequence,
      ),
    );
  }

  /* ---- Phase 5: flatten and square --------------------------------------- */

  for (const flatten of a.flattens) {
    const isEndGrain = endGrainNodes.has(flatten.id);
    const passes = Math.ceil(flatten.op.removePerFace / shop.drumSanderRemovalPerPass);

    steps.push({
      phase: 'flatten',
      title: flatten.label ?? 'Flatten the board',
      body:
        `Remove ${formatTicks(flatten.op.removePerFace)} from each face with the drum sander, ` +
        `taking no more than ${formatLimit(shop.drumSanderRemovalPerPass)} per pass — about ` +
        `${passes} passes per face (${passes * 2} in total). Alternate faces so the board stays symmetric.`,
      nodes: [flatten.id],
      // Derived from graph structure, not authored into the template, so no
      // design can omit it.
      safety: isEndGrain
        ? [
            {
              cites: 'KB-A08',
              severity: 'critical',
              text:
                'Do NOT run this board through a thickness planer. End grain tears out ' +
                'catastrophically and the board can be seized and thrown. Drum sander only, ' +
                `no more than ${formatLimit(shop.drumSanderRemovalPerPass)} per pass.`,
            },
          ]
        : [],
      cites: ['KB-A08', 'KB-D04'],
    });
  }

  for (const trim of a.trims) {
    if (trim.op.target.kind !== 'rect') continue;
    steps.push({
      phase: 'flatten',
      title: trim.label ?? 'Square up to final size',
      body:
        `Trim to ${formatTicks(trim.op.target.width)} × ${formatTicks(trim.op.target.height)}, ` +
        'taking material evenly from opposite edges so the pattern stays centred.',
      nodes: [trim.id],
      safety: [],
      cites: ['KB-A09'],
    });
  }

  /* ---- Phase 7: finish ---------------------------------------------------- */

  steps.push({
    phase: 'finish',
    title: 'Sand',
    body: 'Work through 80, 120, 180 and 220 grit. End grain shows scratches readily, so do not skip grits.',
    nodes: [],
    safety: [],
    cites: ['KB-C04'],
  });

  steps.push({
    phase: 'finish',
    title: 'Oil',
    body: kb('KB-B06').text,
    nodes: [],
    safety: [
      {
        cites: 'KB-B06',
        severity: 'important',
        text: 'Use food-grade mineral oil. Never use nut-derived oils such as walnut oil — a board is handled by guests, and allergen exposure is not the maker’s risk to take.',
      },
    ],
    wait: { duration: '48 hours', reason: 'three oil soaks, wiped back between each' },
    cites: ['KB-B06'],
  });

  return steps.map((step, index) => ({ ...step, number: index + 1 }));
}

/**
 * A glue-up step, with the clamping requirement computed rather than asserted.
 *
 * Required force is the target pressure times the joint area, and in a
 * multi-piece glue-up that force passes through every joint at once.
 */
function glueStep(
  nodeId: NodeId,
  title: string,
  phase: Phase,
  memberCount: number,
  acrossDimension: number,
  thickness: number,
  shop: ShopProfile,
  sequence: 'simultaneous' | 'rowByRow' | 'taped',
): Omit<Step, 'number'> {
  const jointAreaSqIn = toInches(acrossDimension) * toInches(thickness);
  const requiredForce = TARGET_CLAMP_PRESSURE * jointAreaSqIn;
  const clampsNeeded = Math.ceil(requiredForce / shop.clampForceEach);

  // Sizing the joint comes first whatever holds the pieces together: end grain
  // wicks glue out of the joint and starves it.
  const sizing =
    `Glue ${memberCount} pieces edge to edge. ` +
    'End grain wicks glue away and starves the joint, so size it: a light coat, let it tack, ' +
    'then a second coat before assembling. ';

  // A taped assembly gets no clamp arithmetic, because there are no clamps and
  // quoting a pressure it cannot reach would be worse than saying nothing.
  const body =
    sequence === 'taped'
      ? sizing +
        'Do not clamp this. Three rhombi meeting around a shared line have no clamping axis: ' +
        'pressure from any direction pushes one of them out somewhere else. Wrap painter’s tape ' +
        'firmly across the joints along the whole length — stretched tape acts as a tension band ' +
        'and pulls all three together at once. Check the hexagon is closed on both ends before the ' +
        'glue grabs.'
      : sizing +
        `Aim for about ${TARGET_CLAMP_PRESSURE} psi — roughly ${clampsNeeded} clamps at ` +
        `${shop.clampForceEach} lbf across ${jointAreaSqIn.toFixed(1)} sq in of joint. ` +
        (sequence === 'rowByRow'
          ? 'Glue row by row with about 30 minutes between rows: angled joints turn clamp pressure into lateral force and slide. '
          : '') +
        'Use cauls to keep the faces coplanar; a stepped glue-up wastes flattening allowance.';

  const safety: SafetyNote[] =
    sequence !== 'taped' && clampsNeeded > shop.clampCount
      ? [
          {
            cites: 'KB-D05',
            severity: 'important',
            text:
              `This glue-up wants about ${clampsNeeded} clamps and the shop profile lists ` +
              `${shop.clampCount}. Under-clamping usually shows as visible glue lines rather than ` +
              'outright failure, but expect them.',
          },
        ]
      : [];

  return {
    phase,
    title,
    body,
    nodes: [nodeId],
    safety,
    wait: { duration: 'overnight', reason: 'full glue cure before machining' },
    cites: ['KB-A10', 'KB-A11', 'KB-D05'],
  };
}

/** Nodes at or downstream of the rotation to end grain. */
function endGrainClosure(graph: Graph): Set<NodeId> {
  const endGrain = new Set<NodeId>();
  // buildOrder guarantees dependencies precede dependents, so one forward pass
  // propagates the flag correctly.
  for (const node of analyze(graph).order) {
    if (node.op.kind === 'reorient') {
      endGrain.add(node.id);
      continue;
    }
    const inputs =
      node.op.kind === 'billet'
        ? []
        : node.op.kind === 'laminate'
          ? node.op.members.map((m) => m.piece.node)
          : [node.op.input.node];
    if (inputs.some((i) => endGrain.has(i))) endGrain.add(node.id);
  }
  return endGrain;
}

/** Render instructions as plain text, for the printed sheet and for tests. */
export function formatInstructions(steps: readonly Step[]): string {
  const out: string[] = [];
  let phase: Phase | null = null;
  for (const step of steps) {
    if (step.phase !== phase) {
      phase = step.phase;
      out.push('');
      out.push(PHASE_TITLES[phase]);
      out.push('-'.repeat(PHASE_TITLES[phase].length));
    }
    out.push(`${step.number}. ${step.title}`);
    out.push(`   ${step.body}`);
    const setting = describeSetting(step.machineSetting);
    if (setting) out.push(`   Setting: ${setting}`);
    for (const note of step.safety) {
      out.push(`   ${note.severity === 'critical' ? '!! CRITICAL' : '!  NOTE'}: ${note.text}`);
    }
    if (step.checkpoint) out.push(`   CHECK: ${step.checkpoint}`);
    if (step.wait) out.push(`   WAIT: ${step.wait.duration} — ${step.wait.reason}`);
  }
  return out.join('\n');
}

export type { Ticks };
