import { describe, expect, it } from 'vitest';
import { evaluate, workpieceVolumeBySpecies } from '../geometry/evaluate.js';
import { checkTiling } from '../geometry/partition.js';
import { boundingBox } from '../geometry/polygon.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import { PRECISION, degrees, inches } from '../units/ticks.js';
import { buildCutList } from '../cutlist/cutlist.js';
import { validate } from '../validation/validate.js';
import { PATTERNS, type PatternParams } from './registry.js';

const SHOP = DEFAULT_SHOP;

/**
 * The parameters the app actually starts with.
 *
 * Every catalogue entry is built from these, because a pattern that only works
 * at hand-picked settings is a pattern that will greet its first user with an
 * error.
 */
const DEFAULTS: PatternParams = {
  cellSize: inches(1.5),
  columns: 8,
  rows: 10,
  boardThickness: inches(1.5),
  speciesA: 'hard-maple',
  speciesB: 'black-walnut',
  speciesC: 'black-cherry',
  angle: degrees(15),
  seed: 42,
  stripes: 6,
  edgeResolution: 'trimThrough',
};

describe.each(PATTERNS.map((p) => [p.id, p] as const))('%s', (_id, definition) => {
  it('builds and evaluates from the app defaults', () => {
    const { graph } = definition.build(DEFAULTS, SHOP);
    expect(() => evaluate(graph, SHOP)).not.toThrow();
  });

  it('produces an end-grain board with a rectangular face', () => {
    const result = evaluate(definition.build(DEFAULTS, SHOP).graph, SHOP);
    expect(result.workpiece.orientation).toBe('endGrain');
    const box = boundingBox(result.workpiece.crossSection.outline);
    expect(box.maxX - box.minX).toBeGreaterThan(0);
    expect(box.maxY - box.minY).toBeGreaterThan(0);
  });

  it('tiles its own face', () => {
    const result = evaluate(definition.build(DEFAULTS, SHOP).graph, SHOP);
    expect(checkTiling(result.workpiece.crossSection).ok).toBe(true);
  });

  it('conserves mass per species', () => {
    const result = evaluate(definition.build(DEFAULTS, SHOP).graph, SHOP);
    const out = workpieceVolumeBySpecies(result.workpiece);
    const { input, kerf, removed, offcut } = result.ledger;
    for (const id of Object.keys(input)) {
      const accounted = (out[id] ?? 0) + (kerf[id] ?? 0) + (removed[id] ?? 0) + (offcut[id] ?? 0);
      expect(Math.abs(accounted - input[id]!) / input[id]!).toBeLessThan(1e-9);
    }
  });

  it('raises no blocking findings, so it can be taken to the saw', () => {
    const { graph } = definition.build(DEFAULTS, SHOP);
    const evaluated = evaluate(graph, SHOP);
    const project = createProject({
      name: definition.id,
      graph,
      speciesPalette: [DEFAULTS.speciesA, DEFAULTS.speciesB, DEFAULTS.speciesC],
      shopProfile: SHOP,
    });
    const result = validate({ project, evaluated, shop: SHOP });
    expect(result.findings.filter((f) => f.severity === 'error').map((f) => `${f.ruleId}: ${f.message}`)).toEqual([]);
    expect(result.canExport).toBe(true);
  });

  it('declares the glue-up count a user is committing to', () => {
    expect(definition.glueUps).toBeGreaterThanOrEqual(1);
    expect(definition.description.length).toBeGreaterThan(20);
  });
});

describe('the catalogue', () => {
  it('has unique ids', () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the multi-stage patterns P2 exists to deliver', () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(ids).toContain('tumbling-block');
    expect(ids).toContain('herringbone');
    expect(ids).toContain('pinwheel');
    expect(ids).toContain('basket-weave');
  });
});

/**
 * The ledger has to agree with the board for EVERY pattern, not just the grid
 * ones it was written against.
 *
 * It originally encoded the two-stage model directly -- finished width is the
 * stage-1 panel's width, finished length is slice count times pitch -- which is
 * exactly right for a checkerboard and meaningless for a honeycomb, where the
 * stage-1 assembly is a 3" hex prism and consecutive pucks share a row so the
 * pitch reads zero. The printed cut list claimed a 3" x 0" board beside a
 * picture of a 12" x 15" one.
 */
describe.each(PATTERNS.map((p) => [p.id, p] as const))('%s ledger', (_id, definition) => {
  const { graph } = definition.build(DEFAULTS, SHOP);
  const evaluated = evaluate(graph, SHOP);
  const list = buildCutList(graph, evaluated, SHOP, {
    name: definition.id,
    precision: PRECISION.THIRTY_SECOND,
  });

  const section = (title: string) =>
    list.ledger.sections.find((s) => s.title.toLowerCase().startsWith(title));

  it('states the finished width the board actually has', () => {
    const box = boundingBox(evaluated.workpiece.crossSection.outline);
    expect(section('width')?.result).toBe(box.maxX - box.minX);
  });

  it('states the finished length the board actually has', () => {
    const box = boundingBox(evaluated.workpiece.crossSection.outline);
    expect(section('length')?.result).toBe(box.maxY - box.minY);
  });

  it('every section reconciles: lines sum to the stated result', () => {
    for (const s of list.ledger.sections) {
      const summed = s.lines.reduce((total, line) => total + line.delta, 0);
      expect(summed, `${s.title} does not reconcile`).toBe(s.result);
    }
  });
});
