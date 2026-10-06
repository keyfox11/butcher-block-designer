# 03 — Geometry Engine

Simulating the construction graph. This module is pure, React-free, and independently testable
([`08`](08-architecture-and-stack.md#module-boundaries)).

## The evaluator

```ts
/** Pure. Given a graph and a ref, produce the workpiece at that port. */
function evaluate(graph: Graph, ref: Ref, cache: EvalCache): EvalResult;

interface EvalResult {
  workpiece: Workpiece;
  /** Everything removed or discarded on the way here. Feeds conservation (I-5). */
  ledger: MaterialLedger;
  diagnostics: Diagnostic[];
}

interface MaterialLedger {
  /** Per species: volume consumed as kerf. */
  kerf: Record<SpeciesId, number>;
  /** Pieces cut but not used downstream, retained for the material report. */
  offcuts: Array<{ species: SpeciesId; dims: Dims; fromNode: NodeId }>;
  /** Volume removed by flatten and trim operations. */
  removed: Record<SpeciesId, number>;
}
```

Memoised by `(nodeId, contentHash)` so editing one strip width re-evaluates only the affected
subtree. The graph is small (tens to low hundreds of nodes), so this is a responsiveness
optimisation rather than a necessity.

## Polygon representation

```ts
/** Integer tick coordinates. Closed ring, counter-clockwise, no repeated last point. */
type Polygon = { ring: Array<{ x: number; y: number }>; holes?: Array<...> };
```

### Recommended library: Clipper2

**Use [Clipper2](https://github.com/AngusJohnson/Clipper2) (`clipper2-js`) for all polygon
booleans and offsetting, operating directly on integer tick coordinates.**

The reasoning matters, because the obvious alternative is wrong for this project:

| | Clipper2 | `polygon-clipping` / Martinez |
| --- | --- | --- |
| Coordinate type | **64-bit integers** | float64 |
| Fits our `Ticks` model | **Exactly** | Requires conversion both ways |
| Robustness | Battle-tested in 3-D printing slicers | Good, but float-epsilon sensitive |
| Polygon offsetting | **Built in** | Not included |

Integer coordinates are not a minor convenience. A float-based boolean library will produce
slivers of width `1e-13` at coincident edges, and those slivers then have to be detected and
merged with an epsilon heuristic that is itself a bug farm. On integers, coincident edges are
*actually* coincident and the degenerate case disappears.

The built-in offsetting also turns out to be exactly what the kerf model needs.

## Cuts as polygon subtraction

A saw cut is not a zero-width line — it removes a slab of material one kerf wide. Modelling it
that way makes kerf accounting automatic instead of bookkeeping:

```
cutSlab   = offset(cutLine, kerf / 2)        // Clipper2 offsetting
pieceA    = crossSection ∩ halfPlaneLeft(cutLine)  −  cutSlab
pieceB    = crossSection ∩ halfPlaneRight(cutLine) −  cutSlab
kerfVolume = area(crossSection ∩ cutSlab) × length
```

Two things fall out for free:

1. **Conservation of mass (invariant I-5) holds by construction.** `area(pieceA) + area(pieceB) +
   area(kerf) == area(input)` is a property of the boolean operation, not something the kerf
   bookkeeping has to remember to do. The common bug in this domain — kerf counted once per
   strip instead of once per cut, or double-counted at panel ends — becomes unrepresentable.
2. **Bevel cuts work without special-casing.** A bevelled cut slab is a parallelogram rather than
   a rectangle; subtracting it is the same operation.

## Operation semantics

### `billet`

Produces a rectangular partition with a single face. The difference between `rough` and `milled`
dimensions is recorded in `ledger.removed` — milling waste is real material and belongs in the
lumber order ([KB-A12](01-woodworking-domain.md#kb-a12--material-budget)).

### `rip` — and why the cut list reports *fence settings*

This is where a naive implementation produces numbers that are arithmetically right and
practically useless.

Cut positions in the model are measured across the cross-section from one reference edge. But
nobody sets a table saw that way. You set the **fence-to-blade distance**, which equals the
width of the piece being kept, and the kerf is removed from the waste side.

So for sequential rips from one edge, keeping each strip:

```
strip 1 occupies [0,              w1]
kerf            [w1,              w1 + k]
strip 2         [w1 + k,          w1 + k + w2]
kerf            [...]
...
widthConsumed = Σ w_i + (number of cuts) × k
```

The cut list therefore reports, per strip: **the fence setting (= the strip width), the cut
number, and the cumulative position**, not just abstract offsets. Same geometry, usable output.

**Bevel rips have a handedness that must be stated.** When the blade is tilted, the kept piece's
two faces have *different* widths, so "the width" is ambiguous:

```
widthAtTableFace = fenceSetting
widthAtTopFace   = fenceSetting ∓ thickness × tan(bevel)
```

The sign depends on which way the blade leans. Standard safe practice tilts the blade **away
from the fence**, so the workpiece is not trapped between a rising blade and the fence. The
instruction generator states the tilt direction explicitly and reports both face widths
([`05`](05-cut-list-and-instructions.md)). Getting this backwards produces a mirror-image
pattern, which for the 3D cube means the illusion simply does not appear
([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)).

### `crosscut`

Divides along the extrusion axis. Cross-section is unchanged; each slice gets
`length = sliceLength`.

```
lengthConsumed = count × sliceLength + (count − 1) × kerf
leftover       = inputLength − lengthConsumed
```

Matches [KB-A02](01-woodworking-domain.md#kb-a02--the-dimensional-relationships) and golden case
1. If `count` is not supplied, the engine derives the maximum that fits, including the `+1`
correction.

**Non-zero miter** produces an oblique prism ([KB-A07](01-woodworking-domain.md#kb-a07--mitered-crosscuts-produce-oblique-prisms)).
The engine applies a shear to the exposed cross-section:

```ts
shear = [[1, 0], [tan(miter), 1 / cos(miter)]]
```

and sets `grainToFaceAngle = miter` on the result so downstream validation and the 3-D renderer
both know the grain is no longer perpendicular. The preview must show the shear, or the picture
is a lie about the shape of the finished pieces.

### `laminate`

Place each member's cross-section by its `offset` / `rotation` / `mirrored`, then union:

```
result.outline = ∪ transform(member.crossSection.outline)
result.faces   = concat of transformed member faces, with pieceIds preserved
```

Then check: **no overlaps, and no unintended gaps.** An overlap means the design asks two pieces
to occupy the same space — an error. A gap may be intended (a honeycomb edge, handled below) or a
mistake (a mis-set offset), so gaps are reported as polygons for the UI to highlight rather than
silently filled.

Glue area per joint is computed here for the clamp-pressure calculation
([KB-A10](01-woodworking-domain.md#kb-a10--glue-choice-sizing-and-pressure)):

```
jointArea = sharedEdgeLength(memberA, memberB) × length
```

### `reorient`

Returns the input with `length` and the cross-section's role swapped in interpretation. **No
geometry changes.** The implementation is close to an identity function, and that is the point
([`02`](02-construction-graph.md#why-toendgrain-is-a-reinterpretation-not-a-transform)).

What it does change is the *validation context*: downstream nodes are end-grain and get
end-grain rules. It also records a marker the safety validator reads (`V-SAFE-010`).

### `flatten`

Reduces two opposing cross-section dimensions by `removePerFace` each and records the removal.
For a post-`reorient` workpiece this shortens `length` (the board's thickness) — which is exactly
why the crosscut was made oversize.

### `trim`

Intersects the cross-section with the target rect or outline. Everything outside becomes a
tracked offcut. This is how the honeycomb's ragged edge is resolved into stated finished
dimensions.

## Deriving the views

### 2-D face mosaic

For a graph whose output is post-`reorient`, the face pattern *is* `output.crossSection`. Render
each `PartitionFace` as an SVG path filled with its species colour. No projection, no
transformation — a direct read of the model.

Also derived here: the per-piece labels and orientation arrows used by the assembly maps
([`05`](05-cut-list-and-instructions.md#assembly-maps)).

### 3-D solid

Extrude each face polygon by `output.length`:

```ts
// one mesh per species, merged, so the draw-call count is species-count not piece-count
geometry = mergeBufferGeometries(faces.map(f => extrude(f.polygon, thickness)))
```

Grain rendering is what makes the preview read as wood rather than as coloured plastic:

| Surface | Appearance |
| --- | --- |
| Top / bottom | **End grain** — concentric rings, pores; procedural, oriented per face by `ringAngle` |
| Sides | **Long grain** — lengthwise figure |

Species colour, pore scale, and ring contrast come from the species table
([KB-B03](01-woodworking-domain.md#kb-b03--species-movement-data)) so the preview stays consistent
with the palette swatches. Edge treatments are applied here as a post-process, since they are not
part of the prism model.

## Degenerate and failure cases

The engine must be explicit about these rather than producing plausible-looking garbage.

| Case | Handling |
| --- | --- |
| Zero or negative strip width | **Error.** Geometrically impossible, usually an over-large bevel (KB-A06). |
| Strip narrower than `minSafeRipWidth` | **Error**, not a warning — the design instructs an unsafe cut (`V-TOOL-020`). |
| Strip that tapers to zero *inside* the panel | **Error.** Checked at both faces, not one (KB-A06); CBDJS checks only one direction. |
| Sliver faces below one tick | Merged into the neighbour sharing the longest edge; reported as info. |
| Gap in a lamination | Reported as a polygon with its area, for the UI to highlight. Never auto-filled. |
| Overlap in a lamination | **Error** with the overlap polygon. |
| Self-intersecting user polygon | Rejected at input with the intersection point; the canvas prevents it where it can. |
| Hex tiling that does not close | Reported with the residual polygons (see below). |
| Rotation producing a non-integer offset | Rounded to ticks; rounding error accumulated into the tolerance band. |

## Honeycomb and other non-grid tilings

A hexagonal tiling cannot fill a rectangle. Partial hexes at the border are not an edge case to
be handled quietly — they are a decision the builder has to make, and the finished dimensions
depend on which way it goes.

The engine tiles hexes over the target, intersects with the target outline, and classifies each
cell as whole or partial. The UI then offers three resolutions:

1. **Trim through.** Accept partial cubes at the border. Exact target dimensions; the illusion is
   cut off at the edge, which many builders consider correct since it implies continuation.
2. **Filler strips.** Glue solid border strips to square it off. A clean frame, and it reads as a
   deliberate border; adds pieces to the cut list.
3. **Grow to whole cells.** Expand the board to the next whole hex. Preserves every cube intact;
   the finished size is no longer what was asked for, and the tool must say so clearly.

Whichever is chosen becomes an explicit `trim` or `laminate` node in the graph — so the cut list
and the picture stay in agreement, which is the whole premise.

## Performance

Target: **re-evaluate and re-render within one animation frame** while a dimension slider is
dragged.

- Memoised evaluation, dirty-subtree only.
- Boolean operations are the hot path. Typical designs are tens of polygons of a few vertices
  each, well within Clipper2's range; cache cut slabs across re-evaluations when only a
  downstream parameter changed.
- 3-D geometry rebuilt only when the partition actually changes, not on camera movement.
- If profiling shows the 2-D canvas struggling at high piece counts, the fallback is Canvas2D or
  Pixi ([`08`](08-architecture-and-stack.md)); SVG is the default for its hit-testing and crispness.

## Next

[`04-validation-rules.md`](04-validation-rules.md) — deciding whether the result can actually be
built.
