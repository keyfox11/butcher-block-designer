/**
 * The construction graph: the source of truth for a design.
 *
 * A design is not a picture. It is the sequence of physical operations that
 * produces the board, and the picture is derived by simulating that sequence.
 * The cut list therefore cannot disagree with the preview, because there is
 * only one representation.
 */

import type { Polygon } from '../geometry/polygon.js';
import type { MilliDeg, Ticks } from '../units/ticks.js';

export type SpeciesId = string;
export type NodeId = string;
export type PieceId = string;

export type RingOrientation = 'quartersawn' | 'flatsawn' | 'riftsawn' | 'unspecified';

/* -------------------------------------------------------------------------- */
/* Workpieces                                                                  */
/* -------------------------------------------------------------------------- */

export interface PartitionFace {
  readonly polygon: Polygon;
  readonly species: SpeciesId;
  /** Traces back to a cut piece so the assembly map can label it. */
  readonly pieceId: PieceId;
  /**
   * Growth-ring orientation. Rotating a blank to end grain puts the tangential
   * and radial axes in the face plane, so mixing orientations shears every
   * glue line -- the opposite of edge-grain panel practice (KB-B02).
   */
  readonly ringOrientation: RingOrientation;
}

/** A planar subdivision: faces that tile `outline` with no gaps or overlaps. */
export interface Partition {
  readonly outline: Polygon;
  readonly faces: readonly PartitionFace[];
}

/**
 * How to read a workpiece's axes.
 *
 * `longGrain`  - milled stock or a stage-1 panel. `length` is along the grain.
 * `endGrain`   - after the 90-degree rotation. The cross-section IS the board's
 *                face pattern and `length` IS the board's thickness.
 *
 * The rotation changes no geometry at all; it changes which axis is "up".
 */
export type Orientation = 'longGrain' | 'endGrain';

/**
 * A prismatic workpiece: a species-partitioned cross-section, extruded along
 * the grain axis.
 *
 * Every intermediate piece in end-grain board making has this shape, and the
 * model is closed under every operation that actually occurs. It cannot
 * represent a board whose pattern varies through its thickness -- and no real
 * end-grain board does, because every piece runs face to face. The model's
 * expressiveness equals physical reality.
 */
export interface Workpiece {
  readonly crossSection: Partition;
  /** Extent along the grain axis. After `reorient`, the board's thickness. */
  readonly length: Ticks;
  readonly orientation: Orientation;
  readonly producedBy: NodeId;
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

/** A port on a node. A rip yields many strips from one panel. */
export interface Ref {
  readonly node: NodeId;
  readonly port: number;
}

export interface BilletOp {
  readonly kind: 'billet';
  readonly species: SpeciesId;
  /** As purchased. The difference from `milled` is real material (KB-A12). */
  readonly rough: { thickness: Ticks; width: Ticks; length: Ticks };
  /** After flattening and squaring. */
  readonly milled: { thickness: Ticks; width: Ticks; length: Ticks };
  readonly ringOrientation: RingOrientation;
}

/**
 * Rip a workpiece lengthwise into strips.
 *
 * Ports are the strips in order, followed by the remainder when it has
 * positive width. The remainder is always emitted because the material
 * physically exists -- if nothing downstream references it, the ledger counts
 * it as an offcut. Letting an operation drop material silently is how a cut
 * list ends up claiming less lumber than the build consumes.
 */
export interface RipOp {
  readonly kind: 'rip';
  readonly input: Ref;
  /**
   * Successive fence settings. Each entry is the width of the strip kept on
   * that pass, measured at the face against the table, with the kerf falling
   * on the waste side -- the number actually set on the fence.
   */
  readonly strips: ReadonlyArray<{ width: Ticks; bevel: MilliDeg }>;
}

export interface CrosscutOp {
  readonly kind: 'crosscut';
  readonly input: Ref;
  /**
   * Length of each slice along the grain. After `reorient` this becomes the
   * board's thickness, so it is cut oversize by the flattening allowance.
   */
  readonly sliceLength: Ticks;
  /** Omit to take the maximum that fits. */
  readonly count?: number;
  /**
   * Miter from perpendicular. 0 is strongly preferred: a non-zero miter yields
   * an oblique prism whose grain is no longer perpendicular to the working
   * face, which is the whole reason to choose end grain (KB-A07).
   */
  readonly miter: MilliDeg;
}

export interface LaminateMember {
  readonly piece: Ref;
  /**
   * Placement of this member's cross-section inside the parent's. General 2-D
   * placement is what allows non-grid assemblies -- a honeycomb of hex pucks,
   * a brick offset, a pinwheel.
   */
  readonly offset: { x: Ticks; y: Ticks };
  readonly rotate180: boolean;
  readonly mirrored: boolean;
}

export interface LaminateOp {
  readonly kind: 'laminate';
  readonly members: readonly LaminateMember[];
  /**
   * Angled joints convert clamp pressure into lateral force and slide, so they
   * are glued row by row with a cure between rows (KB-A11).
   */
  readonly sequence: 'simultaneous' | 'rowByRow';
}

export interface ReorientOp {
  readonly kind: 'reorient';
  readonly input: Ref;
  /** The only physically meaningful reorientation in this domain. */
  readonly mode: 'toEndGrain';
}

/**
 * Stock removal.
 *
 * There is deliberately no `thicknessPlaner` method. Running an end-grain
 * glue-up through a planer tears out catastrophically and can throw the board
 * (KB-A08). Making it unrepresentable in the type is stronger than validating
 * against it, costs nothing, and cannot be clicked through.
 */
export interface FlattenOp {
  readonly kind: 'flatten';
  readonly input: Ref;
  readonly method: 'drumSander' | 'routerSled' | 'handPlane';
  /** Removed from each face. Default 1/8" per face. */
  readonly removePerFace: Ticks;
}

export interface TrimOp {
  readonly kind: 'trim';
  readonly input: Ref;
  readonly target:
    | { kind: 'rect'; width: Ticks; height: Ticks }
    | { kind: 'outline'; polygon: Polygon };
}

export type Op =
  | BilletOp
  | RipOp
  | CrosscutOp
  | LaminateOp
  | ReorientOp
  | FlattenOp
  | TrimOp;

export interface GraphNode {
  readonly id: NodeId;
  readonly op: Op;
  /** User-facing label; flows through to the cut list. */
  readonly label?: string;
}

export interface Graph {
  readonly nodes: Readonly<Record<NodeId, GraphNode>>;
  /** The finished board. Exactly one. */
  readonly output: Ref;
}

/* -------------------------------------------------------------------------- */
/* Edge treatments                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Applied to the finished solid, not part of the lamination algebra -- a
 * chamfered board is no longer a prism, and keeping these out is what lets the
 * core stay a closed system.
 */
export interface EdgeTreatments {
  readonly chamfer?: { size: Ticks };
  readonly roundover?: { radius: Ticks };
  readonly juiceGroove?: { inset: Ticks; width: Ticks; depth: Ticks };
  readonly feet?: { kind: 'rubber' | 'silicone'; diameter: Ticks; inset: Ticks; count: number };
}

/* -------------------------------------------------------------------------- */
/* Shop profile                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The shop a design is validated against.
 *
 * Stored separately from the design so a shared project re-validates against
 * whoever opens it: a board that fits an 18" drum sander correctly reports as
 * too wide for a 16" one, and nobody inherits a stranger's kerf setting.
 */
export interface ShopProfile {
  readonly kerf: Ticks;
  /**
   * Two measured points. Depth is interpolated between them rather than
   * assuming the cosine model, which overstates a real saw's reach at a bevel
   * (KB-D01).
   */
  readonly bladeDepthAt90: Ticks;
  readonly bladeDepthAt45: Ticks;
  readonly maxBevel: MilliDeg;
  readonly minSafeRipWidth: Ticks;
  readonly minSafeCrosscutLength: Ticks;
  readonly sledCapacity: Ticks;
  readonly drumSanderWidth: Ticks;
  readonly drumSanderMaxThickness: Ticks;
  readonly drumSanderRemovalPerPass: Ticks;
  readonly clampCount: number;
  /** lbf per clamp. */
  readonly clampForceEach: number;
  readonly clampMaxReach: Ticks;
  /** Expected seasonal moisture-content swing, percent. */
  readonly moistureSwingPercent: number;
  /** Per-cut accuracy, in ticks, for the tolerance band. */
  readonly perCutTolerance: number;
  /** A chamfer is a 45-degree bevel rip; a roundover or groove needs a router. */
  readonly hasRouter: boolean;
  readonly hasDrill: boolean;
}

/* -------------------------------------------------------------------------- */
/* Project                                                                     */
/* -------------------------------------------------------------------------- */

export const SCHEMA_VERSION = 1;

export interface ProjectMeta {
  readonly name: string;
  readonly created: string;
  readonly modified: string;
  /** Imperial only for now; Ticks is unit-agnostic so this stays reversible. */
  readonly units: 'imperial';
  /** Rounding target for displayed dimensions. Default 1/32" = 250 ticks. */
  readonly measurementPrecision: Ticks;
}

export interface Project {
  readonly schemaVersion: number;
  readonly meta: ProjectMeta;
  readonly shopProfile: ShopProfile;
  readonly speciesPalette: readonly SpeciesId[];
  readonly graph: Graph;
  readonly edgeTreatments: EdgeTreatments;
  /** Retained so a generated design stays re-parameterisable after a round trip. */
  readonly generator?: { id: string; params: Readonly<Record<string, unknown>> };
}

// Re-exported so model consumers get units from one place.
export type { MilliDeg, Ticks } from '../units/ticks.js';
