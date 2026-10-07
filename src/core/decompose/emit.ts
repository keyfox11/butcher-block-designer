/**
 * From a cut tree to a construction graph.
 *
 * The search proves a decomposition exists; this decides how it is actually
 * built, and the two are not the same question. Reversing the recursion
 * naively -- glue every leaf into its parent, bottom up -- produces a graph
 * that is geometrically correct and a build plan no one would follow: every
 * cell separately crosscut and separately glued, which throws away the entire
 * economy of the two-stage method.
 *
 * ## What axis means where
 *
 * The tree's axes are in the finished board's face coordinates, and the same
 * axis means a different operation depending on how far up the tree it sits.
 * The rule is forced by geometry rather than chosen:
 *
 * - A `y` split whose region spans the **full board length** separates
 *   **slices**. Each part's y extent becomes a stage-1 panel's stock thickness.
 * - A `y` split deeper down is inside a single slice, so its parts are
 *   **layers glued face to face** before the panel is ripped.
 * - An `x` split is always an **edge joint** -- strips side by side.
 *
 * Why forced: an `x` split preserves its parent's y range, so every part of a
 * root-level `x` split still spans the whole board length. Nothing below a
 * full-length region can be anything but slices, and nothing inside a slice can
 * be anything but layers.
 *
 * ## The transpose
 *
 * A leaf `w` wide and `h` tall in the face can be reached two ways: stock
 * milled `h` thick and ripped `w` wide, or stock milled `w` thick and ripped
 * `h` wide, then rolled a quarter turn about its own length. Rolling a stick in
 * your hand is free and leaves the grain exactly where it was, so the only real
 * constraint on a piece is `min(w, h) <= maxStockThickness`. Without the
 * transpose, merging a column of cells into one piece would ask for stock as
 * thick as the board is long.
 */

import {
  DEFAULT_FLATTEN_PER_FACE,
  DEFAULT_MILLING_ALLOWANCE,
  DEFAULT_TRIM_PER_EDGE,
} from '../model/defaults.js';
import type {
  Graph,
  LaminateMember,
  MilliDeg,
  NodeId,
  Ref,
  RingOrientation,
  ShopProfile,
  SpeciesId,
  Ticks,
} from '../model/types.js';
import { NO_TURN, milliDeg, ticks } from '../units/ticks.js';
import { GraphBuilder } from '../generators/builder.js';
import { treeStages } from './guillotine.js';
import type { CutTree, Rect } from './types.js';

const SQUARE = milliDeg(0);
const QUARTER_TURN = milliDeg(90_000);

/**
 * Thickest stock the shop can mill, used as the ceiling on a single piece.
 *
 * 8/4 rough yields a touch under 2" dressed, which is the thickest board most
 * hardwood dealers carry off the rack. It lives here rather than in
 * `ShopProfile` to avoid a schema bump for a P3-only field -- noted in the
 * handoff as a candidate for promotion once the paint surface has been used.
 */
export const DEFAULT_MAX_STOCK_THICKNESS = ticks(2 * 8000);

export interface EmitOptions {
  readonly boardThickness: Ticks;
  /** See the note on `SearchOptions` for why these carry `| undefined`. */
  readonly maxStockThickness?: Ticks | undefined;
  readonly flattenPerFace?: Ticks | undefined;
  readonly trimPerEdge?: Ticks | undefined;
  readonly ringOrientation?: RingOrientation | undefined;
}

export interface EmitResult {
  readonly graph: Graph;
  /** Nested cure cycles. Equal to the tree's height. */
  readonly stages: number;
  /**
   * Glue-ups the builder actually performs.
   *
   * Lower than the tree's split count, because identical bands are crosscut
   * from one shared panel. The search's `glueUps` is a proxy that cannot know
   * which bands turn out identical; this is the number to show the user.
   */
  readonly glueUps: number;
  readonly panelCount: number;
  readonly finished: { readonly width: Ticks; readonly length: Ticks; readonly thickness: Ticks };
  /** Slice length along the grain, before flattening. */
  readonly sliceLength: Ticks;
}

/* -------------------------------------------------------------------------- */
/* Leaf feasibility                                                            */
/* -------------------------------------------------------------------------- */

/** How one piece of wood gets made. */
export interface LeafPlan {
  readonly species: SpeciesId;
  /** Milled thickness of the billet it comes from. */
  readonly stockThickness: number;
  /** Fence setting that frees it. */
  readonly ripWidth: number;
  /** A quarter turn when the piece is ripped wide and stood on edge. */
  readonly rotate: MilliDeg;
}

export type LeafPlanResult =
  | { readonly ok: true; readonly plan: LeafPlan }
  | { readonly ok: false; readonly code: 'unsafeWidth' | 'tooThick'; readonly detail: string };

/**
 * Decide how to make one piece, or say why it cannot be made.
 *
 * Exported because the orchestrator runs this over every leaf *before*
 * emitting, so an impossible piece produces a refusal naming its region rather
 * than a `GeometryError` from deep inside the evaluator. A thrown error is the
 * right answer for an internal invariant and the wrong one for a design the
 * user drew.
 */
export function planLeaf(
  rect: Rect,
  species: SpeciesId,
  shop: ShopProfile,
  maxStockThickness: number,
): LeafPlanResult {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;

  // Prefer the untransposed orientation: it keeps the rip width equal to the
  // piece's width on the board, which is what the cut list reads best.
  const upright = h <= maxStockThickness;
  const rolled = w <= maxStockThickness;

  if (!upright && !rolled) {
    return {
      ok: false,
      code: 'tooThick',
      detail: `needs stock at least ${Math.min(w, h) / 8000}" thick`,
    };
  }

  const plan: LeafPlan = upright
    ? { species, stockThickness: h, ripWidth: w, rotate: NO_TURN }
    : { species, stockThickness: w, ripWidth: h, rotate: QUARTER_TURN };

  if (plan.ripWidth < shop.minSafeRipWidth) {
    return {
      ok: false,
      code: 'unsafeWidth',
      detail: `would be ripped ${plan.ripWidth / 8000}" wide`,
    };
  }
  return { ok: true, plan };
}

/* -------------------------------------------------------------------------- */
/* Panel identity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A structural fingerprint for a slice.
 *
 * Two slices with the same fingerprint are the same piece of wood cut twice, so
 * they come from one panel. That is the single biggest material saving the
 * emitter makes: a painted design with ten identical bands needs one panel ten
 * slices long, not ten panels.
 *
 * Positions are not encoded, only sizes and order, because the parts tile their
 * parent and so order fixes position.
 */
export function sliceSignature(node: CutTree): string {
  if (node.kind === 'leaf') {
    return `L${node.rect.x1 - node.rect.x0}x${node.rect.y1 - node.rect.y0}:${node.piece.species}`;
  }
  return `S${node.axis}[${node.parts.map(sliceSignature).join(',')}]`;
}

/* -------------------------------------------------------------------------- */
/* Emission                                                                    */
/* -------------------------------------------------------------------------- */

interface PanelGroup {
  readonly signature: string;
  readonly exemplar: CutTree;
  /** Slices wanted from this panel. */
  count: number;
  /** The crosscut node, once built. */
  crosscut?: NodeId;
  /** Ports handed out so far. */
  taken: number;
}

export function emitGraph(tree: CutTree, shop: ShopProfile, options: EmitOptions): EmitResult {
  const {
    boardThickness,
    maxStockThickness = DEFAULT_MAX_STOCK_THICKNESS,
    flattenPerFace = DEFAULT_FLATTEN_PER_FACE,
    trimPerEdge = DEFAULT_TRIM_PER_EDGE,
    ringOrientation = 'quartersawn',
  } = options;

  const b = new GraphBuilder();
  const sliceLength = ticks(boardThickness + 2 * flattenPerFace);
  const board = tree.rect;

  /** Does this region span the whole board along its length? */
  const fullLength = (r: Rect) => r.y0 === board.y0 && r.y1 === board.y1;

  /* --- pass 1: which subtrees become slices, and how many of each --------- */

  const groups = new Map<string, PanelGroup>();
  const sliceNodes: CutTree[] = [];

  const collect = (node: CutTree): void => {
    if (node.kind === 'split' && node.axis === 'x' && fullLength(node.rect)) {
      node.parts.forEach(collect);
      return;
    }
    if (node.kind === 'split' && node.axis === 'y' && fullLength(node.rect)) {
      node.parts.forEach((part) => {
        sliceNodes.push(part);
        register(part);
      });
      return;
    }
    // A full-length leaf, or the whole board as one piece: one slice of its own.
    sliceNodes.push(node);
    register(node);
  };

  const register = (node: CutTree): void => {
    const signature = sliceSignature(node);
    const existing = groups.get(signature);
    if (existing) existing.count += 1;
    else groups.set(signature, { signature, exemplar: node, count: 1, taken: 0 });
  };

  collect(tree);

  /* --- pass 2: one panel per distinct slice ------------------------------- */

  for (const group of groups.values()) {
    const slices = group.count;
    // n slices need n-1 internal kerfs, plus an allowance to square both ends.
    const panelLength = ticks(
      slices * sliceLength + Math.max(slices - 1, 0) * shop.kerf + 2 * trimPerEdge,
    );
    const panel = emitPanel(b, group.exemplar, shop, {
      panelLength,
      maxStockThickness,
      ringOrientation,
    });
    group.crosscut = b.add(
      {
        kind: 'crosscut',
        input: { node: panel, port: 0 },
        sliceLength,
        count: slices,
        miter: SQUARE,
      },
      slices === 1 ? 'Crosscut the slice' : `Crosscut ${slices} slices`,
    );
  }

  /* --- pass 3: stand the slices up and glue the board -------------------- */

  let sliceCounter = 0;

  const takeSlice = (node: CutTree): Ref => {
    const group = groups.get(sliceSignature(node));
    if (!group?.crosscut) throw new Error('Internal: no panel for this slice');
    const port = group.taken++;
    if (port >= group.count) throw new Error('Internal: panel ran out of slices');
    const rotated = b.add(
      { kind: 'reorient', input: { node: group.crosscut, port }, mode: 'toEndGrain' },
      `Stand slice ${++sliceCounter} on end`,
    );
    return { node: rotated, port: 0 };
  };

  const assemble = (node: CutTree): Ref => {
    if (node.kind === 'leaf' || !fullLength(node.rect)) return takeSlice(node);

    if (node.axis === 'y') {
      const members: LaminateMember[] = node.parts.map((part) => ({
        piece: takeSlice(part),
        offset: { x: ticks(part.rect.x0 - node.rect.x0), y: ticks(part.rect.y0 - node.rect.y0) },
        rotate: NO_TURN,
        mirrored: false,
      }));
      const id = b.add(
        { kind: 'laminate', members, sequence: 'simultaneous' },
        `Glue ${members.length} slices into the board`,
      );
      return { node: id, port: 0 };
    }

    const members: LaminateMember[] = node.parts.map((part) => ({
      piece: assemble(part),
      offset: { x: ticks(part.rect.x0 - node.rect.x0), y: ticks(part.rect.y0 - node.rect.y0) },
      rotate: NO_TURN,
      mirrored: false,
    }));
    const id = b.add(
      { kind: 'laminate', members, sequence: 'simultaneous' },
      `Glue ${members.length} sub-assemblies side by side`,
    );
    return { node: id, port: 0 };
  };

  const assembled = assemble(tree);

  const flattened = b.add(
    {
      kind: 'flatten',
      input: assembled,
      method: 'drumSander',
      removePerFace: flattenPerFace,
    },
    'Flatten the board',
  );

  // The lay-up must overhang the finished size, or the saw has nothing to
  // remove wherever a piece edge lands on the trim line. Same convention every
  // grid generator uses: the painted grid is the lay-up, and the finished board
  // is smaller by the trim allowance on each edge.
  const finishedWidth = ticks(board.x1 - board.x0 - 2 * trimPerEdge);
  const finishedLength = ticks(board.y1 - board.y0 - 2 * trimPerEdge);

  const trimmed = b.add(
    {
      kind: 'trim',
      input: { node: flattened, port: 0 },
      target: { kind: 'rect', width: finishedWidth, height: finishedLength },
    },
    'Square up to final size',
  );

  return {
    graph: b.build({ node: trimmed, port: 0 }),
    stages: treeStages(tree),
    glueUps: countGlueUps(tree, groups, fullLength),
    panelCount: groups.size,
    finished: { width: finishedWidth, length: finishedLength, thickness: boardThickness },
    sliceLength,
  };
}

/**
 * Glue-ups as the builder experiences them.
 *
 * A split with one part is not a glue-up, and a panel shared between identical
 * slices is glued once however many slices come off it. Counting split nodes
 * instead would tell a user with ten identical bands that they face eleven
 * glue-ups when they face two.
 */
function countGlueUps(
  tree: CutTree,
  groups: ReadonlyMap<string, PanelGroup>,
  fullLength: (r: Rect) => boolean,
): number {
  let total = 0;

  // Assembly-level glue-ups: every full-length split that joins more than one
  // thing happens once.
  const walkAssembly = (node: CutTree): void => {
    if (node.kind !== 'split' || !fullLength(node.rect)) return;
    if (node.parts.length > 1) total += 1;
    if (node.axis === 'x') node.parts.forEach(walkAssembly);
  };
  walkAssembly(tree);

  // Panel-level glue-ups: counted once per distinct panel, not per slice.
  const walkPanel = (node: CutTree): void => {
    if (node.kind !== 'split') return;
    if (node.parts.length > 1) total += 1;
    node.parts.forEach(walkPanel);
  };
  for (const group of groups.values()) walkPanel(group.exemplar);

  return total;
}

/* -------------------------------------------------------------------------- */
/* One stage-1 panel                                                           */
/* -------------------------------------------------------------------------- */

interface PanelOptions {
  readonly panelLength: Ticks;
  readonly maxStockThickness: number;
  readonly ringOrientation: RingOrientation;
}

/**
 * Build one long-grain panel whose cross-section is `node`'s rectangle.
 *
 * Leaves are gathered and grouped by species and milled thickness first, so
 * each group is one billet and one rip. That is what makes the cut list read
 * like a plan -- "rip maple into five strips" rather than five separate boards
 * -- and it is also where the kerf accounting has to be right, since a billet
 * must be wide enough for its strips *and* the blade between them.
 */
function emitPanel(
  b: GraphBuilder,
  node: CutTree,
  shop: ShopProfile,
  options: PanelOptions,
): NodeId {
  const leaves: Array<{ node: Extract<CutTree, { kind: 'leaf' }>; plan: LeafPlan }> = [];

  const gather = (n: CutTree): void => {
    if (n.kind === 'leaf') {
      const planned = planLeaf(n.rect, n.piece.species, shop, options.maxStockThickness);
      if (!planned.ok) {
        // Unreachable in normal use: the orchestrator plans every leaf before
        // emitting. Kept as an internal invariant rather than a user message.
        throw new Error(`Internal: leaf ${planned.code} (${planned.detail}) reached the emitter`);
      }
      leaves.push({ node: n, plan: planned.plan });
      return;
    }
    n.parts.forEach(gather);
  };
  gather(node);

  // Group by species AND milled thickness: a billet has one thickness, so two
  // pieces of the same species at different thicknesses are different stock.
  const bySpecies = new Map<string, Array<{ index: number; plan: LeafPlan }>>();
  leaves.forEach(({ plan }, index) => {
    const key = `${plan.species}|${plan.stockThickness}`;
    const list = bySpecies.get(key) ?? [];
    list.push({ index, plan });
    bySpecies.set(key, list);
  });

  const stripRef = new Map<number, Ref>();

  for (const [, group] of bySpecies) {
    const first = group[0]!.plan;
    const widths = group.map((g) => g.plan.ripWidth);
    // Every strip costs its own width plus the kerf that frees it.
    const totalWidth = widths.reduce((sum, w) => sum + w + shop.kerf, 0);

    const milled = {
      thickness: ticks(first.stockThickness),
      width: ticks(totalWidth + DEFAULT_MILLING_ALLOWANCE.width),
      length: options.panelLength,
    };
    const billet = b.add(
      {
        kind: 'billet',
        species: first.species,
        rough: {
          thickness: ticks(milled.thickness + DEFAULT_MILLING_ALLOWANCE.thickness),
          width: ticks(milled.width + DEFAULT_MILLING_ALLOWANCE.width),
          length: ticks(milled.length + DEFAULT_MILLING_ALLOWANCE.length),
        },
        milled,
        ringOrientation: options.ringOrientation,
      },
      `${first.species} stock, ${milled.thickness / 8000}" thick`,
    );

    const rip = b.add(
      {
        kind: 'rip',
        input: { node: billet, port: 0 },
        strips: widths.map((w) => ({ width: ticks(w), bevel: SQUARE })),
      },
      `Rip ${first.species} into ${widths.length} ${widths.length === 1 ? 'strip' : 'strips'}`,
    );

    group.forEach(({ index }, port) => stripRef.set(index, { node: rip, port }));
  }

  /* Assemble the panel's cross-section from the ripped strips. */

  let nextLeaf = 0;
  const build = (n: CutTree): Ref => {
    if (n.kind === 'leaf') {
      const index = nextLeaf++;
      const ref = stripRef.get(index);
      const plan = leaves[index]?.plan;
      if (!ref || !plan) throw new Error(`Internal: no strip for leaf ${index}`);
      if (plan.rotate === NO_TURN) return ref;
      // A rolled stick needs a laminate node of its own to carry the turn,
      // because only a member placement can express a rotation.
      const turned = b.add(
        {
          kind: 'laminate',
          members: [{ piece: ref, offset: { x: ticks(0), y: ticks(0) }, rotate: plan.rotate, mirrored: false }],
          sequence: 'simultaneous',
        },
        'Stand the strip on edge',
      );
      return { node: turned, port: 0 };
    }

    const members: LaminateMember[] = n.parts.map((part) => ({
      piece: build(part),
      offset: { x: ticks(part.rect.x0 - n.rect.x0), y: ticks(part.rect.y0 - n.rect.y0) },
      rotate: NO_TURN,
      mirrored: false,
    }));
    const id = b.add(
      { kind: 'laminate', members, sequence: 'simultaneous' },
      n.axis === 'x'
        ? `Glue ${members.length} strips edge to edge`
        : `Glue ${members.length} layers face to face`,
    );
    return { node: id, port: 0 };
  };

  const assembled = build(node);
  // The crosscut takes a node, not a port, so a bare rip needs wrapping. A
  // single-strip panel is a real case -- a full-width band of one species.
  if (assembled.port !== 0) {
    throw new Error('Internal: panel root must be on port 0');
  }
  return assembled.node;
}
