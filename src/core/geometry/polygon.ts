/**
 * Integer-coordinate polygon geometry.
 *
 * Every coordinate is in ticks (1/8000"). Working on integers rather than
 * floats is what removes the coincident-edge sliver problem outright: two
 * pieces that share a glue line share it *exactly*, so there is no epsilon
 * heuristic deciding whether a 1e-13-wide gap is real.
 *
 * Only convex clipping is implemented, because that is all the operation
 * vocabulary needs. A saw makes straight, full-depth cuts, which are half-plane
 * clips; laminating places pieces side by side without overlap, which is
 * concatenation rather than a boolean union. A general polygon-boolean library
 * would be a large dependency doing less verifiably what 60 lines of
 * Sutherland-Hodgman do exactly.
 */

import { type MilliDeg, toRadians } from '../units/ticks.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A simple polygon: counter-clockwise, implicitly closed, no repeated last point. */
export type Polygon = readonly Point[];

export class GeometryError extends Error {}

export function point(x: number, y: number): Point {
  return { x, y };
}

/** Axis-aligned rectangle with its lower-left corner at (x, y). */
export function rectangle(x: number, y: number, width: number, height: number): Polygon {
  if (width <= 0 || height <= 0) {
    throw new GeometryError(`Rectangle must have positive extent, got ${width}x${height}`);
  }
  return [
    point(x, y),
    point(x + width, y),
    point(x + width, y + height),
    point(x, y + height),
  ];
}

/**
 * Twice the signed area, via the shoelace formula.
 *
 * Returned doubled because on integer coordinates the doubled value is always
 * an exact integer, while the halved one may end in .5. Comparisons and
 * conservation checks therefore stay in exact integer arithmetic.
 */
export function doubleSignedArea(poly: Polygon): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    total += a.x * b.y - b.x * a.y;
  }
  return total;
}

/** Unsigned area in square ticks. */
export function area(poly: Polygon): number {
  return Math.abs(doubleSignedArea(poly)) / 2;
}

export function isCounterClockwise(poly: Polygon): boolean {
  return doubleSignedArea(poly) > 0;
}

/** Normalise winding to counter-clockwise. */
export function toCounterClockwise(poly: Polygon): Polygon {
  return isCounterClockwise(poly) ? poly : [...poly].reverse();
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundingBox(poly: Polygon): BoundingBox {
  if (poly.length === 0) throw new GeometryError('Empty polygon has no bounding box');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function width(poly: Polygon): number {
  const b = boundingBox(poly);
  return b.maxX - b.minX;
}

export function height(poly: Polygon): number {
  const b = boundingBox(poly);
  return b.maxY - b.minY;
}

/* -------------------------------------------------------------------------- */
/* Exact transforms                                                            */
/* -------------------------------------------------------------------------- */

export function translate(poly: Polygon, dx: number, dy: number): Polygon {
  return poly.map((p) => point(p.x + dx, p.y + dy));
}

/**
 * Rotate 180 degrees about a centre. Exact on integers when the centre is
 * expressed doubled (cx2 = 2*cx), which lets a half-tick centre stay exact --
 * the common case, since a piece is rotated about its own midpoint.
 */
export function rotate180About(poly: Polygon, cx2: number, cy2: number): Polygon {
  return poly.map((p) => point(cx2 - p.x, cy2 - p.y));
}

/** Mirror across a vertical axis. `axis2` is twice the axis x-coordinate. */
export function mirrorX(poly: Polygon, axis2: number): Polygon {
  // Mirroring reverses winding; restore CCW so downstream area signs hold.
  return toCounterClockwise(poly.map((p) => point(axis2 - p.x, p.y)));
}

/** Mirror across a horizontal axis. `axis2` is twice the axis y-coordinate. */
export function mirrorY(poly: Polygon, axis2: number): Polygon {
  return toCounterClockwise(poly.map((p) => point(p.x, axis2 - p.y)));
}

/* -------------------------------------------------------------------------- */
/* Half-plane clipping                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An oriented line. `keep` names the side retained, where "left" is the side a
 * walker travelling a -> b has on their left.
 */
export interface HalfPlane {
  readonly a: Point;
  readonly b: Point;
  readonly keep: 'left' | 'right';
}

/** Positive when p lies left of the directed line a -> b. Exact on integers. */
export function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function isInside(h: HalfPlane, p: Point): boolean {
  const side = cross(h.a, h.b, p);
  // Points exactly on the line belong to both halves, so a cut through a
  // vertex does not drop area from either side.
  return h.keep === 'left' ? side >= 0 : side <= 0;
}

/**
 * Sutherland-Hodgman clip against a single half-plane.
 *
 * Exact whenever edge/line intersections land on integer coordinates, which
 * covers every square cut. A bevelled cut can produce a fractional crossing;
 * those are snapped to the tick grid and the sub-tick residual is absorbed by
 * the tolerance on the conservation check, never by silent loss.
 */
export function clipHalfPlane(poly: Polygon, h: HalfPlane): Polygon {
  if (poly.length === 0) return [];

  const out: Point[] = [];

  for (let i = 0; i < poly.length; i++) {
    const current = poly[i]!;
    const next = poly[(i + 1) % poly.length]!;
    const currentIn = isInside(h, current);
    const nextIn = isInside(h, next);

    if (currentIn) out.push(current);
    if (currentIn !== nextIn) {
      const crossing = intersectSegmentLine(current, next, h.a, h.b);
      if (crossing) out.push(crossing);
    }
  }

  return dedupe(out);
}

function intersectSegmentLine(p: Point, q: Point, a: Point, b: Point): Point | null {
  const denominator = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x);
  if (denominator === 0) return null; // parallel; the endpoint tests cover it

  const t = ((b.x - a.x) * (a.y - p.y) - (b.y - a.y) * (a.x - p.x)) / denominator;
  return point(Math.round(p.x + t * (q.x - p.x)), Math.round(p.y + t * (q.y - p.y)));
}

/** Drop consecutive duplicate vertices, including the wrap-around pair. */
function dedupe(points: readonly Point[]): Polygon {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first.x === last.x && first.y === last.y) out.pop();
    else break;
  }
  return out.length < 3 ? [] : out;
}

/* -------------------------------------------------------------------------- */
/* Saw cuts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A saw cut through a cross-section.
 *
 * `atBase` follows the fence convention: it is the blade's near edge measured
 * at the face against the table, so the piece between the fence and the blade
 * has width exactly `atBase` and the kerf falls entirely on the waste side.
 * That is the number a woodworker actually sets, which is why the cut list can
 * report it directly.
 */
export interface SawCut {
  /** Blade near-edge position at y = 0, in ticks. */
  readonly atBase: number;
  /** Blade tilt from vertical. 0 is a square cut. */
  readonly bevel: MilliDeg;
  /** Blade kerf measured perpendicular to the blade, in ticks. */
  readonly kerf: number;
}

export interface CutResult {
  /** The piece on the fence side of the blade. */
  readonly keep: Polygon;
  /** The piece on the waste side. */
  readonly offcut: Polygon;
  /** The material the blade turned into dust. */
  readonly kerf: Polygon;
}

/**
 * Split a cross-section with one saw cut.
 *
 * The kerf is modelled as a slab that is *subtracted*, not as bookkeeping
 * applied afterwards. That makes conservation of area a property of the
 * operation rather than something the caller has to remember:
 *
 *     area(keep) + area(offcut) + area(kerf) === area(input)
 *
 * which removes the classic failure in this domain -- kerf counted once per
 * strip instead of once per cut, or double-counted at a panel end.
 */
/**
 * The two blade edges of a cut, as oriented lines.
 *
 * Exposed so that a partition's outline and each of its faces are clipped by
 * the *same* lines. Deriving them twice would risk the outline and the faces
 * disagreeing by a tick, which is exactly the gap-or-overlap bug the partition
 * invariant exists to catch.
 */
export interface CutEdges {
  readonly near: { a: Point; b: Point };
  readonly far: { a: Point; b: Point };
}

export function sawCutEdges(extent: BoundingBox, cut: SawCut): CutEdges {
  if (cut.kerf < 0) throw new GeometryError(`Kerf must be non-negative, got ${cut.kerf}`);

  const tilt = Math.tan(toRadians(cut.bevel));
  // A horizontal line crosses a slab of perpendicular thickness k over a
  // distance k / cos(bevel).
  const horizontalKerf = cut.kerf / Math.cos(toRadians(cut.bevel));

  // Anchor the line exactly at the workpiece's own top and bottom, and round
  // it THERE.
  //
  // Clipping uses an infinite line, so the anchors need not extend past the
  // polygon -- and anchoring outside it is actively harmful. Every strip in
  // this model has flat top and bottom faces, so those are precisely where the
  // cut crosses the boundary. Rounded at the crossings, the crossings are the
  // anchors and a bevelled cut is EXACT; rounded somewhere further out, each
  // crossing is interpolated and re-rounded, and the sub-tick residue
  // accumulates across every face of every slice.
  const top = extent.maxY;
  const bottom = extent.minY;

  const edge = (offset: number) => ({
    a: point(Math.round(cut.atBase + offset + bottom * tilt), bottom),
    b: point(Math.round(cut.atBase + offset + top * tilt), top),
  });

  return { near: edge(0), far: edge(horizontalKerf) };
}

export function applyCut(poly: Polygon, cut: SawCut): CutResult {
  const edges = sawCutEdges(boundingBox(poly), cut);
  return applyCutEdges(poly, edges);
}

/** Split a polygon with pre-computed cut edges. */
export function applyCutEdges(poly: Polygon, edges: CutEdges): CutResult {
  // The directed lines run bottom -> top, so their left side is -x (fence side).
  return {
    keep: clipHalfPlane(poly, { ...edges.near, keep: 'left' }),
    offcut: clipHalfPlane(poly, { ...edges.far, keep: 'right' }),
    kerf: clipHalfPlane(clipHalfPlane(poly, { ...edges.near, keep: 'right' }), {
      ...edges.far,
      keep: 'left',
    }),
  };
}

/**
 * Width of a bevelled strip at each face.
 *
 * A tilted blade makes the two faces of a strip different widths, so "the
 * width" is ambiguous and the cut list has to state both. Reporting only one
 * is how a rhombus stick ends up the wrong shape.
 */
export function bevelledWidths(
  fenceSetting: number,
  thickness: number,
  bevel: MilliDeg,
): { atTableFace: number; atTopFace: number } {
  return {
    atTableFace: fenceSetting,
    atTopFace: fenceSetting + thickness * Math.tan(toRadians(bevel)),
  };
}
