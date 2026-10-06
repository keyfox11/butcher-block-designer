/**
 * The 3D cube / tumbling block.
 *
 * The pattern no layer-stack tool can express, and the reason this project
 * models construction rather than pictures. A tumbling block is not a grid: it
 * is a honeycomb of hexagonal prisms, each prism glued from three rhombus
 * sticks, and no amount of parameterising a list of horizontal bands will ever
 * produce one.
 *
 * Everything below follows from ONE number, the stock thickness T
 * ([KB-A05](../../../docs/spec/01-woodworking-domain.md)):
 *
 *     bevel            = 30 degrees from vertical (60 from the table)
 *     ripWidthOnFace   = T / cos(30) = 1.154700 x T      <- the closure condition
 *     hexAcrossFlats   = 2 x T                           <- exact
 *     hexAcrossCorners = 2.309401 x T
 *
 * That second identity is a free correctness check, and `V-GEOM-050` spends it:
 * if a hex puck is not exactly twice the stock thickness across the flats, the
 * rhombus is not a rhombus and the cubes will not read as cubes.
 *
 * ## Why the integer arithmetic is arranged the way it is
 *
 * A regular hexagon has irrational vertices, so it cannot sit exactly on a tick
 * grid. Rather than scatter that error, it is concentrated in a single integer:
 *
 *     d = round(T x tan(30))        the sideways drift of one bevelled cut
 *
 * and then every other dimension is written as an integer multiple of d or T --
 * the rip width is 2d rather than round(2T/sqrt(3)), the lattice pitches are 2T
 * and 3d. The two differ by at most one tick, which is 1/8000" and far below
 * anything a saw can hold, but it makes the honeycomb lattice land on exact
 * integers at every cell no matter how large the board. The only rounding left
 * is the rhombus rotation itself, which the union welder is sized to absorb.
 */

import { DEFAULT_FLATTEN_PER_FACE, DEFAULT_MILLING_ALLOWANCE, DEFAULT_TRIM_PER_EDGE } from '../model/defaults.js';
import type {
  Graph,
  LaminateMember,
  MilliDeg,
  NodeId,
  RingOrientation,
  ShopProfile,
  SpeciesId,
  Ticks,
} from '../model/types.js';
import { NO_TURN, degrees, inches, milliDeg, ticks, toRadians } from '../units/ticks.js';
import { maxSlices } from '../geometry/evaluate.js';
import { GraphBuilder } from './builder.js';

/** 30 degrees from vertical: the blade sits 60 degrees to the table. */
export const CUBE_BEVEL = degrees(30);

/**
 * How the jagged honeycomb border becomes a rectangular board.
 *
 * Hexagons cannot tile a rectangle, so this is a decision the builder has to
 * make and the finished dimensions depend on which way it goes. The tool plans
 * one of these explicitly rather than quietly cutting through and hoping.
 */
export type EdgeResolution =
  /** Accept partial cubes at the border. Exact requested dimensions. */
  | 'trimThrough'
  /**
   * Grow the board to a whole number of lattice periods. The pattern then
   * repeats seamlessly across the cut edges -- opposite borders are identical,
   * so the board reads as a window onto a continuing field rather than as a
   * pattern that ran out. The finished size is no longer what was asked for,
   * and the tool says so.
   */
  | 'growToWhole';

export interface TumblingBlockParams {
  /** The one parameter. Every other dimension is derived from it. */
  readonly stockThickness: Ticks;
  /** The cube's top face. */
  readonly speciesTop: SpeciesId;
  readonly speciesLeft: SpeciesId;
  readonly speciesRight: SpeciesId;
  readonly targetWidth: Ticks;
  readonly targetLength: Ticks;
  readonly boardThickness: Ticks;
  readonly edgeResolution?: EdgeResolution;
  readonly ringOrientation?: RingOrientation;
  readonly flattenPerFace?: Ticks;
  readonly trimPerEdge?: Ticks;
  /** Longest hex prism to handle at the saw. Three taped sticks get unwieldy. */
  readonly maxPrismLength?: Ticks;
}

export interface TumblingBlockDerived {
  readonly bevel: MilliDeg;
  /** Fence setting for each rhombus stick, at the face against the table. */
  readonly ripWidth: Ticks;
  readonly hexAcrossFlats: Ticks;
  readonly hexAcrossCorners: Ticks;
  /** Centre-to-centre spacing of the honeycomb, across and along the board. */
  readonly latticePitch: { x: Ticks; y: Ticks };
  readonly puckLength: Ticks;
  readonly puckCount: number;
  readonly prismCount: number;
  readonly pucksPerPrism: number;
  readonly sticksPerSpecies: number;
  readonly prismLength: Ticks;
  /** Cubes the trim passes through. Never zero for a rectangular board. */
  readonly partialCells: number;
  readonly edgeResolution: EdgeResolution;
  readonly finishedWidth: Ticks;
  readonly finishedLength: Ticks;
  readonly finishedThickness: Ticks;
  /** Set when `growToWhole` moved the finished size away from the request. */
  readonly grewFrom?: { width: Ticks; length: Ticks };
}

export interface TumblingBlockResult {
  readonly graph: Graph;
  readonly derived: TumblingBlockDerived;
}

interface Cell {
  readonly col: number;
  readonly row: number;
  /** Hexagon centre, in lattice coordinates before the assembly is shifted. */
  readonly cx: number;
  readonly cy: number;
}

export function tumblingBlock(
  params: TumblingBlockParams,
  shop: ShopProfile,
): TumblingBlockResult {
  const {
    stockThickness: T,
    speciesTop,
    speciesLeft,
    speciesRight,
    targetWidth,
    targetLength,
    boardThickness,
    edgeResolution = 'trimThrough',
    ringOrientation = 'quartersawn',
    flattenPerFace = DEFAULT_FLATTEN_PER_FACE,
    trimPerEdge = DEFAULT_TRIM_PER_EDGE,
    maxPrismLength = inches(36),
  } = params;

  if (T <= 0) throw new Error('Stock thickness must be positive');
  if (boardThickness <= 0) throw new Error('Board thickness must be positive');
  if (targetWidth <= 0 || targetLength <= 0) throw new Error('Target size must be positive');

  /* ---- The hexagon ------------------------------------------------------- */

  // THE closure condition, and the one quantity that must be rounded directly.
  //
  // It is tempting to round `T x tan(30)` instead and build everything from
  // that integer, because it makes the lattice land on exact multiples. It is
  // also wrong: across-flats is `ripWidth x sqrt(3)`, so rounding the wrong
  // quantity moves the hexagon off 2T by a couple of ticks -- a violation of
  // the very identity V-GEOM-050 exists to check, introduced by the tool
  // itself.
  const ripWidth = ticks(Math.round(T / Math.cos(toRadians(CUBE_BEVEL))));
  if (ripWidth <= 0) throw new Error('Stock is too thin to bevel-rip into rhombus sticks');

  const hexAcrossFlats = ticks(2 * T);
  const hexAcrossCorners = ticks(2 * ripWidth);

  // Pointy-top hexagons: flats left and right, points up and down, so each cube
  // gets a flat top face and reads the way a tumbling block should.
  //
  // Row pitch is three quarters of across-corners, which is 1.5 x the rhombus
  // side. Derived from `ripWidth` rather than from T, so the lattice matches the
  // hexagon that actually gets glued up rather than an idealised one.
  //
  // Kept as a float and rounded at each row rather than rounded once and
  // multiplied, so the error stays below half a tick at row 2 and at row 20
  // alike instead of growing with the board.
  const pitchX = 2 * T;
  const pitchY = 1.5 * ripWidth;
  const oddRowShift = T;
  /** Vertical half-extent of a cell: half of across-corners. */
  const halfHeight = ripWidth;

  /* ---- Which cells to lay up --------------------------------------------- */

  const grown =
    edgeResolution === 'growToWhole'
      ? {
          // A whole number of periods makes opposite borders identical, so the
          // pattern continues across the cut instead of stopping at it. The
          // period is TWO rows and TWO columns, because alternate rows are
          // offset by half a cell.
          //
          // Both periods are exact integers even though a single row pitch is
          // not: two rows span `2 x 1.5 x ripWidth = 3 x ripWidth`, so the half
          // tick cancels. Snapping to the double period is therefore exact, and
          // the finished dimension needs no rounding at all.
          width: ticks(Math.max(1, Math.round(targetWidth / (2 * pitchX))) * 2 * pitchX),
          length: ticks(Math.max(1, Math.round(targetLength / (3 * ripWidth))) * 3 * ripWidth),
        }
      : null;

  const finishedWidth = grown?.width ?? targetWidth;
  const finishedLength = grown?.length ?? targetLength;

  const cells = coveringCells(finishedWidth, finishedLength, { pitchX, pitchY, oddRowShift, T, halfHeight });
  if (cells.length === 0) throw new Error('No hex cells cover the requested board');

  const minX = Math.min(...cells.map((c) => c.cx - T));
  const minY = Math.min(...cells.map((c) => c.cy - halfHeight));
  const maxX = Math.max(...cells.map((c) => c.cx + T));
  const maxY = Math.max(...cells.map((c) => c.cy + halfHeight));

  if (maxX - minX < finishedWidth || maxY - minY < finishedLength) {
    throw new Error('Internal: the honeycomb does not cover the finished board');
  }

  /* ---- Prisms and pucks --------------------------------------------------- */

  const puckLength = ticks(boardThickness + 2 * flattenPerFace);
  const puckCount = cells.length;

  const wantedLength = puckCount * (puckLength + shop.kerf) + 2 * trimPerEdge;
  const prismLength = ticks(Math.min(maxPrismLength, wantedLength));
  const pucksPerPrism = maxSlices(ticks(prismLength - 2 * trimPerEdge), puckLength, shop.kerf);
  if (pucksPerPrism < 1) {
    throw new Error('A prism this short cannot yield even one puck of the requested thickness');
  }
  const prismCount = Math.ceil(puckCount / pucksPerPrism);

  /* ---- Build -------------------------------------------------------------- */

  const b = new GraphBuilder();

  // One billet per species, ripped into one stick per prism. All three species
  // see the same cuts, because all three rhombi are the same rhombus.
  const stickSource = new Map<SpeciesId, NodeId>();
  for (const species of [speciesTop, speciesLeft, speciesRight]) {
    if (stickSource.has(species)) continue;
    stickSource.set(
      species,
      ripSticks(b, {
        species,
        stockThickness: T,
        ripWidth,
        sticks: countOf([speciesTop, speciesLeft, speciesRight], species) * prismCount,
        prismLength,
        ringOrientation,
        shop,
      }),
    );
  }

  // Ports consumed per species, since one billet may serve two cube faces.
  // Port 0 is the setup cut, which is waste -- the usable sticks start at 1.
  const nextPort = new Map<SpeciesId, number>();
  const takeStick = (species: SpeciesId) => {
    const node = stickSource.get(species);
    if (node === undefined) throw new Error(`Internal: no stick source for ${species}`);
    const taken = nextPort.get(species) ?? 0;
    nextPort.set(species, taken + 1);
    return { node, port: taken + 1 };
  };

  // Each rhombus is the SAME stick turned about its own length. A 60-degree
  // rhombus has 180-degree symmetry, so no combination of half-turns and
  // mirroring reaches the third orientation -- only a real rotation does.
  const faces: Array<{ species: SpeciesId; rotate: MilliDeg; offset: { x: number; y: number }; name: string }> = [
    { species: speciesLeft, rotate: milliDeg(90_000), offset: { x: 0, y: 0 }, name: 'lower-left face' },
    { species: speciesRight, rotate: milliDeg(210_000), offset: { x: T, y: 0 }, name: 'lower-right face' },
    { species: speciesTop, rotate: milliDeg(330_000), offset: { x: 0, y: ripWidth }, name: 'top face' },
  ];

  const puckRefs: Array<{ node: NodeId; port: number }> = [];
  let pucksMade = 0;

  for (let p = 0; p < prismCount; p++) {
    const members: LaminateMember[] = faces.map((face) => ({
      piece: takeStick(face.species),
      offset: { x: ticks(face.offset.x), y: ticks(face.offset.y) },
      rotate: face.rotate,
      mirrored: false,
    }));

    const prism = b.add(
      // Free placement: the union of three rhombi is a hexagon, and a bounding
      // box would claim the four corners it does not fill.
      { kind: 'laminate', members, placement: 'free', sequence: 'simultaneous' },
      `Glue hex prism ${p + 1} (tape, do not clamp)`,
    );

    const take = Math.min(pucksPerPrism, puckCount - pucksMade);
    const cut = b.add(
      {
        kind: 'crosscut',
        input: { node: prism, port: 0 },
        sliceLength: puckLength,
        count: take,
        miter: milliDeg(0),
      },
      `Crosscut prism ${p + 1} into ${take} puck${take === 1 ? '' : 's'}`,
    );

    for (let i = 0; i < take; i++) {
      puckRefs.push({
        node: b.add(
          { kind: 'reorient', input: { node: cut, port: i }, mode: 'toEndGrain' },
          `Stand puck ${pucksMade + i + 1} on end`,
        ),
        port: 0,
      });
    }
    pucksMade += take;
  }

  // Every puck goes down unturned. That is the whole illusion: each cube shows
  // the same species on the same face, so the eye reads one light source.
  const honeycombMembers: LaminateMember[] = cells.map((cell, index) => {
    const ref = puckRefs[index];
    if (!ref) throw new Error('Internal: ran out of pucks for the honeycomb');
    return {
      piece: ref,
      offset: { x: ticks(Math.round(cell.cx - T - minX)), y: ticks(Math.round(cell.cy - halfHeight - minY)) },
      rotate: NO_TURN,
      mirrored: false,
    };
  });

  const honeycomb = b.add(
    {
      kind: 'laminate',
      members: honeycombMembers,
      placement: 'free',
      // 60-degree joints convert clamp pressure into sideways force and the
      // pucks slide out of the lattice (KB-A11).
      sequence: 'rowByRow',
    },
    'Lay up the honeycomb',
  );

  const flattened = b.add(
    {
      kind: 'flatten',
      input: { node: honeycomb, port: 0 },
      method: 'drumSander',
      removePerFace: flattenPerFace,
    },
    'Flatten the board',
  );

  const trimmed = b.add(
    {
      kind: 'trim',
      input: { node: flattened, port: 0 },
      target: { kind: 'rect', width: finishedWidth, height: finishedLength },
    },
    'Trim the ragged honeycomb border to size',
  );

  return {
    graph: b.build({ node: trimmed, port: 0 }),
    derived: {
      bevel: CUBE_BEVEL,
      ripWidth,
      hexAcrossFlats,
      hexAcrossCorners,
      latticePitch: { x: ticks(pitchX), y: ticks(Math.round(pitchY)) },
      puckLength,
      puckCount,
      prismCount,
      pucksPerPrism,
      sticksPerSpecies: prismCount,
      prismLength,
      partialCells: countPartial(cells, {
        T,
        halfHeight,
        window: centredWindow(minX, minY, maxX, maxY, finishedWidth, finishedLength),
      }),
      edgeResolution,
      finishedWidth,
      finishedLength,
      finishedThickness: boardThickness,
      ...(grown ? { grewFrom: { width: targetWidth, length: targetLength } } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The lattice                                                                 */
/* -------------------------------------------------------------------------- */

interface Lattice {
  pitchX: number;
  pitchY: number;
  oddRowShift: number;
  T: number;
  halfHeight: number;
}

/**
 * Every cell with material inside the finished rectangle.
 *
 * Membership is tested by overlap rather than by containment, so the set covers
 * the target completely: any point of the board lies in some hexagon, that
 * hexagon overlaps the target, and so it is laid up. Cells that merely touch
 * along an edge are left out -- they would contribute no material and cost a
 * puck.
 */
function coveringCells(width: number, length: number, lattice: Lattice): Cell[] {
  const { pitchX, pitchY, oddRowShift, T, halfHeight } = lattice;
  const cells: Cell[] = [];

  for (let row = 0; ; row++) {
    const cy = Math.round(row * pitchY);
    if (cy - halfHeight >= length) break;

    const shift = (row & 1) === 1 ? oddRowShift : 0;
    for (let col = 0; ; col++) {
      const cx = col * pitchX + shift;
      if (cx - T >= width) break;
      cells.push({ col, row, cx, cy });
    }
  }

  return cells;
}

function centredWindow(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  width: number,
  length: number,
): { x0: number; y0: number; x1: number; y1: number } {
  // `trim` centres its target in the workpiece, so the honeycomb is cut
  // symmetrically and the border loses the same amount all the way round.
  const insetX = (maxX - minX - width) / 2;
  const insetY = (maxY - minY - length) / 2;
  return { x0: minX + insetX, y0: minY + insetY, x1: maxX - insetX, y1: maxY - insetY };
}

/** A cell is partial when the trim line passes through its hexagon. */
function countPartial(
  cells: readonly Cell[],
  spec: { T: number; halfHeight: number; window: { x0: number; y0: number; x1: number; y1: number } },
): number {
  const { T, halfHeight, window } = spec;
  return cells.filter((c) => {
    const vertices = [
      { x: c.cx, y: c.cy - halfHeight },
      { x: c.cx + T, y: c.cy - halfHeight / 2 },
      { x: c.cx + T, y: c.cy + halfHeight / 2 },
      { x: c.cx, y: c.cy + halfHeight },
      { x: c.cx - T, y: c.cy + halfHeight / 2 },
      { x: c.cx - T, y: c.cy - halfHeight / 2 },
    ];
    const inside = vertices.filter(
      (v) => v.x >= window.x0 && v.x <= window.x1 && v.y >= window.y0 && v.y <= window.y1,
    ).length;
    return inside > 0 && inside < vertices.length;
  }).length;
}

/* -------------------------------------------------------------------------- */
/* Stock                                                                       */
/* -------------------------------------------------------------------------- */

interface StickSpec {
  species: SpeciesId;
  stockThickness: Ticks;
  ripWidth: Ticks;
  sticks: number;
  prismLength: Ticks;
  ringOrientation: RingOrientation;
  shop: ShopProfile;
}

function countOf<T>(list: readonly T[], value: T): number {
  return list.filter((x) => x === value).length;
}

/**
 * Bevel-rip one billet into rhombus sticks.
 *
 * The billet arrives with square edges, so the first cut establishes the
 * slanted left edge and is waste. Every cut after that yields a parallelogram,
 * and the rhombus condition makes it a 60-degree rhombus.
 */
function ripSticks(b: GraphBuilder, spec: StickSpec): NodeId {
  const { species, stockThickness, ripWidth, sticks, prismLength, ringOrientation, shop } = spec;

  const drift = Math.abs(stockThickness * Math.tan(toRadians(CUBE_BEVEL)));
  // A bevelled strip has two different widths; a setup piece at the bare
  // minimum would compute to a negative width at the narrow face once the drift
  // exceeds it. Adding the drift keeps the narrow face at the minimum.
  const strips: Array<{ width: Ticks; bevel: MilliDeg }> = [
    { width: ticks(Math.ceil(shop.minSafeRipWidth + drift)), bevel: CUBE_BEVEL },
  ];
  for (let i = 0; i < sticks; i++) strips.push({ width: ripWidth, bevel: CUBE_BEVEL });

  // Stock must cover the cuts' rightmost reach, not the sum of fence settings:
  // a bevelled cut marches sideways by thickness x tan(bevel) as it crosses the
  // panel, so the top face runs out before the table face does.
  let cursor = 0;
  let reach = 0;
  for (const strip of strips) {
    cursor += strip.width + shop.kerf;
    reach = Math.max(reach, cursor + drift);
  }

  const milled = {
    thickness: stockThickness,
    width: ticks(Math.ceil(reach) + DEFAULT_MILLING_ALLOWANCE.width),
    length: prismLength,
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

  return b.add(
    { kind: 'rip', input: { node: billet, port: 0 }, strips },
    `Bevel-rip ${species} into ${sticks} rhombus stick${sticks === 1 ? '' : 's'}`,
  );
}
