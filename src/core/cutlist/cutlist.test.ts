import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluate } from '../geometry/evaluate.js';
import { checkerboard } from '../generators/checkerboard.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { PRECISION, formatLimit, formatTicks, inches, toInches } from '../units/ticks.js';
import { buildCutList, formatCutList } from './cutlist.js';
import { buildInstructions, formatInstructions } from './instructions.js';
import { formatLedger } from './ledger.js';

function reference(overrides: Record<string, unknown> = {}) {
  const { graph } = checkerboard(
    {
      cellSize: inches(1.5),
      speciesA: 'hard-maple',
      speciesB: 'black-walnut',
      columns: 8,
      rows: 10,
      boardThickness: inches(1.5),
      ...overrides,
    },
    DEFAULT_SHOP,
  );
  const evaluated = evaluate(graph, DEFAULT_SHOP);
  const list = buildCutList(graph, evaluated, DEFAULT_SHOP, {
    name: 'reference board',
    precision: PRECISION.THIRTY_SECOND,
  });
  const steps = buildInstructions(graph, evaluated, DEFAULT_SHOP);
  return { graph, evaluated, list, steps };
}

/* -------------------------------------------------------------------------- */
/* The allowance ledger                                                       */
/* -------------------------------------------------------------------------- */

describe('allowance ledger', () => {
  const { list } = reference();
  const section = (title: string) =>
    list.ledger.sections.find((s) => s.title.toLowerCase().startsWith(title));

  it('traces thickness backward from the finished target to the saw', () => {
    // The commonest way a board comes out wrong: slices cut at the finished
    // thickness, then flattened, ending up 1/4" thin.
    const thickness = section('thickness');
    expect(thickness?.direction).toBe('backward');
    expect(thickness?.result).toBe(inches(1.75));
    expect(thickness?.lines.map((l) => l.label)).toEqual([
      'target finished thickness',
      'flattening, 2 faces',
    ]);
  });

  it('traces width forward from the pattern to the finished size', () => {
    const width = section('width');
    expect(width?.direction).toBe('forward');
    expect(width?.result).toBe(inches(11.875));
  });

  it('derives length from the pitch, not from the slice thickness', () => {
    // The pitch is the stage-1 panel thickness -- the most counterintuitive
    // relationship in end-grain work (KB-A02).
    const length = section('length');
    expect(length?.lines[0]!.label).toMatch(/pitch/);
    expect(length?.result).toBe(inches(14.875));
  });

  it('cites the allowance that caused each line', () => {
    const thickness = section('thickness');
    expect(thickness?.lines.find((l) => l.label.includes('flattening'))?.cites).toBe('KB-A08');
  });

  it('every section reconciles: lines sum to the stated result', () => {
    for (const s of list.ledger.sections) {
      const summed = s.lines.reduce((total, line) => total + line.delta, 0);
      expect(summed, `${s.title} does not reconcile`).toBe(s.result);
    }
  });

  it('the panel-length section reconciles with the cut list', () => {
    // A ledger whose lines do not add up to the cut list is worse than none.
    const panelSection = section('stage-1 panel length');
    const ripGroup = list.groups.find((g) => g.operation.startsWith('Rip'));
    const stripLength = ripGroup?.pieces[0]?.length.asMeasured;
    expect(panelSection?.result).toBe(stripLength);
  });
});

/* -------------------------------------------------------------------------- */
/* Cut list                                                                   */
/* -------------------------------------------------------------------------- */

describe('cut list', () => {
  const { list } = reference();

  it('reports finished dimensions matching the evaluated board', () => {
    expect(formatTicks(list.finished.width.asMeasured)).toBe('11 7/8"');
    expect(formatTicks(list.finished.length.asMeasured)).toBe('14 7/8"');
    expect(formatTicks(list.finished.thickness.asMeasured)).toBe('1 1/2"');
  });

  it('reports fence settings, not cut positions', () => {
    // Nobody sets a saw by "position across the cross-section". Reporting the
    // geometry instead of the setting is how a cut list ends up right and
    // useless at the same time.
    const rip = list.groups.find((g) => g.operation.startsWith('Rip'));
    const setting = rip?.pieces[0]?.machineSetting;
    expect(setting?.machine).toBe('tablesaw-rip');
    if (setting?.machine === 'tablesaw-rip') {
      expect(setting.fenceSetting.asMeasured).toBe(inches(1.5));
    }
  });

  it('collapses identical strips into one row with a quantity', () => {
    const rip = list.groups.find((g) => g.operation.startsWith('Rip'));
    expect(rip?.pieces).toHaveLength(1);
    expect(rip?.pieces[0]?.quantity).toBe(4);
  });

  it('lands inside the expected end-grain material multiplier', () => {
    // End-grain construction runs 1.5x to 2.5x the finished volume (KB-A12).
    expect(list.summary.endGrainMultiplier).toBeGreaterThan(1.4);
    expect(list.summary.endGrainMultiplier).toBeLessThan(2.6);
  });

  it('reports board feet per species and a total', () => {
    expect(list.purchase).toHaveLength(2);
    const total = list.purchase.reduce((s, p) => s + p.boardFeet, 0);
    expect(list.summary.totalBoardFeet).toBeCloseTo(total, 9);
  });

  it('names species in plain language rather than by id', () => {
    expect(list.purchase.map((p) => p.displayName)).toContain('Hard maple');
  });

  it('renders to text without throwing', () => {
    expect(formatCutList(list)).toMatch(/SHOPPING LIST/);
    expect(formatLedger(list.ledger)).toMatch(/CUT SLICES AT/);
  });
});

/* -------------------------------------------------------------------------- */
/* Machine limits                                                             */
/* -------------------------------------------------------------------------- */

describe('machine limits are never overstated', () => {
  it('floors rather than rounds', () => {
    // 1/64" displayed at 1/32" precision would round UP to 1/32", telling
    // someone they may remove twice what the machine allows. A stated limit
    // must be achievable by definition.
    expect(formatLimit(inches(1 / 64))).toBe('1/64"');
    expect(formatTicks(inches(1 / 64))).toBe('1/32"'); // the unsafe rounding
  });

  it('never reports a limit above its true value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80_000 }), (value) => {
        const text = formatLimit(value);
        const parsed = text.endsWith('"') && text.includes('/')
          ? parseFraction(text)
          : Number.parseFloat(text);
        expect(parsed).toBeLessThanOrEqual(toInches(value) + 1e-9);
      }),
    );
  });

  it('quotes the real per-pass limit in the instructions', () => {
    const { steps } = reference();
    const flatten = steps.find((s) => s.phase === 'flatten');
    expect(flatten?.body).toMatch(/1\/64" per pass/);
    expect(flatten?.body).not.toMatch(/1\/32" per pass/);
  });
});

function parseFraction(text: string): number {
  const cleaned = text.replace(/"$/, '');
  const [whole, fraction] = cleaned.includes(' ') ? cleaned.split(' ') : ['0', cleaned];
  const [n, d] = fraction!.split('/');
  return Number(whole) + Number(n) / Number(d);
}

/* -------------------------------------------------------------------------- */
/* Instructions                                                               */
/* -------------------------------------------------------------------------- */

describe('instructions', () => {
  const { steps } = reference();

  it('orders phases from preparation to finish', () => {
    const phases = [...new Set(steps.map((s) => s.phase))];
    expect(phases).toEqual(['prepare', 'mill', 'stage1', 'crosscut', 'stage2', 'flatten', 'finish']);
  });

  it('numbers steps consecutively from one', () => {
    expect(steps.map((s) => s.number)).toEqual(steps.map((_, i) => i + 1));
  });

  it('attaches the never-planer gate to end-grain flattening', () => {
    // Derived from graph structure rather than authored into a template, so no
    // design can omit it.
    const flatten = steps.find((s) => s.phase === 'flatten');
    const critical = flatten?.safety.filter((n) => n.severity === 'critical') ?? [];
    expect(critical).toHaveLength(1);
    expect(critical[0]?.text).toMatch(/thickness planer/i);
    expect(critical[0]?.cites).toBe('KB-A08');
  });

  it('gates the crosscut on a squareness check', () => {
    const crosscut = steps.find((s) => s.phase === 'crosscut');
    expect(crosscut?.checkpoint).toMatch(/square/i);
  });

  it('gates the stage-2 glue-up on grain-orientation consistency', () => {
    const rotate = steps.find((s) => s.title.includes('Rotate every slice'));
    expect(rotate?.checkpoint).toMatch(/ring orientation/i);
    expect(rotate?.checkpoint).toMatch(/opposite of edge-grain/i);
  });

  it('computes the clamping requirement rather than asserting it', () => {
    const glue = steps.find((s) => s.title.includes('Glue the slices'));
    expect(glue?.body).toMatch(/200 psi/);
    expect(glue?.body).toMatch(/\d+ clamps at \d+ lbf/);
  });

  it('requires glue sizing, since end grain starves a joint', () => {
    const glue = steps.find((s) => s.title.includes('Glue the slices'));
    expect(glue?.body).toMatch(/let it tack/);
  });

  it('warns when the glue-up needs more clamps than the shop has', () => {
    const narrow = buildInstructions(
      reference({ columns: 20, rows: 20 }).graph,
      reference({ columns: 20, rows: 20 }).evaluated,
      { ...DEFAULT_SHOP, clampCount: 2 },
    );
    const glue = narrow.find((s) => s.title.includes('Glue the slices'));
    expect(glue?.safety.some((n) => n.text.includes('clamps'))).toBe(true);
  });

  it('renders to text without throwing', () => {
    const text = formatInstructions(steps);
    expect(text).toMatch(/CRITICAL/);
    expect(text).toMatch(/0 — Prepare/);
  });
});
