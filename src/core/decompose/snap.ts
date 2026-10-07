/**
 * Snap to buildable.
 *
 * The honest half of the free-paint promise. When a painted design cannot be
 * built, the tool refuses -- and then offers the nearest thing it *can* build,
 * with the difference visible, for the user to accept or reject.
 *
 * ## Why this is not an approximation
 *
 * For a rectilinear arrangement, every repair here is a **split along a grid
 * line, keeping the species**. Both halves are the same wood, so the picture
 * does not change by a single pixel; what changes is that a glue line appears
 * where there was solid timber. That is the one edit the tool can make to
 * someone's design without betraying it, and it is why
 * `suggestion.changesAppearance` is false for this whole family of repairs.
 *
 * A curved or slanted face has no such repair. Replacing it with a rectangle
 * genuinely changes the drawing, so that suggestion is flagged and the UI has
 * to show a diff before it can be accepted.
 *
 * ## Why splitting always terminates
 *
 * Each repair splits at least one piece, so the piece count strictly rises and
 * is bounded by the number of grid cells. At one piece per cell the arrangement
 * is a plain grid, which is guillotine-decomposable by banding. So the loop
 * either succeeds or runs out of pieces to split, and the iteration cap is a
 * guard against a bug rather than part of the argument.
 */

import type { ShopProfile } from '../model/types.js';
import { type Placed, searchGuillotine } from './guillotine.js';
import { DEFAULT_MAX_STOCK_THICKNESS, planLeaf } from './emit.js';
import { edges, pieceRect, splitPiece, validateTarget } from './target.js';
import type { Axis, PaintTarget } from './types.js';

export interface SnapOptions {
  readonly boardThickness: number;
  /** See the note on `SearchOptions` for why these carry `| undefined`. */
  readonly maxStages?: number | undefined;
  readonly maxStockThickness?: number | undefined;
}

/**
 * A grid line that would unblock a region, and what it would cost.
 *
 * Every field is a *measurement*, deliberately: which of them should win is a
 * judgement about what a woodworker minds, not a property of the geometry, and
 * the comparison lives in `chooseSplit` below.
 */
export interface SplitCandidate {
  readonly axis: Axis;
  /** Grid index the line sits on. */
  readonly at: number;
  /** Indices of the pieces this line crosses. These are what get split. */
  readonly crosses: readonly number[];
  /**
   * Distance from the blocked region's middle, as a fraction: 0 is dead centre,
   * 1 is hard against an edge.
   */
  readonly offCentre: number;
  /** Area of the largest piece the line crosses, in square ticks. */
  readonly largestCrossed: number;
  /** Total area of every piece the line crosses. */
  readonly totalCrossed: number;
}

/**
 * Which line to split on, when more than one would unblock the region.
 *
 * TODO(human): return the candidate to split.
 */
export function chooseSplit(candidates: readonly SplitCandidate[]): SplitCandidate {
  // TODO(human)
  throw new Error(`chooseSplit is not implemented (${candidates.length} candidates offered)`);
}

/** Repairs attempted before giving up. See the termination note above. */
const MAX_REPAIRS = 64;

/**
 * Find a buildable target close to this one, or null if there is none worth
 * offering.
 *
 * Returns null rather than something far-fetched. A suggestion the user would
 * never accept is worse than no suggestion, because it implies the tool
 * misunderstood the design.
 */
export function suggestBuildable(
  target: PaintTarget,
  shop: ShopProfile,
  options: SnapOptions,
): { target: PaintTarget; changesAppearance: boolean } | null {
  const maxStock = options.maxStockThickness ?? DEFAULT_MAX_STOCK_THICKNESS;
  const maxStages = options.maxStages ?? 4;

  let current = thinOversizePieces(target, shop, maxStock);
  if (!current) return null;

  // A piece narrower than a safe rip cannot be repaired by splitting -- every
  // split makes pieces smaller. The refusal's remedy names the real fix.
  for (const piece of current.pieces) {
    const planned = planLeaf(pieceRect(current, piece), piece.species, shop, maxStock);
    if (!planned.ok && planned.code === 'unsafeWidth') return null;
  }

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const outline = {
      x0: 0,
      y0: 0,
      x1: current.columns.reduce((a, b) => a + b, 0),
      y1: current.rows.reduce((a, b) => a + b, 0),
    };
    const placed: Placed[] = current.pieces.map((piece) => ({
      rect: pieceRect(current!, piece),
      piece,
    }));

    const search = searchGuillotine(placed, outline, { maxStages });
    if (search.ok) {
      // Only offer it if it actually differs; an unchanged target means the
      // refusal came from somewhere splitting cannot reach.
      if (samePieces(target, current)) return null;
      return { target: current, changesAppearance: false };
    }
    // More nested cures than the cap allows is not a blockage, and splitting a
    // piece can only ever add depth. Nothing to offer.
    if (search.exceededStages) return null;

    const candidates = candidatesWithin(current, search.blocked);
    if (candidates.length === 0) return null;

    const choice = chooseSplit(candidates);
    current = applySplit(current, choice);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Candidate lines                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Grid lines strictly inside the blocked region, with the pieces they cross.
 *
 * Every one of them is crossed by at least one piece -- a line crossed by none
 * would have been a valid cut and the region would not be blocked. So there is
 * no "free" choice here; each candidate costs at least one new glue line.
 */
export function candidatesWithin(
  target: PaintTarget,
  blocked: { x0: number; y0: number; x1: number; y1: number },
): SplitCandidate[] {
  const xs = edges(target.columns);
  const ys = edges(target.rows);
  const rects = target.pieces.map((p) => pieceRect(target, p));
  const out: SplitCandidate[] = [];

  const scan = (axis: Axis, lineEdges: readonly number[], lo: number, hi: number) => {
    const mid = (lo + hi) / 2;
    const halfSpan = (hi - lo) / 2;

    for (const [index, at] of lineEdges.entries()) {
      if (at <= lo || at >= hi) continue;
      const crosses: number[] = [];
      let largest = 0;
      let totalCrossed = 0;

      for (const [pieceIndex, r] of rects.entries()) {
        // Only pieces inside the blocked region are relevant; one outside it
        // cannot be what is blocking it.
        const within = r.x0 >= blocked.x0 && r.x1 <= blocked.x1 && r.y0 >= blocked.y0 && r.y1 <= blocked.y1;
        if (!within) continue;
        const a = axis === 'x' ? r.x0 : r.y0;
        const b = axis === 'x' ? r.x1 : r.y1;
        if (a < at && b > at) {
          crosses.push(pieceIndex);
          const size = (r.x1 - r.x0) * (r.y1 - r.y0);
          largest = Math.max(largest, size);
          totalCrossed += size;
        }
      }
      if (crosses.length === 0) continue;

      out.push({
        axis,
        at: index,
        crosses,
        offCentre: halfSpan === 0 ? 0 : Math.abs(at - mid) / halfSpan,
        largestCrossed: largest,
        totalCrossed,
      });
    }
  };

  scan('x', xs, blocked.x0, blocked.x1);
  scan('y', ys, blocked.y0, blocked.y1);
  return out;
}

/** Split every piece the chosen line crosses. */
export function applySplit(target: PaintTarget, choice: SplitCandidate): PaintTarget {
  let next = target;
  // Highest index first, so splicing one piece does not shift the indices of
  // the ones still to be split.
  for (const pieceIndex of [...choice.crosses].sort((a, b) => b - a)) {
    next = splitPiece(next, pieceIndex, choice.axis, choice.at);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Oversize pieces                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Halve pieces too large to come from one board, until they fit.
 *
 * No heuristic is needed here, unlike the blockage repair: a piece thicker than
 * the stock has to be split on its long axis, and the middle grid line is the
 * only choice that cannot need splitting again on the same pass.
 */
function thinOversizePieces(
  target: PaintTarget,
  shop: ShopProfile,
  maxStock: number,
): PaintTarget | null {
  let current = target;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const offender = current.pieces.findIndex((piece) => {
      const planned = planLeaf(pieceRect(current, piece), piece.species, shop, maxStock);
      return !planned.ok && planned.code === 'tooThick';
    });
    if (offender < 0) return current;

    const piece = current.pieces[offender]!;
    // Split across the span that has more cells to divide, so the halves are
    // closer to square and less likely to offend again.
    const axis: Axis = piece.rows >= piece.cols ? 'y' : 'x';
    const span = axis === 'y' ? piece.rows : piece.cols;
    if (span < 2) return null; // A single cell too thick: the grid itself is too coarse.
    const base = axis === 'y' ? piece.row : piece.col;
    current = splitPiece(current, offender, axis, base + Math.floor(span / 2));
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

function samePieces(a: PaintTarget, b: PaintTarget): boolean {
  if (a.pieces.length !== b.pieces.length) return false;
  const encode = (t: PaintTarget) =>
    t.pieces
      .map((p) => `${p.col},${p.row},${p.cols},${p.rows},${p.species}`)
      .sort()
      .join('|');
  return encode(a) === encode(b);
}

/**
 * Which pieces the suggestion added, for the diff view.
 *
 * Reported as the *new* glue lines rather than as changed regions, because for
 * a rectilinear repair that is literally all that changed and showing it any
 * other way would overstate the cost.
 */
export function suggestionDiff(
  before: PaintTarget,
  after: PaintTarget,
): Array<{ axis: Axis; at: number; from: number; to: number }> {
  const beforeKeys = new Set(
    before.pieces.map((p) => `${p.col},${p.row},${p.cols},${p.rows}`),
  );
  const lines: Array<{ axis: Axis; at: number; from: number; to: number }> = [];

  for (const piece of after.pieces) {
    if (beforeKeys.has(`${piece.col},${piece.row},${piece.cols},${piece.rows}`)) continue;
    // A piece that is new sits against at least one new glue line. Report the
    // edge shared with the sibling it was split from, which is the edge that
    // was interior to a piece in `before`.
    const covering = before.pieces.find(
      (p) =>
        piece.col >= p.col &&
        piece.col + piece.cols <= p.col + p.cols &&
        piece.row >= p.row &&
        piece.row + piece.rows <= p.row + p.rows,
    );
    if (!covering) continue;
    if (piece.col > covering.col) {
      lines.push({ axis: 'x', at: piece.col, from: piece.row, to: piece.row + piece.rows });
    }
    if (piece.row > covering.row) {
      lines.push({ axis: 'y', at: piece.row, from: piece.col, to: piece.col + piece.cols });
    }
  }
  return lines;
}

/** A sanity net: a suggestion must still be a well-formed target. */
export function suggestionIsSound(target: PaintTarget): boolean {
  return validateTarget(target).ok;
}
