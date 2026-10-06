/**
 * Union outlines for assemblies that are not rectangles.
 *
 * Through P1 every lamination produced a rectangle or a parallelogram, so its
 * outline could simply be written down: a bounding box for grids, a
 * quadrilateral for butted bevelled strips. A honeycomb cannot be written down.
 * Hexagons do not tile a rectangle, and the union of hex pucks on a lattice is
 * a jagged polygon with no closed form.
 *
 * The union is computed topologically rather than geometrically, which is what
 * keeps it exact and dependency-free. Faces in this model are placed edge to
 * edge and never overlap, so each shared glue line appears twice -- once in
 * each direction. Cancel those pairs and what remains is precisely the
 * boundary. No polygon-boolean library, no sweep line, and no epsilon deciding
 * whether two edges are "the same".
 *
 * The one concession to reality is welding. A hexagon's vertices are irrational
 * multiples of the stock thickness, so a corner computed by two different
 * routes -- through a rotation, through a placement offset -- can land a tick
 * or two apart. Welding snaps those to one representative before the
 * cancellation, because a one-tick disagreement must not read as a hole.
 */

import { type Point, type Polygon, GeometryError, doubleSignedArea } from './polygon.js';

/**
 * How far two corners may sit apart and still be the same corner.
 *
 * Each rounding step displaces a vertex by at most half a tick: the member's
 * own geometry, a rotation about its centre, and the placement offset. Two
 * members meeting at a corner each carry that error, so three ticks is the
 * worst case and four is the next integer up.
 *
 * Four ticks is 1/2000". The smallest feature this tool will build is a
 * 1/2"-wide rip (minSafeRipWidth), 4,000 ticks -- a thousand times larger --
 * so welding cannot merge two corners that are genuinely distinct.
 */
export const WELD_TICKS = 4;

export interface UnionResult {
  /**
   * Outer boundaries, counter-clockwise. More than one means the assembly is
   * in disconnected pieces, which no clamp arrangement can glue in one go.
   */
  readonly outer: readonly Polygon[];
  /**
   * Enclosed voids, clockwise. A hole is a gap with material all the way
   * around it -- a missing cell -- which is the failure this check exists to
   * find, and it is found exactly rather than by comparing areas.
   */
  readonly holes: readonly Polygon[];
  /** Signed total: outer areas less hole areas. */
  readonly area: number;
}

/* -------------------------------------------------------------------------- */
/* Vertex welding                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Snaps near-coincident points to a single representative.
 *
 * A uniform grid of cells the size of the weld radius, so a candidate match is
 * always inside the 3x3 neighbourhood of a point's own cell. Insertion order
 * decides the representative, which makes the result deterministic -- the same
 * assembly always produces the same outline, so a diff between two designs is
 * a diff of the designs rather than of the iteration order.
 */
class VertexWelder {
  private readonly cells = new Map<string, number[]>();
  private readonly points: Point[] = [];

  constructor(private readonly radius: number) {
    if (radius <= 0) throw new GeometryError(`Weld radius must be positive, got ${radius}`);
  }

  weld(p: Point): number {
    const cx = Math.floor(p.x / this.radius);
    const cy = Math.floor(p.y / this.radius);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const q = this.points[id]!;
          if (Math.abs(q.x - p.x) <= this.radius && Math.abs(q.y - p.y) <= this.radius) return id;
        }
      }
    }
    const id = this.points.length;
    this.points.push(p);
    const key = `${cx}:${cy}`;
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(id);
    else this.cells.set(key, [id]);
    return id;
  }

  at(id: number): Point {
    const p = this.points[id];
    if (!p) throw new GeometryError(`No welded vertex ${id}`);
    return p;
  }

  get ids(): readonly number[] {
    return this.points.map((_, i) => i);
  }
}

/* -------------------------------------------------------------------------- */
/* The union                                                                   */
/* -------------------------------------------------------------------------- */

export function unionOutline(
  polygons: readonly Polygon[],
  weldRadius: number = WELD_TICKS,
): UnionResult {
  if (polygons.length === 0) throw new GeometryError('Cannot take the union of zero polygons');

  const welder = new VertexWelder(weldRadius);
  const rings = polygons
    .map((poly) => dropRepeats(poly.map((p) => welder.weld(p))))
    .filter((ring) => ring.length >= 3);
  if (rings.length === 0) throw new GeometryError('Every polygon collapsed under welding');

  const edges = splitAtInteriorVertices(rings, welder, weldRadius);
  const boundary = cancelOpposites(edges);
  if (boundary.length === 0) {
    throw new GeometryError('Union has no boundary; the members must overlap exactly');
  }

  const stitched = stitchRings(boundary, welder);

  const outer: Polygon[] = [];
  const holes: Polygon[] = [];
  let area = 0;
  for (const ring of stitched) {
    const signed = doubleSignedArea(ring) / 2;
    area += signed;
    if (signed >= 0) outer.push(ring);
    else holes.push(ring);
  }

  return { outer, holes, area };
}

/**
 * The single outer ring of an assembly, or an error naming what went wrong.
 *
 * A gap or a split assembly is reported here rather than absorbed into a
 * tolerance, because both are real build failures and both have a *location*
 * the UI can point at.
 */
export function singleOutline(polygons: readonly Polygon[], context: string): Polygon {
  const result = unionOutline(polygons);
  if (result.holes.length > 0) {
    const sizes = result.holes.map((h) => Math.abs(doubleSignedArea(h) / 2));
    throw new GeometryError(
      `${context}: the assembly encloses ${result.holes.length} gap(s) ` +
        `(${sizes.map((s) => `${s} sq ticks`).join(', ')}). ` +
        'Pieces surround a void, so the glue-up would leave a hole in the board.',
    );
  }
  if (result.outer.length !== 1) {
    throw new GeometryError(
      `${context}: the assembly is in ${result.outer.length} disconnected pieces, ` +
        'so no clamp arrangement glues it in one operation.',
    );
  }
  return result.outer[0]!;
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

interface Edge {
  readonly from: number;
  readonly to: number;
}

function dropRepeats(ids: readonly number[]): number[] {
  const out: number[] = [];
  for (const id of ids) if (out[out.length - 1] !== id) out.push(id);
  while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

/**
 * Split every edge where another piece's corner lands partway along it.
 *
 * Without this, cancellation fails at a T-junction: a hex puck whose flat is
 * met by the ends of two shorter pieces has one long edge against two short
 * ones, and no pair matches. Splitting first makes the halves match exactly.
 *
 * The containment test is distance to the segment rather than a collinearity
 * predicate, because a welded vertex sits within the weld radius of the true
 * line rather than exactly on it.
 */
function splitAtInteriorVertices(
  rings: readonly (readonly number[])[],
  welder: VertexWelder,
  weldRadius: number,
): Edge[] {
  const out: Edge[] = [];

  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]!;
      const to = ring[(i + 1) % ring.length]!;
      const a = welder.at(from);
      const b = welder.at(to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;

      const between: Array<{ t: number; id: number }> = [];
      for (const id of welder.ids) {
        if (id === from || id === to) continue;
        const p = welder.at(id);
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
        if (t <= 0 || t >= 1) continue;
        const perpendicular = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(lengthSq);
        if (perpendicular <= weldRadius) between.push({ t, id });
      }

      between.sort((p, q) => p.t - q.t);
      let previous = from;
      for (const { id } of between) {
        if (id !== previous) out.push({ from: previous, to: id });
        previous = id;
      }
      if (previous !== to) out.push({ from: previous, to });
    }
  }

  return out;
}

/**
 * Drop every directed edge matched by the same edge in reverse.
 *
 * Two faces sharing a glue line contribute that line once in each direction,
 * because both are wound counter-clockwise. What survives borders material on
 * one side only, which is the definition of the boundary.
 */
function cancelOpposites(edges: readonly Edge[]): Edge[] {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const key = `${e.from}>${e.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out: Edge[] = [];
  for (const [key, count] of counts) {
    const parts = key.split('>');
    const from = Number(parts[0]);
    const to = Number(parts[1]);
    const net = count - (counts.get(`${to}>${from}`) ?? 0);
    for (let i = 0; i < net; i++) out.push({ from, to });
  }
  return out;
}

/**
 * Walk the surviving edges into closed rings.
 *
 * At a vertex where several boundary edges meet -- two cells touching only at
 * a corner -- the walk takes the **most clockwise** turn available. Faces are
 * counter-clockwise, so material lies to the left of every boundary edge, and
 * hugging right keeps it there. Taking any other branch would close a ring
 * early and report one assembly as several.
 */
function stitchRings(boundary: readonly Edge[], welder: VertexWelder): Polygon[] {
  const outgoing = new Map<number, number[]>();
  for (let i = 0; i < boundary.length; i++) {
    const e = boundary[i]!;
    const bucket = outgoing.get(e.from);
    if (bucket) bucket.push(i);
    else outgoing.set(e.from, [i]);
  }

  const used = new Array<boolean>(boundary.length).fill(false);
  const rings: Polygon[] = [];

  for (let start = 0; start < boundary.length; start++) {
    if (used[start]) continue;

    const ring: Point[] = [];
    let current = start;
    let guard = boundary.length + 1;

    while (!used[current] && guard-- > 0) {
      used[current] = true;
      const edge = boundary[current]!;
      ring.push(welder.at(edge.from));

      const candidates = (outgoing.get(edge.to) ?? []).filter((i) => !used[i]);
      if (candidates.length === 0) break;
      current =
        candidates.length === 1 ? candidates[0]! : mostClockwise(edge, candidates, boundary, welder);
    }

    if (ring.length >= 3) rings.push(ring);
  }

  if (rings.length === 0) throw new GeometryError('Boundary edges did not close into any ring');
  return rings;
}

function mostClockwise(
  incoming: Edge,
  candidates: readonly number[],
  boundary: readonly Edge[],
  welder: VertexWelder,
): number {
  const from = welder.at(incoming.from);
  const at = welder.at(incoming.to);
  const inAngle = Math.atan2(at.y - from.y, at.x - from.x);

  let best = candidates[0]!;
  let bestTurn = Infinity;
  for (const index of candidates) {
    const to = welder.at(boundary[index]!.to);
    const outAngle = Math.atan2(to.y - at.y, to.x - at.x);
    // Normalised to (-PI, PI]: a straight reversal scores +PI, so it is taken
    // only when nothing else is left.
    let turn = outAngle - inAngle;
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = index;
    }
  }
  return best;
}
