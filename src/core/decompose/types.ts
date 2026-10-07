/**
 * The free-paint target and the decomposer's answers.
 *
 * Tier 1 goes one way -- parameters to a graph -- and cannot produce anything
 * unbuildable. Tier 2 goes the other way: a user paints a picture and the
 * decomposer has to find a sequence of operations that produces it, or say
 * plainly that none exists.
 *
 * The asymmetry is the whole design problem. A generator's output is correct by
 * construction; a painted target's is not, so the honest answers are "here is
 * the graph" and "here is why there is no graph" -- never "here is something
 * close".
 */

import type { Polygon } from '../geometry/polygon.js';
import type { Graph, Partition, SpeciesId, Ticks } from '../model/types.js';

/* -------------------------------------------------------------------------- */
/* The painted target                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One piece of wood, as the painter sees it: a rectangle of grid cells.
 *
 * Rectangular because that is what a piece of wood IS in this model. It comes
 * off a rip (which sets its width) and a crosscut (which sets its length), so
 * its cross-section is a rectangle. An L-shaped piece is not a piece that is
 * hard to make -- it is not a piece.
 */
export interface PaintPiece {
  /** Index of the leftmost column spanned. */
  readonly col: number;
  /** Index of the bottom row spanned. */
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  readonly species: SpeciesId;
}

/**
 * A painted design.
 *
 * The grid is a coordinate system, not a constraint: column widths and row
 * heights are independent, and a piece may span any rectangle of cells. A
 * uniform grid of single-cell pieces is a checkerboard; merged pieces of
 * differing size are the irregular layouts that make the decomposer necessary.
 *
 * Pieces must tile the grid exactly. `validateTarget` is the one place that is
 * checked, because every later stage assumes it.
 */
export interface PaintTarget {
  /** Column widths, left to right. */
  readonly columns: readonly Ticks[];
  /** Row heights, bottom to top. */
  readonly rows: readonly Ticks[];
  readonly pieces: readonly PaintPiece[];
}

/* -------------------------------------------------------------------------- */
/* The cut tree                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Which way a glue line runs, in the finished board's own face coordinates.
 *
 * `x` is across the board's width: a joint between strips sitting side by side
 * in a stage-1 panel.
 *
 * `y` is along the board's length: a joint between slices, or between layers
 * glued face to face before the panel is ripped.
 *
 * Naming them by board axis rather than by operation is deliberate. The same
 * axis means a different operation depending on where in the tree it sits, and
 * the search has no business knowing that -- the emitter does.
 */
export type Axis = 'x' | 'y';

/** A rectangle in tick coordinates, half-open on the high side. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * A guillotine decomposition, read as a build plan when run backwards.
 *
 * A `leaf` is one piece of wood. A `split` is a glue line: its parts were
 * separate before the clamps went on.
 *
 * The tree strictly alternates axis, because each split is taken at EVERY
 * edge-to-edge line in its direction at once. A child therefore cannot be split
 * again the same way -- a line spanning a child spans its parent too -- so
 * `split('x', [split('x', ...)])` is unreachable by construction rather than by
 * a normalisation pass.
 */
export type CutTree =
  | { readonly kind: 'leaf'; readonly rect: Rect; readonly piece: PaintPiece }
  | { readonly kind: 'split'; readonly rect: Rect; readonly axis: Axis; readonly parts: readonly CutTree[] };

/**
 * What a candidate tree costs to build.
 *
 * Separated from the comparison that uses it: these are measurements, and which
 * of them matters most is a judgement call about what a woodworker minds, not a
 * property of the geometry.
 */
export interface TreeCost {
  /**
   * Nested glue-up levels -- the height of the tree.
   *
   * Each level is a separate cure, so this is the number of days the build
   * takes, and the roadmap's reason for preferring shallow trees.
   */
  readonly stages: number;
  /** Glue lines closed in total, counting every split node. */
  readonly glueUps: number;
  /** Pieces handled across all glue-ups. Proxy for fiddliness. */
  readonly members: number;
  /** The axis this subtree's own root splits on; `null` for a leaf. */
  readonly axis: Axis | null;
}

/* -------------------------------------------------------------------------- */
/* Refusals                                                                    */
/* -------------------------------------------------------------------------- */

export type RefusalCode =
  /** A face has curved edges. A saw cuts straight lines. */
  | 'curved'
  /** A face is rectilinear but not a rectangle: an L, a T, a ring. */
  | 'notRectangular'
  /** A face has straight but non-axis-aligned edges. Bevel territory. */
  | 'angled'
  /** A face encloses another, which through-cuts and lamination cannot produce. */
  | 'island'
  /** The arrangement admits no edge-to-edge cut. The pinwheel is the canonical case. */
  | 'notGuillotine'
  /** A decomposition exists but needs more nested cures than the cap allows. */
  | 'tooManyStages'
  /** A piece is narrower than the saw can safely rip. */
  | 'unsafeWidth'
  /** The target does not tile its own outline. A painting bug, not a design one. */
  | 'malformed';

/**
 * Why a target cannot be built, and where.
 *
 * `regions` carries polygons in the target's own coordinates so the canvas can
 * outline exactly what is at fault. A refusal that names no region is a refusal
 * the user cannot act on.
 */
export interface Refusal {
  readonly code: RefusalCode;
  /** One sentence addressed to the user, naming what is wrong. */
  readonly reason: string;
  /** What to do about it, when there is something to do. */
  readonly remedy?: string;
  readonly regions: readonly Polygon[];
}

/* -------------------------------------------------------------------------- */
/* The result                                                                  */
/* -------------------------------------------------------------------------- */

export interface DecomposeSuccess {
  readonly ok: true;
  readonly graph: Graph;
  /** Nested cure cycles. The cost the user should see before starting. */
  readonly stages: number;
  readonly glueUps: number;
  /**
   * Always true, and that is a design commitment rather than a coincidence.
   *
   * The spec's result type admits an inexact answer carrying a diff, and
   * nothing emits one: a board that does not match the drawing is a worse
   * outcome than a refusal, so an approximation is never returned under
   * `ok: true`. Where one exists it is offered as `Refusal.suggestion`, which
   * the user has to accept.
   */
  readonly exact: true;
  /** Distinct stage-1 panels the build needs. */
  readonly panelCount: number;
  /** The tree the graph was emitted from, for the achieved-pattern view. */
  readonly tree: CutTree;
}

export interface DecomposeFailure {
  readonly ok: false;
  readonly refusal: Refusal;
  /**
   * A buildable target that differs from what was painted.
   *
   * For a rectilinear arrangement this only ever ADDS glue lines, so the
   * picture is unchanged and `changesAppearance` is false -- the cost is piece
   * count, not fidelity. For a curved or angled face it replaces the face with
   * a grid rectangle, which does change the picture, and the UI must show the
   * diff before accepting it.
   */
  readonly suggestion?: { readonly target: PaintTarget; readonly changesAppearance: boolean };
}

export type DecomposeResult = DecomposeSuccess | DecomposeFailure;

export interface DecomposeOptions {
  readonly boardThickness: Ticks;
  /** Cap on nested cures. Past this a design is not practically buildable. */
  readonly maxStages?: number | undefined;
  readonly flattenPerFace?: Ticks | undefined;
  readonly trimPerEdge?: Ticks | undefined;
  /** Reported as the search runs, so a worker can show progress and be cancelled. */
  readonly onProgress?: ((fraction: number) => void) | undefined;
  readonly shouldCancel?: (() => boolean) | undefined;
}

/** Thrown when a decomposition is cancelled from outside. */
export class DecomposeCancelled extends Error {
  constructor() {
    super('Decomposition cancelled');
    this.name = 'DecomposeCancelled';
  }
}

/** The achieved pattern, for the target-versus-achieved view. */
export type AchievedPattern = Partition;
