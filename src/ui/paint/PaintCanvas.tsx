/**
 * The tier-2 paint surface.
 *
 * Shows the **target** -- what the user drew -- and outlines any region the
 * decomposer named as a problem. The achieved pattern is a separate view
 * (`BoardCanvas` over the evaluated graph), and keeping them distinct is the
 * crux of the spec's honesty requirement: a tool that silently redraws the
 * target to match what it managed to build produces a board that does not look
 * like the drawing, which is a worse betrayal than refusing.
 *
 * Merged pieces are drawn with a heavier outline than cell boundaries, because
 * piece count is the thing that decides buildability and the user needs to see
 * it. A 2 x 2 merged square and four separate cells look identical in colour and
 * are completely different designs.
 */

import { useMemo, useRef, useState } from 'react';
import { SPECIES } from '../../core/knowledge/species.js';
import { boundingBox, type Polygon } from '../../core/geometry/polygon.js';
import { edges, pieceRect, targetLength, targetWidth } from '../../core/decompose/target.js';
import type { PaintPiece, PaintTarget } from '../../core/decompose/types.js';
import { formatTicks } from '../../core/units/ticks.js';

export type PaintTool = 'paint' | 'merge' | 'split';

export interface PaintCanvasProps {
  readonly target: PaintTarget;
  readonly tool: PaintTool;
  /** Regions the decomposer named. Drawn on top, never silently corrected. */
  readonly problemRegions?: readonly Polygon[];
  readonly onPaintCell: (col: number, row: number) => void;
  readonly onMergeRect: (col: number, row: number, cols: number, rows: number) => void;
  readonly onSplitCell: (col: number, row: number) => void;
}

interface CellRef {
  readonly col: number;
  readonly row: number;
}

export function PaintCanvas({
  target,
  tool,
  problemRegions = [],
  onPaintCell,
  onMergeRect,
  onSplitCell,
}: PaintCanvasProps) {
  const [drag, setDrag] = useState<{ from: CellRef; to: CellRef } | null>(null);
  const [hovered, setHovered] = useState<CellRef | null>(null);
  const painting = useRef(false);

  const width = targetWidth(target);
  const length = targetLength(target);
  const xs = useMemo(() => edges(target.columns), [target.columns]);
  const ys = useMemo(() => edges(target.rows), [target.rows]);

  const pad = Math.max(width, length) * 0.04;
  const stroke = Math.max(width, length) / 500;

  const cellAt = (event: React.PointerEvent<SVGSVGElement>): CellRef | null => {
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    // Map client pixels into the viewBox's own units. Doing it from the
    // bounding rect rather than from a transform matrix keeps this correct
    // under the responsive `max-width` the layout applies.
    const vx = ((event.clientX - box.left) / box.width) * (width + pad * 2) - pad;
    const vy = ((event.clientY - box.top) / box.height) * (length + pad * 2) - pad;

    const col = xs.findIndex((edge, i) => i < target.columns.length && vx >= edge && vx < xs[i + 1]!);
    const row = ys.findIndex((edge, i) => i < target.rows.length && vy >= edge && vy < ys[i + 1]!);
    return col < 0 || row < 0 ? null : { col, row };
  };

  const onDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const cell = cellAt(event);
    if (!cell) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'paint') {
      painting.current = true;
      onPaintCell(cell.col, cell.row);
      return;
    }
    if (tool === 'split') {
      onSplitCell(cell.col, cell.row);
      return;
    }
    setDrag({ from: cell, to: cell });
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const cell = cellAt(event);
    setHovered(cell);
    if (!cell) return;
    if (painting.current) onPaintCell(cell.col, cell.row);
    else if (drag) setDrag({ from: drag.from, to: cell });
  };

  const onUp = () => {
    painting.current = false;
    if (drag) {
      const col = Math.min(drag.from.col, drag.to.col);
      const row = Math.min(drag.from.row, drag.to.row);
      onMergeRect(
        col,
        row,
        Math.abs(drag.to.col - drag.from.col) + 1,
        Math.abs(drag.to.row - drag.from.row) + 1,
      );
      setDrag(null);
    }
  };

  const selection = drag
    ? {
        x: xs[Math.min(drag.from.col, drag.to.col)]!,
        y: ys[Math.min(drag.from.row, drag.to.row)]!,
        w: xs[Math.max(drag.from.col, drag.to.col) + 1]! - xs[Math.min(drag.from.col, drag.to.col)]!,
        h: ys[Math.max(drag.from.row, drag.to.row) + 1]! - ys[Math.min(drag.from.row, drag.to.row)]!,
      }
    : null;

  const hoveredPiece = hovered
    ? target.pieces.find(
        (p) =>
          hovered.col >= p.col &&
          hovered.col < p.col + p.cols &&
          hovered.row >= p.row &&
          hovered.row < p.row + p.rows,
      )
    : undefined;

  return (
    <div className="canvas-wrap">
      <svg
        className={`board-canvas paint-canvas tool-${tool}`}
        viewBox={`${-pad} ${-pad} ${width + pad * 2} ${length + pad * 2}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          painting.current = false;
          setHovered(null);
        }}
        role="application"
        aria-label={`Paint surface, ${target.columns.length} by ${target.rows.length} cells`}
      >
        {/* Pieces first, so every later layer draws over solid colour. */}
        {target.pieces.map((piece, i) => (
          <PieceShape key={`${piece.col}-${piece.row}-${i}`} target={target} piece={piece} />
        ))}

        {/* Cell boundaries inside a merged piece, drawn faintly: they are where
            a split would land, so they are useful, but they are not joints. */}
        <g className="paint-lattice">
          {xs.slice(1, -1).map((x) => (
            <line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={length} strokeWidth={stroke * 0.6} />
          ))}
          {ys.slice(1, -1).map((y) => (
            <line key={`hy-${y}`} x1={0} y1={y} x2={width} y2={y} strokeWidth={stroke * 0.6} />
          ))}
        </g>

        {/* Piece outlines on top, heavier: these ARE the joints. */}
        <g className="paint-joints">
          {target.pieces.map((piece, i) => {
            const r = pieceRect(target, piece);
            return (
              <rect
                key={`joint-${i}`}
                x={r.x0}
                y={r.y0}
                width={r.x1 - r.x0}
                height={r.y1 - r.y0}
                strokeWidth={stroke * 1.6}
              />
            );
          })}
        </g>

        {problemRegions.map((region, i) => (
          <polygon
            key={`problem-${i}`}
            className={i === 0 ? 'problem-region problem-extent' : 'problem-region'}
            points={region.map((p) => `${p.x},${p.y}`).join(' ')}
            strokeWidth={stroke * (i === 0 ? 3 : 2)}
          />
        ))}

        {selection && (
          <rect
            className="paint-selection"
            x={selection.x}
            y={selection.y}
            width={selection.w}
            height={selection.h}
            strokeWidth={stroke * 2}
          />
        )}
      </svg>

      {/* A fixed-height caption. The 2-D canvas learned this the hard way: a
          shrink-to-fit wrapper took its width from its widest child, so hover
          text of a different length resized the board by up to 24%. */}
      <div className="canvas-caption">
        {hoveredPiece ? (
          <span>
            <strong>{SPECIES[hoveredPiece.species]?.name ?? hoveredPiece.species}</strong> ·{' '}
            {formatTicks(pieceRect(target, hoveredPiece).x1 - pieceRect(target, hoveredPiece).x0)} ×{' '}
            {formatTicks(pieceRect(target, hoveredPiece).y1 - pieceRect(target, hoveredPiece).y0)}
            {hoveredPiece.cols * hoveredPiece.rows > 1 ? ` · ${hoveredPiece.cols}×${hoveredPiece.rows} merged` : ''}
          </span>
        ) : (
          <span>
            Target · {formatTicks(width)} × {formatTicks(length)} · {target.pieces.length} pieces
          </span>
        )}
      </div>
    </div>
  );
}

function PieceShape({ target, piece }: { target: PaintTarget; piece: PaintPiece }) {
  const r = pieceRect(target, piece);
  const info = SPECIES[piece.species];
  return (
    <g>
      <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill={info?.color ?? '#999'} />
      <rect
        x={r.x0}
        y={r.y0}
        width={r.x1 - r.x0}
        height={r.y1 - r.y0}
        fill={`url(#${info?.hatch ?? 'hatch-none'})`}
      />
    </g>
  );
}

/**
 * The hatch patterns, as a standalone `<defs>`.
 *
 * Duplicated from `BoardCanvas` rather than shared because an SVG `<pattern>`
 * is referenced by id within its own document, and in split view both canvases
 * are mounted at once -- two elements with the same id is invalid and which one
 * wins is not specified. Each canvas carrying its own prefixed set is the only
 * version that is correct in both views.
 */
export function PaintDefs() {
  return (
    <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        <pattern id="hatch-diagonal" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,8 l8,-8" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
        </pattern>
        <pattern id="hatch-dots" width={8} height={8} patternUnits="userSpaceOnUse">
          <circle cx={4} cy={4} r={1} fill="rgba(0,0,0,0.35)" />
        </pattern>
        <pattern id="hatch-cross" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,0 l8,8 M8,0 l-8,8" stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} fill="none" />
        </pattern>
        <pattern id="hatch-vertical" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M4,0 l0,8" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
        </pattern>
        <pattern id="hatch-horizontal" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,4 l8,0" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
        </pattern>
        <pattern id="hatch-grid" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,0 l0,8 M0,0 l8,0" stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} fill="none" />
        </pattern>
        <pattern id="hatch-wave" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,6 q2,-4 4,0 q2,4 4,0" stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} fill="none" />
        </pattern>
        <pattern id="hatch-dense" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0,2 l8,0 M0,6 l8,0" stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} />
        </pattern>
      </defs>
    </svg>
  );
}

/** Centre of everything a set of regions covers, for a "show me" control. */
export function regionsCentre(regions: readonly Polygon[]): { x: number; y: number } | null {
  if (regions.length === 0) return null;
  const b = boundingBox(regions[0]!);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
