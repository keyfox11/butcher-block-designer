/**
 * Validation rules, as data.
 *
 * Every rule cites a knowledge-base entry, and the citation is enforced by a
 * test. A rule with no citation means somebody encoded an opinion, which is
 * exactly what this structure exists to prevent.
 */

import type { EvalResult } from '../geometry/evaluate.js';
import type { KbId } from '../knowledge/kb.js';
import type { NodeId, PieceId, Project, ShopProfile } from '../model/types.js';

export type Severity = 'error' | 'warning' | 'info';

export type RuleCategory = 'safety' | 'tooling' | 'geometry' | 'grain' | 'movement' | 'dimension' | 'food' | 'material' | 'tolerance';

export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  /** Nodes at fault, so the UI can highlight them in the graph. */
  readonly nodes: readonly NodeId[];
  /** Pieces at fault, so the UI can highlight them on the 2-D canvas. */
  readonly pieces?: readonly PieceId[];
  readonly message: string;
  readonly remedy: string;
  /** Resolved citation text, so the user reads *why* without leaving the panel. */
  readonly rationale: string;
  readonly cites: readonly KbId[];
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * Groups findings that are the same problem seen in several places.
   *
   * Defaults to the message, which is wrong whenever the message carries an
   * instance detail such as a strip index -- so rules that aggregate set it
   * explicitly rather than relying on their text happening to match.
   */
  readonly dedupeKey?: string;
}

export interface ValidationContext {
  readonly project: Project;
  readonly evaluated: EvalResult;
  readonly shop: ShopProfile;
}

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  /** Must be non-empty, and every id must resolve. Enforced by test. */
  readonly cites: readonly KbId[];
  readonly check: (ctx: ValidationContext) => Finding[];
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}

export function bySeverity(findings: readonly Finding[]): Record<Severity, Finding[]> {
  return {
    error: findings.filter((f) => f.severity === 'error'),
    warning: findings.filter((f) => f.severity === 'warning'),
    info: findings.filter((f) => f.severity === 'info'),
  };
}
