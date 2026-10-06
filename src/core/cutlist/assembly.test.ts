import { describe, expect, it } from 'vitest';
import { evaluate } from '../geometry/evaluate.js';
import { checkerboard } from '../generators/checkerboard.js';
import { zigZag } from '../generators/patterns.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { degrees, inches } from '../units/ticks.js';
import { buildAssemblyMaps, describeScale, mapScale } from './assembly.js';

const S = DEFAULT_SHOP;

function maps(kind: 'checker' | 'zigzag' = 'checker') {
  const { graph } =
    kind === 'checker'
      ? checkerboard(
          { cellSize: inches(1.5), speciesA: 'hard-maple', speciesB: 'black-walnut', columns: 8, rows: 10, boardThickness: inches(1.5) },
          S,
        )
      : zigZag(['hard-maple', 'black-walnut'], inches(1.5), 8, degrees(15), S);
  return buildAssemblyMaps(graph, evaluate(graph, S));
}

describe('assembly maps', () => {
  it('produces one map per glue-up', () => {
    // Stage-1 panel plus the stage-2 board.
    expect(maps().length).toBeGreaterThanOrEqual(2);
  });

  it('labels the pieces a builder picks up, not every species region', () => {
    // A ten-slice board has eighty cells; numbering all of them buries the one
    // fact that matters — which slice goes where, and is it turned.
    const stageTwo = maps().at(-1)!;
    expect(stageTwo.pieces).toHaveLength(stageTwo.memberCount);
    expect(stageTwo.pieces.length).toBeLessThan(20);
    expect(stageTwo.pieces[0]!.faces.length).toBeGreaterThan(1);
  });

  it('labels every piece', () => {
    for (const map of maps()) {
      expect(map.pieces.length).toBeGreaterThan(0);
      for (const piece of map.pieces) {
        expect(piece.label).toMatch(/^\d+$/);
        expect(piece.displayName.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries a hatch as well as a colour for monochrome printing', () => {
    const faces = maps().flatMap((m) => m.pieces).flatMap((p) => p.faces);
    expect(faces.some((f) => f.hatch !== 'hatch-none')).toBe(true);
  });

  it('marks rotated slices so they cannot be laid the wrong way', () => {
    const stageTwo = maps().at(-1)!;
    expect(stageTwo.pieces.some((p) => p.rotated180)).toBe(true);
  });

  it('marks angled glue-ups as row by row', () => {
    // Angled joints turn clamp pressure into lateral force and slide.
    expect(maps('zigzag').some((m) => m.sequence === 'rowByRow')).toBe(true);
  });

  it('keeps simultaneous sequencing for square glue-ups', () => {
    expect(maps().every((m) => m.sequence === 'simultaneous')).toBe(true);
  });
});

describe('map scale', () => {
  it('uses full size when the board fits the paper', () => {
    const small = { nodeId: 'n', stageLabel: 's', width: inches(4), height: inches(5), pieces: [], sequence: 'simultaneous' as const, memberCount: 0 };
    const { scale, isFullSize } = mapScale(small, { width: 7.5, height: 8.5 });
    expect(isFullSize).toBe(true);
    expect(describeScale(scale)).toMatch(/full size/);
  });

  it('reduces, and says not to measure from the drawing, when it does not fit', () => {
    const big = { nodeId: 'n', stageLabel: 's', width: inches(20), height: inches(30), pieces: [], sequence: 'simultaneous' as const, memberCount: 0 };
    const { scale, isFullSize } = mapScale(big, { width: 7.5, height: 8.5 });
    expect(isFullSize).toBe(false);
    expect(scale).toBeLessThan(1);
    expect(describeScale(scale)).toMatch(/do not measure/);
  });
});
