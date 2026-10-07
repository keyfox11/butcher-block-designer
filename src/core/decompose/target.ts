/**
 * The painted target: grid arithmetic, editing operations, and the conversion
 * to a `Partition`.
 *
 * Two representations, on purpose. `PaintTarget` is what the canvas edits --
 * cell indices, cheap to mutate, impossible to make non-rectangular. A
 * `Partition` is what the rest of the engine speaks, and is also what the
 * decomposer's public signature takes, so a target drawn some other way (an
 * imported image, a region tool, a future free-draw brush) enters by the same
 * door and gets the same checks.
 *
 * The grid is a coordinate system, not a constraint. Column widths and row
 * heights are independent, so dragging a boundary changes one width without
 * disturbing the pattern.
 */

import { type Polygon, area, rectangle } from '../geometry/polygon.js';
import type { Partition, PartitionFace, RingOrientation, SpeciesId, Ticks } from '../model/types.js';
import { ticks } from '../units/ticks.js';
import type { PaintPiece, PaintTarget, Rect } from './types.js';

/* -------------------------------------------------------------------------- */
/* Grid arithmetic                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cumulative edge positions, so index i sits at `edges[i]` and the grid's full
 * extent is the last entry.
 *
 * Computed by running sum rather than `i * cellSize`, because the whole point
 * of independent widths is that there is no single cell size to multiply.
 */
export function edges(sizes: readonly Ticks[]): readonly number[] {
  const out: number[] = [0];
  let total = 0;
  for (const s of sizes) {
    total += s;
    out.push(total);
  }
  return out;
}

export function targetWidth(t: PaintTarget): Ticks {
  return ticks(t.columns.reduce((a, b) => a + b, 0));
}

export function targetLength(t: PaintTarget): Ticks {
  return ticks(t.rows.reduce((a, b) => a + b, 0));
}

/** A piece's rectangle in tick coordinates. */
export function pieceRect(t: PaintTarget, p: PaintPiece): Rect {
  const xs = edges(t.columns);
  const ys = edges(t.rows);
  const x0 = xs[p.col];
  const x1 = xs[p.col + p.cols];
  const y0 = ys[p.row];
  const y1 = ys[p.row + p.rows];
  if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) {
    throw new Error(`Piece at (${p.col},${p.row}) ${p.cols}x${p.rows} falls outside the grid`);
  }
  return { x0, y0, x1, y1 };
}

export function rectPolygon(r: Rect): Polygon {
  return rectangle(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
}

export function rectWidth(r: Rect): number {
  return r.x1 - r.x0;
}

export function rectHeight(r: Rect): number {
  return r.y1 - r.y0;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/** A uniform grid of single-cell pieces, species chosen per cell. */
export function uniformTarget(
  cols: number,
  rowCount: number,
  cellSize: Ticks,
  speciesAt: (col: number, row: number) => SpeciesId,
): PaintTarget {
  const pieces: PaintPiece[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      pieces.push({ col, row, cols: 1, rows: 1, species: speciesAt(col, row) });
    }
  }
  return {
    columns: Array.from({ length: cols }, () => cellSize),
    rows: Array.from({ length: rowCount }, () => cellSize),
    pieces,
  };
}

/** A two-species checkerboard, the starting point the paint surface opens on. */
export function checkerTarget(
  cols: number,
  rowCount: number,
  cellSize: Ticks,
  a: SpeciesId,
  b: SpeciesId,
): PaintTarget {
  return uniformTarget(cols, rowCount, cellSize, (c, r) => ((c + r) % 2 === 0 ? a : b));
}

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

/** The piece covering a cell, or null when the grid has a hole. */
export function pieceAt(t: PaintTarget, col: number, row: number): PaintPiece | null {
  for (const p of t.pieces) {
    if (col >= p.col && col < p.col + p.cols && row >= p.row && row < p.row + p.rows) return p;
  }
  return null;
}

export function pieceIndexAt(t: PaintTarget, col: number, row: number): number {
  return t.pieces.findIndex(
    (p) => col >= p.col && col < p.col + p.cols && row >= p.row && row < p.row + p.rows,
  );
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

/** Break a piece back into single cells, keeping its species. */
function explode(p: PaintPiece): PaintPiece[] {
  const out: PaintPiece[] = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({ col: p.col + c, row: p.row + r, cols: 1, rows: 1, species: p.species });
    }
  }
  return out;
}

/**
 * Paint one cell.
 *
 * Painting into a merged piece splits it apart first. A merged piece is a
 * single piece of wood, so recolouring one of its cells is not a colour change
 * -- it is a request for two pieces where there was one, and doing it silently
 * is the only honest reading.
 */
export function paintCell(t: PaintTarget, col: number, row: number, species: SpeciesId): PaintTarget {
  const index = pieceIndexAt(t, col, row);
  if (index < 0) return t;
  const existing = t.pieces[index]!;
  if (existing.cols === 1 && existing.rows === 1) {
    if (existing.species === species) return t;
    const pieces = [...t.pieces];
    pieces[index] = { ...existing, species };
    return { ...t, pieces };
  }

  const replacement = explode(existing).map((cell) =>
    cell.col === col && cell.row === row ? { ...cell, species } : cell,
  );
  return { ...t, pieces: [...t.pieces.slice(0, index), ...replacement, ...t.pieces.slice(index + 1)] };
}

/**
 * Merge a rectangle of cells into one piece.
 *
 * Any piece the rectangle touches is consumed whole: a merge that bisected a
 * neighbouring piece would leave a non-rectangular remainder, which is not a
 * piece of wood. So the rectangle grows to cover every piece it overlaps, and
 * the grown rectangle is what gets merged. Reporting the grown extent back lets
 * the UI show what actually happened rather than silently doing more than asked.
 */
export function mergeRect(
  t: PaintTarget,
  col: number,
  row: number,
  cols: number,
  rows: number,
  species: SpeciesId,
): { target: PaintTarget; merged: PaintPiece } {
  let c0 = Math.max(0, col);
  let r0 = Math.max(0, row);
  let c1 = Math.min(t.columns.length, col + cols);
  let r1 = Math.min(t.rows.length, row + rows);
  if (c1 <= c0 || r1 <= r0) throw new Error('Merge rectangle is empty');

  // Grow until the rectangle covers whole pieces on every side. One extra pass
  // can pull in a further piece, so this iterates to a fixed point.
  for (;;) {
    let grew = false;
    for (const p of t.pieces) {
      const overlaps = p.col < c1 && p.col + p.cols > c0 && p.row < r1 && p.row + p.rows > r0;
      if (!overlaps) continue;
      if (p.col < c0) {
        c0 = p.col;
        grew = true;
      }
      if (p.col + p.cols > c1) {
        c1 = p.col + p.cols;
        grew = true;
      }
      if (p.row < r0) {
        r0 = p.row;
        grew = true;
      }
      if (p.row + p.rows > r1) {
        r1 = p.row + p.rows;
        grew = true;
      }
    }
    if (!grew) break;
  }

  const merged: PaintPiece = { col: c0, row: r0, cols: c1 - c0, rows: r1 - r0, species };
  const kept = t.pieces.filter(
    (p) => !(p.col < c1 && p.col + p.cols > c0 && p.row < r1 && p.row + p.rows > r0),
  );
  return { target: { ...t, pieces: [...kept, merged] }, merged };
}

/** Break the piece under a cell back into single cells. */
export function splitPieceAt(t: PaintTarget, col: number, row: number): PaintTarget {
  const index = pieceIndexAt(t, col, row);
  if (index < 0) return t;
  const existing = t.pieces[index]!;
  if (existing.cols === 1 && existing.rows === 1) return t;
  return {
    ...t,
    pieces: [...t.pieces.slice(0, index), ...explode(existing), ...t.pieces.slice(index + 1)],
  };
}

/**
 * Split one piece along a grid line, keeping its species.
 *
 * This is what snap-to-buildable uses. Both halves are the same species, so the
 * picture does not change at all -- only a glue line appears where there was
 * solid wood. That is the one kind of change the tool can make to a painted
 * design without betraying it.
 */
export function splitPiece(
  t: PaintTarget,
  index: number,
  axis: 'x' | 'y',
  at: number,
): PaintTarget {
  const p = t.pieces[index];
  if (!p) throw new Error(`No piece at index ${index}`);

  if (axis === 'x') {
    if (at <= p.col || at >= p.col + p.cols) throw new Error(`Column ${at} is not inside the piece`);
    const left: PaintPiece = { ...p, cols: at - p.col };
    const right: PaintPiece = { ...p, col: at, cols: p.col + p.cols - at };
    return { ...t, pieces: [...t.pieces.slice(0, index), left, right, ...t.pieces.slice(index + 1)] };
  }

  if (at <= p.row || at >= p.row + p.rows) throw new Error(`Row ${at} is not inside the piece`);
  const bottom: PaintPiece = { ...p, rows: at - p.row };
  const top: PaintPiece = { ...p, row: at, rows: p.row + p.rows - at };
  return { ...t, pieces: [...t.pieces.slice(0, index), bottom, top, ...t.pieces.slice(index + 1)] };
}

/**
 * Resize the grid, keeping what overlaps.
 *
 * Pieces are exploded to cells first. Preserving merges across a resize would
 * mean deciding what a 3-column piece becomes in a 2-column grid, and every
 * answer is a guess about intent.
 */
export function resizeGrid(
  t: PaintTarget,
  cols: number,
  rowCount: number,
  cellSize: Ticks,
  fill: SpeciesId,
): PaintTarget {
  const pieces: PaintPiece[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < cols; col++) {
      const existing = pieceAt(t, col, row);
      pieces.push({ col, row, cols: 1, rows: 1, species: existing?.species ?? fill });
    }
  }
  return {
    columns: Array.from({ length: cols }, (_, i) => t.columns[i] ?? cellSize),
    rows: Array.from({ length: rowCount }, (_, i) => t.rows[i] ?? cellSize),
    pieces,
  };
}

/** Set one column's width or one row's height. */
export function setTrackSize(
  t: PaintTarget,
  axis: 'x' | 'y',
  index: number,
  size: Ticks,
): PaintTarget {
  const track = axis === 'x' ? t.columns : t.rows;
  if (index < 0 || index >= track.length) return t;
  const next = [...track];
  next[index] = size;
  return axis === 'x' ? { ...t, columns: next } : { ...t, rows: next };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Do the pieces tile the grid exactly?
 *
 * Checked cell by cell rather than by area, because the failure modes are a
 * hole and a double-cover and the user needs to be told which cell. This is a
 * bug net for the editing operations above, not a design check -- a target that
 * fails here was built wrong, not painted wrong.
 */
export function validateTarget(t: PaintTarget): { ok: true } | { ok: false; message: string } {
  if (t.columns.length === 0 || t.rows.length === 0) return { ok: false, message: 'The grid is empty' };
  for (const [i, w] of t.columns.entries()) {
    if (w <= 0) return { ok: false, message: `Column ${i + 1} has no width` };
  }
  for (const [i, h] of t.rows.entries()) {
    if (h <= 0) return { ok: false, message: `Row ${i + 1} has no height` };
  }

  const cover = new Int32Array(t.columns.length * t.rows.length);
  for (const p of t.pieces) {
    if (p.cols <= 0 || p.rows <= 0) return { ok: false, message: 'A piece spans no cells' };
    if (p.col < 0 || p.row < 0 || p.col + p.cols > t.columns.length || p.row + p.rows > t.rows.length) {
      return { ok: false, message: `A piece at column ${p.col + 1}, row ${p.row + 1} runs off the grid` };
    }
    for (let r = p.row; r < p.row + p.rows; r++) {
      for (let c = p.col; c < p.col + p.cols; c++) cover[r * t.columns.length + c]! += 1;
    }
  }

  for (let r = 0; r < t.rows.length; r++) {
    for (let c = 0; c < t.columns.length; c++) {
      const n = cover[r * t.columns.length + c]!;
      if (n === 0) return { ok: false, message: `Column ${c + 1}, row ${r + 1} is unpainted` };
      if (n > 1) return { ok: false, message: `Column ${c + 1}, row ${r + 1} is covered ${n} times` };
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The painted target as a `Partition`.
 *
 * This is the boundary where the paint surface hands over to the engine. From
 * here on the target is just geometry, which is why an imported image and a
 * hand-painted grid get identical treatment.
 */
export function targetToPartition(
  t: PaintTarget,
  ringOrientation: RingOrientation = 'quartersawn',
): Partition {
  const faces: PartitionFace[] = t.pieces.map((p, i) => ({
    polygon: rectPolygon(pieceRect(t, p)),
    species: p.species,
    pieceId: `paint-${i}`,
    ringOrientation,
  }));
  return {
    outline: rectangle(0, 0, targetWidth(t), targetLength(t)),
    faces,
  };
}

/**
 * Recover a `PaintTarget` from a `Partition` whose faces are grid rectangles.
 *
 * Needed because the decomposer's public entry takes a `Partition`, and both
 * snapping and the achieved-pattern view want to hand a target back. Returns
 * null when a face is not a rectangle on the implied lattice -- which is a
 * refusal the caller has already been given a better message for.
 */
export function partitionToTarget(p: Partition): PaintTarget | null {
  const xs = new Set<number>();
  const ys = new Set<number>();
  const rects: Array<{ r: Rect; species: SpeciesId }> = [];

  for (const face of p.faces) {
    const r = asAxisAlignedRect(face.polygon);
    if (!r) return null;
    xs.add(r.x0);
    xs.add(r.x1);
    ys.add(r.y0);
    ys.add(r.y1);
    rects.push({ r, species: face.species });
  }

  const xEdges = [...xs].sort((a, b) => a - b);
  const yEdges = [...ys].sort((a, b) => a - b);
  const columns: Ticks[] = [];
  const rows: Ticks[] = [];
  for (let i = 1; i < xEdges.length; i++) columns.push(ticks(xEdges[i]! - xEdges[i - 1]!));
  for (let i = 1; i < yEdges.length; i++) rows.push(ticks(yEdges[i]! - yEdges[i - 1]!));

  const pieces: PaintPiece[] = rects.map(({ r, species }) => ({
    col: xEdges.indexOf(r.x0),
    row: yEdges.indexOf(r.y0),
    cols: xEdges.indexOf(r.x1) - xEdges.indexOf(r.x0),
    rows: yEdges.indexOf(r.y1) - yEdges.indexOf(r.y0),
    species,
  }));

  return { columns, rows, pieces };
}

/**
 * A polygon as an axis-aligned rectangle, or null.
 *
 * Tolerates collinear vertices, because a rectangle that arrived by clipping
 * may carry a redundant point on an edge, and rejecting it for that would be a
 * false refusal.
 */
export function asAxisAlignedRect(poly: Polygon): Rect | null {
  if (poly.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of poly) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
    // Every vertex of an axis-aligned rectangle lies on one of its four sides,
    // but that is only knowable once the extent is, so it is checked below.
  }
  if (maxX <= minX || maxY <= minY) return null;

  for (const pt of poly) {
    const onVertical = pt.x === minX || pt.x === maxX;
    const onHorizontal = pt.y === minY || pt.y === maxY;
    if (!onVertical && !onHorizontal) return null;
  }
  // The vertex test alone passes a rectangle with a bite out of a corner, so
  // confirm the area too. Exact on integers.
  if (area(poly) !== (maxX - minX) * (maxY - minY)) return null;

  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}
