/**
 * Constructing findings.
 *
 * Extracted so a rule set can live in its own module without reaching into
 * `rules.ts` and creating a cycle. The rationale is resolved from the knowledge
 * base here rather than written by each rule, which is what guarantees a finding
 * always carries the reason it fired.
 */

import { kb, type KbId } from '../knowledge/kb.js';
import type { NodeId, PieceId } from '../model/types.js';
import type { Finding, Severity } from './types.js';

export function finding(
  rule: { id: string; cites: readonly KbId[] },
  severity: Severity,
  parts: {
    nodes?: readonly NodeId[];
    pieces?: readonly PieceId[];
    message: string;
    remedy: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
  },
): Finding {
  const primary = rule.cites[0];
  return {
    ruleId: rule.id,
    severity,
    nodes: parts.nodes ?? [],
    ...(parts.pieces === undefined ? {} : { pieces: parts.pieces }),
    message: parts.message,
    remedy: parts.remedy,
    rationale: primary ? kb(primary).text : '',
    cites: rule.cites,
    data: parts.data ?? {},
    ...(parts.dedupeKey === undefined ? {} : { dedupeKey: parts.dedupeKey }),
  };
}
