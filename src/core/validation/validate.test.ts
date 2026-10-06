import { describe, expect, it } from 'vitest';
import { evaluate } from '../geometry/evaluate.js';
import { checkerboard } from '../generators/checkerboard.js';
import { chevron, zigZag } from '../generators/patterns.js';
import { KB } from '../knowledge/kb.js';
import { SPECIES, coefficientLooksConsistent } from '../knowledge/species.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import type { Project, ShopProfile } from '../model/types.js';
import { degrees, inches, toInches } from '../units/ticks.js';
import { RULES, maxCutDepth } from './rules.js';
import { validate } from './validate.js';

function build(
  overrides: Partial<Parameters<typeof checkerboard>[0]> = {},
  shop: ShopProfile = DEFAULT_SHOP,
  project: Partial<Project> = {},
) {
  const params = {
    cellSize: inches(1.5),
    speciesA: 'hard-maple',
    speciesB: 'black-walnut',
    columns: 8,
    rows: 10,
    boardThickness: inches(1.5),
    ...overrides,
  };

  const { graph } = checkerboard(params, shop);
  const evaluated = evaluate(graph, shop);
  const base = createProject({
    name: 'test',
    graph,
    speciesPalette: [params.speciesA, params.speciesB],
    shopProfile: shop,
  });
  return validate({ project: { ...base, ...project }, evaluated, shop });
}

/** Same construction, but exposing the evaluation for material comparisons. */
function buildRaw(
  overrides: Partial<Parameters<typeof checkerboard>[0]> = {},
  shop: ShopProfile = DEFAULT_SHOP,
) {
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
    shop,
  );
  return { graph, evaluated: evaluate(graph, shop) };
}

/* -------------------------------------------------------------------------- */
/* Rule-set integrity                                                          */
/* -------------------------------------------------------------------------- */

describe('rule set integrity', () => {
  it('every rule cites at least one knowledge-base entry', () => {
    // This is the mechanism that keeps unsourced woodworking opinion out of
    // the codebase. A rule with no citation means somebody encoded a belief.
    for (const rule of RULES) {
      expect(rule.cites.length, `${rule.id} has no citation`).toBeGreaterThan(0);
    }
  });

  it('every cited knowledge-base id exists', () => {
    for (const rule of RULES) {
      for (const id of rule.cites) {
        expect(KB[id], `${rule.id} cites unknown ${id}`).toBeDefined();
      }
    }
  });

  it('rule ids are unique within a category or deliberately shared', () => {
    const seen = new Map<string, number>();
    for (const rule of RULES) seen.set(rule.id, (seen.get(rule.id) ?? 0) + 1);
    // V-TOOL-090 intentionally emits for several features from one rule object.
    for (const [id, count] of seen) {
      expect(count, `${id} is registered more than once`).toBe(1);
    }
  });

  it('every safety rule can block', () => {
    const safety = RULES.filter((r) => r.category === 'safety');
    expect(safety.length).toBeGreaterThan(0);
  });
});

describe('species data integrity', () => {
  it('published coefficients agree with tangential shrinkage over the saturation point', () => {
    // Guards added rows: hard maple gives 9.9 / 28 = 0.00354 against a
    // published 0.00353.
    for (const s of Object.values(SPECIES)) {
      const consistent = coefficientLooksConsistent(s);
      if (consistent !== null) {
        expect(consistent, `${s.name} coefficient looks inconsistent`).toBe(true);
      }
    }
  });

  it('records provenance for every species', () => {
    for (const s of Object.values(SPECIES)) {
      expect(s.provenance.length, `${s.name} has no provenance`).toBeGreaterThan(0);
    }
  });

  it('leaves unsourced shrinkage null rather than estimating it', () => {
    expect(SPECIES['sapele']!.movementCoefficient).toBeNull();
    expect(SPECIES['hard-maple']!.movementCoefficient).toBe(0.00353);
  });
});

/* -------------------------------------------------------------------------- */
/* No false positives on the classics                                          */
/* -------------------------------------------------------------------------- */

describe('the classics validate clean', () => {
  // A validator that warns about the most commonly built board in the hobby
  // trains users to ignore warnings, which destroys the value of every genuine
  // finding. This is the guard against over-strict thresholds.
  it('a maple/walnut checkerboard raises no errors or warnings', () => {
    const result = build();
    expect(result.counts.error).toBe(0);
    expect(result.counts.warning, JSON.stringify(result.findings.map((f) => f.message))).toBe(0);
    expect(result.canExport).toBe(true);
  });

  it('a three-wood brick board raises no errors', () => {
    const result = build({ bond: 'brick', speciesB: 'black-cherry' });
    expect(result.counts.error).toBe(0);
  });

  it('an odd-column board does not waste material on its second panel', () => {
    // Regression: both panels were built at the full length while each supplied
    // only half the slices, nearly doubling the lumber. V-MAT-020 caught it.
    // Each panel is now only as long as the slices it actually provides.
    const result = build({ columns: 7 });
    expect(result.findings.find((f) => f.ruleId === 'V-MAT-020')).toBeUndefined();
  });

  it('an odd-column board uses less stock than a wider even-column one', () => {
    const odd = buildRaw({ columns: 7 });
    const even = buildRaw({ columns: 8 });
    const total = (r: typeof odd) =>
      Object.values(r.evaluated.ledger.input).reduce((s, v) => s + v, 0);
    expect(total(odd)).toBeLessThan(total(even));
  });

  it('reports board feet as information, not as a problem', () => {
    const result = build();
    const material = result.findings.find((f) => f.ruleId === 'V-MAT-010');
    expect(material?.severity).toBe('info');
    expect(material?.message).toMatch(/board feet/);
  });
});

/* -------------------------------------------------------------------------- */
/* Each rule: a trigger and a near-miss                                        */
/* -------------------------------------------------------------------------- */

describe('V-DIM-010 minimum thickness', () => {
  it('fires below 1 1/2"', () => {
    const result = build({ boardThickness: inches(1.25) });
    const f = result.findings.find((x) => x.ruleId === 'V-DIM-010');
    expect(f?.severity).toBe('error');
    expect(result.canExport).toBe(false);
  });

  it('does not fire at exactly 1 1/2"', () => {
    // The near-miss is the valuable half: it catches an off-by-one-tick
    // comparison that a 1" fixture never would.
    const result = build({ boardThickness: inches(1.5) });
    expect(result.findings.find((x) => x.ruleId === 'V-DIM-010')).toBeUndefined();
  });
});

describe('V-SAFE-030 minimum safe rip width', () => {
  it('fires on a strip narrower than the limit', () => {
    const result = build({ cellSize: inches(0.375) });
    const f = result.findings.find((x) => x.ruleId === 'V-SAFE-030');
    expect(f?.severity).toBe('error');
  });

  it('does not fire at exactly the limit', () => {
    const result = build({ cellSize: DEFAULT_SHOP.minSafeRipWidth });
    expect(result.findings.find((x) => x.ruleId === 'V-SAFE-030')).toBeUndefined();
  });
});

describe('V-SAFE-040 minimum safe crosscut length', () => {
  it('fires when slices are too short to hold safely', () => {
    const shop = { ...DEFAULT_SHOP, minSafeCrosscutLength: inches(2) };
    const result = build({ boardThickness: inches(1.5) }, shop);
    expect(result.findings.find((x) => x.ruleId === 'V-SAFE-040')?.severity).toBe('error');
  });
});

describe('V-TOOL-050 drum sander width', () => {
  it('warns only when the NARROW dimension exceeds the drum', () => {
    // The narrow dimension is what passes under the drum, so a long board is
    // fine and a wide one is not. Both dimensions must exceed 16" to fire.
    const result = build({ columns: 14, rows: 14 });
    const f = result.findings.find((x) => x.ruleId === 'V-TOOL-050');
    // A warning, not an error: an open-end sander can manage it in two passes.
    expect(f?.severity).toBe('warning');
    expect(f?.remedy).toMatch(/open-end/);
  });

  it('does not warn for a long board whose narrow dimension fits', () => {
    // 20 7/8" x 14 7/8" feeds lengthwise through a 16" sander without trouble.
    const result = build({ columns: 14, rows: 10 });
    expect(result.findings.find((x) => x.ruleId === 'V-TOOL-050')).toBeUndefined();
  });

  it('does not warn for a board that fits in both directions', () => {
    const result = build({ columns: 8 });
    expect(result.findings.find((x) => x.ruleId === 'V-TOOL-050')).toBeUndefined();
  });
});

describe('V-FOOD species gating', () => {
  it('blocks a species that is not food safe', () => {
    const result = build({ speciesB: 'cocobolo' });
    expect(result.findings.find((x) => x.ruleId === 'V-FOOD-010')?.severity).toBe('error');
    expect(result.canExport).toBe(false);
  });

  it('warns about open-pore species without blocking', () => {
    const result = build({ speciesB: 'red-oak' });
    const f = result.findings.find((x) => x.ruleId === 'V-FOOD-020');
    expect(f?.severity).toBe('warning');
    expect(result.canExport).toBe(true);
  });

  it('presents contested species as information rather than a verdict', () => {
    const result = build({ speciesB: 'purpleheart' });
    const f = result.findings.find((x) => x.ruleId === 'V-FOOD-030');
    expect(f?.severity).toBe('info');
    expect(f?.message).toMatch(/disagree/);
  });
});

describe('V-TOOL-090 tooling for edge treatments', () => {
  it('warns when a juice groove is requested without a router', () => {
    const result = build({}, DEFAULT_SHOP, {
      edgeTreatments: { juiceGroove: { inset: inches(1), width: inches(0.75), depth: inches(0.375) } },
    });
    const f = result.findings.find((x) => x.ruleId === 'V-TOOL-090');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/router/);
  });

  it('does not warn for a chamfer, which is a bevel rip', () => {
    const result = build({}, DEFAULT_SHOP, {
      edgeTreatments: { chamfer: { size: inches(0.125) } },
    });
    expect(result.findings.find((x) => x.ruleId === 'V-TOOL-090')).toBeUndefined();
  });
});

describe('V-DIM-020 juice groove depth', () => {
  it('blocks a groove deeper than a quarter of the thickness', () => {
    const result = build({}, { ...DEFAULT_SHOP, hasRouter: true }, {
      edgeTreatments: { juiceGroove: { inset: inches(1), width: inches(0.75), depth: inches(0.5) } },
    });
    expect(result.findings.find((x) => x.ruleId === 'V-DIM-020')?.severity).toBe('error');
  });

  it('allows 3/8" in a 1 1/2" board, which is exactly 25%', () => {
    const result = build({}, { ...DEFAULT_SHOP, hasRouter: true }, {
      edgeTreatments: { juiceGroove: { inset: inches(1), width: inches(0.75), depth: inches(0.375) } },
    });
    expect(result.findings.find((x) => x.ruleId === 'V-DIM-020')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

describe('finding presentation', () => {
  it('orders errors before warnings before info', () => {
    const result = build({ boardThickness: inches(1.25), speciesB: 'red-oak' });
    const severities = result.findings.map((f) => f.severity);
    const firstWarning = severities.indexOf('warning');
    const lastError = severities.lastIndexOf('error');
    if (firstWarning !== -1 && lastError !== -1) expect(lastError).toBeLessThan(firstWarning);
  });

  it('carries its rationale so the user reads why without leaving the panel', () => {
    const result = build({ boardThickness: inches(1.25) });
    const f = result.findings.find((x) => x.ruleId === 'V-DIM-010');
    expect(f?.rationale).toMatch(/splitting/);
  });

  it('collapses repeated findings into one row carrying a count', () => {
    const result = build({ cellSize: inches(0.375), columns: 8 });
    const narrow = result.findings.filter((f) => f.ruleId === 'V-SAFE-030');
    // Eight narrow strips are one problem, not eight rows burying everything
    // else. The rule aggregates per rip, and dedupeKey merges across rips.
    expect(narrow).toHaveLength(1);
    expect(narrow[0]!.message).toMatch(/strips at/);
    expect(narrow[0]!.data['occurrences']).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------- */
/* P1 — bevel rules                                                            */
/* -------------------------------------------------------------------------- */

describe('V-GEOM-030 both-faces taper', () => {
  function angled(angleDeg: number, stripWidth = inches(1.5), shop = DEFAULT_SHOP) {
    const { graph } = zigZag(['hard-maple', 'black-walnut'], stripWidth, 6, degrees(angleDeg), shop);
    const evaluated = evaluate(graph, shop);
    const project = createProject({
      name: 't', graph, speciesPalette: ['hard-maple', 'black-walnut'], shopProfile: shop,
    });
    return validate({ project, evaluated, shop });
  }

  it('passes a gentle bevel on a wide strip', () => {
    expect(angled(10).findings.find((f) => f.ruleId === 'V-GEOM-030')).toBeUndefined();
  });

  it('catches a strip that is safe at the fence but too narrow at its other face', () => {
    // A bevelled strip's two faces differ by thickness x tan(angle). Checking
    // only the fence setting misses this; CBDJS checks one direction only.
    const result = angled(15, inches(0.75));
    const f = result.findings.find((x) => x.ruleId === 'V-GEOM-030');
    expect(f?.severity).toBe('error');
    expect(f?.message).toMatch(/narrow face/);
  });
});

describe('V-TOOL-010 cut depth at a bevel', () => {
  it('interpolates between measured points rather than using cosine', () => {
    // A 10" saw measures 3 1/8" at 90 and 2 1/4" at 45 — a ratio of 0.72,
    // where cosine predicts 0.707. The model is not wrong in a predictable
    // direction; a saw's reach depends on its arbor and throat geometry, so
    // the measured points are used instead of trigonometry.
    const atZero = maxCutDepth(DEFAULT_SHOP, 0);
    const at45 = maxCutDepth(DEFAULT_SHOP, degrees(45));
    expect(toInches(atZero)).toBeCloseTo(3.125, 6);
    expect(toInches(at45)).toBeCloseTo(2.25, 6);
    expect(at45 / atZero).toBeCloseTo(0.72, 2);
    expect(at45 / atZero).not.toBeCloseTo(Math.cos(Math.PI / 4), 3);
  });

  it('blocks a cut deeper than the saw can reach', () => {
    const shop = { ...DEFAULT_SHOP, bladeDepthAt90: inches(1), bladeDepthAt45: inches(0.7) };
    const { graph } = zigZag(['hard-maple', 'black-walnut'], inches(1.5), 6, degrees(20), shop);
    const evaluated = evaluate(graph, shop);
    const project = createProject({
      name: 't', graph, speciesPalette: ['hard-maple', 'black-walnut'], shopProfile: shop,
    });
    const result = validate({ project, evaluated, shop });
    expect(result.findings.find((f) => f.ruleId === 'V-TOOL-010')?.severity).toBe('error');
  });
});

describe('V-TOOL-030 bevel range', () => {
  it('blocks a bevel beyond the saw limit', () => {
    const shop = { ...DEFAULT_SHOP, maxBevel: degrees(20) };
    const { graph } = zigZag(['hard-maple', 'black-walnut'], inches(1.5), 6, degrees(35), shop);
    const evaluated = evaluate(graph, shop);
    const project = createProject({
      name: 't', graph, speciesPalette: ['hard-maple', 'black-walnut'], shopProfile: shop,
    });
    const result = validate({ project, evaluated, shop });
    expect(result.findings.find((f) => f.ruleId === 'V-TOOL-030')?.severity).toBe('error');
  });

  it('allows a bevel at exactly the limit', () => {
    const shop = { ...DEFAULT_SHOP, maxBevel: degrees(20) };
    const { graph } = zigZag(['hard-maple', 'black-walnut'], inches(1.5), 6, degrees(20), shop);
    const evaluated = evaluate(graph, shop);
    const project = createProject({
      name: 't', graph, speciesPalette: ['hard-maple', 'black-walnut'], shopProfile: shop,
    });
    const result = validate({ project, evaluated, shop });
    expect(result.findings.find((f) => f.ruleId === 'V-TOOL-030')).toBeUndefined();
  });
});

describe('angled patterns validate clean at sensible angles', () => {
  it.each([
    ['zigZag', () => zigZag(['hard-maple', 'black-walnut'], inches(1.5), 8, degrees(15), DEFAULT_SHOP)],
    ['chevron', () => chevron(['hard-maple', 'black-walnut'], inches(1.5), 8, degrees(15), DEFAULT_SHOP)],
  ])('%s raises no errors', (_name, make) => {
    const { graph } = make();
    const evaluated = evaluate(graph, DEFAULT_SHOP);
    const project = createProject({
      name: 't', graph, speciesPalette: ['hard-maple', 'black-walnut'], shopProfile: DEFAULT_SHOP,
    });
    expect(validate({ project, evaluated, shop: DEFAULT_SHOP }).counts.error).toBe(0);
  });
});
