/**
 * The layered-panel generator.
 *
 * One generator covers everything CBDJS's model can express -- stripes, bands,
 * diagonal accents, zig-zag, chevron, snake skin and spiral -- because they are
 * all the same thing: a stack of layers with a width, a species, and an angle
 * on the boundary that follows, sliced and optionally transformed.
 *
 * Unlike CBDJS this emits a construction graph, so each pattern arrives with a
 * cut list that cannot disagree with it, and with real bevel cuts the validator
 * can check against the saw.
 */

import {
  DEFAULT_FLATTEN_PER_FACE,
  DEFAULT_MILLING_ALLOWANCE,
  DEFAULT_TRIM_PER_EDGE,
} from '../model/defaults.js';
import type {
  Graph,
  GraphNode,
  LaminateMember,
  MilliDeg,
  NodeId,
  RingOrientation,
  ShopProfile,
  SpeciesId,
  Ticks,
} from '../model/types.js';
import { milliDeg, ticks, toRadians } from '../units/ticks.js';

const SQUARE = milliDeg(0);

export interface Layer {
  readonly species: SpeciesId;
  readonly width: Ticks;
  /**
   * Angle of the boundary that FOLLOWS this layer, measured from vertical --
   * CBDJS calls it the trailing angle. The boundary shifts sideways by
   * `panelThickness * tan(angle)` as it crosses the panel (KB-A06).
   *
   * The final layer's value is ignored: the panel's outer edge is cut square so
   * the panel is a clean rectangle. CBDJS leaves that edge ragged and reports
   * the maximum width, which in a real shop just becomes trim.
   */
  readonly trailingAngle: MilliDeg;
}

export interface LayeredBoardParams {
  readonly layers: readonly Layer[];
  /** Slices taken from the panel; each contributes `sourceThickness` to length. */
  readonly rows: number;
  readonly boardThickness: Ticks;
  /** Stage-1 panel thickness. This is the pitch (KB-A02). */
  readonly sourceThickness: Ticks;
  /**
   * What to do with alternate slices. Rotating reverses a slice's sequence;
   * flipping mirrors it. They are different operations with different results,
   * which is why they are named separately rather than merged into "alternate".
   */
  readonly sliceTransform?: 'none' | 'rotateAlternate' | 'flipAlternate';
  readonly ringOrientation?: RingOrientation;
  readonly flattenPerFace?: Ticks;
  readonly trimPerEdge?: Ticks;
}

export interface LayeredResult {
  readonly graph: Graph;
  readonly derived: {
    readonly sliceLength: Ticks;
    readonly panelLength: Ticks;
    readonly panelWidthAtTable: Ticks;
    readonly finishedThickness: Ticks;
    /** Cuts made only to establish a bevelled edge; their output is waste. */
    readonly setupCuts: number;
    readonly hasBevels: boolean;
  };
}

class GraphBuilder {
  private readonly nodes: Record<NodeId, GraphNode> = {};
  private counter = 0;

  add(op: GraphNode['op'], label?: string): NodeId {
    const id = `n${++this.counter}`;
    this.nodes[id] = label === undefined ? { id, op } : { id, op, label };
    return id;
  }

  build(output: { node: NodeId; port: number }): Graph {
    return { nodes: this.nodes, output };
  }
}

export function layeredBoard(params: LayeredBoardParams, shop: ShopProfile): LayeredResult {
  const {
    layers,
    rows,
    boardThickness,
    sourceThickness,
    sliceTransform = 'none',
    ringOrientation = 'quartersawn',
    flattenPerFace = DEFAULT_FLATTEN_PER_FACE,
    trimPerEdge = DEFAULT_TRIM_PER_EDGE,
  } = params;

  if (layers.length < 2) throw new Error('A layered board needs at least 2 layers');
  if (rows < 2) throw new Error('A layered board needs at least 2 slices');
  if (boardThickness <= 0 || sourceThickness <= 0) {
    throw new Error('Thicknesses must be positive');
  }

  const b = new GraphBuilder();

  const sliceLength = ticks(boardThickness + 2 * flattenPerFace);
  const panelLength = ticks(rows * sliceLength + (rows - 1) * shop.kerf + 2 * trimPerEdge);

  // Boundary j sits between layer j and layer j+1. Both outer edges are square,
  // so the assembled panel is a rectangle and nothing has to be trimmed off the
  // sides to square it.
  const boundary = (index: number): MilliDeg =>
    index < 0 || index >= layers.length - 1 ? SQUARE : layers[index]!.trailingAngle;

  const edges = layers.map((_, i) => ({ left: boundary(i - 1), right: boundary(i) }));
  const hasBevels = edges.some((e) => e.left !== SQUARE || e.right !== SQUARE);

  /* ---- Rip each species' strips from one billet -------------------------- */

  const bySpecies = new Map<SpeciesId, number[]>();
  layers.forEach((layer, index) => {
    const list = bySpecies.get(layer.species) ?? [];
    list.push(index);
    bySpecies.set(layer.species, list);
  });

  const stripRef = new Map<number, { node: NodeId; port: number }>();
  let setupCuts = 0;

  for (const [species, indices] of bySpecies) {
    const cuts: Array<{ width: Ticks; bevel: MilliDeg }> = [];
    // Which cut index yields each wanted strip; everything else is waste that
    // the ledger will account for as an offcut.
    const wanted = new Map<number, number>();

    // The billet arrives with square edges, so the first bevelled left edge has
    // to be established by a cut of its own.
    let currentEdge: MilliDeg = SQUARE;

    for (const layerIndex of indices) {
      const edge = edges[layerIndex]!;
      if (edge.left !== currentEdge) {
        // A setup cut: its kept piece is waste, but it must still be a cut the
        // saw can actually make.
        //
        // A bevelled strip's two faces have DIFFERENT widths. A setup piece at
        // the bare minimum width would compute to a negative width at one face
        // once the drift exceeds it -- at 30 degrees over 1 1/2" stock the
        // drift is 0.866", which turns a 1/2" setup into -0.366". Adding the
        // drift keeps the narrow face at the minimum whichever way the blade
        // leans.
        const drift = Math.abs(sourceThickness * Math.tan(toRadians(edge.left)));
        cuts.push({ width: ticks(Math.ceil(shop.minSafeRipWidth + drift)), bevel: edge.left });
        setupCuts++;
      }
      wanted.set(layerIndex, cuts.length);
      cuts.push({ width: layers[layerIndex]!.width, bevel: edge.right });
      currentEdge = edge.right;
    }

    // Stock has to cover the cuts' rightmost reach, not just the sum of the
    // fence settings. A bevelled cut drifts sideways by
    // `thickness * tan(bevel)` as it crosses the panel, so at the top face the
    // cuts march progressively further right than at the table face. Sizing
    // from table-face widths alone leaves the last strip truncated.
    let cursor = 0;
    let reach = 0;
    for (const cut of cuts) {
      cursor += cut.width + shop.kerf;
      const drift = sourceThickness * Math.tan(toRadians(cut.bevel));
      reach = Math.max(reach, cursor + Math.max(0, drift));
    }

    const milled = {
      thickness: sourceThickness,
      width: ticks(Math.ceil(reach) + DEFAULT_MILLING_ALLOWANCE.width),
      length: panelLength,
    };

    const billet = b.add(
      {
        kind: 'billet',
        species,
        rough: {
          thickness: ticks(milled.thickness + DEFAULT_MILLING_ALLOWANCE.thickness),
          width: ticks(milled.width + DEFAULT_MILLING_ALLOWANCE.width),
          length: ticks(milled.length + DEFAULT_MILLING_ALLOWANCE.length),
        },
        milled,
        ringOrientation,
      },
      `${species} stock`,
    );

    const rip = b.add(
      { kind: 'rip', input: { node: billet, port: 0 }, strips: cuts },
      `Rip ${species} into ${indices.length} strip${indices.length === 1 ? '' : 's'}`,
    );

    for (const [layerIndex, port] of wanted) stripRef.set(layerIndex, { node: rip, port });
  }

  /* ---- Glue the stage-1 panel -------------------------------------------- */

  const panelMembers: LaminateMember[] = layers.map((_, index) => {
    const ref = stripRef.get(index);
    if (!ref) throw new Error(`Internal: no strip for layer ${index}`);
    return { piece: ref, offset: { x: ticks(0), y: ticks(0) }, rotate180: false, mirrored: false };
  });

  const panel = b.add(
    hasBevels
      ? {
          kind: 'laminate',
          members: panelMembers,
          // Bevelled strips interlock, so they are positioned by their mating
          // edges rather than by an offset every generator would have to
          // re-derive. Angled joints also slide under clamp pressure, so they
          // are glued row by row (KB-A11).
          placement: 'butted',
          sequence: 'rowByRow',
        }
      : {
          kind: 'laminate',
          members: withCumulativeOffsets(panelMembers, layers),
          placement: 'explicit',
          sequence: 'simultaneous',
        },
    'Glue the stage-1 panel',
  );

  /* ---- Crosscut, rotate, and glue the board ------------------------------ */

  const crosscut = b.add(
    { kind: 'crosscut', input: { node: panel, port: 0 }, sliceLength, count: rows, miter: SQUARE },
    'Crosscut the panel into slices',
  );

  const members: LaminateMember[] = [];
  for (let row = 0; row < rows; row++) {
    const rotated = b.add(
      { kind: 'reorient', input: { node: crosscut, port: row }, mode: 'toEndGrain' },
      `Rotate slice ${row + 1} to end grain`,
    );
    const alternate = row % 2 === 1;
    members.push({
      piece: { node: rotated, port: 0 },
      offset: { x: ticks(0), y: ticks(row * sourceThickness) },
      rotate180: alternate && sliceTransform === 'rotateAlternate',
      mirrored: alternate && sliceTransform === 'flipAlternate',
    });
  }

  const glued = b.add(
    { kind: 'laminate', members, placement: 'explicit', sequence: 'simultaneous' },
    'Glue the slices into the board',
  );

  const flattened = b.add(
    {
      kind: 'flatten',
      input: { node: glued, port: 0 },
      method: 'drumSander',
      removePerFace: flattenPerFace,
    },
    'Flatten the board',
  );

  const panelWidthAtTable = ticks(layers.reduce((sum, l) => sum + l.width, 0));
  const finishedWidth = ticks(panelWidthAtTable - 2 * trimPerEdge);
  const finishedLength = ticks(rows * sourceThickness - 2 * trimPerEdge);

  const trimmed = b.add(
    {
      kind: 'trim',
      input: { node: flattened, port: 0 },
      target: { kind: 'rect', width: finishedWidth, height: finishedLength },
    },
    'Square up to final size',
  );

  return {
    graph: b.build({ node: trimmed, port: 0 }),
    derived: {
      sliceLength,
      panelLength,
      panelWidthAtTable,
      finishedThickness: boardThickness,
      setupCuts,
      hasBevels,
    },
  };
}

/** Square panels place strips by cumulative width; no mating edges to find. */
function withCumulativeOffsets(
  members: readonly LaminateMember[],
  layers: readonly Layer[],
): LaminateMember[] {
  let x = 0;
  return members.map((m, i) => {
    const placed = { ...m, offset: { x: ticks(x), y: ticks(0) } };
    x += layers[i]!.width;
    return placed;
  });
}
