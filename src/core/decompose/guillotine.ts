/**
 * The guillotine search: from a painted arrangement to a cut tree.
 *
 * ## Why the search is small
 *
 * The textbook formulation tries every candidate cut position independently,
 * giving a dynamic program over O(X^2 Y^2) sub-rectangles. That is not needed
 * here, because of one observation:
 *
 * > A vertical cut that runs edge to edge inside a vertical sub-rectangle runs
 * > edge to edge in its parent too.
 *
 * Vertical splits preserve the parent's full y-range, so a line spanning the
 * child spans the parent. Therefore splitting at **every** valid line in one
 * direction at once loses nothing: any line the greedy split skipped would have
 * been available to a child, and taking it later only buries it deeper.
 *
 * Three things follow, and all three matter:
 *
 * 1. Each node has exactly two candidates -- split on all x-lines, or all
 *    y-lines -- so the recursion is two-way and memoises to almost nothing.
 * 2. The tree **strictly alternates** axis, with no normalisation pass, because
 *    a child provably has no remaining line in its parent's direction.
 * 3. A failure is a **proof**, not a timeout. If neither direction has a valid
 *    line and the region holds more than one piece, no guillotine decomposition
 *    of that region exists. The spec's hard requirement is never to approximate
 *    silently, and this is what lets the refusal be stated as a fact.
 *
 * ## The canonical failure
 *
 * The pinwheel: four rectangles around a fifth. Every horizontal line is
 * blocked by a vertical piece and every vertical line by a horizontal one, so
 * there is no first cut -- and equally no last glue-up, since reversing the
 * recursion is what a glue-up is. It is the smallest arrangement of rectangles
 * that tiles a rectangle and cannot be built, which is why it is the fixture
 * the tests are built around.
 */

import type { PartitionFace } from '../model/types.js';
import { DecomposeCancelled, type Axis, type CutTree, type PaintPiece, type Rect, type TreeCost } from './types.js';

/** A piece of the arrangement, as the search sees it. */
export interface Placed {
  readonly rect: Rect;
  readonly piece: PaintPiece;
  readonly face?: PartitionFace;
}

/**
 * `| undefined` on every optional field, rather than bare `?`.
 *
 * The project compiles with `exactOptionalPropertyTypes`, under which `?:` and
 * `| undefined` are different types: the first forbids passing the key at all
 * with an undefined value. Forwarding a caller's own optionals through -- which
 * every layer here does -- needs the second.
 */
export interface SearchOptions {
  readonly maxStages?: number | undefined;
  readonly onProgress?: ((fraction: number) => void) | undefined;
  readonly shouldCancel?: (() => boolean) | undefined;
}

export type SearchResult =
  | { readonly ok: true; readonly tree: CutTree; readonly cost: TreeCost }
  | {
      readonly ok: false;
      /** The smallest region with no edge-to-edge cut in either direction. */
      readonly blocked: Rect;
      readonly blockedPieces: readonly Placed[];
      /** A decomposition exists but is deeper than the cap allows. */
      readonly exceededStages: boolean;
    };

const DEFAULT_MAX_STAGES = 4;

/**
 * Guard against a pathological arrangement exhausting memory.
 *
 * With maximal splitting the reachable state count is small -- a 24 x 24 target
 * settles in the low hundreds -- so hitting this means something is wrong with
 * the arrangement rather than merely large, and failing loudly beats grinding.
 */
const MAX_STATES = 200_000;

/* -------------------------------------------------------------------------- */
/* Cost                                                                       */
/* -------------------------------------------------------------------------- */

const LEAF_COST: TreeCost = { stages: 0, glueUps: 0, members: 0, axis: null };

/**
 * Compose a node's cost from its children's.
 *
 * `stages` takes the max because cures nest -- the deepest sub-assembly sets
 * how many days the build takes. `glueUps` and `members` sum because every one
 * of them happens.
 *
 * All three are monotone in their children, which is what makes the memoised
 * recursion return a genuinely optimal tree under any monotone ordering rather
 * than merely a good one.
 *
 * `glueUps` here is a **search proxy**, not the number shown to the user.
 * Identical bands share one stage-1 panel, and only the emitter knows which
 * bands turned out identical, so the reported count comes from there.
 */
function composeCost(axis: Axis, parts: readonly TreeCost[]): TreeCost {
  let stages = 0;
  let glueUps = 1;
  let members = parts.length;
  for (const p of parts) {
    stages = Math.max(stages, p.stages);
    glueUps += p.glueUps;
    members += p.members;
  }
  return { stages: stages + 1, glueUps, members, axis };
}

/**
 * Which of two candidate trees to build.
 *
 * The roadmap leaves the weighting open ("minimising tree depth minimises
 * glue-ups, but the best search heuristic needs empirical tuning"), and this is
 * a defensible starting point rather than a tuned answer. But the first two
 * terms are not taste, and the order between them was measured:
 *
 * **Stages first.** A stage is an overnight cure, a flattening pass and a
 * chance to ruin the work. It is the cost a woodworker actually feels.
 *
 * **Then prefer a `y` split, ahead of glue-up count.** This looks like a
 * cosmetic tie-break and is the opposite. A `y` split at full length is the
 * slice stack, so its parts are bands that get crosscut from *shared* panels;
 * an `x` split makes independent sub-assemblies, each needing panels of its
 * own. On a plain 6 x 8 grid the two trees tie at two stages, and the `x`-rooted
 * one looks *cheaper* by the proxy -- 7 splits against 9 -- while actually
 * costing six panels against two. `glueUps` cannot see that, because panel
 * sharing is only knowable once identical bands have been matched up, which
 * happens in the emitter. So the axis term stands in for the one cost the proxy
 * is blind to, and it has to outrank it.
 *
 * Glue-ups and member count then settle the rest: fewer joints, then fewer
 * pieces to handle.
 */
export function cheaper(a: TreeCost, b: TreeCost): boolean {
  if (a.stages !== b.stages) return a.stages < b.stages;
  if (a.axis !== b.axis && (a.axis === 'y' || b.axis === 'y')) return a.axis === 'y';
  if (a.glueUps !== b.glueUps) return a.glueUps < b.glueUps;
  return a.members < b.members;
}

/* -------------------------------------------------------------------------- */
/* The search                                                                 */
/* -------------------------------------------------------------------------- */

export function searchGuillotine(
  placed: readonly Placed[],
  outline: Rect,
  options: SearchOptions = {},
): SearchResult {
  const maxStages = options.maxStages ?? DEFAULT_MAX_STAGES;
  if (placed.length === 0) {
    return { ok: false, blocked: outline, blockedPieces: [], exceededStages: false };
  }

  type Memo = { tree: CutTree; cost: TreeCost } | null;
  const memo = new Map<string, Memo>();
  const blockedRegions: Array<{ rect: Rect; pieces: readonly Placed[] }> = [];
  let states = 0;
  let sinceCheck = 0;

  const key = (r: Rect) => `${r.x0},${r.y0},${r.x1},${r.y1}`;

  const inside = (r: Rect): Placed[] =>
    placed.filter(
      (p) => p.rect.x0 >= r.x0 && p.rect.x1 <= r.x1 && p.rect.y0 >= r.y0 && p.rect.y1 <= r.y1,
    );

  /**
   * Lines that cut `members` edge to edge, in order.
   *
   * A candidate is any piece boundary strictly inside the region; it survives
   * only if no piece spans it. Collected from the pieces themselves rather than
   * from a global coordinate list, so a region with few pieces tests few lines.
   */
  const linesOn = (axis: Axis, r: Rect, members: readonly Placed[]): number[] => {
    const lo = axis === 'x' ? r.x0 : r.y0;
    const hi = axis === 'x' ? r.x1 : r.y1;
    const candidates = new Set<number>();
    for (const m of members) {
      const a = axis === 'x' ? m.rect.x0 : m.rect.y0;
      const b = axis === 'x' ? m.rect.x1 : m.rect.y1;
      if (a > lo && a < hi) candidates.add(a);
      if (b > lo && b < hi) candidates.add(b);
    }
    const out: number[] = [];
    for (const line of candidates) {
      const straddled = members.some((m) => {
        const a = axis === 'x' ? m.rect.x0 : m.rect.y0;
        const b = axis === 'x' ? m.rect.x1 : m.rect.y1;
        return a < line && b > line;
      });
      if (!straddled) out.push(line);
    }
    return out.sort((p, q) => p - q);
  };

  const subRects = (axis: Axis, r: Rect, lines: readonly number[]): Rect[] => {
    const bounds = [axis === 'x' ? r.x0 : r.y0, ...lines, axis === 'x' ? r.x1 : r.y1];
    const out: Rect[] = [];
    for (let i = 1; i < bounds.length; i++) {
      const a = bounds[i - 1]!;
      const b = bounds[i]!;
      out.push(axis === 'x' ? { ...r, x0: a, x1: b } : { ...r, y0: a, y1: b });
    }
    return out;
  };

  const solve = (r: Rect): Memo => {
    const k = key(r);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    if (++states > MAX_STATES) {
      throw new Error(
        `Guillotine search exceeded ${MAX_STATES} states; the arrangement is pathological rather than merely large`,
      );
    }
    // Checked every 64 states rather than every one: a cancel that lands within
    // a few microseconds is indistinguishable from an immediate one, and the
    // callback is the hot path's only unknown cost.
    if (++sinceCheck >= 64) {
      sinceCheck = 0;
      if (options.shouldCancel?.()) throw new DecomposeCancelled();
      options.onProgress?.(Math.min(0.99, states / (states + placed.length)));
    }

    const members = inside(r);
    if (members.length === 1) {
      const only = members[0]!;
      if (
        only.rect.x0 === r.x0 &&
        only.rect.x1 === r.x1 &&
        only.rect.y0 === r.y0 &&
        only.rect.y1 === r.y1
      ) {
        const leaf: Memo = { tree: { kind: 'leaf', rect: r, piece: only.piece }, cost: LEAF_COST };
        memo.set(k, leaf);
        return leaf;
      }
    }

    let best: Memo = null;
    for (const axis of ['y', 'x'] as const) {
      const lines = linesOn(axis, r, members);
      if (lines.length === 0) continue;

      const parts: CutTree[] = [];
      const costs: TreeCost[] = [];
      let complete = true;
      for (const sub of subRects(axis, r, lines)) {
        const solved = solve(sub);
        if (!solved) {
          complete = false;
          break;
        }
        parts.push(solved.tree);
        costs.push(solved.cost);
      }
      if (!complete) continue;

      const cost = composeCost(axis, costs);
      const candidate: Memo = { tree: { kind: 'split', rect: r, axis, parts }, cost };
      if (!best || cheaper(cost, best.cost)) best = candidate;
    }

    if (!best) blockedRegions.push({ rect: r, pieces: members });
    memo.set(k, best);
    return best;
  };

  const solved = solve(outline);
  options.onProgress?.(1);

  if (!solved) {
    // Report the SMALLEST blocked region. A larger one contains it and is
    // technically also blocked, but outlining half the board tells the user
    // nothing about which five pieces are the problem.
    const smallest = blockedRegions.reduce(
      (acc, candidate) => {
        const a = (candidate.rect.x1 - candidate.rect.x0) * (candidate.rect.y1 - candidate.rect.y0);
        const accArea = (acc.rect.x1 - acc.rect.x0) * (acc.rect.y1 - acc.rect.y0);
        return a < accArea ? candidate : acc;
      },
      blockedRegions[0] ?? { rect: outline, pieces: placed },
    );
    return {
      ok: false,
      blocked: smallest.rect,
      blockedPieces: smallest.pieces,
      exceededStages: false,
    };
  }

  if (solved.cost.stages > maxStages) {
    return { ok: false, blocked: outline, blockedPieces: placed, exceededStages: true };
  }

  return { ok: true, tree: solved.tree, cost: solved.cost };
}

/* -------------------------------------------------------------------------- */
/* Reading a tree                                                             */
/* -------------------------------------------------------------------------- */

export function treeLeaves(tree: CutTree): Array<{ rect: Rect; piece: PaintPiece }> {
  if (tree.kind === 'leaf') return [{ rect: tree.rect, piece: tree.piece }];
  return tree.parts.flatMap(treeLeaves);
}

export function treeStages(tree: CutTree): number {
  if (tree.kind === 'leaf') return 0;
  return 1 + Math.max(...tree.parts.map(treeStages));
}

/**
 * Is this the ordinary two-stage board -- slices stacked along the length, each
 * cut from a panel of strips?
 *
 * Worth naming because it is the shape the whole cut-list vocabulary was built
 * around, and because telling a user their painted design builds like a
 * checkerboard is more reassuring than a stage count.
 */
export function isTwoStage(tree: CutTree): boolean {
  if (tree.kind !== 'split' || tree.axis !== 'y') return false;
  return tree.parts.every(
    (band) =>
      band.kind === 'leaf' || (band.axis === 'x' && band.parts.every((s) => s.kind === 'leaf')),
  );
}
