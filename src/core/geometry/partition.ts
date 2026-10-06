/**
 * Species-partitioned cross-sections.
 *
 * A Partition is an outline plus faces that tile it exactly. Every operation
 * here preserves that invariant or reports precisely where it broke, because a
 * gap or overlap in the cross-section is a gap or overlap in the real board.
 */

import type { Partition, PartitionFace, SpeciesId } from '../model/types.js';
import {
  type BoundingBox,
  type CutEdges,
  type Polygon,
  type SawCut,
  GeometryError,
  applyCutEdges,
  area,
  boundingBox,
  clipHalfPlane,
  mirrorX,
  rectangle,
  rotate180About,
  sawCutEdges,
  toCounterClockwise,
  translate,
} from './polygon.js';

/**
 * How far faces may disagree with their outline before it counts as an error.
 *
 * Square cuts are exact, so the tolerance is zero in the common case. A
 * bevelled cut crosses an edge off the tick grid and the crossing is snapped,
 * which displaces a boundary by at most half a tick. Moving a vertex by d
 * changes area by at most d times its adjacent edge lengths, so the total error
 * is bounded by roughly the perimeter -- proportional to the boundary, not to
 * the area. A fixed tolerance would be far too tight on a large panel and far
 * too loose on a small one.
 */
export function laminateTolerance(outline: Polygon): number {
  return tilingTolerance(outline);
}

/**
 * A snapped vertex moves by up to half a tick in x and half in y, so its
 * displacement magnitude is up to sqrt(2)/2 ticks -- and two faces sharing a
 * boundary can move in opposite directions, doubling it. Rounding sqrt(2) up to
 * 2 gives a bound that holds and is still far below any real defect.
 */
const SNAP_TICKS_PER_UNIT_BOUNDARY = 2;

function tilingTolerance(outline: Polygon): number {
  let perimeter = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Math.max(1, perimeter * SNAP_TICKS_PER_UNIT_BOUNDARY);
}

export function singleFacePartition(
  outline: Polygon,
  species: SpeciesId,
  pieceId: string,
  ringOrientation: PartitionFace['ringOrientation'],
): Partition {
  return {
    outline,
    faces: [{ polygon: outline, species, pieceId, ringOrientation }],
  };
}

export function partitionArea(p: Partition): number {
  return area(p.outline);
}

export function facesArea(p: Partition): number {
  return p.faces.reduce((sum, f) => sum + area(f.polygon), 0);
}

export function partitionBounds(p: Partition): BoundingBox {
  return boundingBox(p.outline);
}

/**
 * The left edge at the table face -- what a fence setting is measured from.
 *
 * NOT the bounding-box minimum. For a left edge leaning one way the two
 * coincide, which is why uniform-angle patterns work either way. For a left
 * edge leaning the other way the bounding box sits at the top face instead,
 * and every fence setting comes out wrong by thickness times tan(angle).
 */
export function leftEdgeAtTableFace(p: Partition): number {
  const bounds = partitionBounds(p);
  return profileAt(p.outline, bounds.minY, 'left') ?? bounds.minX;
}

/**
 * Invariant I-3: faces tile the outline with no gaps and no overlaps.
 *
 * Checked by area rather than by pairwise polygon intersection. Because faces
 * are produced only by clipping and placement -- never by arbitrary user
 * drawing -- they cannot overlap without the total exceeding the outline, so
 * the area identity is sufficient and is exact on integer coordinates.
 */
export function checkTiling(p: Partition): { ok: boolean; outlineArea: number; facesArea: number } {
  const outlineArea = partitionArea(p);
  const faces = facesArea(p);
  return {
    // Same accumulation as a lamination: every face carries its own sub-tick
    // boundary error, so the bound counts the faces as well as the outline.
    ok: Math.abs(outlineArea - faces) <= laminateToleranceFor(p.outline, p.faces.map((f) => ({ outline: f.polygon, faces: [] }))),
    outlineArea,
    facesArea: faces,
  };
}

export function assertTiling(p: Partition, context: string): void {
  const check = checkTiling(p);
  if (!check.ok) {
    const delta = check.facesArea - check.outlineArea;
    throw new GeometryError(
      `${context}: faces do not tile the outline (${delta > 0 ? 'overlap' : 'gap'} of ` +
        `${Math.abs(delta)} sq ticks; outline ${check.outlineArea}, faces ${check.facesArea})`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Transforms                                                                  */
/* -------------------------------------------------------------------------- */

function mapPartition(p: Partition, fn: (poly: Polygon) => Polygon): Partition {
  return {
    outline: fn(p.outline),
    faces: p.faces.map((f) => ({ ...f, polygon: fn(f.polygon) })),
  };
}

export function translatePartition(p: Partition, dx: number, dy: number): Partition {
  return mapPartition(p, (poly) => translate(poly, dx, dy));
}

/** Move a partition so its bounding box starts at the origin. */
export function normalisePartition(p: Partition): Partition {
  const b = partitionBounds(p);
  return translatePartition(p, -b.minX, -b.minY);
}

/**
 * Rotate 180 degrees about the partition's own centre.
 *
 * This is how a checkerboard gets its offset: reversing a slice's species
 * sequence. Done in doubled coordinates so a half-tick centre stays exact.
 */
export function rotatePartition180(p: Partition): Partition {
  const b = partitionBounds(p);
  const cx2 = b.minX + b.maxX;
  const cy2 = b.minY + b.maxY;
  return mapPartition(p, (poly) => rotate180About(poly, cx2, cy2));
}

/** Mirror across the partition's own vertical centre line. */
export function mirrorPartition(p: Partition): Partition {
  const b = partitionBounds(p);
  return mapPartition(p, (poly) => mirrorX(poly, b.minX + b.maxX));
}

/* -------------------------------------------------------------------------- */
/* Cutting                                                                     */
/* -------------------------------------------------------------------------- */

export interface PartitionCut {
  readonly keep: Partition;
  readonly offcut: Partition;
  /** Area turned to dust, in square ticks. */
  readonly kerfArea: number;
}

/**
 * Split a partition with one saw cut.
 *
 * The outline and every face are clipped by the same two blade edges, so the
 * tiling invariant survives the cut. Faces that fall entirely on one side
 * simply vanish from the other.
 */
export function cutPartition(p: Partition, cut: SawCut): PartitionCut {
  const edges = sawCutEdges(partitionBounds(p), cut);
  const outlineCut = applyCutEdges(p.outline, edges);

  return {
    keep: { outline: outlineCut.keep, faces: clipFaces(p.faces, edges, 'keep') },
    offcut: { outline: outlineCut.offcut, faces: clipFaces(p.faces, edges, 'offcut') },
    kerfArea: area(outlineCut.kerf),
  };
}

function clipFaces(
  faces: readonly PartitionFace[],
  edges: CutEdges,
  side: 'keep' | 'offcut',
): PartitionFace[] {
  const out: PartitionFace[] = [];
  for (const face of faces) {
    const clipped = applyCutEdges(face.polygon, edges)[side];
    if (clipped.length >= 3 && area(clipped) > 0) out.push({ ...face, polygon: clipped });
  }
  return out;
}

/** Clip a partition to a rectangle. Used for squaring up and end-trimming. */
export function trimPartitionToRect(
  p: Partition,
  x: number,
  y: number,
  w: number,
  h: number,
): { trimmed: Partition; removedArea: number } {
  const target = rectangle(x, y, w, h);
  const before = partitionArea(p);

  const clipToRect = (poly: Polygon): Polygon => {
    let result = poly;
    for (const plane of rectHalfPlanes(target)) {
      result = clipHalfPlane(result, plane);
      if (result.length === 0) return [];
    }
    return result;
  };

  const trimmed: Partition = {
    outline: clipToRect(p.outline),
    faces: p.faces
      .map((f) => ({ ...f, polygon: clipToRect(f.polygon) }))
      .filter((f) => f.polygon.length >= 3 && area(f.polygon) > 0),
  };

  return { trimmed, removedArea: before - partitionArea(trimmed) };
}

function rectHalfPlanes(rect: Polygon): Array<{ a: Polygon[number]; b: Polygon[number]; keep: 'left' }> {
  // A counter-clockwise rectangle's interior is to the left of every edge.
  const planes: Array<{ a: Polygon[number]; b: Polygon[number]; keep: 'left' }> = [];
  for (let i = 0; i < rect.length; i++) {
    planes.push({ a: rect[i]!, b: rect[(i + 1) % rect.length]!, keep: 'left' });
  }
  return planes;
}

/* -------------------------------------------------------------------------- */
/* Lamination                                                                  */
/* -------------------------------------------------------------------------- */

export interface LaminateResult {
  readonly partition: Partition;
  /** Area the members fail to cover, in square ticks. Non-zero means a gap. */
  readonly gapArea: number;
  /**
   * How large a gap is still attributable to integer snapping rather than to a
   * real hole.
   *
   * Counts the members, not just the outline: each bevelled member carries its
   * own sub-tick boundary error, and stacking ten slices multiplies it tenfold.
   * A tolerance based on the outline alone is roughly 4.5x too tight for a
   * ten-slice board. Even so a genuinely missing 1 1/2" cell is ~56x above this
   * bound, so the check keeps its teeth.
   */
  readonly tolerance: number;
}

function laminateToleranceFor(outline: Polygon, members: readonly Partition[]): number {
  // Counts EVERY boundary in the assembly, internal face edges included. A
  // member's faces are snapped just as its outline is, and at a steep bevel
  // those internal edges are long -- a three-face slice carries about 144,000
  // ticks of boundary against 96,000 for its outline alone. Bounding by
  // outlines only is roughly 3.5% too tight at 24 degrees.
  return members.reduce(
    (sum, m) =>
      sum +
      tilingTolerance(m.outline) +
      m.faces.reduce((faceSum, f) => faceSum + tilingTolerance(f.polygon), 0),
    tilingTolerance(outline),
  );
}

/**
 * Combine placed partitions into one.
 *
 * The outline is the bounding box of the placed members, and the result is
 * accepted only if the members tile it exactly. That check stands in for a
 * general polygon union: pieces glued side by side on a bench do not overlap,
 * so if their areas sum to the bounding box they tile it, and if they do not,
 * the design has a gap the builder would discover with glue already spread.
 */
/**
 * The x of a polygon's left or right boundary at height y.
 *
 * Exact for the convex strips this model produces, because their edges are
 * straight: the extreme of (right_a - left_b) over an interval always occurs at
 * a vertex, so sampling vertices is sufficient.
 */
export function profileAt(poly: Polygon, y: number, side: 'left' | 'right'): number | null {
  let found: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y > hi) continue;
    const x = a.y === b.y ? Math.min(a.x, b.x) : a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (found === null) found = x;
    else found = side === 'left' ? Math.min(found, x) : Math.max(found, x);
    if (a.y === b.y) {
      const other = Math.max(a.x, b.x);
      found = side === 'left' ? Math.min(found, other) : Math.max(found, other);
    }
  }
  return found;
}

/**
 * Glue members edge to edge along x, pushed together until they touch.
 *
 * Placing by bounding box is wrong the moment a cut is bevelled: slanted strips
 * interlock, and their bounding boxes overlap by the wedge the slant creates --
 * measured at 68% on a 15-degree bevel. This instead finds the offset at which
 * the mating edges coincide, which is what actually happens when the clamps go
 * on. For matching bevels that offset equals the cumulative fence settings.
 */
export function laminateButted(members: readonly Partition[]): LaminateResult {
  if (members.length === 0) throw new GeometryError('Cannot laminate zero members');

  const placed: Partition[] = [];
  let previous: Partition | null = null;

  for (const member of members) {
    const normalised = normalisePartition(member);
    if (!previous) {
      placed.push(normalised);
      previous = normalised;
      continue;
    }

    // Butt against the PREVIOUS strip, not the accumulated union. The union's
    // outline is a bounding box, whose right edge sits outside the true slanted
    // edge -- butting against it would push each strip further out than the
    // last, and the error compounds along the panel.
    const heights = new Set<number>();
    for (const p of previous.outline) heights.add(p.y);
    for (const p of normalised.outline) heights.add(p.y);

    let offset = -Infinity;
    for (const y of heights) {
      const right = profileAt(previous.outline, y, 'right');
      const left = profileAt(normalised.outline, y, 'left');
      if (right === null || left === null) continue;
      offset = Math.max(offset, right - left);
    }
    if (!Number.isFinite(offset)) {
      throw new GeometryError('Butted lamination found no shared edge between members');
    }

    const shifted = translatePartition(normalised, Math.round(offset), 0);
    placed.push(shifted);
    previous = shifted;
  }

  const faces = placed.flatMap((p) => p.faces);
  const outline = buttedOutline(placed);
  const covered = faces.reduce((sum, f) => sum + area(f.polygon), 0);

  return {
    partition: { outline, faces },
    gapArea: area(outline) - covered,
    tolerance: laminateToleranceFor(outline, placed),
  };
}

/**
 * The true union outline of butted strips.
 *
 * Every strip spans the full thickness with flat top and bottom faces, so the
 * union is a quadrilateral: the first strip's left edge, the last strip's right
 * edge, and the two faces between them. A bounding box would instead include
 * the triangular wedges a slant leaves at two corners, and the gap check would
 * read those as missing material.
 */
function buttedOutline(placed: readonly Partition[]): Polygon {
  const first = placed[0]!;
  const last = placed[placed.length - 1]!;
  const bounds = placed
    .map(partitionBounds)
    .reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    }));

  const { minY, maxY } = bounds;
  const leftBottom = profileAt(first.outline, minY, 'left') ?? bounds.minX;
  const leftTop = profileAt(first.outline, maxY, 'left') ?? bounds.minX;
  const rightBottom = profileAt(last.outline, minY, 'right') ?? bounds.maxX;
  const rightTop = profileAt(last.outline, maxY, 'right') ?? bounds.maxX;

  return toCounterClockwise([
    { x: Math.round(leftBottom), y: minY },
    { x: Math.round(rightBottom), y: minY },
    { x: Math.round(rightTop), y: maxY },
    { x: Math.round(leftTop), y: maxY },
  ]);
}

export function laminate(members: readonly Partition[]): LaminateResult {
  if (members.length === 0) throw new GeometryError('Cannot laminate zero members');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    const b = partitionBounds(m);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  const outline = rectangle(minX, minY, maxX - minX, maxY - minY);
  const faces = members.flatMap((m) => m.faces);
  const covered = faces.reduce((sum, f) => sum + area(f.polygon), 0);

  return {
    partition: { outline, faces },
    gapArea: area(outline) - covered,
    tolerance: laminateToleranceFor(outline, members),
  };
}
