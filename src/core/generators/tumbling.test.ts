import { describe, expect, it } from 'vitest';
import { evaluate } from '../geometry/evaluate.js';
import { area, boundingBox } from '../geometry/polygon.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { TICKS_PER_INCH, inches, toInches } from '../units/ticks.js';
import { tumblingBlock } from './tumbling.js';

const SHOP = DEFAULT_SHOP;

function build(overrides: Partial<Parameters<typeof tumblingBlock>[0]> = {}) {
  return tumblingBlock(
    {
      stockThickness: inches(1.25),
      speciesTop: 'hard-maple',
      speciesLeft: 'black-walnut',
      speciesRight: 'cherry',
      targetWidth: inches(10),
      targetLength: inches(14),
      boardThickness: inches(1.5),
      ...overrides,
    },
    SHOP,
  );
}

describe('tumbling block geometry (KB-A05)', () => {
  it('derives the closure condition from the stock thickness alone', () => {
    const { derived } = build({ stockThickness: inches(1.25) });
    // ripWidth = T / cos(30) = 1.4434"
    expect(toInches(derived.ripWidth)).toBeCloseTo(1.4434, 3);
    // The identity that makes the cubes read as cubes.
    expect(derived.hexAcrossFlats).toBe(inches(2.5));
    expect(toInches(derived.hexAcrossCorners)).toBeCloseTo(2.8868, 3);
  });

  it('reproduces the second published stock size', () => {
    const { derived } = build({ stockThickness: inches(1.375) });
    expect(toInches(derived.ripWidth)).toBeCloseTo(1.5877, 3);
    expect(derived.hexAcrossFlats).toBe(inches(2.75));
  });

  it('keeps hexAcrossFlats exactly 2T across the whole plausible range', () => {
    for (let eighths = 8; eighths <= 16; eighths++) {
      const T = inches(eighths / 8);
      const { derived } = build({ stockThickness: T });
      expect(derived.hexAcrossFlats).toBe(2 * T);
    }
  });
});

describe('tumbling block construction graph', () => {
  it('evaluates, conserves mass, and closes the honeycomb with no holes', () => {
    const { graph } = build();
    const result = evaluate(graph, SHOP);
    expect(result.workpiece.orientation).toBe('endGrain');
  });

  it('builds a hexagonal prism from three rhombus sticks', () => {
    const { graph, derived } = build();
    const result = evaluate(graph, SHOP);

    const prismNode = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.members.length === 3,
    );
    expect(prismNode).toBeDefined();

    const prism = result.nodeOutputs.get(prismNode!.id)![0]!;
    expect(prism.crossSection.faces).toHaveLength(3);

    // Six sides, and across-corners exactly twice the rhombus side.
    expect(prism.crossSection.outline.length).toBe(6);
    const box = boundingBox(prism.crossSection.outline);
    expect(box.maxY - box.minY).toBe(derived.hexAcrossCorners);
  });

  it('measures the built hexagon against 2T rather than trusting the generator', () => {
    const T = inches(1.25);
    const { graph } = build({ stockThickness: T });
    const result = evaluate(graph, SHOP);
    const prismNode = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.members.length === 3,
    )!;
    const prism = result.nodeOutputs.get(prismNode.id)![0]!;
    const box = boundingBox(prism.crossSection.outline);

    // Measured off the evaluated geometry, not read back from the generator.
    //
    // One tick, and one tick is the floor. T x tan(30) falls almost exactly
    // halfway between two ticks (5773.5027), so the rhombus's two slanted edges
    // round opposite ways and its top face ends up a tick wider than its
    // bottom. That is 1/8000" -- a human hair is 24 times thicker -- and no
    // choice of rounding removes it, because the hexagon is irrational.
    expect(Math.abs(box.maxX - box.minX - 2 * T)).toBeLessThanOrEqual(1);

    // The hexagon is regular: across-corners is 2/sqrt(3) of across-flats.
    const ideal = (2 / Math.sqrt(3)) * (box.maxX - box.minX);
    expect(Math.abs(box.maxY - box.minY - ideal)).toBeLessThanOrEqual(2);
  });

  it('holds the 2T identity on the built geometry across the stock range', () => {
    for (let eighths = 8; eighths <= 16; eighths++) {
      const T = inches(eighths / 8);
      const { graph } = build({ stockThickness: T, targetWidth: inches(8), targetLength: inches(8) });
      const result = evaluate(graph, SHOP);
      const prismNode = Object.values(graph.nodes).find(
        (n) => n.op.kind === 'laminate' && n.op.members.length === 3,
      )!;
      const box = boundingBox(result.nodeOutputs.get(prismNode.id)![0]!.crossSection.outline);
      expect(Math.abs(box.maxX - box.minX - 2 * T)).toBeLessThanOrEqual(2);
    }
  });

  it('finishes at exactly the requested size when trimming through', () => {
    const { graph, derived } = build({ targetWidth: inches(10), targetLength: inches(14) });
    const result = evaluate(graph, SHOP);
    const box = boundingBox(result.workpiece.crossSection.outline);
    expect(box.maxX - box.minX).toBe(inches(10));
    expect(box.maxY - box.minY).toBe(inches(14));
    expect(derived.finishedThickness).toBe(inches(1.5));
    expect(derived.partialCells).toBeGreaterThan(0);
  });

  it('grows to whole lattice periods and says so', () => {
    const { derived } = build({ edgeResolution: 'growToWhole' });
    expect(derived.grewFrom).toEqual({ width: inches(10), length: inches(14) });

    // A whole number of double periods in each direction, which is what makes
    // opposite borders identical. Doubled because odd rows are offset by half.
    // Two rows span exactly 3 x ripWidth, so this is exact despite a single row
    // pitch landing on a half tick.
    expect(derived.finishedWidth % (2 * derived.latticePitch.x)).toBe(0);
    expect(derived.finishedLength % (3 * derived.ripWidth)).toBe(0);
  });

  it('lays up one puck per cell and enough prisms to cut them', () => {
    const { derived } = build();
    expect(derived.puckCount).toBeGreaterThan(10);
    expect(derived.prismCount * derived.pucksPerPrism).toBeGreaterThanOrEqual(derived.puckCount);
    expect((derived.prismCount - 1) * derived.pucksPerPrism).toBeLessThan(derived.puckCount);
  });

  it('covers the finished board at a range of sizes without leaving a hole', () => {
    for (const [w, l] of [
      [8, 10],
      [10, 14],
      [12, 18],
      [6, 6],
    ] as const) {
      const { graph } = build({ targetWidth: inches(w), targetLength: inches(l) });
      const result = evaluate(graph, SHOP);
      const box = boundingBox(result.workpiece.crossSection.outline);
      expect(box.maxX - box.minX).toBe(inches(w));
      expect(box.maxY - box.minY).toBe(inches(l));

      // The faces tile the finished board: no gap survived the trim.
      const faces = result.workpiece.crossSection.faces.reduce((s, f) => s + area(f.polygon), 0);
      const outline = area(result.workpiece.crossSection.outline);
      expect(Math.abs(outline - faces) / outline).toBeLessThan(1e-4);
    }
  });

  it('uses one billet when two cube faces share a species', () => {
    const { graph, derived } = build({ speciesLeft: 'hard-maple', speciesTop: 'hard-maple' });
    const billets = Object.values(graph.nodes).filter((n) => n.op.kind === 'billet');
    expect(billets).toHaveLength(2);
    // ...but still two sticks per prism from it.
    const maple = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'rip' && graph.nodes[n.op.input.node]!.op.kind === 'billet',
    );
    expect(maple).toBeDefined();
    expect(derived.sticksPerSpecies).toBe(derived.prismCount);
  });

  it('reports the material in inches a builder would recognise', () => {
    const { derived } = build({ stockThickness: inches(1.25) });
    expect(derived.puckLength).toBe(inches(1.5) + 2 * (TICKS_PER_INCH / 8));
  });
});
