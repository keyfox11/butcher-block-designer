/**
 * The findings panel.
 *
 * Always present, never a modal. Every finding shows its rationale inline, so
 * the user reads *why* without going looking -- which is the difference between
 * a tool that teaches and one that nags.
 */

import type { Finding } from '../../core/validation/types.js';

export interface FindingsPanelProps {
  readonly findings: readonly Finding[];
  readonly counts: { error: number; warning: number; info: number };
  readonly canExport: boolean;
  readonly onSelect?: (finding: Finding) => void;
}

const LABELS = {
  error: { icon: '⛔', title: 'errors' },
  warning: { icon: '⚠', title: 'warnings' },
  info: { icon: 'ℹ', title: 'notes' },
} as const;

export function FindingsPanel({ findings, counts, canExport, onSelect }: FindingsPanelProps) {
  if (findings.length === 0) {
    return (
      <div className="panel">
        <h2>Checks</h2>
        <p className="all-clear">No issues found. This design is ready to build.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Checks</h2>
      {!canExport && (
        <p className="export-blocked">
          Export is blocked while errors remain. The cut list is what you take to the saw.
        </p>
      )}

      {(['error', 'warning', 'info'] as const).map((severity) => {
        const group = findings.filter((f) => f.severity === severity);
        if (group.length === 0) return null;
        return (
          <section key={severity} className={`findings findings-${severity}`}>
            <h3>
              {LABELS[severity].icon} {counts[severity]} {LABELS[severity].title}
            </h3>
            <ul>
              {group.map((f, index) => (
                <li key={`${f.ruleId}-${index}`}>
                  <button type="button" className="finding" onClick={() => onSelect?.(f)}>
                    <code>{f.ruleId}</code>
                    <span className="finding-message">{f.message}</span>
                    {typeof f.data['occurrences'] === 'number' && (
                      <span className="finding-count">×{f.data['occurrences']}</span>
                    )}
                  </button>
                  <p className="finding-remedy">→ {f.remedy}</p>
                  {f.rationale && (
                    <details className="finding-why">
                      <summary>Why</summary>
                      <p>{f.rationale}</p>
                      <p className="finding-cites">{f.cites.join(', ')}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
