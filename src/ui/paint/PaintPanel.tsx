/**
 * Controls for the paint surface.
 *
 * The refusal block at the bottom is the part that matters. It is not an error
 * toast: it stays in place, names the regions, explains why, and offers the
 * repair when there is one. A refusal the user can read twice is worth more
 * than one that fades.
 */

import { useCallback, useRef, useState } from 'react';
import { SPECIES } from '../../core/knowledge/species.js';
import { quantiseImage, quantiseQuality, type QuantiseResult } from '../../core/decompose/quantise.js';
import type { PaintTarget, Refusal } from '../../core/decompose/types.js';
import type { SpeciesId, Ticks } from '../../core/model/types.js';
import { formatTicks, inches, parseLength } from '../../core/units/ticks.js';
import type { PaintTool } from './PaintCanvas.js';

export interface PaintPanelProps {
  readonly target: PaintTarget;
  readonly tool: PaintTool;
  readonly brush: SpeciesId;
  readonly palette: readonly SpeciesId[];
  readonly cellSize: Ticks;
  readonly refusal: Refusal | null;
  readonly suggestion: { target: PaintTarget; changesAppearance: boolean } | null;
  readonly internalError: string | null;
  readonly running: boolean;
  readonly progress: number;
  readonly onTool: (tool: PaintTool) => void;
  readonly onBrush: (species: SpeciesId) => void;
  readonly onResize: (cols: number, rows: number, cellSize: Ticks) => void;
  readonly onTarget: (target: PaintTarget) => void;
  readonly onCancel: () => void;
}

export function PaintPanel(props: PaintPanelProps) {
  const { target, refusal, suggestion, internalError } = props;

  return (
    <div className="panel">
      <h2>Paint</h2>
      <p className="pattern-description">
        Paint cells, merge them into bigger pieces, and the decomposer works out how to build it —
        or says plainly that it cannot.
      </p>

      <ToolPicker tool={props.tool} onTool={props.onTool} />
      <Palette palette={props.palette} brush={props.brush} onBrush={props.onBrush} />
      <GridControls
        cols={target.columns.length}
        rows={target.rows.length}
        cellSize={props.cellSize}
        onResize={props.onResize}
      />
      <ImageImport
        palette={props.palette}
        cellSize={props.cellSize}
        cols={target.columns.length}
        rows={target.rows.length}
        onAccept={props.onTarget}
      />

      {props.running && (
        <div className="paint-progress">
          <progress value={props.progress} max={1} />
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      )}

      {internalError && (
        <div className="paint-refusal paint-internal">
          <h3>Something in the tool went wrong</h3>
          <p>{internalError}</p>
          {/* Named differently from a refusal on purpose. Telling a user to
              change their design to work around a defect in the tool sends
              them to fix the wrong thing. */}
          <p className="field-hint">
            This is a fault in the decomposer, not a problem with your design. Worth reporting.
          </p>
        </div>
      )}

      {refusal && !internalError && (
        <div className="paint-refusal">
          <h3>This cannot be built</h3>
          <p>{refusal.reason}</p>
          {refusal.remedy && <p className="finding-remedy">{refusal.remedy}</p>}

          {suggestion ? (
            <button
              type="button"
              className="paint-snap"
              onClick={() => props.onTarget(suggestion.target)}
            >
              {suggestion.changesAppearance
                ? 'Snap to the nearest buildable pattern'
                : `Add ${pieceDelta(target, suggestion.target)} — the pattern stays identical`}
            </button>
          ) : (
            <p className="field-hint">
              No automatic repair for this one. The remedy above is the fix.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function pieceDelta(before: PaintTarget, after: PaintTarget): string {
  const extra = after.pieces.length - before.pieces.length;
  return extra === 1 ? 'one glue line' : `${extra} glue lines`;
}

/* -------------------------------------------------------------------------- */

function ToolPicker({ tool, onTool }: { tool: PaintTool; onTool: (t: PaintTool) => void }) {
  const tools: Array<{ id: PaintTool; label: string; hint: string }> = [
    { id: 'paint', label: 'Paint', hint: 'Drag to colour cells. Painting into a merged piece breaks it up.' },
    { id: 'merge', label: 'Merge', hint: 'Drag a rectangle to make it one piece of wood.' },
    { id: 'split', label: 'Split', hint: 'Click a merged piece to break it back into cells.' },
  ];
  return (
    <div className="field">
      <span className="field-label">Tool</span>
      <div className="paint-tools">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tool ? 'pattern-chip active' : 'pattern-chip'}
            onClick={() => onTool(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>
      <span className="field-hint">{tools.find((t) => t.id === tool)?.hint}</span>
    </div>
  );
}

function Palette({
  palette,
  brush,
  onBrush,
}: {
  palette: readonly SpeciesId[];
  brush: SpeciesId;
  onBrush: (s: SpeciesId) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">Species</span>
      <div className="paint-palette">
        {palette.map((id) => {
          const info = SPECIES[id];
          return (
            <button
              key={id}
              type="button"
              className={id === brush ? 'paint-swatch active' : 'paint-swatch'}
              onClick={() => onBrush(id)}
              title={info?.name ?? id}
            >
              <span className="swatch" style={{ background: info?.color ?? '#999' }} />
              <span>{info?.name ?? id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GridControls({
  cols,
  rows,
  cellSize,
  onResize,
}: {
  cols: number;
  rows: number;
  cellSize: Ticks;
  onResize: (cols: number, rows: number, cellSize: Ticks) => void;
}) {
  const [sizeText, setSizeText] = useState(formatTicks(cellSize));
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="row">
        <label className="field">
          <span className="field-label">Columns</span>
          <input
            type="number"
            min={2}
            max={40}
            value={cols}
            onChange={(e) => onResize(clamp(Number(e.target.value), 2, 40), rows, cellSize)}
          />
        </label>
        <label className="field">
          <span className="field-label">Rows</span>
          <input
            type="number"
            min={2}
            max={40}
            value={rows}
            onChange={(e) => onResize(cols, clamp(Number(e.target.value), 2, 40), cellSize)}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Cell size</span>
        <input
          type="text"
          value={sizeText}
          onChange={(e) => setSizeText(e.target.value)}
          onBlur={() => {
            // `parseLength` throws rather than returning a result union, and
            // reports inexact input through `exact` -- matching the parameter
            // panel so the two dimension fields behave identically.
            try {
              const parsed = parseLength(sizeText);
              if (parsed.ticks <= 0) throw new Error('Must be positive');
              setError(parsed.exact ? null : `Rounded to ${formatTicks(parsed.ticks)}`);
              setSizeText(formatTicks(parsed.ticks));
              onResize(cols, rows, parsed.ticks);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Cannot parse');
            }
          }}
        />
        {error ? (
          <span className="field-error">{error}</span>
        ) : (
          <span className="field-hint">
            Resizing the grid breaks merged pieces back into cells — there is no honest answer for
            what a 3-column piece becomes in a 2-column grid.
          </span>
        )}
      </label>
    </>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
}

/* -------------------------------------------------------------------------- */
/* Image import                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Load a picture, quantise it, and show the result **before** anything is
 * generated.
 *
 * The preview is the whole point. Quantising to three or four wood tones loses
 * nearly all photographic detail, and the only fair way to set that expectation
 * is with a picture rather than with a warning nobody reads.
 */
function ImageImport({
  palette,
  cellSize,
  cols,
  rows,
  onAccept,
}: {
  palette: readonly SpeciesId[];
  cellSize: Ticks;
  cols: number;
  rows: number;
  onAccept: (t: PaintTarget) => void;
}) {
  const [preview, setPreview] = useState<{ result: QuantiseResult; cols: number; rows: number } | null>(
    null,
  );
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        // Draw at the source size and let the quantiser average whole cells,
        // rather than letting the browser downsample first -- its filter is
        // not gamma-correct and would bias every cell dark.
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setPreview({
          result: quantiseImage(pixels, cols, rows, cellSize, palette),
          cols,
          rows,
        });
        setSourceUrl(url);
      };
      image.src = url;
    },
    [cols, rows, cellSize, palette],
  );

  const quality = preview ? quantiseQuality(preview.result) : null;

  return (
    <div className="field paint-import">
      <span className="field-label">Import an image</span>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) load(file);
        }}
      />
      <span className="field-hint">
        Quantised to the palette at the current grid. Bold shapes work; photographs do not.
      </span>

      {preview && quality && (
        <div className={`paint-quantise quantise-${quality.verdict}`}>
          <div className="quantise-pair">
            {sourceUrl && <img src={sourceUrl} alt="Source" />}
            <QuantisePreview result={preview.result} cols={preview.cols} rows={preview.rows} />
          </div>
          <p>{quality.note}</p>
          <div className="row">
            <button type="button" onClick={() => onAccept(preview.result.target)}>
              Use this
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                if (fileInput.current) fileInput.current.value = '';
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuantisePreview({
  result,
  cols,
  rows,
}: {
  result: QuantiseResult;
  cols: number;
  rows: number;
}) {
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} role="img" aria-label="Quantised preview">
      {result.target.pieces.map((p, i) => (
        <rect
          key={i}
          x={p.col}
          y={p.row}
          width={1}
          height={1}
          fill={SPECIES[p.species]?.color ?? '#999'}
        />
      ))}
    </svg>
  );
}

/** The default paint grid: a plain checkerboard, so the surface opens on something. */
export const DEFAULT_PAINT_CELL = inches(1.5);
