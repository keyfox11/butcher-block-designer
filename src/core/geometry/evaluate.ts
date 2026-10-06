/**
 * The construction-graph evaluator.
 *
 * Pure: a graph in, a workpiece and a material ledger out. Simulating the
 * physical operations is what makes the cut list correct -- the picture and the
 * numbers are the same computation, so they cannot drift apart.
 */

import type {
  Graph,
  NodeId,
  Partition,
  Ref,
  ShopProfile,
  SpeciesId,
  Workpiece,
} from '../model/types.js';
import { TICKS_PER_INCH, type Ticks, ticks } from '../units/ticks.js';
import { GeometryError, area, boundingBox, rectangle } from './polygon.js';
import {
  assertTiling,
  cutPartition,
  laminate,
  laminateButted,
  laminateFree,
  leftEdgeAtTableFace,
  profileAt,
  normalisePartition,
  mirrorPartition,
  partitionBounds,
  rotatePartition,
  singleFacePartition,
  translatePartition,
  trimPartitionToRect,
} from './partition.js';

/** Per-species volumes in cubic inches. */
export type VolumeBySpecies = Record<SpeciesId, number>;

export interface MaterialLedger {
  /** Rough stock entering the graph. */
  readonly input: VolumeBySpecies;
  /** Turned to dust by the blade. */
  readonly kerf: VolumeBySpecies;
  /** Removed by milling, flattening, and trimming. */
  readonly removed: VolumeBySpecies;
  /** Cut but never used downstream. */
  readonly offcut: VolumeBySpecies;
}

export interface EvalResult {
  readonly workpiece: Workpiece;
  readonly ledger: MaterialLedger;
  /** Every node's outputs, for the cut list and assembly maps. */
  readonly nodeOutputs: ReadonlyMap<NodeId, readonly Workpiece[]>;
  /**
   * Where each laminate's members ended up, in the parent's coordinates.
   *
   * An assembly map has to label what the builder physically picks up -- a
   * slice -- not every species region inside it. Butted placement computes its
   * offsets from the mating edges, so the positions are only known here;
   * recomputing them downstream would duplicate the geometry.
   */
  readonly memberPlacements: ReadonlyMap<NodeId, readonly Partition[]>;
}

/** Relative tolerance on per-node volume conservation. */
const CONSERVATION_TOLERANCE = 1e-6;

export function volumeCuIn(areaSqTicks: number, lengthTicks: number): number {
  return (areaSqTicks / (TICKS_PER_INCH * TICKS_PER_INCH)) * (lengthTicks / TICKS_PER_INCH);
}

export function workpieceVolumeBySpecies(w: Workpiece): VolumeBySpecies {
  const out: VolumeBySpecies = {};
  for (const face of w.crossSection.faces) {
    out[face.species] = (out[face.species] ?? 0) + volumeCuIn(area(face.polygon), w.length);
  }
  return out;
}

function addInto(target: VolumeBySpecies, source: VolumeBySpecies): void {
  for (const [id, v] of Object.entries(source)) target[id] = (target[id] ?? 0) + v;
}

function subtract(a: VolumeBySpecies, b: VolumeBySpecies): VolumeBySpecies {
  const out: VolumeBySpecies = { ...a };
  for (const [id, v] of Object.entries(b)) out[id] = (out[id] ?? 0) - v;
  return out;
}

function totalOf(v: VolumeBySpecies): number {
  return Object.values(v).reduce((s, x) => s + x, 0);
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

interface NodeResult {
  readonly outputs: readonly Workpiece[];
  /** Placed member cross-sections, for laminate nodes only. */
  readonly placements?: readonly Partition[];
  readonly kerf: VolumeBySpecies;
  readonly removed: VolumeBySpecies;
  readonly input: VolumeBySpecies;
}

export function evaluate(graph: Graph, shop: ShopProfile): EvalResult {
  const cache = new Map<NodeId, NodeResult>();
  const visiting = new Set<NodeId>();

  const evalNode = (id: NodeId): NodeResult => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new GeometryError(`Cycle in construction graph at node ${id}`);
    visiting.add(id);

    const node = graph.nodes[id];
    if (!node) throw new GeometryError(`Unknown node: ${id}`);

    const resolve = (ref: Ref): Workpiece => {
      const parent = evalNode(ref.node);
      const piece = parent.outputs[ref.port];
      if (!piece) {
        throw new GeometryError(`Node ${id} references ${ref.node} port ${ref.port}, which does not exist`);
      }
      return piece;
    };

    const result = evalOp(node.id, node.op, resolve, shop);
    assertNodeConservation(node.id, node.op.kind, result);

    visiting.delete(id);
    cache.set(id, result);
    return result;
  };

  const outputNode = evalNode(graph.output.node);
  const workpiece = outputNode.outputs[graph.output.port];
  if (!workpiece) {
    throw new GeometryError(
      `Graph output references port ${graph.output.port} of ${graph.output.node}, which does not exist`,
    );
  }

  return {
    workpiece,
    ledger: buildLedger(graph, cache, workpiece),
    nodeOutputs: new Map([...cache].map(([id, r]) => [id, r.outputs])),
    memberPlacements: new Map(
      [...cache]
        .filter(([, r]) => r.placements !== undefined)
        .map(([id, r]) => [id, r.placements!]),
    ),
  };
}

/**
 * Per-node conservation: what goes in equals what comes out, plus kerf, plus
 * removal.
 *
 * Checked at every node rather than only globally, because a global check tells
 * you the graph is wrong while a per-node check tells you *which operation* is
 * wrong. Modelling cuts as subtracted slabs makes this hold by construction,
 * so a failure here is a genuine defect rather than a rounding artefact.
 */
function assertNodeConservation(id: NodeId, kind: string, r: NodeResult): void {
  const outputs = r.outputs.reduce<VolumeBySpecies>((acc, w) => {
    addInto(acc, workpieceVolumeBySpecies(w));
    return acc;
  }, {});

  const accounted = totalOf(outputs) + totalOf(r.kerf) + totalOf(r.removed);
  const supplied = totalOf(r.input);
  if (supplied === 0 && accounted === 0) return;

  const error = Math.abs(supplied - accounted) / Math.max(supplied, 1e-9);
  if (error > CONSERVATION_TOLERANCE) {
    throw new GeometryError(
      `Node ${id} (${kind}) does not conserve volume: ` +
        `in ${supplied.toFixed(6)} cu in, accounted ${accounted.toFixed(6)} cu in`,
    );
  }
}

function buildLedger(
  graph: Graph,
  cache: ReadonlyMap<NodeId, NodeResult>,
  finalPiece: Workpiece,
): MaterialLedger {
  const input: VolumeBySpecies = {};
  const kerf: VolumeBySpecies = {};
  const removed: VolumeBySpecies = {};

  for (const [id, r] of cache) {
    const node = graph.nodes[id];
    // A billet's `input` is stock entering the graph; every other node's
    // `input` is material already counted upstream.
    if (node?.op.kind === 'billet') addInto(input, r.input);
    addInto(kerf, r.kerf);
    addInto(removed, r.removed);
  }

  // Anything produced but never referenced downstream is an offcut. Walking
  // consumption rather than guessing is what keeps conservation honest.
  const consumed = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    for (const ref of inputRefs(node.op)) consumed.add(`${ref.node}:${ref.port}`);
  }
  consumed.add(`${graph.output.node}:${graph.output.port}`);

  const offcut: VolumeBySpecies = {};
  for (const [id, r] of cache) {
    r.outputs.forEach((w, port) => {
      if (!consumed.has(`${id}:${port}`)) addInto(offcut, workpieceVolumeBySpecies(w));
    });
  }

  void finalPiece;
  return { input, kerf, removed, offcut };
}

export function inputRefs(op: Graph['nodes'][string]['op']): readonly Ref[] {
  switch (op.kind) {
    case 'billet':
      return [];
    case 'laminate':
      return op.members.map((m) => m.piece);
    default:
      return [op.input];
  }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

function evalOp(
  id: NodeId,
  op: Graph['nodes'][string]['op'],
  resolve: (ref: Ref) => Workpiece,
  shop: ShopProfile,
): NodeResult {
  switch (op.kind) {
    case 'billet': {
      const partition = singleFacePartition(
        rectangle(0, 0, op.milled.width, op.milled.thickness),
        op.species,
        `${op.species}-${id}`,
        op.ringOrientation,
      );
      const output: Workpiece = {
        crossSection: partition,
        length: op.milled.length,
        orientation: 'longGrain',
        producedBy: id,
      };
      const roughVolume =
        (op.rough.thickness / TICKS_PER_INCH) *
        (op.rough.width / TICKS_PER_INCH) *
        (op.rough.length / TICKS_PER_INCH);
      const milledVolume = totalOf(workpieceVolumeBySpecies(output));
      return {
        outputs: [output],
        input: { [op.species]: roughVolume },
        kerf: {},
        // Milling to flat and square is real material and belongs in the
        // lumber order, not silently dropped.
        removed: { [op.species]: roughVolume - milledVolume },
      };
    }

    case 'rip': {
      const source = resolve(op.input);
      const outputs: Workpiece[] = [];
      const kerf: VolumeBySpecies = {};
      let remaining = source.crossSection;

      op.strips.forEach((strip, index) => {
        const cut = cutPartition(remaining, {
          // A fence is set from the edge it touches, at the table face. Using
          // the bounding-box minimum instead is wrong whenever the left edge
          // leans away from the table, which is what broke varying-angle
          // patterns while uniform ones happened to work.
          atBase: leftEdgeAtTableFace(remaining) + strip.width,
          bevel: strip.bevel,
          kerf: shop.kerf,
        });

        const before = faceVolumes(remaining, source.length);
        if (cut.keep.faces.length === 0) {
          throw new GeometryError(
            `Node ${id}: strip ${index + 1} has no material left to cut; the stock is too narrow`,
          );
        }
        const keptPiece = normalisePartition(cut.keep);
        assertTiling(keptPiece, `${id} strip ${index}`);

        // A rip must refuse rather than hand back whatever was left. A bevelled
        // cut drifts sideways by thickness x tan(bevel) as it crosses the
        // panel, so stock sized from table-face widths alone runs out at the
        // top face and silently truncates the last strip to the wrong SHAPE --
        // which conserves mass perfectly and so slips past that check.
        const keptBounds = partitionBounds(cut.keep);
        const actualWidth =
          (profileAt(cut.keep.outline, keptBounds.minY, 'right') ?? 0) -
          leftEdgeAtTableFace(cut.keep);
        if (actualWidth < strip.width - 1) {
          throw new GeometryError(
            `Node ${id}: strip ${index + 1} came out ${actualWidth} ticks wide at the table face ` +
              `but ${strip.width} was requested — the stock is too narrow. A bevelled cut needs ` +
              'extra width for the sideways drift across the thickness.',
          );
        }

        outputs.push({
          crossSection: retagPieces(keptPiece, `${id}-s${index}`),
          length: source.length,
          orientation: source.orientation,
          producedBy: id,
        });

        const after = subtract(
          before,
          addVolumes(faceVolumes(cut.keep, source.length), faceVolumes(cut.offcut, source.length)),
        );
        addInto(kerf, after);
        remaining = normalisePartition(cut.offcut);
      });

      // The remainder physically exists, so it is always emitted. If nothing
      // downstream references it, the ledger counts it as an offcut rather
      // than letting the material disappear.
      if (remaining.faces.length > 0 && area(remaining.outline) > 0) {
        outputs.push({
          crossSection: retagPieces(remaining, `${id}-rem`),
          length: source.length,
          orientation: source.orientation,
          producedBy: id,
        });
      }

      return { outputs, input: faceVolumes(source.crossSection, source.length), kerf, removed: {} };
    }

    case 'crosscut': {
      const source = resolve(op.input);
      const sliceArea = faceVolumes(source.crossSection, source.length);
      const count = op.count ?? maxSlices(source.length, op.sliceLength, shop.kerf);
      if (count < 1) {
        throw new GeometryError(
          `Node ${id}: panel is too short to yield even one slice of the requested length`,
        );
      }

      const outputs: Workpiece[] = Array.from({ length: count }, (_, i) => ({
        crossSection: retagPieces(source.crossSection, `${id}-c${i}`),
        length: op.sliceLength,
        orientation: source.orientation,
        producedBy: id,
      }));

      // n slices need n-1 internal cuts; the leftover tail is tracked as
      // removal rather than vanishing.
      const kerfLength = (count - 1) * shop.kerf;
      const leftover = source.length - count * op.sliceLength - kerfLength;
      if (leftover < 0) {
        throw new GeometryError(
          `Node ${id}: ${count} slices need ${count * op.sliceLength + kerfLength} ticks but the panel is ${source.length}`,
        );
      }

      return {
        outputs,
        input: sliceArea,
        kerf: scaleVolumes(sliceArea, kerfLength / source.length),
        removed: scaleVolumes(sliceArea, leftover / source.length),
      };
    }

    case 'reorient': {
      const source = resolve(op.input);
      // No geometry changes. The cross-section becomes the board's face and
      // `length` becomes its thickness -- a relabelling of axes, not a transform.
      return {
        outputs: [{ ...source, orientation: 'endGrain', producedBy: id }],
        input: faceVolumes(source.crossSection, source.length),
        kerf: {},
        removed: {},
      };
    }

    case 'laminate': {
      const butted = op.placement === 'butted';
      const free = op.placement === 'free';
      const members = op.members.map((m) => {
        const piece = resolve(m.piece);
        let partition = normalisePartition(piece.crossSection);
        if (m.rotate !== 0) partition = normalisePartition(rotatePartition(partition, m.rotate));
        if (m.mirrored) partition = mirrorPartition(partition);
        return {
          piece,
          // Butted members are positioned by their mating edges, so their own
          // offsets are ignored rather than compounded with the placement.
          partition: butted ? partition : translatePartition(partition, m.offset.x, m.offset.y),
        };
      });

      const lengths = new Set(members.map((m) => m.piece.length));
      if (lengths.size > 1) {
        throw new GeometryError(
          `Node ${id}: laminate members have different lengths (${[...lengths].join(', ')}); ` +
            'gluing pieces of unequal length cannot produce a flat board',
        );
      }

      const first = members[0];
      if (!first) throw new GeometryError(`Node ${id}: laminate has no members`);

      const placedPartitions = members.map((m) => m.partition);
      const result = butted
        ? laminateButted(placedPartitions)
        : free
          ? laminateFree(placedPartitions, `Node ${id}`)
          : laminate(placedPartitions);
      if (Math.abs(result.gapArea) > result.tolerance) {
        throw new GeometryError(
          `Node ${id}: laminate members leave a ${result.gapArea > 0 ? 'gap' : 'overlap'} of ` +
            `${Math.abs(result.gapArea)} sq ticks`,
        );
      }

      // laminateButted repositions members, so take the placed geometry from
      // the result rather than from the pre-placement members.
      const placements = result.placed;

      const output: Workpiece = {
        crossSection: result.partition,
        length: first.piece.length,
        orientation: first.piece.orientation,
        producedBy: id,
      };
      return {
        outputs: [output],
        placements,
        input: workpieceVolumeBySpecies(output),
        kerf: {},
        removed: {},
      };
    }

    case 'flatten': {
      const source = resolve(op.input);
      const before = faceVolumes(source.crossSection, source.length);

      if (source.orientation === 'endGrain') {
        // The board's faces are the cross-section plane, so flattening takes
        // material off the thickness -- which is why the crosscut was oversize.
        const newLength = source.length - 2 * op.removePerFace;
        if (newLength <= 0) {
          throw new GeometryError(`Node ${id}: flattening would remove the entire board thickness`);
        }
        const output: Workpiece = { ...source, length: ticks(newLength), producedBy: id };
        return {
          outputs: [output],
          input: before,
          kerf: {},
          removed: subtract(before, workpieceVolumeBySpecies(output)),
        };
      }

      // A long-grain panel is flattened on its two wide faces, which in
      // cross-section is the thickness (y) dimension.
      const bounds = partitionBounds(source.crossSection);
      const { trimmed } = trimPartitionToRect(
        source.crossSection,
        bounds.minX,
        bounds.minY + op.removePerFace,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY - 2 * op.removePerFace,
      );
      const output: Workpiece = {
        crossSection: normalisePartition(trimmed),
        length: source.length,
        orientation: source.orientation,
        producedBy: id,
      };
      return {
        outputs: [output],
        input: before,
        kerf: {},
        removed: subtract(before, workpieceVolumeBySpecies(output)),
      };
    }

    case 'trim': {
      const source = resolve(op.input);
      const before = faceVolumes(source.crossSection, source.length);
      const bounds = partitionBounds(source.crossSection);

      if (op.target.kind !== 'rect') {
        throw new GeometryError(`Node ${id}: outline trimming is not implemented in this phase`);
      }

      // Centre the target by default, because squaring up a panel means taking
      // the same off both edges. An anchor overrides that for a lay-up whose
      // material is not centred on its own bounding box.
      const insetX = (bounds.maxX - bounds.minX - op.target.width) / 2;
      const insetY = (bounds.maxY - bounds.minY - op.target.height) / 2;
      if (insetX < 0 || insetY < 0) {
        throw new GeometryError(`Node ${id}: trim target is larger than the workpiece`);
      }

      const anchor = op.target.anchor;
      const x0 = anchor ? bounds.minX + anchor.x : Math.round(bounds.minX + insetX);
      const y0 = anchor ? bounds.minY + anchor.y : Math.round(bounds.minY + insetY);
      if (
        x0 < bounds.minX ||
        y0 < bounds.minY ||
        x0 + op.target.width > bounds.maxX ||
        y0 + op.target.height > bounds.maxY
      ) {
        throw new GeometryError(
          `Node ${id}: the trim target sits partly outside the workpiece, so the saw would be ` +
            'cutting air on at least one edge',
        );
      }

      const { trimmed } = trimPartitionToRect(
        source.crossSection,
        x0,
        y0,
        op.target.width,
        op.target.height,
      );
      const output: Workpiece = {
        crossSection: normalisePartition(trimmed),
        length: source.length,
        orientation: source.orientation,
        producedBy: id,
      };
      return {
        outputs: [output],
        input: before,
        kerf: {},
        removed: subtract(before, workpieceVolumeBySpecies(output)),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Maximum slices that fit, including the correction the naive floor misses.
 *
 * The floor assumes a kerf after the final slice, which does not exist, and so
 * under-counts by one whenever the remainder falls between one slice and one
 * slice plus a kerf.
 */
export function maxSlices(panelLength: Ticks, sliceLength: Ticks, kerf: Ticks): number {
  let n = Math.floor(panelLength / (sliceLength + kerf));
  if (sliceLength * (n + 1) + n * kerf <= panelLength) n += 1;
  return n;
}

function faceVolumes(p: Partition, length: number): VolumeBySpecies {
  const out: VolumeBySpecies = {};
  for (const face of p.faces) {
    out[face.species] = (out[face.species] ?? 0) + volumeCuIn(area(face.polygon), length);
  }
  return out;
}

function addVolumes(a: VolumeBySpecies, b: VolumeBySpecies): VolumeBySpecies {
  const out: VolumeBySpecies = { ...a };
  addInto(out, b);
  return out;
}

function scaleVolumes(v: VolumeBySpecies, factor: number): VolumeBySpecies {
  return Object.fromEntries(Object.entries(v).map(([id, x]) => [id, x * factor]));
}

/** Give each face a fresh piece id so the cut list can trace it to one cut. */
function retagPieces(p: Partition, prefix: string): Partition {
  return {
    outline: p.outline,
    faces: p.faces.map((f, i) => ({ ...f, pieceId: `${prefix}-${i}` })),
  };
}

export function boardDimensions(w: Workpiece): { width: number; length: number; thickness: number } {
  const b = boundingBox(w.crossSection.outline);
  return w.orientation === 'endGrain'
    ? { width: b.maxX - b.minX, length: b.maxY - b.minY, thickness: w.length }
    : { width: b.maxX - b.minX, thickness: b.maxY - b.minY, length: w.length };
}
