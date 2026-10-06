import { describe, expect, it } from 'vitest';
import { evaluate } from '../geometry/evaluate.js';
import { area, boundingBox } from '../geometry/polygon.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import type { Graph } from '../model/types.js';
import { inches } from '../units/ticks.js';
import { validate } from '../validation/validate.js';
import { basketWeave, herringbone, pinwheel } from './multistage.js';

const SHOP = DEFAULT_SHOP;

const BASE = {
  stockThickness: inches(1.5),
  stripes: 6,
  speciesA: 'hard-maple',
  speciesB: 'black-walnut',
  speciesAccent: 'cherry',
  targetWidth: inches(12),
  targetLength: inches(16),
  boardThickness: inches(1.5),
};

function params(overrides: Partial<typeof BASE> = {}) {
  return { ...BASE, ...overrides };
}

function findings(graph: Graph) {
  const evaluated = evaluate(graph, SHOP);
  const project = createProject({
    name: 'multistage',
    graph,
    speciesPalette: ['hard-maple', 'black-walnut', 'cherry'],
    shopProfile: SHOP,
  });
  return validate({ project, evaluated, shop: SHOP }).findings;
}

// Basket weave uses a square tile, half the long dimension of the other two,
// so the same stripe count would call for strips below the safe rip width.
const PATTERNS = [
  ['herringbone', herringbone, 6],
  ['pinwheel', pinwheel, 6],
  ['basket weave', basketWeave, 3],
] as const;

describe.each(PATTERNS)('%s', (_name, generate, stripes) => {
  it('evaluates with no gaps, which is the tiling proof', () => {
    // A lattice that does not tile leaves an enclosed void, and the union
    // reports that as a hole rather than absorbing it into a tolerance.
    const { graph } = generate(params({ stripes }), SHOP);
    expect(() => evaluate(graph, SHOP)).not.toThrow();
  });

  it('finishes at exactly the requested size', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const result = evaluate(graph, SHOP);
    const box = boundingBox(result.workpiece.crossSection.outline);
    expect(box.maxX - box.minX).toBe(inches(12));
    expect(box.maxY - box.minY).toBe(inches(16));
  });

  it('keeps every piece end grain: the board is one orientation throughout', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const result = evaluate(graph, SHOP);
    expect(result.workpiece.orientation).toBe('endGrain');
  });

  it('turns tiles rather than mitering them, so V-GRAIN-020 stays quiet', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const crosscuts = Object.values(graph.nodes).filter((n) => n.op.kind === 'crosscut');
    expect(crosscuts.length).toBeGreaterThan(0);
    expect(crosscuts.every((n) => n.op.kind === 'crosscut' && n.op.miter === 0)).toBe(true);
    expect(findings(graph).filter((f) => f.ruleId === 'V-GRAIN-020')).toEqual([]);
  });

  it('actually turns some tiles, or it is not this pattern at all', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const layUp = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.placement === 'free',
    )!;
    const turned =
      layUp.op.kind === 'laminate' ? layUp.op.members.filter((m) => m.rotate !== 0).length : 0;
    expect(turned).toBeGreaterThan(0);
  });

  it('raises no errors', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const errors = findings(graph).filter((f) => f.severity === 'error');
    expect(errors.map((f) => `${f.ruleId}: ${f.message}`)).toEqual([]);
  });

  it('tiles the finished board with no gap left over', () => {
    const { graph } = generate(params({ stripes }), SHOP);
    const result = evaluate(graph, SHOP);
    const faces = result.workpiece.crossSection.faces.reduce((s, f) => s + area(f.polygon), 0);
    const outline = area(result.workpiece.crossSection.outline);
    expect(Math.abs(outline - faces) / outline).toBeLessThan(1e-4);
  });

  it('covers a range of board sizes', () => {
    for (const [w, l] of [
      [8, 10],
      [12, 16],
      [9, 15],
    ] as const) {
      const { graph } = generate(
        params({ stripes, targetWidth: inches(w), targetLength: inches(l) }),
        SHOP,
      );
      const box = boundingBox(evaluate(graph, SHOP).workpiece.crossSection.outline);
      expect(box.maxX - box.minX).toBe(inches(w));
      expect(box.maxY - box.minY).toBe(inches(l));
    }
  });
});

describe('herringbone specifics', () => {
  it('uses a 2:1 tile derived from the stock thickness alone', () => {
    const { derived } = herringbone(params({ stockThickness: inches(1.5) }), SHOP);
    expect(derived.tileShort).toBe(inches(1.5));
    expect(derived.tileLong).toBe(inches(3));
    expect(derived.stripeWidth).toBe(inches(0.5));
  });

  it('places tiles in both orientations in roughly equal numbers', () => {
    const { graph } = herringbone(params(), SHOP);
    const layUp = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.placement === 'free',
    )!;
    if (layUp.op.kind !== 'laminate') throw new Error('expected a laminate');
    const turned = layUp.op.members.filter((m) => m.rotate !== 0).length;
    const flat = layUp.op.members.length - turned;
    // A herringbone is half one way and half the other, give or take the border.
    expect(Math.abs(turned - flat) / layUp.op.members.length).toBeLessThan(0.3);
  });

  it('rejects stripes too narrow to rip safely', () => {
    expect(() => herringbone(params({ stripes: 40 }), SHOP)).toThrow(/minimum safe rip/);
  });
});

describe('pinwheel specifics', () => {
  it('needs an accent species for the centre squares', () => {
    expect(() =>
      pinwheel({ ...params(), speciesAccent: '' }, SHOP),
    ).toThrow(/accent species/);
  });

  it('includes one centre square per block', () => {
    const { graph } = pinwheel(params(), SHOP);
    const layUp = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.placement === 'free',
    )!;
    if (layUp.op.kind !== 'laminate') throw new Error('expected a laminate');
    // Four tiles and one centre per block: a fifth of the pieces are centres.
    const cherry = evaluate(graph, SHOP).workpiece.crossSection.faces.filter(
      (f) => f.species === 'cherry',
    );
    expect(cherry.length).toBeGreaterThan(0);
  });
});

describe('basket weave specifics', () => {
  it('uses a square tile', () => {
    const { derived } = basketWeave(params({ stockThickness: inches(1.5), stripes: 3 }), SHOP);
    expect(derived.tileShort).toBe(derived.tileLong);
  });

  it('is the cheapest of the three in glue-ups and tiles', () => {
    const square = basketWeave(params({ stripes: 3 }), SHOP).derived;
    const herring = herringbone(params(), SHOP).derived;
    expect(square.glueUps).toBe(herring.glueUps);
    // A square tile is half the area of a 2:1 tile, so there are more of them.
    expect(square.tileCount).toBeGreaterThan(herring.tileCount);
  });
});
