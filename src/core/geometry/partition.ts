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
  translate,
} from './polygon.js';

/** Faces may disagree with the outline by this much before it is an error. */
const TILING_TOLERANCE_SQ_TICKS = 1;

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
    ok: Math.abs(outlineArea - faces) <= TILING_TOLERANCE_SQ_TICKS,
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
  };
}
