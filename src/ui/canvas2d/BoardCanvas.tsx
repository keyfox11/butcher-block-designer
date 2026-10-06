/**
 * The 2-D face view.
 *
 * The face pattern IS the evaluated workpiece's cross-section, so this renders
 * a direct read of the model -- no projection, no second source of truth.
 *
 * Species carry a hatch pattern as well as a colour. Wood palettes are mostly
 * browns and reds, which is close to worst case for red-green colour blindness,
 * and it also means a monochrome shop printout stays readable.
 */

import { useMemo, useState } from 'react';
import type { PartitionFace, Workpiece } from '../../core/model/types.js';
import { SPECIES } from '../../core/knowledge/species.js';
import { boardDimensions } from '../../core/geometry/evaluate.js';
import { formatTicks } from '../../core/units/ticks.js';

export interface BoardCanvasProps {
  readonly workpiece: Workpiece;
  /** Pieces to highlight, e.g. from a selected finding. */
  readonly highlighted?: readonly string[];
  readonly showGrain?: boolean;
}

const HATCHES = [
  { id: 'hatch-none', render: null },
  { id: 'hatch-diagonal', render: <path d="M0,8 l8,-8" strokeWidth={1} /> },
  { id: 'hatch-dots', render: <circle cx={4} cy={4} r={1} /> },
  { id: 'hatch-cross', render: <path d="M0,0 l8,8 M8,0 l-8,8" strokeWidth={0.8} /> },
  { id: 'hatch-vertical', render: <path d="M4,0 l0,8" strokeWidth={1} /> },
  { id: 'hatch-horizontal', render: <path d="M0,4 l8,0" strokeWidth={1} /> },
  { id: 'hatch-grid', render: <path d="M0,0 l0,8 M0,0 l8,0" strokeWidth={0.8} /> },
  { id: 'hatch-wave', render: <path d="M0,6 q2,-4 4,0 q2,4 4,0" strokeWidth={0.8} /> },
  { id: 'hatch-dense', render: <path d="M0,2 l8,0 M0,6 l8,0" strokeWidth={1.2} /> },
] as const;

export function BoardCanvas({ workpiece, highlighted = [], showGrain = true }: BoardCanvasProps) {
  const [hovered, setHovered] = useState<PartitionFace | null>(null);
  const dims = useMemo(() => boardDimensions(workpiece), [workpiece]);
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  const pad = Math.max(dims.width, dims.length) * 0.04;

  return (
    <div className="canvas-wrap">
      <svg
        className="board-canvas"
        viewBox={`${-pad} ${-pad} ${dims.width + pad * 2} ${dims.length + pad * 2}`}
        role="img"
        aria-label={`End-grain board, ${formatTicks(dims.width)} by ${formatTicks(dims.length)}`}
      >
        <defs>
          {HATCHES.map((h) =>
            h.render ? (
              <pattern key={h.id} id={h.id} width={8} height={8} patternUnits="userSpaceOnUse">
                <g stroke="rgba(0,0,0,0.35)" fill="rgba(0,0,0,0.35)">
                  {h.render}
                </g>
              </pattern>
            ) : null,
          )}
          {/* End-grain texture: concentric arcs reading as growth rings. */}
          <pattern id="endgrain" width={14} height={14} patternUnits="userSpaceOnUse">
            <g fill="none" stroke="rgba(0,0,0,0.13)" strokeWidth={0.7}>
              <path d="M-4,18 q9,-11 18,-18" />
              <path d="M-4,12 q6,-8 12,-12" />
              <path d="M-4,24 q12,-14 24,-24" />
            </g>
          </pattern>
        </defs>

        {workpiece.crossSection.faces.map((face) => {
          const info = SPECIES[face.species];
          const isHot = highlightSet.has(face.pieceId) || hovered?.pieceId === face.pieceId;
          const points = face.polygon.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={face.pieceId}>
              <polygon points={points} fill={info?.color ?? '#999'} />
              {showGrain && <polygon points={points} fill="url(#endgrain)" />}
              <polygon points={points} fill={`url(#${info?.hatch ?? 'hatch-none'})`} />
              <polygon
                points={points}
                className={isHot ? 'face-outline hot' : 'face-outline'}
                onMouseEnter={() => setHovered(face)}
                onMouseLeave={() => setHovered(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="canvas-caption">
        {hovered ? (
          <span>
            <strong>{SPECIES[hovered.species]?.name ?? hovered.species}</strong> · piece{' '}
            {hovered.pieceId} · {hovered.ringOrientation}
          </span>
        ) : (
          <span>
            {formatTicks(dims.width)} × {formatTicks(dims.length)} × {formatTicks(dims.thickness)}{' '}
            · end grain up
          </span>
        )}
      </div>
    </div>
  );
}
