/**
 * The allowance ledger.
 *
 * The most common way a cutting board comes out wrong is an allowance that was
 * never written down: someone cuts slices at the finished thickness, flattens
 * the board, and ends up 1/4" thin.
 *
 * So allowances are not applied silently inside a formula. Every finished
 * dimension traces back to rough stock one line at a time, with each line
 * naming its cause -- which means any number in the cut list can be checked.
 */

import { boardDimensions, type EvalResult } from '../geometry/evaluate.js';
import type { KbId } from '../knowledge/kb.js';
import { SPECIES } from '../knowledge/species.js';
import type { Graph, ShopProfile, Ticks } from '../model/types.js';
import { formatTicks, ticks } from '../units/ticks.js';
import { analyze } from './analyze.js';

export interface LedgerLine {
  readonly label: string;
  /** The contribution this line makes. Signed. */
  readonly delta: number;
  /** Running total after this line. */
  readonly running: number;
  readonly kind: 'start' | 'add' | 'subtract' | 'result';
  /** Why this allowance exists. */
  readonly cites?: KbId;
}

export interface LedgerSection {
  readonly title: string;
  /**
   * Pattern-driven dimensions flow forward (the designer picks them and the
   * finished size follows); allowance-driven ones flow backward (the finished
   * target is fixed and the cut dimension follows). Conflating the two is what
   * produces "why is my board 11 7/8 when I asked for 12?".
   */
  readonly direction: 'forward' | 'backward';
  readonly lines: readonly LedgerLine[];
  readonly resultLabel: string;
  readonly result: number;
}

export interface AllowanceLedger {
  readonly sections: readonly LedgerSection[];
}

class SectionBuilder {
  private readonly lines: LedgerLine[] = [];
  private running = 0;

  constructor(
    private readonly title: string,
    private readonly direction: 'forward' | 'backward',
  ) {}

  start(label: string, value: number): this {
    this.running = value;
    this.lines.push({ label, delta: value, running: value, kind: 'start' });
    return this;
  }

  add(label: string, value: number, cites?: KbId): this {
    this.running += value;
    this.lines.push({
      label,
      delta: value,
      running: this.running,
      kind: 'add',
      ...(cites === undefined ? {} : { cites }),
    });
    return this;
  }

  subtract(label: string, value: number, cites?: KbId): this {
    this.running -= value;
    this.lines.push({
      label,
      delta: -value,
      running: this.running,
      kind: 'subtract',
      ...(cites === undefined ? {} : { cites }),
    });
    return this;
  }

  finish(resultLabel: string): LedgerSection {
    return {
      title: this.title,
      direction: this.direction,
      lines: this.lines,
      resultLabel,
      result: this.running,
    };
  }
}

export function buildLedger(
  graph: Graph,
  evaluated: EvalResult,
  shop: ShopProfile,
): AllowanceLedger {
  const a = analyze(graph);
  const sections: LedgerSection[] = [];
  const dims = boardDimensions(evaluated.workpiece);

  /* ---- Thickness: allowance-driven, backward ---------------------------- */

  const crosscut = a.crosscuts[0];
  const flatten = a.flattens.find((f) => f.op.method === 'drumSander') ?? a.flattens[0];

  if (crosscut && flatten) {
    const perFace = flatten.op.removePerFace;
    sections.push(
      new SectionBuilder('Thickness', 'backward')
        .start('target finished thickness', dims.thickness)
        .add('flattening, 2 faces', 2 * perFace, 'KB-A08')
        .finish('CUT SLICES AT'),
    );
  }

  /* ---- Width and length -------------------------------------------------- */

  /**
   * A non-grid lay-up has neither a panel width nor a pitch.
   *
   * The two sections below encode the two-stage grid: the finished width is the
   * stage-1 panel's width, and the finished length is the slice count times the
   * panel thickness. Both are exactly right for a checkerboard and meaningless
   * for a honeycomb, where the stage-1 assembly is a hex prism three inches
   * across and consecutive pucks sit in the same row, so the pitch reads zero.
   *
   * Left unguarded this produced a cut list stating a 3" x 0" board next to a
   * picture of a 12" x 15" one -- the precise divergence this whole design
   * exists to prevent. For these patterns the two dimensions come from the
   * lay-up's own extent, measured on the evaluated geometry, less the trim.
   */
  const freeLayUp = a.finalLaminate?.op.placement === 'free' ? a.finalLaminate : null;

  if (freeLayUp) {
    const extent = layUpExtent(evaluated, freeLayUp.id);
    const label = freeLayUp.label ?? 'lay-up';
    for (const axis of ['width', 'length'] as const) {
      const laid = axis === 'width' ? extent.width : extent.height;
      const finished = axis === 'width' ? dims.width : dims.length;
      const section = new SectionBuilder(
        axis === 'width' ? 'Width' : 'Length',
        'forward',
      ).start(`${label}, measured across`, laid);
      if (laid > finished) {
        section.subtract('trim the ragged border to straight sides', laid - finished, 'KB-A05');
      }
      sections.push(section.finish(`finished ${axis}`));
    }
  }

  const panel = freeLayUp ? null : a.stagePanels[0];
  if (panel) {
    const stripCount = panel.op.members.length;
    const panelWidth = panelWidthOf(graph, evaluated, panel.id);
    const widthTrim = dims.width - panelWidth;

    const width = new SectionBuilder('Width', 'forward').start(
      `${stripCount} strips glued edge to edge`,
      panelWidth,
    );
    if (widthTrim < 0) width.subtract('squaring trim, 2 edges', -widthTrim);
    sections.push(width.finish('finished width'));
  }

  /* ---- Length: pattern-driven, via the pitch ---------------------------- */

  if (a.finalLaminate && !freeLayUp) {
    const sliceCount = a.finalLaminate.op.members.length;
    const pitch = pitchOf(graph, evaluated, a.finalLaminate.id);
    const gross = sliceCount * pitch;
    const lengthTrim = dims.length - gross;

    const length = new SectionBuilder('Length', 'forward').start(
      `${sliceCount} slices × ${formatTicks(ticks(pitch))} pitch`,
      gross,
    );
    if (lengthTrim < 0) length.subtract('end trim, 2 ends', -lengthTrim);
    sections.push(length.finish('finished length'));
  }

  /* ---- Panel length: allowance-driven, backward ------------------------- */

  if (crosscut) {
    const count = crosscut.op.count ?? 0;
    const kerfs = Math.max(count - 1, 0);
    const section = new SectionBuilder('Stage-1 panel length', 'backward')
      .start(
        `${count} slices × ${formatTicks(crosscut.op.sliceLength)}`,
        count * crosscut.op.sliceLength,
      )
      .add(`${kerfs} internal kerfs`, kerfs * shop.kerf, 'KB-A02');

    // Reconcile against the panel the graph actually builds. Without this the
    // section states a minimum while the cut list reports a longer strip, and
    // a ledger whose lines do not add up to the cut list is worse than none.
    const actual = evaluated.nodeOutputs.get(crosscut.op.input.node)?.[crosscut.op.input.port];
    if (actual) {
      const squaring = actual.length - (count * crosscut.op.sliceLength + kerfs * shop.kerf);
      if (squaring > 0) section.add('allowance to square the ends', squaring, 'KB-A09');
    }
    sections.push(section.finish('PANEL LENGTH'));
  }

  /* ---- Stock per species: backward -------------------------------------- */

  for (const billet of a.billets) {
    const { rough, milled, species } = billet.op;
    const name = SPECIES[species]?.name ?? species;
    sections.push(
      new SectionBuilder(`Stock — ${name} (width)`, 'backward')
        .start('milled width', milled.width)
        .add('milling allowance', rough.width - milled.width, 'KB-A12')
        .finish('rough width to buy'),
    );
    sections.push(
      new SectionBuilder(`Stock — ${name} (thickness)`, 'backward')
        .start('milled thickness', milled.thickness)
        .add('milling allowance', rough.thickness - milled.thickness, 'KB-A12')
        .finish('rough thickness to buy'),
    );
  }

  return { sections };
}

/** Extent of a lay-up before trimming, read off the evaluated geometry. */
function layUpExtent(evaluated: EvalResult, id: string): { width: number; height: number } {
  const piece = evaluated.nodeOutputs.get(id)?.[0];
  if (!piece) return { width: 0, height: 0 };
  const xs = piece.crossSection.outline.map((p) => p.x);
  const ys = piece.crossSection.outline.map((p) => p.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Width of a stage-1 panel, read from the evaluated workpiece at that node. */
function panelWidthOf(graph: Graph, evaluated: EvalResult, id: string): number {
  const outputs = evaluated.nodeOutputs.get(id);
  const piece = outputs?.[0];
  if (!piece) return 0;
  void graph;
  const bounds = piece.crossSection.outline;
  const xs = bounds.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * The pitch: how much each rotated slice contributes to the finished length.
 *
 * It is the stage-1 panel's thickness, which is the single most counterintuitive
 * relationship in end-grain work (KB-A02).
 */
function pitchOf(graph: Graph, evaluated: EvalResult, laminateId: string): number {
  const node = graph.nodes[laminateId];
  if (!node || node.op.kind !== 'laminate') return 0;
  const members = node.op.members;
  if (members.length < 2) return 0;
  const first = members[0]!;
  const second = members[1]!;
  void evaluated;
  return Math.abs(second.offset.y - first.offset.y);
}

/** Render a ledger as plain text, for the printed cut list and for tests. */
export function formatLedger(ledger: AllowanceLedger): string {
  const out: string[] = [];
  for (const section of ledger.sections) {
    out.push(`${section.title.toUpperCase()}  (${section.direction})`);
    for (const line of section.lines) {
      const sign = line.kind === 'add' ? '+' : line.kind === 'subtract' ? '−' : ' ';
      out.push(`  ${sign} ${line.label.padEnd(36)} ${formatTicks(ticks(Math.abs(line.delta)))}`);
    }
    out.push(`  ${'='.repeat(46)}`);
    out.push(`    ${section.resultLabel.padEnd(36)} ${formatTicks(ticks(section.result))}`);
    out.push('');
  }
  return out.join('\n');
}

export type { Ticks };
