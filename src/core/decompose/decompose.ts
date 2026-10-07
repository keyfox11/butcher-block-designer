/**
 * `decompose()` -- the free-paint tier's engine.
 *
 * Takes a painted target and returns either a construction graph or a reason
 * there is none. The ordering of checks is the whole design: each stage can
 * only give a good message about the failures it is positioned to see, so they
 * run cheapest and most-specific first.
 *
 * 1. **Shape** -- a face is not a rectangle. Names the face and why.
 * 2. **Malformed** -- the faces do not tile their own outline. A painting bug.
 * 3. **Feasibility** -- a rectangle no saw can produce: too thick for stock, or
 *    narrower than a safe rip. Names the piece and the measurement.
 * 4. **Guillotine** -- the arrangement admits no edge-to-edge cut. Names the
 *    smallest blocked region, and the answer is a proof rather than a timeout.
 * 5. **Stage cap** -- a decomposition exists but needs more nested cures than
 *    the cap allows.
 *
 * Shape comes before tiling on purpose. A curved region is diagnosable whether
 * or not it tiles anything, and "a saw cannot cut that curve" is a far more
 * useful sentence than "your regions overlap" -- which is all the tiling check
 * could say about a circle drawn over a grid.
 *
 * Only after all five does anything get emitted. The one thing this must never
 * do is return something close: `exact` is always true on success, and an
 * approximation is offered as a `suggestion` the user has to accept, with the
 * diff visible. A board that does not match the drawing is a worse outcome than
 * a refusal, and the roadmap's exit criterion for this phase says so in as many
 * words.
 */

import { type Polygon, area, boundingBox } from '../geometry/polygon.js';
import type { Partition, ShopProfile, Ticks } from '../model/types.js';
import { formatTicks } from '../units/ticks.js';
import { classifyFaces, faceRects } from './classify.js';
import { DEFAULT_MAX_STOCK_THICKNESS, emitGraph, planLeaf } from './emit.js';
import { type Placed, searchGuillotine } from './guillotine.js';
import { suggestBuildable } from './snap.js';
import { asAxisAlignedRect, partitionToTarget, rectPolygon, targetToPartition } from './target.js';
import {
  type DecomposeOptions,
  type DecomposeResult,
  type PaintTarget,
  type Rect,
  type Refusal,
} from './types.js';

export interface DecomposeExtraOptions extends DecomposeOptions {
  readonly maxStockThickness?: Ticks;
}

/**
 * Decompose a painted target.
 *
 * Takes a `Partition` rather than a `PaintTarget` so that anything able to
 * produce geometry enters by the same door and gets the same checks -- the
 * paint grid, an imported image, a region tool, a future free-draw brush. The
 * refusals are phrased in terms of regions, which every one of those can
 * outline.
 */
export function decompose(
  target: Partition,
  shop: ShopProfile,
  options: DecomposeExtraOptions,
): DecomposeResult {
  const maxStock = options.maxStockThickness ?? DEFAULT_MAX_STOCK_THICKNESS;
  const maxStages = options.maxStages ?? 4;

  /* --- 0. the board itself ----------------------------------------------- */

  const outline = asAxisAlignedRect(target.outline);
  if (!outline) {
    return fail({
      code: 'malformed',
      reason: 'The painted area is not a rectangle. A board is cut square at the end, so the lay-up has to be one.',
      regions: [target.outline],
    });
  }
  if (target.faces.length === 0) {
    return fail({
      code: 'malformed',
      reason: 'Nothing is painted.',
      regions: [],
    });
  }

  /* --- 1. shape ---------------------------------------------------------- */

  const shapeRefusal = classifyFaces(target);
  if (shapeRefusal) return fail(shapeRefusal, target, options, shop, maxStock);

  /* --- 2. malformed ------------------------------------------------------ */

  const covered = target.faces.reduce((sum, f) => sum + area(f.polygon), 0);
  const outlineArea = area(target.outline);
  if (covered !== outlineArea) {
    return fail({
      code: 'malformed',
      reason:
        covered < outlineArea
          ? `The painted regions leave ${formatArea(outlineArea - covered)} of the board uncovered.`
          : `The painted regions overlap by ${formatArea(covered - outlineArea)}.`,
      remedy: 'This is a fault in the drawing rather than in the design. Reset the grid if it persists.',
      regions: [target.outline],
    });
  }

  const rects = faceRects(target);

  /* --- 3. feasibility ---------------------------------------------------- */

  const tooThick: Polygon[] = [];
  const tooNarrow: Polygon[] = [];
  let thickDetail = '';
  let narrowDetail = '';

  for (const { rect, face } of rects) {
    const planned = planLeaf(rect, face.species, shop, maxStock);
    if (planned.ok) continue;
    if (planned.code === 'tooThick') {
      tooThick.push(face.polygon);
      thickDetail = planned.detail;
    } else {
      tooNarrow.push(face.polygon);
      narrowDetail = planned.detail;
    }
  }

  if (tooThick.length > 0) {
    return fail(
      {
        code: 'malformed',
        reason:
          `${count(tooThick.length, 'region')} too large to be one piece of wood: ` +
          `the smaller side still ${thickDetail}, and stock only comes so thick.`,
        remedy:
          `Split ${tooThick.length === 1 ? 'it' : 'them'} into pieces no more than ` +
          `${formatTicks(maxStock)} across the short way. That adds a glue line and changes nothing else.`,
        regions: tooThick,
      },
      target,
      options,
      shop,
      maxStock,
    );
  }

  if (tooNarrow.length > 0) {
    return fail(
      {
        code: 'unsafeWidth',
        reason:
          `${count(tooNarrow.length, 'piece')} narrower than the saw can safely rip: ` +
          `${narrowDetail} against a ${formatTicks(shop.minSafeRipWidth)} minimum.`,
        remedy:
          'Widen the column, or raise the minimum safe rip width in the shop profile if a sled makes it safe in your shop.',
        regions: tooNarrow,
      },
      target,
      options,
      shop,
      maxStock,
    );
  }

  const sliceLength = options.boardThickness + 2 * (options.flattenPerFace ?? 1000);
  if (sliceLength < shop.minSafeCrosscutLength) {
    return fail({
      code: 'unsafeWidth',
      reason:
        `Every slice would be crosscut ${formatTicks(sliceLength)} long, below the ` +
        `${formatTicks(shop.minSafeCrosscutLength)} minimum. A short offcut beside a spinning blade is how hands get hurt.`,
      remedy: 'Increase the board thickness.',
      regions: [target.outline],
    });
  }

  /* --- 4. the search ----------------------------------------------------- */

  const placed: Placed[] = rects.map(({ rect, face }, i) => ({
    rect,
    face,
    piece: { col: i, row: 0, cols: 1, rows: 1, species: face.species },
  }));

  const search = searchGuillotine(placed, outline, {
    maxStages,
    onProgress: options.onProgress,
    shouldCancel: options.shouldCancel,
  });

  if (!search.ok) {
    /* --- 5. stage cap --------------------------------------------------- */
    if (search.exceededStages) {
      return fail(
        {
          code: 'tooManyStages',
          reason:
            `This design can be built, but it needs more than ${maxStages} nested glue-ups. ` +
            'Each one is an overnight cure and a chance to ruin the work.',
          remedy:
            'Simplify the arrangement, or raise the stage cap if you genuinely want a build that long.',
          regions: [target.outline],
        },
        target,
        options,
        shop,
        maxStock,
      );
    }

    return fail(
      {
        code: 'notGuillotine',
        reason:
          `${count(search.blockedPieces.length, 'piece')} arranged so that no cut crosses the region ` +
          'edge to edge. Run that backwards and there is no last glue-up either: whichever pair you ' +
          'try to join, a third piece straddles the joint.',
        remedy:
          'Splitting one of these pieces along a grid line unblocks it, which adds a glue line and leaves the pattern looking exactly the same.',
        regions: [
          rectPolygon(search.blocked),
          ...search.blockedPieces.map((p) => p.face?.polygon ?? rectPolygon(p.rect)),
        ],
      },
      target,
      options,
      shop,
      maxStock,
    );
  }

  /* --- emit -------------------------------------------------------------- */

  const emitted = emitGraph(search.tree, shop, {
    boardThickness: options.boardThickness,
    maxStockThickness: maxStock,
    flattenPerFace: options.flattenPerFace,
    trimPerEdge: options.trimPerEdge,
  });

  return {
    ok: true,
    graph: emitted.graph,
    stages: emitted.stages,
    glueUps: emitted.glueUps,
    exact: true,
    panelCount: emitted.panelCount,
    tree: search.tree,
  };
}

/** Convenience entry for the paint surface, which holds a `PaintTarget`. */
export function decomposeTarget(
  target: PaintTarget,
  shop: ShopProfile,
  options: DecomposeExtraOptions,
): DecomposeResult {
  return decompose(targetToPartition(target), shop, options);
}

/* -------------------------------------------------------------------------- */
/* Failure                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Attach a buildable alternative to a refusal, when one can be found.
 *
 * Wrapped in a try/catch on purpose. A suggestion is best-effort help; a clean
 * refusal is the contract. Letting a fault in the snapper turn "here is why
 * this cannot be built" into a crash would trade the guarantee for the
 * convenience, which is the wrong way round.
 */
function fail(
  refusal: Refusal,
  target?: Partition,
  options?: DecomposeExtraOptions,
  shop?: ShopProfile,
  maxStock?: number,
): DecomposeResult {
  if (!target || !options || !shop) return { ok: false, refusal };

  try {
    const paint = partitionToTarget(target);
    if (!paint) return { ok: false, refusal };
    const suggestion = suggestBuildable(paint, shop, {
      ...options,
      maxStockThickness: maxStock ?? DEFAULT_MAX_STOCK_THICKNESS,
    });
    return suggestion ? { ok: false, refusal, suggestion } : { ok: false, refusal };
  } catch {
    return { ok: false, refusal };
  }
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function count(n: number, noun: string): string {
  return n === 1 ? `One ${noun} is` : `${n} ${noun}s are`;
}

function formatArea(sqTicks: number): string {
  const sqIn = sqTicks / (8000 * 8000);
  return `${sqIn.toFixed(sqIn < 1 ? 2 : 1)} sq in`;
}

/** The region outlines a refusal names, for the canvas to draw. */
export function refusalRegions(refusal: Refusal): readonly Polygon[] {
  return refusal.regions;
}

/** Bounding box of everything a refusal names, for scrolling it into view. */
export function refusalBounds(refusal: Refusal): Rect | null {
  if (refusal.regions.length === 0) return null;
  let box = boundingBox(refusal.regions[0]!);
  for (const region of refusal.regions.slice(1)) {
    const b = boundingBox(region);
    box = {
      minX: Math.min(box.minX, b.minX),
      minY: Math.min(box.minY, b.minY),
      maxX: Math.max(box.maxX, b.maxX),
      maxY: Math.max(box.maxY, b.maxY),
    };
  }
  return { x0: box.minX, y0: box.minY, x1: box.maxX, y1: box.maxY };
}
