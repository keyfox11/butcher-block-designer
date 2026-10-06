/**
 * Printed assembly maps.
 *
 * Laid on the bench beside the parts. Every piece is labelled with the same id
 * the cut list uses, and every piece carries an orientation arrow -- not just
 * the ones that differ, because a map that marks only exceptions relies on the
 * builder noticing an absence.
 */

import {
  type AssemblyMap,
  describeScale,
  mapScale,
  summariseMap,
} from '../../core/cutlist/assembly.js';
import { TICKS_PER_INCH } from '../../core/units/ticks.js';

/** Letter paper at 0.5" margins, less room for the caption. */
const PRINTABLE = { width: 7.5, height: 8.5 };

export function AssemblyMapSheet({ maps }: { maps: readonly AssemblyMap[] }) {
  if (maps.length === 0) return null;
  return (
    <section className="print-section">
      <h2>Assembly maps</h2>
      <p className="print-note">
        One page per glue-up. Lay each map beside the parts and check every piece against it before
        any glue is opened — a single slice turned the wrong way ruins the board once the glue is
        spread.
      </p>
      {maps.map((map) => (
        <AssemblyMapFigure key={map.nodeId} map={map} />
      ))}
    </section>
  );
}

function AssemblyMapFigure({ map }: { map: AssemblyMap }) {
  const { scale, isFullSize } = mapScale(map, PRINTABLE);
  const widthIn = (map.width / TICKS_PER_INCH) * scale;
  const heightIn = (map.height / TICKS_PER_INCH) * scale;

  // Keep stroke and type legible whatever the scale.
  const stroke = map.width / 320;
  const fontSize = Math.min(map.width, map.height) / 18;

  return (
    <figure className="assembly-map">
      <figcaption>
        <strong>{map.stageLabel}</strong>
        <span className="muted"> · {summariseMap(map)}</span>
        <span className={isFullSize ? 'scale-full' : 'scale-reduced'}> · {describeScale(scale)}</span>
      </figcaption>

      {map.sequence === 'rowByRow' && (
        <p className="assembly-sequence">
          Glue row by row, about 30 minutes between rows. These joints are not perpendicular to the
          clamps, so the pressure turns into lateral force and the pieces slide.
        </p>
      )}

      <svg
        width={`${widthIn}in`}
        height={`${heightIn}in`}
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="assembly-svg"
      >
        <defs>
          <pattern id={`am-hatch-${map.nodeId}`} width={map.width / 40} height={map.width / 40} patternUnits="userSpaceOnUse">
            <path d={`M0,${map.width / 40} L${map.width / 40},0`} stroke="rgba(0,0,0,0.3)" strokeWidth={stroke * 0.5} />
          </pattern>
        </defs>

        {map.pieces.map((piece) => {
          const points = piece.polygon.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={piece.pieceId}>
              {/* Species regions are drawn faintly inside the piece so the
                  pattern is visible, but the PIECE is the labelled unit: it is
                  what the builder picks up. */}
              {piece.faces.map((face, i) => {
                const facePoints = face.polygon.map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <g key={i}>
                    <polygon points={facePoints} fill={face.colour} stroke="none" />
                    {/* Hatch as well as colour, so the map survives a
                        monochrome shop printer. */}
                    {face.hatch !== 'hatch-none' && (
                      <polygon points={facePoints} fill={`url(#am-hatch-${map.nodeId})`} stroke="none" />
                    )}
                    <polygon
                      points={facePoints}
                      fill="none"
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth={stroke * 0.5}
                    />
                  </g>
                );
              })}
              {/* The member boundary, drawn heavy: this is the cut line that
                  matters when laying parts out. */}
              <polygon points={points} fill="none" stroke="#000" strokeWidth={stroke * 2.2} />

              <text
                x={piece.centre.x}
                y={piece.centre.y}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#000"
                stroke="#fff"
                strokeWidth={fontSize / 14}
                paintOrder="stroke"
                fontWeight={700}
              >
                {piece.label}
              </text>

              {/* An arrow on EVERY piece: a map marking only exceptions asks
                  the builder to notice an absence. */}
              <OrientationArrow
                x={piece.centre.x}
                y={piece.centre.y + fontSize * 1.1}
                size={fontSize * 0.8}
                stroke={stroke}
                flipped={piece.rotated180}
              />

              {(piece.rotated180 || piece.mirrored) && (
                <text
                  x={piece.centre.x}
                  y={piece.centre.y - fontSize * 1.05}
                  fontSize={fontSize * 0.62}
                  textAnchor="middle"
                  fill="#000"
                  stroke="#fff"
                  strokeWidth={fontSize / 22}
                  paintOrder="stroke"
                  fontWeight={700}
                >
                  {piece.rotated180 ? 'ROTATE' : 'FLIP'}
                </text>
              )}
            </g>
          );
        })}

        <rect
          x={0}
          y={0}
          width={map.width}
          height={map.height}
          fill="none"
          stroke="#000"
          strokeWidth={stroke * 2}
        />
      </svg>

      <ScaleBar map={map} scale={scale} />
    </figure>
  );
}

function OrientationArrow({
  x,
  y,
  size,
  stroke,
  flipped,
}: {
  x: number;
  y: number;
  size: number;
  stroke: number;
  flipped: boolean;
}) {
  const direction = flipped ? -1 : 1;
  return (
    <g stroke="#000" strokeWidth={stroke * 1.6} fill="none" strokeLinecap="round">
      <line x1={x} y1={y - (size / 2) * direction} x2={x} y2={y + (size / 2) * direction} />
      <polyline
        points={`${x - size / 4},${y + (size / 4) * direction} ${x},${y + (size / 2) * direction} ${x + size / 4},${y + (size / 4) * direction}`}
      />
    </g>
  );
}

/** Printers rescale, so the bar is the only trustworthy reference on the page. */
function ScaleBar({ map, scale }: { map: AssemblyMap; scale: number }) {
  const inchInTicks = TICKS_PER_INCH;
  const barInches = Math.max(1, Math.floor(map.width / inchInTicks / 4));
  return (
    <div className="scale-bar">
      <svg
        width={`${barInches * scale}in`}
        height="0.22in"
        viewBox={`0 0 ${barInches * inchInTicks} 1600`}
        preserveAspectRatio="none"
      >
        <rect x={0} y={400} width={barInches * inchInTicks} height={340} fill="none" stroke="#000" strokeWidth={90} />
        {Array.from({ length: barInches }, (_, i) => (
          <rect
            key={i}
            x={i * inchInTicks}
            y={400}
            width={inchInTicks}
            height={340}
            fill={i % 2 === 0 ? '#000' : 'none'}
          />
        ))}
      </svg>
      <span>{barInches}" — measure this bar to confirm your printer did not rescale</span>
    </div>
  );
}
