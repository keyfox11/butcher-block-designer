/**
 * Running the rule set.
 *
 * Pure and fast enough to run on every edit. Findings are ordered so the first
 * error listed is the earliest problem in the build, and deduplicated so twenty
 * identical narrow strips produce one row with a count rather than twenty rows.
 */

import { RULES } from './rules.js';
import type { Finding, Rule, ValidationContext } from './types.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export interface ValidationResult {
  readonly findings: readonly Finding[];
  /** Errors block export: the cut list is what somebody takes to the saw. */
  readonly canExport: boolean;
  readonly counts: { error: number; warning: number; info: number };
}

export function validate(
  ctx: ValidationContext,
  rules: readonly Rule[] = RULES,
): ValidationResult {
  const raw = rules.flatMap((rule) => {
    try {
      return rule.check(ctx);
    } catch (error) {
      // A rule that throws must not take down the whole panel: the user still
      // needs the other findings.
      return [
        {
          ruleId: rule.id,
          severity: 'warning' as const,
          nodes: [],
          message: `Rule ${rule.id} could not be evaluated.`,
          remedy: 'This is a defect in the tool, not in your design.',
          rationale: error instanceof Error ? error.message : String(error),
          cites: rule.cites,
          data: {},
        },
      ];
    }
  });

  const findings = sortFindings(deduplicate(raw));

  return {
    findings,
    canExport: !findings.some((f) => f.severity === 'error'),
    counts: {
      error: findings.filter((f) => f.severity === 'error').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
  };
}

/**
 * Collapse findings that differ only in which node they point at.
 *
 * Twenty narrow strips are one problem with twenty instances, not twenty
 * problems. A panel that lists them separately buries everything else.
 */
function deduplicate(findings: readonly Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.ruleId}::${f.dedupeKey ?? f.message}`;
    const group = groups.get(key) ?? [];
    group.push(f);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    if (group.length === 1) return first;
    return {
      ...first,
      nodes: group.flatMap((f) => f.nodes),
      data: { ...first.data, occurrences: group.length },
    };
  });
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export { RULES } from './rules.js';
export type { Finding, Rule, Severity, ValidationContext } from './types.js';
