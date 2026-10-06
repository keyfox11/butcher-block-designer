/**
 * The shop profile.
 *
 * Stored separately from the design, so a shared board re-validates against
 * whoever opens it: a board that fits an 18" drum sander correctly reports as
 * too wide for a 16" one.
 *
 * Every field says which rule it feeds. Without that it is a wall of numbers
 * with no evident purpose, and nobody fills it in accurately.
 */

import type { ShopProfile, Ticks } from '../../core/model/types.js';
import { PRECISION, formatTicks, parseLength, toDegrees } from '../../core/units/ticks.js';
import { useState } from 'react';

export interface ShopProfilePanelProps {
  readonly shop: ShopProfile;
  readonly onChange: (next: ShopProfile) => void;
  readonly onReset: () => void;
}

export function ShopProfilePanel({ shop, onChange, onReset }: ShopProfilePanelProps) {
  const set = <K extends keyof ShopProfile>(key: K, value: ShopProfile[K]) =>
    onChange({ ...shop, [key]: value });

  return (
    <div className="panel">
      <h2>Shop profile</h2>
      <p className="field-hint">
        Describes your machines, not the design. Shared designs are re-checked against this, so
        nobody inherits someone else’s kerf.
      </p>

      <fieldset>
        <legend>Table saw</legend>
        <Length label="Blade kerf" value={shop.kerf} why="Consumed by every cut" onChange={(v) => set('kerf', v)} />
        <Length
          label="Max depth at 90°"
          value={shop.bladeDepthAt90}
          why="V-TOOL-010 — interpolated, not computed from cosine"
          onChange={(v) => set('bladeDepthAt90', v)}
        />
        <Length
          label="Max depth at 45°"
          value={shop.bladeDepthAt45}
          why="V-TOOL-010 — the second measured point"
          onChange={(v) => set('bladeDepthAt45', v)}
        />
        <Length
          label="Min safe rip width"
          value={shop.minSafeRipWidth}
          why="V-SAFE-030 and V-GEOM-030 — checked at BOTH faces of a bevelled strip"
          onChange={(v) => set('minSafeRipWidth', v)}
        />
        <Readout label="Max bevel" value={`${toDegrees(shop.maxBevel).toFixed(0)}°`} why="V-TOOL-030" />
      </fieldset>

      <fieldset>
        <legend>Crosscut sled</legend>
        <Length
          label="Min safe workpiece length"
          value={shop.minSafeCrosscutLength}
          why="V-SAFE-040 — short slices need a stop block and hold-down"
          onChange={(v) => set('minSafeCrosscutLength', v)}
        />
      </fieldset>

      <fieldset>
        <legend>Drum sander</legend>
        <Length
          label="Drum width"
          value={shop.drumSanderWidth}
          why="V-TOOL-050 — the board's NARROW dimension must pass under the drum"
          onChange={(v) => set('drumSanderWidth', v)}
        />
        <Length
          label="Removal per pass"
          value={shop.drumSanderRemovalPerPass}
          why="Drives the pass count; heavier cuts burn end grain"
          onChange={(v) => set('drumSanderRemovalPerPass', v)}
        />
      </fieldset>

      <fieldset>
        <legend>Clamps</legend>
        <NumberField
          label="Count"
          value={shop.clampCount}
          why="Compared against the force each glue-up needs"
          onChange={(v) => set('clampCount', v)}
        />
        <NumberField
          label="Force each (lbf)"
          value={shop.clampForceEach}
          why="Required force is target pressure × joint area"
          onChange={(v) => set('clampForceEach', v)}
        />
      </fieldset>

      <fieldset>
        <legend>Other tooling</legend>
        <Check
          label="Router"
          checked={shop.hasRouter}
          why="V-TOOL-090 — a roundover or juice groove needs one; a chamfer does not"
          onChange={(v) => set('hasRouter', v)}
        />
        <Check
          label="Drill"
          checked={shop.hasDrill}
          why="V-TOOL-090 — for feet"
          onChange={(v) => set('hasDrill', v)}
        />
      </fieldset>

      <fieldset>
        <legend>Environment</legend>
        <NumberField
          label="Seasonal moisture swing (%)"
          value={shop.moistureSwingPercent}
          why="V-MOVE-010 — drives predicted differential movement"
          onChange={(v) => set('moistureSwingPercent', v)}
        />
      </fieldset>

      <button type="button" onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  );
}

function Length({
  label,
  value,
  why,
  onChange,
}: {
  label: string;
  value: Ticks;
  why: string;
  onChange: (v: Ticks) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    try {
      const parsed = parseLength(draft);
      if (parsed.ticks > 0) onChange(parsed.ticks);
    } catch {
      /* keep the previous value */
    }
    setDraft(null);
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="text"
        value={draft ?? formatTicks(value, PRECISION.SIXTY_FOURTH)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="field-hint">{why}</span>
    </label>
  );
}

function NumberField({
  label,
  value,
  why,
  onChange,
}: {
  label: string;
  value: number;
  why: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="field-hint">{why}</span>
    </label>
  );
}

function Check({
  label,
  checked,
  why,
  onChange,
}: {
  label: string;
  checked: boolean;
  why: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field">
      <span className="radio">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </span>
      <span className="field-hint">{why}</span>
    </label>
  );
}

function Readout({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div className="field">
      <span className="field-label">
        {label} <span className="field-value">{value}</span>
      </span>
      <span className="field-hint">{why}</span>
    </div>
  );
}
