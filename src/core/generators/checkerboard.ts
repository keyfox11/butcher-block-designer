/**
 * Checkerboard and brick generators.
 *
 * A generator emits a construction graph, not a picture. It therefore cannot
 * produce an unbuildable design, and it cannot disagree with its own cut list,
 * because the cut list is derived from the same graph.
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
  NodeId,
  RingOrientation,
  ShopProfile,
  SpeciesId,
  Ticks,
} from '../model/types.js';
import { milliDeg, ticks } from '../units/ticks.js';

const SQUARE = milliDeg(0);

export interface CheckerboardParams {
  /** Square cell. Also sets stock thickness and rip width, since w = D. */
  readonly cellSize: Ticks;
  readonly speciesA: SpeciesId;
  readonly speciesB: SpeciesId;
  /** Cells across the board's width. */
  readonly columns: number;
  /** Cells along the board's length. */
  readonly rows: number;
  /** Finished thickness; the crosscut is made oversize by the flattening allowance. */
  readonly boardThickness: Ticks;
  readonly ringOrientation?: RingOrientation;
  readonly flattenPerFace?: Ticks;
  readonly trimPerEdge?: Ticks;
  /** Half-cell offset per row instead of a full-cell alternation. */
  readonly bond?: 'checker' | 'brick';
}

export interface GeneratedGraph {
  readonly graph: Graph;
  /** Derived numbers the cut list and UI need without re-deriving them. */
  readonly derived: {
    readonly sliceLength: Ticks;
    readonly panelLength: Ticks;
    readonly panelWidth: Ticks;
    readonly finishedWidth: Ticks;
    readonly finishedLength: Ticks;
    readonly finishedThickness: Ticks;
    /** Two panels are needed when a single one cannot produce the offset. */
    readonly panelCount: number;
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

/**
 * Checkerboard, including the odd-column case.
 *
 * Rotating alternate slices 180 degrees reverses their species sequence, which
 * produces the offset only when the strip count is EVEN:
 *
 *     A B A B A B  ->  B A B A B A    checkerboard
 *     A B A B A    ->  A B A B A      stripes, not a checkerboard
 *
 * So an odd column count is built from two stage-1 panels with inverted species
 * order, drawing alternate slices from each. That costs a little more lumber
 * and one more rip setup, and it is the only way to get a true checkerboard
 * with an odd cell count. Silently rounding the count to even would change the
 * finished dimensions without telling anyone.
 */
export function checkerboard(params: CheckerboardParams, shop: ShopProfile): GeneratedGraph {
  const {
    cellSize,
    speciesA,
    speciesB,
    columns,
    rows,
    boardThickness,
    ringOrientation = 'quartersawn',
    flattenPerFace = DEFAULT_FLATTEN_PER_FACE,
    trimPerEdge = DEFAULT_TRIM_PER_EDGE,
    bond = 'checker',
  } = params;

  if (columns < 2 || rows < 2) throw new Error('A checkerboard needs at least 2 columns and 2 rows');
  if (cellSize <= 0 || boardThickness <= 0) throw new Error('Cell size and thickness must be positive');

  const b = new GraphBuilder();

  // Thickness is set by the crosscut, cut oversize by what flattening removes.
  const sliceLength = ticks(boardThickness + 2 * flattenPerFace);

  const panelWidth = ticks(columns * cellSize);
  const needsTwoPanels = bond === 'brick' || columns % 2 === 1;

  // Each panel is only as long as the slices IT supplies. Building both at the
  // full length and taking half the slices from each would nearly double the
  // lumber for the same board -- which is what the material multiplier check
  // (V-MAT-020) exists to catch.
  const slicesFromA = needsTwoPanels ? Math.ceil(rows / 2) : rows;
  const slicesFromB = needsTwoPanels ? Math.floor(rows / 2) : 0;

  // n slices need n-1 internal kerfs, plus an allowance to square the ends.
  const lengthFor = (slices: number): Ticks =>
    ticks(slices * sliceLength + Math.max(slices - 1, 0) * shop.kerf + 2 * trimPerEdge);

  const panelA = buildPanel(b, {
    order: 'AB',
    columns,
    cellSize,
    speciesA,
    speciesB,
    ringOrientation,
    panelLength: lengthFor(slicesFromA),
    shop,
    bond,
  });

  const panelB = needsTwoPanels
    ? buildPanel(b, {
        order: bond === 'brick' ? 'AB' : 'BA',
        columns,
        cellSize,
        speciesA,
        speciesB,
        ringOrientation,
        panelLength: lengthFor(slicesFromB),
        shop,
        bond,
        halfCellEnds: bond === 'brick',
      })
    : panelA;

  const panelLength = lengthFor(slicesFromA);

  const cutA = b.add(
    { kind: 'crosscut', input: { node: panelA, port: 0 }, sliceLength, count: slicesFromA, miter: SQUARE },
    'Crosscut panel A into slices',
  );
  const cutB =
    slicesFromB > 0
      ? b.add(
          {
            kind: 'crosscut',
            input: { node: panelB, port: 0 },
            sliceLength,
            count: slicesFromB,
            miter: SQUARE,
          },
          'Crosscut panel B into slices',
        )
      : null;

  // Rotate each slice so end grain faces up, then glue them edge to edge.
  // Reorienting per slice rather than after the glue-up matches what actually
  // happens at the bench, which makes the generated instructions read correctly.
  const members: LaminateMember[] = [];
  let takenA = 0;
  let takenB = 0;

  for (let row = 0; row < rows; row++) {
    const fromA = !needsTwoPanels || row % 2 === 0;
    const source = fromA ? cutA : cutB;
    if (!source) throw new Error('Internal: expected a second panel for this bond');
    const port = fromA ? takenA++ : takenB++;

    const rotated = b.add(
      { kind: 'reorient', input: { node: source, port }, mode: 'toEndGrain' },
      `Rotate slice ${row + 1} to end grain`,
    );

    members.push({
      piece: { node: rotated, port: 0 },
      offset: { x: ticks(0), y: ticks(row * cellSize) },
      // With a single panel the offset comes from reversing the sequence.
      rotate180: !needsTwoPanels && row % 2 === 1,
      mirrored: false,
    });
  }

  const glued = b.add({ kind: 'laminate', members, sequence: 'simultaneous' }, 'Glue slices into the board');

  const flattened = b.add(
    { kind: 'flatten', input: { node: glued, port: 0 }, method: 'drumSander', removePerFace: flattenPerFace },
    'Flatten the board',
  );

  const finishedWidth = ticks(panelWidth - 2 * trimPerEdge);
  const finishedLength = ticks(rows * cellSize - 2 * trimPerEdge);

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
      panelWidth,
      finishedWidth,
      finishedLength,
      finishedThickness: boardThickness,
      panelCount: needsTwoPanels ? 2 : 1,
    },
  };
}

interface PanelSpec {
  order: 'AB' | 'BA';
  columns: number;
  cellSize: Ticks;
  speciesA: SpeciesId;
  speciesB: SpeciesId;
  ringOrientation: RingOrientation;
  panelLength: Ticks;
  shop: ShopProfile;
  bond: 'checker' | 'brick';
  /** Start and end with a half-width strip, giving a half-cell row offset. */
  halfCellEnds?: boolean;
}

/**
 * Build one stage-1 panel: rip strips from each species, then glue them edge to
 * edge in alternating order.
 *
 * Stock is milled to `cellSize` thick and ripped to `cellSize` wide, which is
 * what makes the cells square: the face cell is (rip width) x (stock thickness).
 */
function buildPanel(b: GraphBuilder, spec: PanelSpec): NodeId {
  const { columns, cellSize, speciesA, speciesB, ringOrientation, panelLength, shop } = spec;

  // Widths of each strip across the panel, left to right.
  const widths: Ticks[] = [];
  if (spec.halfCellEnds) {
    // A brick row: half cell, then whole cells, then half cell. Same overall
    // width as the plain panel, offset by half a cell -- so every row is
    // complete and nothing has to be trimmed off the edges.
    widths.push(ticks(Math.floor(cellSize / 2)));
    for (let i = 0; i < columns - 1; i++) widths.push(cellSize);
    widths.push(ticks(cellSize - Math.floor(cellSize / 2)));
  } else {
    for (let i = 0; i < columns; i++) widths.push(cellSize);
  }

  const speciesOf = (index: number): SpeciesId => {
    const first = spec.order === 'AB' ? speciesA : speciesB;
    const second = spec.order === 'AB' ? speciesB : speciesA;
    return index % 2 === 0 ? first : second;
  };

  // Group the strips by species so each is ripped from one billet.
  const bySpecies = new Map<SpeciesId, number[]>();
  widths.forEach((_, index) => {
    const id = speciesOf(index);
    const list = bySpecies.get(id) ?? [];
    list.push(index);
    bySpecies.set(id, list);
  });

  const stripRef = new Map<number, { node: NodeId; port: number }>();

  for (const [id, indices] of bySpecies) {
    const stripWidths = indices.map((i) => widths[i]!);
    const totalWidth = stripWidths.reduce((s, w) => s + w + shop.kerf, 0);

    // Rough stock is oversize by the milling allowance, which is real material
    // and belongs in the lumber order.
    const milled = {
      thickness: cellSize,
      width: ticks(totalWidth + DEFAULT_MILLING_ALLOWANCE.width),
      length: panelLength,
    };
    const billet = b.add(
      {
        kind: 'billet',
        species: id,
        rough: {
          thickness: ticks(milled.thickness + DEFAULT_MILLING_ALLOWANCE.thickness),
          width: ticks(milled.width + DEFAULT_MILLING_ALLOWANCE.width),
          length: ticks(milled.length + DEFAULT_MILLING_ALLOWANCE.length),
        },
        milled,
        ringOrientation,
      },
      `${id} stock`,
    );

    const rip = b.add(
      {
        kind: 'rip',
        input: { node: billet, port: 0 },
        strips: stripWidths.map((w) => ({ width: w, bevel: SQUARE })),
      },
      `Rip ${id} into ${stripWidths.length} strips`,
    );

    indices.forEach((stripIndex, port) => stripRef.set(stripIndex, { node: rip, port }));
  }

  // Glue the strips edge to edge in pattern order.
  let x = 0;
  const members: LaminateMember[] = widths.map((w, index) => {
    const ref = stripRef.get(index);
    if (!ref) throw new Error(`Internal: no strip for column ${index}`);
    const member: LaminateMember = {
      piece: ref,
      offset: { x: ticks(x), y: ticks(0) },
      rotate180: false,
      mirrored: false,
    };
    x += w;
    return member;
  });

  return b.add({ kind: 'laminate', members, sequence: 'simultaneous' }, 'Glue the stage-1 panel');
}
