/**
 * The printed shop document.
 *
 * Target: a woodworker prints this, carries it to the shop, and never needs
 * the screen again. Monochrome-safe, machine settings in large type, and no
 * step or table split across a page break.
 */

import type { AssemblyMap } from '../../core/cutlist/assembly.js';
import type { CutList } from '../../core/cutlist/cutlist.js';
import { AssemblyMapSheet } from './AssemblyMapSheet.js';
import { describeSetting } from '../../core/cutlist/cutlist.js';
import { PHASE_TITLES, type Phase, type Step } from '../../core/cutlist/instructions.js';
import { SPECIES } from '../../core/knowledge/species.js';
import type { Finding } from '../../core/validation/types.js';
import { formatTicks, ticks } from '../../core/units/ticks.js';

export interface PrintSheetProps {
  readonly cutList: CutList;
  readonly steps: readonly Step[];
  readonly findings: readonly Finding[];
  readonly assemblyMaps: readonly AssemblyMap[];
}

export function PrintSheet({ cutList, steps, findings, assemblyMaps }: PrintSheetProps) {
  const warnings = findings.filter((f) => f.severity === 'warning');

  return (
    <article className="print-sheet">
      <header className="print-cover">
        <h1>{cutList.boardName}</h1>
        <p className="print-dims">
          {formatTicks(cutList.finished.width.asMeasured)} ×{' '}
          {formatTicks(cutList.finished.length.asMeasured)} ×{' '}
          {formatTicks(cutList.finished.thickness.asMeasured)}
        </p>
        {/* The legend is a palette key: one entry per species, with that
            species' total. `purchase` carries one line per BILLET, which for a
            generated design happened to be one per species and for a painted
            one is several -- a free-paint board can want four panels, each with
            its own stock thickness. Keying on species alone also meant React
            saw duplicate keys and was free to drop rows. */}
        <dl className="print-legend">
          {totalBySpecies(cutList.purchase).map((line) => (
            <div key={line.species}>
              <dt>
                <span className="swatch" style={{ background: SPECIES[line.species]?.color }} />
                {line.displayName}
              </dt>
              <dd>{line.boardFeet.toFixed(2)} bd ft</dd>
            </div>
          ))}
        </dl>

        {/* Warnings travel with the export, so a design exported with known
            compromises carries them to the bench. */}
        {warnings.length > 0 && (
          <section className="print-warnings">
            <h2>Warnings carried into this build</h2>
            <ul>
              {warnings.map((f, i) => (
                <li key={i}>
                  <strong>{f.ruleId}</strong> {f.message} <em>{f.remedy}</em>
                </li>
              ))}
            </ul>
          </section>
        )}
      </header>

      <section className="print-section">
        <h2>Shopping list</h2>
        <table>
          <thead>
            <tr>
              <th>Species</th>
              <th>Rough stock</th>
              <th className="num">Board feet</th>
            </tr>
          </thead>
          <tbody>
            {/* One row per board to buy, so the same species appears as many
                times as it has distinct rough sizes. That is what you take to
                the yard -- but it means the key has to carry the position. */}
            {cutList.purchase.map((line, i) => (
              <tr key={`${line.species}-${i}`}>
                <td>{line.displayName}</td>
                <td>
                  {formatTicks(line.rough.thickness)} × {formatTicks(line.rough.width)} ×{' '}
                  {formatTicks(line.rough.length)}
                </td>
                <td className="num">{line.boardFeet.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="total">
              <td colSpan={2}>Total</td>
              <td className="num">{cutList.summary.totalBoardFeet.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="print-note">
          End-grain construction uses {cutList.summary.endGrainMultiplier.toFixed(2)}× the finished
          volume. Yield from rough stock is typically around 65%, so buy with a margin.
        </p>
      </section>

      <section className="print-section">
        <h2>Allowance ledger</h2>
        <p className="print-note">
          Every finished dimension traced back to rough stock, so any number here can be checked.
        </p>
        {/* Section titles repeat once a design has more than one billet of a
            species -- "Stock — Black walnut (width)" four times over. */}
        {cutList.ledger.sections.map((section, i) => (
          <table key={`${section.title}-${i}`} className="ledger">
            <caption>
              {section.title} <span className="direction">({section.direction})</span>
            </caption>
            <tbody>
              {section.lines.map((line, i) => (
                <tr key={i}>
                  <td className="sign">
                    {line.kind === 'add' ? '+' : line.kind === 'subtract' ? '−' : ''}
                  </td>
                  <td>{line.label}</td>
                  <td className="num">{formatTicks(ticks(Math.abs(line.delta)))}</td>
                </tr>
              ))}
              <tr className="total">
                <td />
                <td>{section.resultLabel}</td>
                <td className="num">{formatTicks(ticks(section.result))}</td>
              </tr>
            </tbody>
          </table>
        ))}
      </section>

      <section className="print-section">
        <h2>Cut list</h2>
        {cutList.groups.map((group) => (
          <div key={group.fromNode} className="cut-group">
            <h3>{group.operation}</h3>
            <table>
              <thead>
                <tr>
                  <th className="num">Qty</th>
                  <th>Thickness</th>
                  <th>Width</th>
                  <th>Length</th>
                  <th>Machine setting</th>
                </tr>
              </thead>
              <tbody>
                {group.pieces.map((piece) => (
                  <tr key={piece.pieceId}>
                    <td className="num">{piece.quantity}</td>
                    <td>{formatTicks(piece.thickness.asMeasured)}</td>
                    <td>{formatTicks(piece.width.asMeasured)}</td>
                    <td>{formatTicks(piece.length.asMeasured)}</td>
                    <td className="setting">{describeSetting(piece.machineSetting)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="print-section">
        <h2>Build instructions</h2>
        {groupByPhase(steps).map(([phase, phaseSteps]) => (
          <div key={phase} className="phase">
            <h3>{PHASE_TITLES[phase]}</h3>
            {phaseSteps.map((step) => (
              <div key={step.number} className="step">
                <h4>
                  <span className="step-number">{step.number}</span> {step.title}
                </h4>
                <p>{step.body}</p>
                {step.machineSetting && (
                  <p className="step-setting">{describeSetting(step.machineSetting)}</p>
                )}
                {step.safety.map((note, i) => (
                  <p
                    key={i}
                    className={note.severity === 'critical' ? 'safety-critical' : 'safety-note'}
                  >
                    {note.severity === 'critical' ? 'CRITICAL' : 'Note'}: {note.text}
                  </p>
                ))}
                {step.checkpoint && <p className="step-check">Check: {step.checkpoint}</p>}
                {step.wait && (
                  <p className="step-wait">
                    Wait: {step.wait.duration} — {step.wait.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <AssemblyMapSheet maps={assemblyMaps} />

      <section className="print-section">
        <h2>Care</h2>
        <p>
          Wash by hand and dry immediately; never put the board in a dishwasher or leave it
          standing in water. Re-oil whenever water stops beading on the surface — food-grade
          mineral oil, left to soak twenty minutes and wiped back.
        </p>
        <p>
          Seasonal movement of up to a quarter inch across the width is normal, not a fault. Keep
          the board off a wet counter so the underside can breathe.
        </p>
      </section>
    </article>
  );
}

function groupByPhase(steps: readonly Step[]): Array<[Phase, Step[]]> {
  const order: Phase[] = [];
  const map = new Map<Phase, Step[]>();
  for (const step of steps) {
    if (!map.has(step.phase)) {
      map.set(step.phase, []);
      order.push(step.phase);
    }
    map.get(step.phase)!.push(step);
  }
  return order.map((phase) => [phase, map.get(phase)!]);
}

/**
 * Board feet per species, for the cover legend.
 *
 * `CutList.purchase` is one line per billet, which is right for the shopping
 * table -- you buy boards, not species. The legend is a different thing: a
 * colour key the reader uses to decode the drawings, so it wants one entry per
 * species carrying that species' total.
 */
function totalBySpecies(
  purchase: readonly { species: string; displayName: string; boardFeet: number }[],
): Array<{ species: string; displayName: string; boardFeet: number }> {
  const totals = new Map<string, { species: string; displayName: string; boardFeet: number }>();
  for (const line of purchase) {
    const existing = totals.get(line.species);
    if (existing) existing.boardFeet += line.boardFeet;
    else totals.set(line.species, { ...line });
  }
  return [...totals.values()];
}
