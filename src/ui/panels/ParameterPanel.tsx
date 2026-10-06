/**
 * Tier-1 parameter editing: pick a pattern, adjust it, see the result.
 *
 * Dimensions are entered as woodworking fractions. "1 1/2", "1-1/2" and "1.5"
 * all work, and the field shows back what will actually be measured.
 */

import { useState } from 'react';
import { PATTERNS, type PatternParams, pattern } from '../../core/generators/registry.js';
import { SPECIES } from '../../core/knowledge/species.js';
import type { SpeciesId, Ticks } from '../../core/model/types.js';
import { PRECISION, degrees, formatTicks, parseLength, toDegrees } from '../../core/units/ticks.js';

export interface ParameterPanelProps {
  readonly patternId: string;
  readonly params: PatternParams;
  readonly onPattern: (id: string) => void;
  readonly onChange: (next: PatternParams) => void;
}

export function ParameterPanel({ patternId, params, onPattern, onChange }: ParameterPanelProps) {
  const definition = pattern(patternId);

  return (
    <div className="panel">
      <h2>Pattern</h2>

      <div className="pattern-grid">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === patternId ? 'pattern-chip active' : 'pattern-chip'}
            onClick={() => onPattern(p.id)}
            title={p.description}
          >
            <span className="pattern-name">{p.name}</span>
            {/* Glue-ups are the real cost of these boards, so the count is on
                the chip rather than buried in a detail view. */}
            <span className="pattern-meta">
              {p.difficulty} · {p.glueUps} glue-ups
            </span>
          </button>
        ))}
      </div>

      <p className="pattern-description">{definition.description}</p>

      <DimensionField
        label="Cell size"
        hint="Also sets stock thickness and rip width, which is what makes cells square."
        value={params.cellSize}
        onCommit={(cellSize) => onChange({ ...params, cellSize })}
      />

      <DimensionField
        label="Finished thickness"
        hint="Set by the crosscut. Cheap to add now, impossible to add later."
        value={params.boardThickness}
        onCommit={(boardThickness) => onChange({ ...params, boardThickness })}
      />

      <CountField
        label="Columns"
        value={params.columns}
        min={2}
        max={24}
        onChange={(columns) => onChange({ ...params, columns })}
        note={
          patternId === 'checkerboard' && params.columns % 2 === 1
            ? 'Odd counts need two inverted panels: rotating a slice only offsets an even sequence.'
            : undefined
        }
      />

      <CountField
        label="Rows"
        value={params.rows}
        min={2}
        max={24}
        onChange={(rows) => onChange({ ...params, rows })}
      />

      {definition.uses.angle && (
        <AngleField
          value={params.angle}
          onChange={(angle) => onChange({ ...params, angle })}
        />
      )}

      {definition.uses.seed && (
        <label className="field">
          <span className="field-label">
            Seed <span className="field-value">{params.seed}</span>
          </span>
          <div className="row">
            <input
              type="range"
              min={1}
              max={999}
              value={params.seed}
              onChange={(e) => onChange({ ...params, seed: Number(e.target.value) })}
            />
            <button type="button" onClick={() => onChange({ ...params, seed: 1 + Math.floor(Math.random() * 999) })}>
              Shuffle
            </button>
          </div>
          <span className="field-hint">The seed is part of the design, so it can be shared and rebuilt exactly.</span>
        </label>
      )}

      <SpeciesField
        label="Species A"
        value={params.speciesA}
        onChange={(speciesA) => onChange({ ...params, speciesA })}
      />
      <SpeciesField
        label="Species B"
        value={params.speciesB}
        onChange={(speciesB) => onChange({ ...params, speciesB })}
      />
      {definition.uses.thirdSpecies && (
        <SpeciesField
          label="Species C"
          value={params.speciesC}
          onChange={(speciesC) => onChange({ ...params, speciesC })}
        />
      )}
    </div>
  );
}

function AngleField({ value, onChange }: { value: Ticks | number; onChange: (v: never) => void }) {
  const current = toDegrees(value);
  return (
    <label className="field">
      <span className="field-label">
        Bevel angle <span className="field-value">{current.toFixed(0)}°</span>
      </span>
      <input
        type="range"
        min={-40}
        max={40}
        value={Math.round(current)}
        onChange={(e) => onChange(degrees(Number(e.target.value)) as never)}
      />
      <span className="field-hint">
        A tilted blade shifts the cut sideways as it crosses the stock, so a bevelled strip is a
        different width at each face.
      </span>
    </label>
  );
}

function DimensionField({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: Ticks;
  onCommit: (value: Ticks) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    try {
      const parsed = parseLength(draft);
      if (parsed.ticks <= 0) throw new Error('Must be positive');
      setError(parsed.exact ? null : `Rounded to ${formatTicks(parsed.ticks)}`);
      onCommit(parsed.ticks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot parse');
    }
    setDraft(null);
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="text"
        value={draft ?? formatTicks(value, PRECISION.THIRTY_SECOND)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {error && <span className="field-error">{error}</span>}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function CountField({
  label,
  value,
  min,
  max,
  onChange,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  note?: string | undefined;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label} <span className="field-value">{value}</span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {note && <span className="field-hint">{note}</span>}
    </label>
  );
}

function SpeciesField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SpeciesId;
  onChange: (value: SpeciesId) => void;
}) {
  const info = SPECIES[value];
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.values(SPECIES).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {info && (
        <span className="field-hint">
          <span className="swatch" style={{ background: info.color }} /> Janka {info.jankaLbf} lbf ·
          movement{' '}
          {info.movementCoefficient === null ? 'not recorded' : info.movementCoefficient.toFixed(5)} ·{' '}
          {foodSafetyLabel(info.foodSafety)}
        </span>
      )}
    </label>
  );
}

function foodSafetyLabel(status: string): string {
  switch (status) {
    case 'safe':
      return 'food safe';
    case 'openPore':
      return 'open pore — hard to clean';
    case 'contested':
      return 'sources disagree';
    case 'avoid':
      return 'avoid for food contact';
    default:
      return status;
  }
}
