/**
 * Multi-stage patterns: herringbone, pinwheel, basket weave.
 *
 * These are the patterns [KB-A04](../../../docs/spec/01-woodworking-domain.md)
 * describes, and the ones a flat layer-stack model cannot reach. A stage-2
 * block is itself ripped, crosscut, and re-glued as the input to a further
 * stage, and the whole point is that a *tile* is not a piece of wood -- it is a
 * small glued-up assembly with its own internal pattern.
 *
 * ## Why these are end grain all the way through
 *
 * The obvious way to turn a tile 90 degrees is to crosscut it at a miter, and
 * it is the wrong way: a miter shears the piece, so the grain is no longer
 * perpendicular to the working face. The board loses the self-healing that is
 * the entire reason to choose end grain, and it tears out when flattened
 * ([KB-A07](../../../docs/spec/01-woodworking-domain.md)).
 *
 * The right way costs nothing. Rotating a finished end-grain block about its
 * VERTICAL axis leaves the grain vertical -- the block is a prism and the grain
 * runs along the extrusion, so spinning it on the bench cannot change that. In
 * the model this is `LaminateMember.rotate`, and it is exactly the operation
 * the tumbling block needed. So the tiles here are turned, never mitered, and
 * `V-GRAIN-020` stays quiet.
 *
 * ## Tile geometry
 *
 * One stage-1 panel of `n` alternating strips, ripped from stock `T` thick to
 * width `s`, gives a panel `n x s` wide and `T` thick. Crosscut and stood on
 * end, that panel face IS the tile: `n x s` by `T`, with the stripes running
 * across it.
 *
 * Herringbone and pinwheel want a 2:1 tile, so `n x s = 2T`; basket weave wants
 * a square one, so `n x s = T`. Both follow from the stock thickness, which is
 * the only dimension a builder has to hit on the planer.
 */

import {
  DEFAULT_FLATTEN_PER_FACE,
  DEFAULT_MILLING_ALLOWANCE,
  DEFAULT_TRIM_PER_EDGE,
} from '../model/defaults.js';
import type {
  Graph,
  LaminateMember,
  MilliDeg,
  NodeId,
  Ref,
  RingOrientation,
  ShopProfile,
  SpeciesId,
  Ticks,
} from '../model/types.js';
import { NO_TURN, inches, milliDeg, ticks } from '../units/ticks.js';
import { maxSlices } from '../geometry/evaluate.js';
import { GraphBuilder } from './builder.js';

const SQUARE = milliDeg(0);
const QUARTER_TURN = milliDeg(90_000);

export interface MultiStageParams {
  /** Stock thickness. Sets the tile's short dimension, and so the whole scale. */
  readonly stockThickness: Ticks;
  /** Strips across one tile. More stripes, finer pattern, more glue lines. */
  readonly stripes: number;
  readonly speciesA: SpeciesId;
  readonly speciesB: SpeciesId;
  /** Pinwheel only: the square at the centre of each block. */
  readonly speciesAccent?: SpeciesId;
  readonly targetWidth: Ticks;
  readonly targetLength: Ticks;
  readonly boardThickness: Ticks;
  readonly ringOrientation?: RingOrientation;
  readonly flattenPerFace?: Ticks;
  readonly trimPerEdge?: Ticks;
  /** Longest stage-1 panel to handle at the saw. */
  readonly maxPanelLength?: Ticks;
}

export interface MultiStageDerived {
  readonly tileShort: Ticks;
  readonly tileLong: Ticks;
  readonly stripeWidth: Ticks;
  readonly tileThickness: Ticks;
  readonly tileCount: number;
  readonly panelCount: number;
  readonly tilesPerPanel: number;
  readonly panelLength: Ticks;
  /** Tiles the trim passes through. */
  readonly partialTiles: number;
  readonly finishedWidth: Ticks;
  readonly finishedLength: Ticks;
  readonly finishedThickness: Ticks;
  /** Glue-ups, counting the stage-1 panel and the final lay-up. */
  readonly glueUps: number;
}

export interface MultiStageResult {
  readonly graph: Graph;
  readonly derived: MultiStageDerived;
}

/** A tile to place: where it goes, and how far it is turned. */
interface Placement {
  readonly x: number;
  readonly y: number;
  readonly rotate: MilliDeg;
  /** Which tile shape to draw from. */
  readonly kind: 'tile' | 'accent';
  /** Extent once turned, for the coverage and partial-tile tests. */
  readonly w: number;
  readonly h: number;
}

/* -------------------------------------------------------------------------- */
/* Herringbone                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * True herringbone.
 *
 * The lattice is the part worth writing down, because it is not the obvious
 * one. In a herringbone a horizontal tile's LEFT end sits flush with the top of
 * a vertical tile, and its RIGHT end flush with the bottom of another. Follow
 * that constraint and the tiles form diagonal runs stepping by `(3u, u)`, with
 * adjacent runs offset by `(u, -u)`:
 *
 *     horizontal tile at ((3a + b) u,     (a - b) u)   size 2u x u
 *     vertical   tile at ((3a + b + 2) u, (a - b) u)   size u x 2u
 *
 * The determinant of [(3,1), (1,-1)] is -4 and each cell carries two tiles of
 * area 2, so the areas balance -- it is a tiling, not a pattern with holes.
 * The union's hole check confirms it on the built geometry.
 */
export function herringbone(params: MultiStageParams, shop: ShopProfile): MultiStageResult {
  const u = params.stockThickness;

  return layUp(params, shop, {
    name: 'herringbone',
    tileLong: ticks(2 * u),
    glueUps: 2,
    place(width, length) {
      const out: Placement[] = [];
      // a and b range widely enough to cover the target from every direction;
      // the overlap test below does the real selection.
      const spanP = Math.ceil(width / u) + 3;
      const spanQ = Math.ceil(length / u) + 3;

      for (let a = -spanQ - 2; a <= spanP + spanQ; a++) {
        for (let b = -3 * spanQ - 4; b <= spanP + 4; b++) {
          const x = (3 * a + b) * u;
          const y = (a - b) * u;
          out.push({ x, y, rotate: NO_TURN, kind: 'tile', w: 2 * u, h: u });
          out.push({ x: x + 2 * u, y, rotate: QUARTER_TURN, kind: 'tile', w: u, h: 2 * u });
        }
      }
      return out;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Pinwheel                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pinwheel.
 *
 * Four 2:1 tiles chasing each other round a square centre, in a 3u x 3u block
 * that tiles the plane as an ordinary grid. The four tiles have areas summing
 * to 8u^2 and the centre fills the ninth square, which is what makes the block
 * square and the blocks a plain grid rather than a staggered one.
 */
export function pinwheel(params: MultiStageParams, shop: ShopProfile): MultiStageResult {
  const u = params.stockThickness;

  return layUp(params, shop, {
    name: 'pinwheel',
    tileLong: ticks(2 * u),
    needsAccent: true,
    glueUps: 2,
    place(width, length) {
      const out: Placement[] = [];
      const cols = Math.ceil(width / (3 * u)) + 1;
      const rows = Math.ceil(length / (3 * u)) + 1;

      for (let i = -1; i <= cols; i++) {
        for (let j = -1; j <= rows; j++) {
          const x = i * 3 * u;
          const y = j * 3 * u;
          out.push({ x, y, rotate: NO_TURN, kind: 'tile', w: 2 * u, h: u });
          out.push({ x: x + 2 * u, y, rotate: QUARTER_TURN, kind: 'tile', w: u, h: 2 * u });
          out.push({ x: x + u, y: y + 2 * u, rotate: NO_TURN, kind: 'tile', w: 2 * u, h: u });
          out.push({ x, y: y + u, rotate: QUARTER_TURN, kind: 'tile', w: u, h: 2 * u });
          out.push({ x: x + u, y: y + u, rotate: NO_TURN, kind: 'accent', w: u, h: u });
        }
      }
      return out;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Basket weave                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Basket weave.
 *
 * Square striped tiles alternating orientation on a checkerboard, so the
 * stripes read as bundles passing over and under each other. The simplest of
 * the three, and the one to reach for first: the tile is square, so there is no
 * lattice to get wrong and the trim cuts whole tiles.
 */
export function basketWeave(params: MultiStageParams, shop: ShopProfile): MultiStageResult {
  const u = params.stockThickness;

  return layUp(params, shop, {
    name: 'basket weave',
    // Square tile: the stage-1 panel is as wide as the stock is thick.
    tileLong: u,
    glueUps: 2,
    place(width, length) {
      const out: Placement[] = [];
      const cols = Math.ceil(width / u) + 1;
      const rows = Math.ceil(length / u) + 1;

      for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= rows; j++) {
          out.push({
            x: i * u,
            y: j * u,
            rotate: (i + j) % 2 === 0 ? NO_TURN : QUARTER_TURN,
            kind: 'tile',
            w: u,
            h: u,
          });
        }
      }
      return out;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The shared build                                                            */
/* -------------------------------------------------------------------------- */

interface PatternSpec {
  readonly name: string;
  /** The tile's long dimension; the short one is always the stock thickness. */
  readonly tileLong: Ticks;
  readonly needsAccent?: boolean;
  readonly glueUps: number;
  /** Every tile that might touch a board of this size, before selection. */
  place(width: number, length: number): Placement[];
}

function layUp(
  params: MultiStageParams,
  shop: ShopProfile,
  spec: PatternSpec,
): MultiStageResult {
  const {
    stockThickness: u,
    stripes,
    speciesA,
    speciesB,
    speciesAccent,
    targetWidth,
    targetLength,
    boardThickness,
    ringOrientation = 'quartersawn',
    flattenPerFace = DEFAULT_FLATTEN_PER_FACE,
    trimPerEdge = DEFAULT_TRIM_PER_EDGE,
    maxPanelLength = inches(36),
  } = params;

  if (u <= 0) throw new Error('Stock thickness must be positive');
  if (stripes < 2) throw new Error('A striped tile needs at least two stripes');
  if (targetWidth <= 0 || targetLength <= 0) throw new Error('Target size must be positive');
  if (spec.needsAccent && !speciesAccent) {
    throw new Error(`A ${spec.name} needs an accent species for the square at each centre`);
  }

  // Stripes divide the tile's long dimension. Rounding here rather than
  // demanding an exact division keeps the tile exactly `tileLong`: the last
  // strip absorbs the remainder, which is a thousandth of an inch at worst and
  // keeps the lattice on integers.
  const stripeWidth = Math.floor(spec.tileLong / stripes);
  const lastStripe = spec.tileLong - stripeWidth * (stripes - 1);
  if (stripeWidth < shop.minSafeRipWidth) {
    throw new Error(
      `${stripes} stripes across a ${spec.tileLong / 8000}" tile gives strips narrower than the ` +
        'minimum safe rip width. Use fewer stripes or thicker stock.',
    );
  }

  /* ---- Which tiles to lay up --------------------------------------------- */

  // Lay up past the finished size, so the trim has material to remove. Covering
  // the target exactly leaves the saw nothing to cut wherever a tile edge
  // happens to land on the line.
  const coverW = targetWidth + 2 * trimPerEdge;
  const coverL = targetLength + 2 * trimPerEdge;

  const placements = spec
    .place(coverW, coverL)
    .filter((p) => p.x + p.w > 0 && p.x < coverW && p.y + p.h > 0 && p.y < coverL);
  if (placements.length === 0) throw new Error(`No ${spec.name} tiles cover the requested board`);

  const minX = Math.min(...placements.map((p) => p.x));
  const minY = Math.min(...placements.map((p) => p.y));
  const maxX = Math.max(...placements.map((p) => p.x + p.w));
  const maxY = Math.max(...placements.map((p) => p.y + p.h));
  if (maxX - minX < targetWidth || maxY - minY < targetLength) {
    throw new Error(`Internal: the ${spec.name} lay-up does not cover the finished board`);
  }

  const tiles = placements.filter((p) => p.kind === 'tile');
  const accents = placements.filter((p) => p.kind === 'accent');

  /* ---- Stage 1: striped panels ------------------------------------------- */

  const b = new GraphBuilder();
  const tileThickness = ticks(boardThickness + 2 * flattenPerFace);

  const panelCapacity = maxSlices(
    ticks(maxPanelLength - 2 * trimPerEdge),
    tileThickness,
    shop.kerf,
  );
  if (panelCapacity < 1) {
    throw new Error('A panel this short cannot yield even one tile of the requested thickness');
  }
  const tilesPerPanel = Math.min(panelCapacity, tiles.length);
  const panelCount = Math.ceil(tiles.length / tilesPerPanel);
  const panelLength = ticks(
    Math.min(maxPanelLength, tilesPerPanel * (tileThickness + shop.kerf) + 2 * trimPerEdge),
  );

  const tileRefs: Ref[] = [];
  let made = 0;
  for (let p = 0; p < panelCount; p++) {
    const take = Math.min(tilesPerPanel, tiles.length - made);
    const panel = stripedPanel(b, {
      index: p,
      stripes,
      stripeWidth,
      lastStripe,
      speciesA,
      speciesB,
      stockThickness: u,
      panelLength,
      ringOrientation,
      shop,
    });

    const cut = b.add(
      {
        kind: 'crosscut',
        input: { node: panel, port: 0 },
        sliceLength: tileThickness,
        count: take,
        miter: SQUARE,
      },
      `Crosscut panel ${p + 1} into ${take} tile${take === 1 ? '' : 's'}`,
    );

    for (let i = 0; i < take; i++) {
      tileRefs.push({
        node: b.add(
          { kind: 'reorient', input: { node: cut, port: i }, mode: 'toEndGrain' },
          `Stand tile ${made + i + 1} on end`,
        ),
        port: 0,
      });
    }
    made += take;
  }

  /* ---- The accent squares, where the pattern has them --------------------- */

  const accentRefs: Ref[] = [];
  if (accents.length > 0 && speciesAccent) {
    const accentLength = ticks(
      Math.min(maxPanelLength, accents.length * (tileThickness + shop.kerf) + 2 * trimPerEdge),
    );
    const perStick = maxSlices(ticks(accentLength - 2 * trimPerEdge), tileThickness, shop.kerf);
    let cutSoFar = 0;
    while (cutSoFar < accents.length) {
      const take = Math.min(perStick, accents.length - cutSoFar);
      const stick = accentStick(b, {
        species: speciesAccent,
        size: u,
        length: accentLength,
        ringOrientation,
        shop,
      });
      const cut = b.add(
        {
          kind: 'crosscut',
          input: { node: stick, port: 0 },
          sliceLength: tileThickness,
          count: take,
          miter: SQUARE,
        },
        `Crosscut the ${speciesAccent} stick into ${take} centre square${take === 1 ? '' : 's'}`,
      );
      for (let i = 0; i < take; i++) {
        accentRefs.push({
          node: b.add(
            { kind: 'reorient', input: { node: cut, port: i }, mode: 'toEndGrain' },
            `Stand centre square ${cutSoFar + i + 1} on end`,
          ),
          port: 0,
        });
      }
      cutSoFar += take;
    }
  }

  /* ---- Stage 2: the lay-up ------------------------------------------------ */

  let nextTile = 0;
  let nextAccent = 0;
  const members: LaminateMember[] = placements.map((p) => {
    const ref = p.kind === 'accent' ? accentRefs[nextAccent++] : tileRefs[nextTile++];
    if (!ref) throw new Error(`Internal: ran out of ${p.kind}s for the ${spec.name}`);
    return {
      piece: ref,
      offset: { x: ticks(Math.round(p.x - minX)), y: ticks(Math.round(p.y - minY)) },
      // Turned about its own vertical axis, which leaves the grain vertical.
      // A miter would reach the same angle and ruin the board (KB-A07).
      rotate: p.rotate,
      mirrored: false,
    };
  });

  const glued = b.add(
    {
      kind: 'laminate',
      members,
      // The lay-up is not a rectangle until it is trimmed, so the outline has
      // to be the true union rather than a bounding box.
      placement: 'free',
      // Tiles interlock in both directions, so no single clamping axis closes
      // every joint (KB-A11).
      sequence: 'rowByRow',
    },
    `Lay up the ${spec.name}`,
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

  const trimmed = b.add(
    {
      kind: 'trim',
      input: { node: flattened, port: 0 },
      target: {
        kind: 'rect',
        width: targetWidth,
        height: targetLength,
        // Anchored, not centred. The lay-up's bounding box is not centred on
        // the material: tiles stick out further on one side than the other,
        // depending on where the lattice happens to fall. A centred cut can
        // therefore land in the ragged border on one edge while leaving a
        // sliver of extra material on the opposite one. The generator knows
        // exactly which rectangle it covered, so it says so.
        anchor: { x: ticks(trimPerEdge - minX), y: ticks(trimPerEdge - minY) },
      },
    },
    'Square up to final size',
  );

  // The cut the generator actually asked for, in placement coordinates.
  const window = {
    x0: trimPerEdge,
    y0: trimPerEdge,
    x1: trimPerEdge + targetWidth,
    y1: trimPerEdge + targetLength,
  };

  return {
    graph: b.build({ node: trimmed, port: 0 }),
    derived: {
      tileShort: u,
      tileLong: spec.tileLong,
      stripeWidth: ticks(stripeWidth),
      tileThickness,
      tileCount: placements.length,
      panelCount,
      tilesPerPanel,
      panelLength,
      partialTiles: placements.filter(
        (p) => p.x < window.x0 || p.y < window.y0 || p.x + p.w > window.x1 || p.y + p.h > window.y1,
      ).length,
      finishedWidth: targetWidth,
      finishedLength: targetLength,
      finishedThickness: boardThickness,
      glueUps: spec.glueUps,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Stock                                                                       */
/* -------------------------------------------------------------------------- */

interface PanelSpec {
  index: number;
  stripes: number;
  stripeWidth: number;
  lastStripe: number;
  speciesA: SpeciesId;
  speciesB: SpeciesId;
  stockThickness: Ticks;
  panelLength: Ticks;
  ringOrientation: RingOrientation;
  shop: ShopProfile;
}

/** One stage-1 panel: alternating strips glued edge to edge. */
function stripedPanel(b: GraphBuilder, spec: PanelSpec): NodeId {
  const { index, stripes, stripeWidth, lastStripe, stockThickness, panelLength, ringOrientation, shop } = spec;

  const widths = Array.from({ length: stripes }, (_, i) =>
    ticks(i === stripes - 1 ? lastStripe : stripeWidth),
  );
  const speciesOf = (i: number) => (i % 2 === 0 ? spec.speciesA : spec.speciesB);

  // One billet per species, ripped into all the strips that species supplies.
  const stripRef = new Map<number, Ref>();
  const bySpecies = new Map<SpeciesId, number[]>();
  widths.forEach((_, i) => {
    const list = bySpecies.get(speciesOf(i)) ?? [];
    list.push(i);
    bySpecies.set(speciesOf(i), list);
  });

  for (const [species, indices] of bySpecies) {
    const total = indices.reduce((sum, i) => sum + widths[i]! + shop.kerf, 0);
    const milled = {
      thickness: stockThickness,
      width: ticks(total + DEFAULT_MILLING_ALLOWANCE.width),
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
      `${species} stock for panel ${index + 1}`,
    );
    const rip = b.add(
      {
        kind: 'rip',
        input: { node: billet, port: 0 },
        strips: indices.map((i) => ({ width: widths[i]!, bevel: SQUARE })),
      },
      `Rip ${species} into ${indices.length} strip${indices.length === 1 ? '' : 's'}`,
    );
    indices.forEach((layerIndex, port) => stripRef.set(layerIndex, { node: rip, port }));
  }

  const members: LaminateMember[] = widths.map((_, i) => {
    const ref = stripRef.get(i);
    if (!ref) throw new Error(`Internal: no strip for stripe ${i}`);
    return { piece: ref, offset: { x: ticks(0), y: ticks(0) }, rotate: NO_TURN, mirrored: false };
  });

  return b.add(
    { kind: 'laminate', members, placement: 'butted', sequence: 'simultaneous' },
    `Glue stage-1 panel ${index + 1}`,
  );
}

interface AccentSpec {
  species: SpeciesId;
  size: Ticks;
  length: Ticks;
  ringOrientation: RingOrientation;
  shop: ShopProfile;
}

/** A plain square stick for the pinwheel centres. */
function accentStick(b: GraphBuilder, spec: AccentSpec): NodeId {
  const { species, size, length, ringOrientation, shop } = spec;
  const milled = {
    thickness: size,
    width: ticks(size + shop.kerf + DEFAULT_MILLING_ALLOWANCE.width),
    length,
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
    `${species} accent stock`,
  );
  return b.add(
    { kind: 'rip', input: { node: billet, port: 0 }, strips: [{ width: size, bevel: SQUARE }] },
    `Rip ${species} to a ${size / 8000}" square stick`,
  );
}
