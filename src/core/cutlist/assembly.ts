/**
 * Glue-up assembly maps.
 *
 * For anything past a simple checkerboard the cut list is not enough. A
 * multi-stage glue-up has dozens of near-identical pieces whose ORIENTATION
 * carries the pattern, and one slice turned the wrong way ruins the board after
 * the glue is already spread.
 *
 * So every glue-up gets a map, drawn to a stated scale, with every piece
 * labelled and every orientation marked.
 */

import type { EvalResult } from '../geometry/evaluate.js';
import { boundingBox } from '../geometry/polygon.js';
import { SPECIES } from '../knowledge/species.js';
import type { Graph, LaminateOp, NodeId, SpeciesId, Ticks } from '../model/types.js';
import type { MilliDeg } from '../units/ticks.js';
import { NO_TURN, TICKS_PER_INCH, formatTicks } from '../units/ticks.js';
import { analyze } from './analyze.js';

export interface AssemblyPiece {
  readonly pieceId: string;
  readonly species: SpeciesId;
  readonly displayName: string;
  readonly colour: string;
  readonly hatch: string;
  /** The member outline in map coordinates (ticks), already placed. */
  readonly polygon: ReadonlyArray<{ x: number; y: number }>;
  /** Species regions within the member, so the pattern shows inside the piece. */
  readonly faces: ReadonlyArray<{
    polygon: ReadonlyArray<{ x: number; y: number }>;
    colour: string;
    hatch: string;
  }>;
  readonly label: string;
  /** Centre, for placing the label and the orientation arrow. */
  readonly centre: { x: number; y: number };
  /**
   * Flip and rotate are DIFFERENT operations with different results; conflating
   * them is a common way to get a mirrored pattern, so they are marked apart.
   *
   * The rotation is in millidegrees rather than a flag because a tumbling block
   * turns its sticks by 120 and 240. "Turn it round" and "turn it a third of
   * the way round" are not the same instruction, and a map that cannot tell
   * them apart is a map that builds the wrong board.
   */
  readonly rotation: MilliDeg;
  readonly mirrored: boolean;
}

export interface AssemblyMap {
  readonly nodeId: NodeId;
  readonly stageLabel: string;
  readonly width: Ticks;
  readonly height: Ticks;
  readonly pieces: readonly AssemblyPiece[];
  /** Angled joints slide under clamp pressure, so sequencing is on the map. */
  readonly sequence: 'simultaneous' | 'rowByRow';
  readonly memberCount: number;
}

export function buildAssemblyMaps(graph: Graph, evaluated: EvalResult): readonly AssemblyMap[] {
  const a = analyze(graph);
  const maps: AssemblyMap[] = [];

  for (const node of a.order) {
    if (node.op.kind !== 'laminate') continue;
    const result = evaluated.nodeOutputs.get(node.id)?.[0];
    if (!result) continue;

    const bounds = boundingBox(result.crossSection.outline);
    const op: LaminateOp = node.op;

    // Label the MEMBERS -- the pieces a builder physically picks up -- not
    // every species region inside them. A ten-slice board has eighty cells;
    // numbering all of them buries the one fact that matters, which is which
    // slice goes where and whether it is turned.
    const placements = evaluated.memberPlacements.get(node.id) ?? [];

    const pieces: AssemblyPiece[] = placements.map((placed, index) => {
      const member = op.members[index];
      const transform = member
        ? { rotation: member.rotate, mirrored: member.mirrored }
        : { rotation: NO_TURN, mirrored: false };

      const xs = placed.outline.map((p) => p.x);
      const ys = placed.outline.map((p) => p.y);

      // A member spanning several species is named for whichever covers most of
      // it, which is how someone would describe it at the bench.
      const byArea = new Map<SpeciesId, number>();
      for (const face of placed.faces) {
        const fxs = face.polygon.map((p) => p.x);
        const fys = face.polygon.map((p) => p.y);
        const extent =
          (Math.max(...fxs) - Math.min(...fxs)) * (Math.max(...fys) - Math.min(...fys));
        byArea.set(face.species, (byArea.get(face.species) ?? 0) + extent);
      }
      const dominant =
        [...byArea].sort((a, b) => b[1] - a[1])[0]?.[0] ?? placed.faces[0]?.species ?? 'mixed';
      const info = SPECIES[dominant];
      const mixed = byArea.size > 1;

      return {
        pieceId: `${node.id}-m${index}`,
        species: dominant,
        displayName: mixed ? `mixed (mostly ${info?.name ?? dominant})` : (info?.name ?? dominant),
        colour: info?.color ?? '#999999',
        hatch: info?.hatch ?? 'hatch-none',
        // The member's own faces, so the map shows the pattern within a piece
        // while the piece itself stays the labelled unit.
        polygon: placed.outline,
        faces: placed.faces.map((f) => ({
          polygon: f.polygon,
          colour: SPECIES[f.species]?.color ?? '#999999',
          hatch: SPECIES[f.species]?.hatch ?? 'hatch-none',
        })),
        label: String(index + 1),
        centre: {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        },
        rotation: transform.rotation,
        mirrored: transform.mirrored,
      };
    });

    maps.push({
      nodeId: node.id,
      stageLabel: node.label ?? 'Glue-up',
      width: (bounds.maxX - bounds.minX) as Ticks,
      height: (bounds.maxY - bounds.minY) as Ticks,
      pieces,
      sequence: op.sequence,
      memberCount: op.members.length,
    });
  }

  return maps;
}

/**
 * The largest scale at which a map fits the printable area.
 *
 * A map is only useful if its stated scale is honest, so the scale is computed
 * from the paper rather than assumed, and 1:1 is used whenever the board is
 * small enough to lay the parts directly on the sheet.
 */
export function mapScale(
  map: AssemblyMap,
  printableInches: { width: number; height: number },
): { scale: number; isFullSize: boolean } {
  const widthIn = map.width / TICKS_PER_INCH;
  const heightIn = map.height / TICKS_PER_INCH;
  const fit = Math.min(printableInches.width / widthIn, printableInches.height / heightIn);
  const scale = Math.min(1, fit);
  return { scale, isFullSize: scale >= 1 };
}

export function describeScale(scale: number): string {
  if (scale >= 1) return 'full size (1:1)';
  const denominator = Math.round(1 / scale);
  return `1:${denominator} — do not measure from this drawing`;
}

export function summariseMap(map: AssemblyMap): string {
  return `${map.memberCount} pieces · ${formatTicks(map.width)} × ${formatTicks(map.height)}`;
}
