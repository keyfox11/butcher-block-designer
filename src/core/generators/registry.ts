/**
 * The pattern catalogue.
 *
 * Data-driven so the UI enumerates patterns rather than hard-coding each one,
 * and so a shared link can name a pattern and have it regenerated from its
 * parameters.
 *
 * `glueUps` is surfaced deliberately: glue-ups are the real cost of these
 * boards -- each is an overnight cure, a flattening pass, and a chance to ruin
 * everything -- so a user choosing between patterns deserves to know before
 * they start.
 */

import type { Graph, MilliDeg, ShopProfile, SpeciesId, Ticks } from '../model/types.js';
import { ticks } from '../units/ticks.js';
import { checkerboard } from './checkerboard.js';
import { basketWeave, herringbone, pinwheel } from './multistage.js';
import { type EdgeResolution, tumblingBlock } from './tumbling.js';
import {
  chevron,
  diagonalAccent,
  snakeSkin,
  spiral,
  stochastic,
  stripes,
  threeWoodBands,
  zigZag,
} from './patterns.js';

export interface PatternParams {
  readonly cellSize: Ticks;
  readonly columns: number;
  readonly rows: number;
  readonly boardThickness: Ticks;
  readonly speciesA: SpeciesId;
  readonly speciesB: SpeciesId;
  readonly speciesC: SpeciesId;
  readonly angle: MilliDeg;
  readonly seed: number;
  /** Multi-stage patterns: strips across one tile. */
  readonly stripes: number;
  /** Tumbling block: how the jagged honeycomb border becomes a rectangle. */
  readonly edgeResolution: EdgeResolution;
}

export interface PatternResult {
  readonly graph: Graph;
  readonly panelCount?: number;
  readonly setupCuts?: number;
  /** Pieces laid up in the final glue-up, for the non-grid patterns. */
  readonly cells?: number;
}

export interface PatternDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly difficulty: 'beginner' | 'intermediate' | 'advanced';
  readonly glueUps: number;
  /** Which extra controls the parameter panel should show. */
  readonly uses: {
    readonly angle?: boolean;
    readonly seed?: boolean;
    readonly thirdSpecies?: boolean;
    readonly stripes?: boolean;
    readonly edgeResolution?: boolean;
  };
  build(params: PatternParams, shop: ShopProfile): PatternResult;
}

function common(p: PatternParams) {
  return { rows: p.rows, boardThickness: p.boardThickness, sourceThickness: p.cellSize };
}

/**
 * Grid patterns count cells; the non-grid ones have no cell grid to count, so
 * the same two controls are read as a finished size instead. One set of
 * controls, so switching patterns keeps the board roughly the same size rather
 * than jumping.
 */
function boardSize(p: PatternParams) {
  return {
    targetWidth: ticks(p.columns * p.cellSize),
    targetLength: ticks(p.rows * p.cellSize),
  };
}

function multiStage(p: PatternParams) {
  return {
    stockThickness: p.cellSize,
    stripes: p.stripes,
    speciesA: p.speciesA,
    speciesB: p.speciesB,
    ...boardSize(p),
    boardThickness: p.boardThickness,
  };
}

export const PATTERNS: readonly PatternDefinition[] = [
  {
    id: 'checkerboard',
    name: 'Checkerboard',
    description: 'The classic. Alternate slices are rotated, which reverses their sequence.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: {},
    build: (p, shop) => {
      const r = checkerboard(
        {
          cellSize: p.cellSize,
          speciesA: p.speciesA,
          speciesB: p.speciesB,
          columns: p.columns,
          rows: p.rows,
          boardThickness: p.boardThickness,
        },
        shop,
      );
      return { graph: r.graph, panelCount: r.derived.panelCount };
    },
  },
  {
    id: 'brick',
    name: 'Brick / running bond',
    description: 'Rows offset by half a cell, using a second panel with half-width end strips.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: {},
    build: (p, shop) => {
      const r = checkerboard(
        {
          cellSize: p.cellSize,
          speciesA: p.speciesA,
          speciesB: p.speciesB,
          columns: p.columns,
          rows: p.rows,
          boardThickness: p.boardThickness,
          bond: 'brick',
        },
        shop,
      );
      return { graph: r.graph, panelCount: r.derived.panelCount };
    },
  },
  {
    id: 'stripes',
    name: 'Classic stripes',
    description: 'Uniform strips, slices untransformed, so the columns run straight through.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: {},
    build: (p, shop) => {
      const r = stripes([p.speciesA, p.speciesB], p.cellSize, p.columns, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'three-wood-bands',
    name: 'Three-wood bands',
    description: 'A repeating three-species band.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: { thirdSpecies: true },
    build: (p, shop) => {
      const r = threeWoodBands(p.speciesA, p.speciesB, p.speciesC, p.cellSize, p.columns, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'diagonal-accent',
    name: 'Diagonal accent',
    description: 'A field of one species crossed by a contrasting band at a bevel.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: { angle: true },
    build: (p, shop) => {
      const r = diagonalAccent(
        p.speciesA,
        p.speciesB,
        p.cellSize,
        p.columns,
        [Math.floor(p.columns / 2)],
        p.angle,
        shop,
        common(p),
      );
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'stochastic',
    name: 'Random',
    description: 'Seeded random species on a square grid. Always buildable, and reproducible.',
    difficulty: 'beginner',
    glueUps: 2,
    uses: { seed: true, thirdSpecies: true },
    build: (p, shop) => {
      const r = stochastic(
        [p.speciesA, p.speciesB, p.speciesC],
        p.cellSize,
        p.columns,
        p.seed,
        shop,
        common(p),
      );
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'zigzag',
    name: 'Zig-zag',
    description: 'Every boundary at one angle; alternate slices rotated so the rows lean against each other.',
    difficulty: 'intermediate',
    glueUps: 2,
    uses: { angle: true },
    build: (p, shop) => {
      const r = zigZag([p.speciesA, p.speciesB], p.cellSize, p.columns, p.angle, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'chevron',
    name: 'Chevron',
    description: 'As zig-zag, but alternate slices are mirrored rather than rotated, so boundaries meet in a V.',
    difficulty: 'intermediate',
    glueUps: 2,
    uses: { angle: true },
    build: (p, shop) => {
      const r = chevron([p.speciesA, p.speciesB], p.cellSize, p.columns, p.angle, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'snake-skin',
    name: 'Snake skin',
    description: 'Boundary angles fan across the panel, reading as overlapping scales.',
    difficulty: 'intermediate',
    glueUps: 2,
    uses: { angle: true },
    build: (p, shop) => {
      const r = snakeSkin([p.speciesA, p.speciesB], p.cellSize, p.columns, p.angle, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },
  {
    id: 'spiral',
    name: 'Spiral',
    description:
      'Angles sweep in one direction with alternate slices rotated. This is the single-stage angled spiral, not the multi-stage pinwheel.',
    difficulty: 'intermediate',
    glueUps: 2,
    uses: { angle: true },
    build: (p, shop) => {
      const r = spiral([p.speciesA, p.speciesB], p.cellSize, p.columns, p.angle, shop, common(p));
      return { graph: r.graph, setupCuts: r.derived.setupCuts };
    },
  },

  /* ---- Multi-stage: the patterns no layer-stack tool can express ---------- */

  {
    id: 'tumbling-block',
    name: '3D cube',
    description:
      'A honeycomb of hexagonal prisms, each glued from three bevel-ripped rhombus sticks. Not a grid, and the one pattern that proves the point: cell size follows from the stock thickness alone.',
    difficulty: 'advanced',
    glueUps: 2,
    uses: { thirdSpecies: true, edgeResolution: true },
    build: (p, shop) => {
      const r = tumblingBlock(
        {
          stockThickness: p.cellSize,
          speciesTop: p.speciesA,
          speciesLeft: p.speciesB,
          speciesRight: p.speciesC,
          ...boardSize(p),
          boardThickness: p.boardThickness,
          edgeResolution: p.edgeResolution,
        },
        shop,
      );
      return { graph: r.graph, panelCount: r.derived.prismCount, cells: r.derived.puckCount };
    },
  },
  {
    id: 'herringbone',
    name: 'Herringbone',
    description:
      'Striped 2:1 tiles in diagonal runs, every other one turned a quarter turn. Turned, never mitered — a miter would shear the grain off perpendicular and cost the board its self-healing.',
    difficulty: 'advanced',
    glueUps: 2,
    uses: { stripes: true },
    build: (p, shop) => {
      const r = herringbone(multiStage(p), shop);
      return { graph: r.graph, panelCount: r.derived.panelCount, cells: r.derived.tileCount };
    },
  },
  {
    id: 'pinwheel',
    name: 'Pinwheel',
    description:
      'Four striped tiles chasing each other round an accent square, in blocks that tile as a plain grid.',
    difficulty: 'advanced',
    glueUps: 2,
    uses: { stripes: true, thirdSpecies: true },
    build: (p, shop) => {
      const r = pinwheel({ ...multiStage(p), speciesAccent: p.speciesC }, shop);
      return { graph: r.graph, panelCount: r.derived.panelCount, cells: r.derived.tileCount };
    },
  },
  {
    id: 'basket-weave',
    name: 'Basket weave',
    description:
      'Square striped tiles alternating a quarter turn, so the stripes read as bundles passing over and under. The gentlest way into multi-stage work.',
    difficulty: 'intermediate',
    glueUps: 2,
    uses: { stripes: true },
    build: (p, shop) => {
      // A square tile is half the long dimension of a 2:1 one, so the same
      // stripe count would call for strips half as wide -- below the safe rip
      // width at ordinary settings. Halving keeps the stripe the same physical
      // width as it is in the other patterns, which is what the control means
      // to the person setting it.
      const r = basketWeave(
        { ...multiStage(p), stripes: Math.max(2, Math.round(p.stripes / 2)) },
        shop,
      );
      return { graph: r.graph, panelCount: r.derived.panelCount, cells: r.derived.tileCount };
    },
  },
];

export function pattern(id: string): PatternDefinition {
  const found = PATTERNS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown pattern: ${id}`);
  return found;
}
