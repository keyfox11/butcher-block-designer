/**
 * Tier-1 parameter editing: pick a pattern, adjust it, see the result.
 *
 * Dimensions are entered as woodworking fractions. "1 1/2", "1-1/2" and "1.5"
 * all work, and the field shows back what the user will actually measure.
 */

import { useState } from 'react';
import { SPECIES } from '../../core/knowledge/species.js';
import type { SpeciesId, Ticks } from '../../core/model/types.js';
import { PRECISION, formatTicks, parseLength, toInches } from '../../core/units/ticks.js';

export interface BoardParams {
  readonly cellSize: Ticks;
  readonly speciesA: SpeciesId;
  readonly speciesB: SpeciesId;
  readonly columns: number;
  readonly rows: number;
  readonly boardThickness: Ticks;
  readonly bond: 'checker' | 'brick';
}

export interface ParameterPanelProps {
  readonly params: BoardParams;
  readonly onChange: (next: BoardParams) => void;
}

export function ParameterPanel({ params, onChange }: ParameterPanelProps) {
  return (
    <div className="panel">
      <h2>Pattern</h2>

      <fieldset>
        <legend>Bond</legend>
        {(['checker', 'brick'] as const).map((bond) => (
          <label key={bond} className="radio">
            <input
              type="radio"
              name="bond"
              checked={params.bond === bond}
              onChange={() => onChange({ ...params, bond })}
            />
            {bond === 'checker' ? 'Checkerboard' : 'Brick / running bond'}
          </label>
        ))}
      </fieldset>

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
          params.bond === 'checker' && params.columns % 2 === 1
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
    </div>
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
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
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
          {info.movementCoefficient === null
            ? 'not recorded'
            : info.movementCoefficient.toFixed(5)}{' '}
          · {foodSafetyLabel(info.foodSafety)}
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

export { toInches };
