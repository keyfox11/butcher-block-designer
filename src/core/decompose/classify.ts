/**
 * Face shape classification: turning "unbuildable" into a named reason.
 *
 * A refusal the user cannot act on is barely better than a wrong answer, so
 * every rejection here has to say which face, what is wrong with its shape, and
 * what shape would work instead.
 *
 * The rule underneath is one sentence: **a face must be an axis-aligned
 * rectangle**, because that is what a piece of wood is in this model. It comes
 * off a rip, which sets its width, and a crosscut, which sets its length. An
 * L-shaped face is not a piece that is awkward to make; it is not a piece. A
 * curved one is not a cut a table saw can make at all.
 *
 * Bevelled faces -- parallelograms and trapezoids -- are genuinely buildable
 * and the layered generators build them at P1. They are refused *here* because
 * the decomposer's search runs on a rectilinear lattice, and a bevel has no
 * place on that lattice. The message says so rather than implying the geometry
 * is impossible, which is the distinction the roadmap's P5 section calls out:
 * a refusal addressed to the user must not describe an internal limit as a
 * physical one.
 */

import {
  type Point,
  type Polygon,
  area,
  boundingBox,
} from '../geometry/polygon.js';
import type { Partition, PartitionFace } from '../model/types.js';
import { asAxisAlignedRect } from './target.js';
import type { Rect, Refusal, RefusalCode } from './types.js';

/** How a face's shape reads. */
export type FaceShape = 'rectangle' | 'rectilinear' | 'angled' | 'curved';

/**
 * Drop vertices that sit on the straight line between their neighbours.
 *
 * Exact on integers via the cross product, so a genuinely collinear point is
 * removed and a point one tick off the line is kept. Without this pass a
 * rectangle that arrived through a clip carries redundant edge points and would
 * be classified as rectilinear-but-not-rectangular.
 */
export function dropCollinear(poly: Polygon): Polygon {
  if (poly.length < 3) return poly;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length]!;
    const here = poly[i]!;
    const next = poly[(i + 1) % poly.length]!;
    const cross = (here.x - prev.x) * (next.y - prev.y) - (here.y - prev.y) * (next.x - prev.x);
    if (cross !== 0) out.push(here);
  }
  return out.length >= 3 ? out : poly;
}

/**
 * Minimum edge count at which a chain of small turns reads as a curve rather
 * than as a chamfered corner.
 *
 * An octagon is the ambiguous case and is deliberately on the curve side: eight
 * equal 45-degree turns is what a coarse circle approximation looks like, and
 * calling it angled would promise a bevel path that does not tile.
 */
const CURVE_MIN_EDGES = 8;

/** Turns sharper than this read as corners, however many there are. */
const CORNER_TURN_DEGREES = 90;

export function classifyShape(poly: Polygon): FaceShape {
  const simplified = dropCollinear(poly);
  if (asAxisAlignedRect(simplified)) return 'rectangle';

  let allAxisAligned = true;
  for (let i = 0; i < simplified.length; i++) {
    const a = simplified[i]!;
    const b = simplified[(i + 1) % simplified.length]!;
    if (a.x !== b.x && a.y !== b.y) {
      allAxisAligned = false;
      break;
    }
  }
  if (allAxisAligned) return 'rectilinear';

  // A curve arrives as many short edges turning gently in one direction; a
  // mitre or bevel arrives as three or four edges with sharp corners.
  if (simplified.length >= CURVE_MIN_EDGES && maxTurnDegrees(simplified) < CORNER_TURN_DEGREES) {
    return 'curved';
  }
  return 'angled';
}

function maxTurnDegrees(poly: Polygon): number {
  let worst = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = poly[(i + 2) % poly.length]!;
    const inAngle = Math.atan2(b.y - a.y, b.x - a.x);
    const outAngle = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(((outAngle - inAngle) * 180) / Math.PI);
    if (turn > 180) turn = 360 - turn;
    worst = Math.max(worst, turn);
  }
  return worst;
}

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

const MESSAGES: Record<
  Exclude<FaceShape, 'rectangle'>,
  { code: RefusalCode; reason: string; remedy: string }
> = {
  curved: {
    code: 'curved',
    reason: 'A table saw cuts straight lines, so a curved region cannot be made.',
    remedy:
      'Curves are not approximated into stair-steps, because the board would not match the drawing. Redraw the region with straight edges, or accept the suggested rectangle.',
  },
  rectilinear: {
    code: 'notRectangular',
    reason:
      'This region has square corners but is not a rectangle, and a single piece of wood is always a rectangle -- its width comes off the rip and its length off the crosscut.',
    remedy: 'Split it into rectangles, which adds a glue line without changing the pattern.',
  },
  angled: {
    code: 'angled',
    reason:
      'This region has slanted edges. Bevel-ripped strips are buildable, but the paint surface works on a square lattice and cannot place them.',
    remedy:
      'Use one of the angled pattern generators -- zig-zag, chevron, diagonal accent -- or redraw the region with square corners.',
  },
};

/**
 * Check every face's shape, and collect the ones that fail.
 *
 * All failures of a kind are gathered into one refusal rather than returning
 * the first. A user who drew three circles should be shown three outlines, not
 * told about one and left to discover the others by fixing it.
 */
export function classifyFaces(target: Partition): Refusal | null {
  const bad = new Map<Exclude<FaceShape, 'rectangle'>, Polygon[]>();

  for (const face of target.faces) {
    const shape = classifyShape(face.polygon);
    if (shape === 'rectangle') continue;
    const list = bad.get(shape) ?? [];
    list.push(face.polygon);
    bad.set(shape, list);
  }

  if (bad.size === 0) return null;

  // An enclosed face is a sharper diagnosis than "not a rectangle", and the
  // only one of the two that names a limit the user cannot work around by
  // adding a glue line. Look for it before falling back.
  const island = findIsland(target);
  if (island) return island;

  // Report the most fundamental failure first: a curve can never be built, a
  // slanted edge can be built by a route this surface does not offer, and a
  // rectilinear region just needs splitting.
  for (const shape of ['curved', 'rectilinear', 'angled'] as const) {
    const regions = bad.get(shape);
    if (!regions) continue;
    const m = MESSAGES[shape];
    return {
      code: m.code,
      reason: regions.length === 1 ? m.reason : `${regions.length} regions: ${m.reason}`,
      remedy: m.remedy,
      regions,
    };
  }
  return null;
}

/**
 * A face fully enclosed by another.
 *
 * This is a real geometric limit rather than a missing feature: through-cuts go
 * all the way across, and lamination presses pieces together from outside, so
 * nothing in the vocabulary can put a piece inside a hole.
 *
 * It is unreachable while every face is a rectangle -- a rectangle cannot
 * enclose anything -- so it is checked only once some face already failed the
 * rectangle test. A ring or a C drawn with the region tool is how it arrives.
 */
function findIsland(target: Partition): Refusal | null {
  const boxes = target.faces.map((f) => ({ face: f, box: boundingBox(f.polygon), a: area(f.polygon) }));

  for (const outer of boxes) {
    // Only a rectilinear face can enclose anything in a way worth reporting as
    // an island. A curve gets the better message of its own, and a rectangle
    // cannot enclose at all.
    if (classifyShape(outer.face.polygon) !== 'rectilinear') continue;

    // The hole's size, exactly: a polygon that doubles back around a void has
    // less area than its own bounding box by precisely that void.
    const holeArea = (outer.box.maxX - outer.box.minX) * (outer.box.maxY - outer.box.minY) - outer.a;
    if (holeArea <= 0) continue;

    const enclosed = boxes.filter(
      (inner) =>
        inner.face !== outer.face &&
        inner.box.minX >= outer.box.minX &&
        inner.box.maxX <= outer.box.maxX &&
        inner.box.minY >= outer.box.minY &&
        inner.box.maxY <= outer.box.maxY,
    );
    // Require the candidates to account for the hole exactly. Bounding-box
    // containment alone is far too loose -- a circle drawn over a grid contains
    // a dozen cells in its box while enclosing none of them -- and the area
    // identity is what separates "inside the box" from "inside the shape".
    const filled = enclosed.reduce((sum, e) => sum + e.a, 0);
    if (enclosed.length === 0 || filled !== holeArea) continue;

    return {
      code: 'island',
      reason:
        enclosed.length === 1
          ? 'A region is completely surrounded by another one. A saw cut runs edge to edge and clamps press from outside, so no sequence of cuts and glue-ups can place a piece inside a hole.'
          : `${enclosed.length} regions are completely surrounded by another one, which no sequence of cuts and glue-ups can produce.`,
      remedy:
        'Let the surrounding region reach an edge of the board, or split it into rectangles so the enclosed piece sits between them.',
      regions: [outer.face.polygon, ...enclosed.map((e) => e.face.polygon)],
    };
  }
  return null;
}

/**
 * Faces that are rectangles, as rectangles.
 *
 * Call only after `classifyFaces` returns null; it throws otherwise, because a
 * silent skip here would drop a face out of the arrangement and the search
 * would then happily decompose a design with a hole in it.
 */
export function faceRects(target: Partition): Array<{ rect: Rect; face: PartitionFace }> {
  return target.faces.map((face) => {
    const rect = asAxisAlignedRect(dropCollinear(face.polygon));
    if (!rect) throw new Error(`Face ${face.pieceId} is not a rectangle; classify first`);
    return { rect, face };
  });
}
