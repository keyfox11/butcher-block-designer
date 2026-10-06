import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOP } from '../model/defaults.js';
import type { ShopProfile, SpeciesId } from '../model/types.js';
import { inches } from '../units/ticks.js';
import { MOVEMENT_RULES } from './movement.js';
import type { Finding, ValidationContext } from './types.js';

const RULE = Object.fromEntries(MOVEMENT_RULES.map((r) => [r.id, r]));

/**
 * A board of the given size whose face is divided between species by area.
 *
 * Fabricated rather than generated, because these fixtures are about species
 * mixes and board sizes — not about construction graphs. Driving them through a
 * generator would make the test depend on whichever pattern happened to produce
 * the right proportions, which is a worse test of the same arithmetic.
 */
function board(
  widthIn: number,
  lengthIn: number,
  mix: Record<SpeciesId, number>,
  shop: ShopProfile = DEFAULT_SHOP,
): ValidationContext {
  const width = inches(widthIn);
  const length = inches(lengthIn);

  // Vertical bands, each as wide as its share. The rule reads face AREA, so the
  // layout does not matter — only the proportions do.
  let x = 0;
  const faces = Object.entries(mix).map(([species, share], i) => {
    const w = Math.round(width * share);
    const polygon = [
      { x, y: 0 },
      { x: x + w, y: 0 },
      { x: x + w, y: length },
      { x, y: length },
    ];
    x += w;
    return { polygon, species, pieceId: `p${i}`, ringOrientation: 'quartersawn' as const };
  });

  const outline = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];

  return {
    project: {} as never,
    shop,
    evaluated: {
      workpiece: {
        crossSection: { outline, faces },
        length: inches(1.5),
        orientation: 'endGrain',
        producedBy: 'n1',
      },
      nodeOutputs: new Map(),
      memberPlacements: new Map(),
    } as never,
  };
}

const check = (id: string, ctx: ValidationContext): Finding[] => RULE[id]!.check(ctx);
const ids = (f: Finding[]) => f.map((x) => `${x.severity}:${x.ruleId}`);

/* -------------------------------------------------------------------------- */
/* V-MOVE-010 — the calibration fixtures from the spec                         */
/* -------------------------------------------------------------------------- */

describe('V-MOVE-010 — no false positives on the classics', () => {
  it('is silent for maple/walnut 50:50 at 12" x 16"', () => {
    const f = check('V-MOVE-010', board(12, 16, { 'hard-maple': 0.5, 'black-walnut': 0.5 }));
    expect(f).toEqual([]);
  });

  it('is silent for the classic three-wood palette at 24"', () => {
    const f = check(
      'V-MOVE-010',
      board(24, 24, { 'hard-maple': 1 / 3, 'black-walnut': 1 / 3, 'black-cherry': 1 / 3 }),
    );
    expect(f).toEqual([]);
  });

  it('is silent for cherry/walnut, the gentlest pair', () => {
    expect(check('V-MOVE-010', board(24, 24, { 'black-cherry': 0.5, 'black-walnut': 0.5 }))).toEqual(
      [],
    );
  });

  it('weights by proportion: a 2% padauk pinstripe at 20" is fine', () => {
    // The whole reason for share weighting. An unweighted gap metric would
    // score this identically to a 50:50 maple/padauk board.
    const f = check('V-MOVE-010', board(20, 20, { 'hard-maple': 0.98, padauk: 0.02 }));
    expect(f).toEqual([]);
  });
});

describe('V-MOVE-010 — what it should catch', () => {
  it('warns on maple/padauk 50:50 at 16", and blames the palette', () => {
    const f = check('V-MOVE-010', board(16, 16, { 'hard-maple': 0.5, padauk: 0.5 }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('warning');
    expect(f[0]!.data.driver).toBe('palette');
    expect(f[0]!.data.tier).toBe('elevated');
    expect(f[0]!.message).toMatch(/differ in seasonal movement/);
    expect(f[0]!.remedy).toMatch(/maple\/walnut\/cherry palette spans only 1\.42/);
  });

  it('warns on maple/walnut 50:50 at 40", and blames the size instead', () => {
    const f = check('V-MOVE-010', board(40, 40, { 'hard-maple': 0.5, 'black-walnut': 0.5 }));
    expect(f).toHaveLength(1);
    expect(f[0]!.data.driver).toBe('size');
    expect(f[0]!.message).toMatch(/reasonably matched/);
    expect(f[0]!.remedy).toMatch(/Reducing the largest dimension/);
  });

  it('escalates the wording, but never the severity, when it is extreme', () => {
    const f = check('V-MOVE-010', board(36, 36, { 'hard-maple': 0.5, padauk: 0.5 }));
    expect(f[0]!.data.tier).toBe('severe');
    // The maker is entitled to accept this risk; maple/padauk boards get built.
    expect(f[0]!.severity).toBe('warning');
    expect(f[0]!.message).toMatch(/beyond the range demonstrated by common practice/);
  });

  it('reproduces the spec calibration table', () => {
    const at = (mix: Record<SpeciesId, number>, dim: number) => {
      const f = check('V-MOVE-010', board(dim, dim, mix));
      const warn = f.find((x) => x.severity === 'warning');
      return warn ? Number(warn.data.differential) : null;
    };
    // Only the rows that warn report a number; the rest are verified silent above.
    expect(at({ 'hard-maple': 0.5, padauk: 0.5 }, 16)).toBeCloseTo(0.166, 3);
    expect(at({ 'hard-maple': 0.5, padauk: 0.5 }, 20)).toBeCloseTo(0.208, 3);
    expect(at({ 'hard-maple': 0.5, padauk: 0.5 }, 24)).toBeCloseTo(0.249, 3);
  });
});

describe('V-MOVE-010 — guards', () => {
  it('performs no arithmetic for a single species, at any size', () => {
    expect(check('V-MOVE-010', board(40, 40, { 'hard-maple': 1 }))).toEqual([]);
  });

  it('gives the same answer whether shares sum to 1.00 or 0.98', () => {
    const exact = check('V-MOVE-010', board(16, 16, { 'hard-maple': 0.5, padauk: 0.5 }));
    const drifted = check('V-MOVE-010', board(16, 16, { 'hard-maple': 0.49, padauk: 0.49 }));
    expect(Number(drifted[0]!.data.spread)).toBeCloseTo(Number(exact[0]!.data.spread), 9);
  });

  it('says so rather than guessing when a species has no sourced data', () => {
    // Sapele, beech, red oak and cocobolo carry null coefficients on purpose.
    const f = check('V-MOVE-010', board(16, 16, { 'hard-maple': 0.5, sapele: 0.5 }));
    const note = f.find((x) => x.ruleId === 'V-MOVE-010' && x.severity === 'info');
    expect(note).toBeDefined();
    expect(note!.message).toMatch(/No sourced movement data for Sapele/);
    expect(note!.remedy).toMatch(/lower bound/);
  });

  it('is silent on a long-grain workpiece, which moves differently', () => {
    const ctx = board(40, 40, { 'hard-maple': 0.5, padauk: 0.5 });
    const longGrain = {
      ...ctx,
      evaluated: {
        ...ctx.evaluated,
        workpiece: { ...ctx.evaluated.workpiece, orientation: 'longGrain' },
      },
    } as unknown as ValidationContext;
    expect(check('V-MOVE-010', longGrain)).toEqual([]);
  });

  it('scales with the shop profile rather than assuming a swing', () => {
    const stable = { ...DEFAULT_SHOP, moistureSwingPercent: 3 };
    expect(check('V-MOVE-010', board(16, 16, { 'hard-maple': 0.5, padauk: 0.5 }, stable))).toEqual(
      [],
    );
  });
});

/* -------------------------------------------------------------------------- */
/* V-MOVE-020 and V-MOVE-030 — absolute movement                               */
/* -------------------------------------------------------------------------- */

describe('V-MOVE-020 — stating what is normal', () => {
  it('reproduces the worked example: a 12" maple board moves about a quarter inch', () => {
    const f = check('V-MOVE-020', board(12, 12, { 'hard-maple': 1 }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('info');
    expect(Number(f[0]!.data.movement)).toBeCloseTo(0.254, 3);
    // It must read as normal behaviour, or it trains people to ignore findings.
    expect(f[0]!.message).toMatch(/normal behaviour for end grain, not a fault/);
  });

  it('says both directions move, which is the end-grain surprise', () => {
    const f = check('V-MOVE-020', board(12, 16, { 'hard-maple': 1 }));
    expect(f[0]!.message).toMatch(/both face directions/);
  });

  it('is quiet on a board too small for it to matter', () => {
    expect(check('V-MOVE-020', board(5, 5, { 'black-cherry': 1 }))).toEqual([]);
  });
});

describe('V-MOVE-030 — beyond demonstrated practice', () => {
  it('is quiet at 24", about the largest end-grain board people report', () => {
    expect(check('V-MOVE-030', board(24, 24, { 'hard-maple': 1 }))).toEqual([]);
  });

  it('warns at 30" and says where the demonstrated range ends', () => {
    const f = check('V-MOVE-030', board(30, 30, { 'hard-maple': 1 }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('warning');
    expect(Number(f[0]!.data.movement)).toBeCloseTo(0.635, 3);
    // Not "shrink it by half an inch", which is what naming the exact
    // threshold-crossing dimension would amount to for a board barely over.
    expect(f[0]!.remedy).toMatch(/demonstrated range tops out around 29\.5/);
  });

  it('allows a bigger board in a gentler wood, which is the point of scaling it', () => {
    // Cherry moves 30% less than maple, so it earns about 12" more board.
    expect(check('V-MOVE-030', board(30, 30, { 'black-cherry': 1 }))).toEqual([]);
    expect(check('V-MOVE-030', board(44, 44, { 'black-cherry': 1 }))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('the rule set as a whole', () => {
  it('leaves the classic palette at a normal size with nothing but context', () => {
    const ctx = board(12, 16, { 'hard-maple': 0.5, 'black-walnut': 0.5 });
    const all = MOVEMENT_RULES.flatMap((r) => r.check(ctx));
    expect(ids(all)).toEqual(['info:V-MOVE-020']);
  });

  it('never blocks export: wood movement is a risk the maker may accept', () => {
    const ctx = board(40, 40, { 'hard-maple': 0.5, padauk: 0.5 });
    const all = MOVEMENT_RULES.flatMap((r) => r.check(ctx));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f) => f.severity !== 'error')).toBe(true);
  });
});
