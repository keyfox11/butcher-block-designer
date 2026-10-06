# 02 — The Construction Graph

The data model. This is the source of truth for a design: not a picture, but the sequence of
physical operations that produces the board.

## The central type

Every intermediate workpiece in end-grain board making is a **prism** — a species-partitioned
2-D polygon extruded along an axis, with grain parallel to that axis ([`00`](00-overview.md),
[KB-A02](01-woodworking-domain.md#kb-a02--the-dimensional-relationships)).

```ts
/** A prismatic workpiece: a species-partitioned cross-section, extruded. */
interface Workpiece {
  /** The 2-D cross-section, subdivided into species regions. */
  crossSection: Partition;
  /** Extrusion length along the grain axis. */
  length: Ticks;
  /**
   * Whether the grain still runs along the extrusion axis.
   * True for milled stock and stage-1 panels. Still true after `toEndGrain` —
   * what changes there is which axis is "up", not where the grain points.
   */
  grainAlongAxis: boolean;
  /** Which graph node produced this, for traceability in the cut list. */
  producedBy: NodeId;
}

interface Partition {
  /** Overall boundary of the cross-section. */
  outline: Polygon;
  /** Non-overlapping faces whose union is exactly `outline`. */
  faces: PartitionFace[];
}

interface PartitionFace {
  polygon: Polygon;
  species: SpeciesId;
  /** Traces back to a specific cut piece, so the assembly map can label it. */
  pieceId: PieceId;
  /**
   * Growth-ring orientation. Needed for the consistency check in KB-B02 —
   * mixing these in an end-grain board shears the glue lines.
   */
  ringOrientation: RingOrientation;
  /** Ring angle within the face plane, for finer movement analysis. */
  ringAngle: MilliDeg;
}

type RingOrientation = 'quartersawn' | 'flatsawn' | 'riftsawn' | 'unspecified';
```

### Why `toEndGrain` is a reinterpretation, not a transform

This is the part worth getting right, because it is where the whole model earns its keep.

When you rotate a crosscut slice 90° to expose end grain, **the cross-section polygon does not
change**. What changes is which axis you call "thickness":

| Before `toEndGrain` | After |
| --- | --- |
| `crossSection` = the panel's (width × thickness) profile | `crossSection` = **the board's face pattern** |
| `length` = slice width `s` | `length` = **the board's thickness** |

So the finished board's face pattern *is* the cross-section polygon, and its thickness *is* the
extrusion length. The operation carries no geometry — it only re-labels axes.

A useful consequence: this model **cannot** express a board whose pattern varies through its
thickness, and no real end-grain board does, because every piece runs from the top face to the
bottom face. The model's expressiveness is exactly equal to physical reality.

## Numbers: exact where it matters, honest where it can't be

### Inputs are exact integers

```ts
/** Integer count of 1/1000 inch. Every user-entered length is Ticks. */
type Ticks = number & { readonly __brand: 'Ticks' };

/** Integer millidegrees. Every angle is MilliDeg. */
type MilliDeg = number & { readonly __brand: 'MilliDeg' };
```

The branded types are deliberate: they make it a compile error to pass a raw `number` where a
length is expected, which is the cheapest possible defence against a unit mix-up.

**Why not floats.** `12 × 1.2` in IEEE-754 doubles is `14.399999999999999`. That is not a
cosmetic problem in this domain. Woodworkers work to 1/32", errors accumulate across a 20-strip
glue-up, and a board that computes to `11.999999"` gets displayed as "12 minus a hair" — sending
someone to re-measure a joint that was never wrong. On ticks, the same computation is `12 × 1200 = 14400`
exactly.

For all-rectilinear designs — checkerboard, brick, stripes, the overwhelming majority of real
boards — **every dimension in the cut list is exact**.

### Where exactness genuinely ends

Bevel rips and angled layers involve `tan θ` ([KB-A06](01-woodworking-domain.md#kb-a06--angled-layer-boundaries-bevel-ripped-strips)),
and the hex closure involves `cos 30° = √3/2`
([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)). These
are irrational. Pretending otherwise would be worse than admitting it.

The policy:

1. **Inputs** (dimensions, angles, counts) are stored exactly as `Ticks` / `MilliDeg`.
2. **Derived geometry** is computed in `float64`.
3. **Cut-list output** is rounded to the user's measurement precision (default nearest 1/32"),
   and **the rounding error is reported alongside the number** — never silently discarded.
4. **Invariant checks** use an explicit tolerance, documented per check.

```ts
interface Dimension {
  /** Exact value if the computation was rational; otherwise the float64 result. */
  value: number;          // in ticks
  /** What the user will measure to, after rounding to their precision. */
  asMeasured: Ticks;
  /** asMeasured - value. Signed. Shown when it exceeds a display threshold. */
  roundingError: number;
  exact: boolean;
}
```

### Accumulated tolerance

A separate and more interesting problem: a 20-strip glue-up where each rip is accurate to
±0.005" has a total width uncertainty of roughly `±0.005 × √20 ≈ ±0.022"` if errors are
independent, or `±0.1"` if they are systematic (a fence set slightly off, which is the realistic
case).

The tool reports **both bounds** per assembly, because they prescribe different actions: random
error means trim to final size at the end; systematic error means check the fence before you cut
twenty strips. No reference tool does this, and "my board came out 1/8" narrow" is one of the
most common complaints in the hobby.

```ts
interface ToleranceBand {
  nominal: Ticks;
  randomWorstCase: number;      // sqrt(n) * perCutTolerance
  systematicWorstCase: number;  // n * perCutTolerance
  cutCount: number;
}
```

## Operations

A design is a DAG of operations. Nodes have **ports**, because a rip produces many strips from
one panel:

```ts
type NodeId = string;
type Ref = { node: NodeId; port: number };

interface GraphNode {
  id: NodeId;
  op: Op;
  /** User-facing label, e.g. "maple strips" — flows into the cut list. */
  label?: string;
}

type Op =
  | BilletOp | RipOp | CrosscutOp | LaminateOp
  | ReorientOp | FlattenOp | TrimOp;
```

### `billet` — raw stock

```ts
interface BilletOp {
  kind: 'billet';
  species: SpeciesId;
  /** Rough dimensions as purchased, before milling. */
  rough: { thickness: Ticks; width: Ticks; length: Ticks };
  /** Dimensions after milling flat and square. Drives the milling allowance. */
  milled: { thickness: Ticks; width: Ticks; length: Ticks };
  ringOrientation: RingOrientation;
}
```

A leaf node. One port: the milled billet.

### `rip` — lengthwise cuts

```ts
interface RipOp {
  kind: 'rip';
  input: Ref;
  /**
   * Cut positions measured across the cross-section width, in order.
   * `bevel` is the blade tilt from vertical; 0 = square.
   * A non-zero bevel shifts the cut by `thickness * tan(bevel)` across the
   * panel's thickness (KB-A06) — this is what produces rhombus sticks and
   * angled layer boundaries.
   */
  cuts: Array<{ at: Ticks; bevel: MilliDeg }>;
  /** Which resulting strips to keep. Omitted strips become tracked offcuts. */
  keep: number[];
}
```

Ports: one per kept strip, in order. Offcuts are retained in the material ledger so that
conservation of mass holds ([`08`](08-architecture-and-stack.md#testing-strategy)).

### `crosscut` — slices across the grain

```ts
interface CrosscutOp {
  kind: 'crosscut';
  input: Ref;
  /**
   * Length of each slice along the grain. After `toEndGrain` this becomes the
   * finished board thickness, so it is cut oversize by the flattening
   * allowance (KB-A08).
   */
  sliceLength: Ticks;
  count: number;
  /**
   * Miter from perpendicular. 0 is strongly preferred.
   * Non-zero yields an OBLIQUE prism: grain is no longer perpendicular to the
   * face, self-healing degrades, and the exposed face shears by 1/cos(miter).
   * See KB-A07 and rule V-GRAIN-020.
   */
  miter: MilliDeg;
  bevel: MilliDeg;
}
```

Ports: one per slice. Consumes `count * (sliceLength + kerf) - kerf` of the input's length.

### `laminate` — glue pieces together

```ts
interface LaminateOp {
  kind: 'laminate';
  members: LaminateMember[];
  glue: GlueSpec;
  /** Sequencing hint. Angled joints slide under clamp pressure (KB-A11). */
  sequence: 'simultaneous' | 'rowByRow';
}

interface LaminateMember {
  piece: Ref;
  /**
   * Where this member's cross-section sits inside the parent's cross-section.
   * General 2-D placement — which is what allows non-grid assemblies such as
   * the honeycomb tiling of hex pucks (KB-A05).
   */
  offset: { x: Ticks; y: Ticks };
  rotation: MilliDeg;
  mirrored: boolean;
}
```

The general 2-D placement is the single most important difference from the reference tools. A
layer-stack model can only append along one axis; this can place a piece anywhere, which is what
a honeycomb, a pinwheel, or a brick offset actually requires.

All members must have equal `length` — you cannot glue a 1.5" slice to a 2" slice and get a flat
board. Enforced as invariant **I-4**.

### `reorient` — the 90° rotation

```ts
interface ReorientOp {
  kind: 'reorient';
  input: Ref;
  /** The only physically meaningful reorientation in this domain. */
  mode: 'toEndGrain';
}
```

Carries no geometry (see above). Its value is semantic: downstream, `crossSection` means "the
face pattern" and `length` means "board thickness", and the validator switches to end-grain rules
(min thickness, grain-orientation consistency, movement in two axes).

### `flatten` — stock removal

```ts
interface FlattenOp {
  kind: 'flatten';
  input: Ref;
  method: 'drumSander' | 'routerSled' | 'handPlane';
  /** Removed from each face. Default 1/8" per face (KB-A08). */
  removePerFace: Ticks;
}
```

There is deliberately **no `'thicknessPlaner'` variant for end-grain stock.** The type system
refuses to represent the one operation that destroys boards and injures people
([KB-A08](01-woodworking-domain.md#kb-a08--flattening-the-hard-safety-gate)). Making an unsafe
operation *unrepresentable* is stronger than validating against it, and it costs nothing.

A planer is legitimate for flattening stage-1 panels, where the grain still runs lengthwise. The
validator distinguishes these by `grainAlongAxis` combined with whether a `reorient` is upstream
(rule `V-SAFE-010`).

### `trim` — square up, or cut to outline

```ts
interface TrimOp {
  kind: 'trim';
  input: Ref;
  target:
    | { kind: 'rect'; width: Ticks; height: Ticks }
    | { kind: 'outline'; polygon: Polygon };
}
```

`rect` is end-trimming and squaring. `outline` handles the jagged edge left by a honeycomb tiling
(KB-A05) — the tool must plan that trim, since ignoring it means the stated finished dimensions
are wrong.

## Edge treatments are not operations

```ts
interface EdgeTreatments {
  chamfer?:     { size: Ticks; edges: EdgeSet };
  roundover?:   { radius: Ticks; edges: EdgeSet };
  juiceGroove?: { inset: Ticks; width: Ticks; depth: Ticks; cornerRadius: Ticks };
  feet?:        { kind: 'rubber' | 'silicone'; diameter: Ticks; inset: Ticks; count: number };
}
```

These break the pure extrusion — a chamfered board is no longer a prism — so they live in a
**separate post-processing layer** applied to the final solid for rendering and for instruction
steps. Keeping them out of the lamination algebra is what lets the core stay a clean, provable
closed system.

They still participate in validation: a juice groove's depth is checked against board thickness
(`V-DIM-020`, [KB-C02](01-woodworking-domain.md#kb-c02--juice-groove)).

## The project document

```ts
interface Project {
  schemaVersion: number;
  meta: {
    name: string;
    created: string;   // ISO 8601
    modified: string;
    units: 'imperial' | 'metric';
    /** Rounding target for displayed dimensions. Default 1/32". */
    measurementPrecision: Ticks;
  };
  shopProfile: ShopProfile;
  speciesPalette: SpeciesId[];
  graph: {
    nodes: Record<NodeId, GraphNode>;
    /** The finished board. Exactly one. */
    output: Ref;
  };
  edgeTreatments: EdgeTreatments;
  /** Set when the graph was produced by a generator, so it stays re-parameterisable. */
  generator?: { id: string; params: Record<string, unknown> };
}
```

```ts
interface ShopProfile {
  kerf: Ticks;
  /** Two measured points; depth is interpolated between them (KB-D01). */
  bladeDepthAt90: Ticks;
  bladeDepthAt45: Ticks;
  maxBevel: MilliDeg;
  minSafeRipWidth: Ticks;
  minSafeCrosscutLength: Ticks;
  sledCapacity: Ticks;
  drumSanderWidth: Ticks;
  drumSanderMaxThickness: Ticks;
  drumSanderRemovalPerPass: Ticks;
  clampCount: number;
  clampForceEach: number;        // lbf
  clampMaxReach: Ticks;
  /** Expected seasonal moisture-content swing, for movement prediction (KB-B04). */
  moistureSwingPercent: number;
  perCutTolerance: number;       // ticks, for the tolerance band
}
```

Storing the **shop** separately from the **design** is what makes a shared design portable: the
same graph re-validates against whoever opens it, and a board that is buildable in one shop
correctly reports as unbuildable in another.

## Invariants

Checked on every mutation in development, and in the test suite as property-based assertions.

| # | Invariant | Tolerance |
| --- | --- | --- |
| **I-1** | The graph is acyclic, and exactly one node is designated `output`. | exact |
| **I-2** | Every node is reachable from `output`. Unreachable nodes are material you cut and never used — a warning, not an error. | exact |
| **I-3** | Every `Partition` is valid: faces pairwise non-overlapping, union exactly equals `outline`, no gaps. | 1 tick |
| **I-4** | All members of a `laminate` have equal `length`. | exact |
| **I-5** | **Conservation of mass.** Per species: volume into the graph equals volume in the output, plus kerf, plus tracked offcuts, plus flattening removal. | 0.1% |
| **I-6** | After a `toEndGrain` node, all laminated members downstream agree on `grainAlongAxis`. | exact |
| **I-7** | Every `Ref` resolves to an existing node and a valid port index. | exact |

**I-5 is the strongest guarantee in the system.** It is a physical conservation law, it holds for
*any* graph regardless of complexity, and it catches an entire class of geometry bugs — a
mis-modelled bevel, a double-counted kerf, a dropped offcut — without anyone having to anticipate
the specific failure. It is specified as a property-based test in
[`08`](08-architecture-and-stack.md#testing-strategy).

## Mutation, history, and identity

- **Normalised store.** Nodes in a flat `Record<NodeId, GraphNode>`, referenced by id. No nested
  trees, so an edit touches one entry.
- **Undo/redo** via immer inverse patches. Patches are small and serialisable, which also makes
  them useful for a future collaborative mode.
- **Stable node ids.** Ids must survive edits, because shared URLs and saved projects reference
  them. Ids are generated once and never reassigned; deletion leaves no hole to be reused.

## Schema versioning

Project files and shared URLs outlive the code, so migration is a requirement rather than a
nicety ([`09`](09-exports.md)).

```ts
type Migration = (doc: unknown) => unknown;
const migrations: Record<number, Migration>;  // keyed by the version it upgrades FROM
```

Rules:

1. `schemaVersion` is bumped for any change that is not purely additive-with-default.
2. Migrations are **pure, total, and tested against stored fixtures** — one committed fixture per
   historical version, so the oldest file in the wild is always covered.
3. Loading a newer version than the code understands fails with a clear message rather than
   partially parsing. A half-loaded cut list is worse than a refusal.

## Next

[`03-geometry-engine.md`](03-geometry-engine.md) — simulating these operations.
