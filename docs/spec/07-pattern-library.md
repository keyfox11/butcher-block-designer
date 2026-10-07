# 07 — Pattern Library and the Decomposer

Two halves. **Generators** emit a construction graph from parameters, so tier-1 output is
buildable by construction. The **decomposer** goes the other way — from a painted target to a
graph — and is the hard part.

## Generator interface

```ts
interface PatternGenerator<P> {
  id: string;
  name: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Number of glue-ups. The honest cost signal — show it in the gallery. */
  glueUpCount: (params: P) => number;
  paramSchema: ParamSchema<P>;
  /** The whole contract: parameters in, construction graph out. */
  generate(params: P, shop: ShopProfile): Graph;
}
```

Generators emit graphs, not pictures. A generator cannot produce an unbuildable design, because
the only thing it can express is a sequence of operations — and it cannot disagree with its own
cut list, because there is only one representation
([`00`](00-overview.md#the-thesis)).

`glueUpCount` is surfaced in the gallery deliberately. Glue-ups are the real cost of these
boards — each one is an overnight cure, a flattening pass, and a chance to ruin everything — and
a user choosing between a 2-stage and a 3-stage pattern deserves to know before they start.

---

## Checkerboard

**Difficulty** beginner · **Glue-ups** 2

| Parameter | Notes |
| --- | --- |
| `cellSize` | Square cell. Also sets stock thickness and rip width — `w = D` ([KB-A02](01-woodworking-domain.md#kb-a02--the-dimensional-relationships)) |
| `species` | Exactly 2 |
| `columns`, `rows` | Cell counts |
| `boardThickness` | Finished; the crosscut is made oversize by the flattening allowance |

Recipe:

```
1. billet(A) milled to thickness = cellSize
   billet(B) milled to thickness = cellSize
2. rip each into strips of width = cellSize
3. laminate alternating A,B,A,B… → stage-1 panel, `columns` strips wide
4. crosscut into `rows` slices at sliceLength = boardThickness + 2 × flattenAllowance
5. reorient toEndGrain
6. laminate slices, rotating alternate slices 180° in the face plane
7. flatten, trim
```

### The odd-column problem

Step 6 is where a naive implementation produces a striped board instead of a checkerboard, and
it is worth spelling out because it is not obvious.

Rotating a slice 180° reverses its species sequence. With an **even** strip count that produces
the offset you want:

```
slice 1:            A B A B A B A B
slice 2 (rotated):  B A B A B A B A     ✓ checkerboard
```

With an **odd** count, reversal is a no-op on the pattern:

```
slice 1:            A B A B A
slice 2 (rotated):  A B A B A           ✗ stripes, not checkerboard
```

So for odd column counts the generator builds **two stage-1 panels** with inverted species order
(`A B A B A` and `B A B A B`) and draws alternate slices from each. This costs a little more
lumber and one more rip setup, and it is the only way to get a true checkerboard with an odd cell
count.

The generator handles this automatically. The alternative — silently rounding the user's column
count to even — would change the finished dimensions without telling them.

---

## Brick / running bond

**Difficulty** beginner · **Glue-ups** 2

Alternate rows offset by **half** a cell. The naive approach shifts alternate slices sideways and
trims the overhang, which wastes material and leaves a partial cell at each edge.

The clean approach is again two panels, where the second begins and ends with a half-width strip:

```
panel A:  [1.5][1.5][1.5][1.5]              = 6.0"
panel B:  [0.75][1.5][1.5][1.5][0.75]       = 6.0"   ← same width, offset by half
```

Both panels are full width, nothing is trimmed, and every row is complete. Slices alternate
between the two panels.

---

## 3D cube / tumbling block

**Difficulty** advanced · **Glue-ups** 2 (but unforgiving)

The pattern no grid-based tool can represent. Geometry derived and verified in
[KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block).

| Parameter | Notes |
| --- | --- |
| `stockThickness` **T** | The master dimension. Everything else derives from it. 1¼"–1⅜" typical |
| `species` | Exactly 3, ordered light → mid → dark. The ordering *is* the illusion |
| `boardWidth`, `boardLength` | Target; resolved against whole hexes |
| `boardThickness` | Puck length |
| `edgeResolution` | `trim` / `filler` / `growToWholeCells` ([`03`](03-geometry-engine.md#honeycomb-and-other-non-grid-tilings)) |

Derived geometry — all of it fixed by `T`:

```
bevel            = 30° from vertical  (60° from the table)
ripWidthOnFace   = T / cos(30°) = 1.154700 × T        [the closure condition]
rhombusSide  s   = ripWidthOnFace
hexAcrossFlats   = 2 × T                              [exact]
hexAcrossCorners = 2.309401 × T

honeycomb lattice (pointy-top):
  dx            = 2 × T
  dy            = T × sqrt(3)
  rowOffset     = T                                   (alternate rows)
```

Recipe:

```
1. billet × 3, each milled to thickness T
2. bevel-rip each at 30°, rip width = 1.1547 × T  → rhombus-section sticks
   ⚠ blade tilts AWAY from the fence; direction is reported in the cut list,
     because a mirrored rhombus means the illusion never appears
3. laminate the 3 rhombi around a shared edge → regular hexagonal prism
   ⚠ sequence: rowByRow. Tape as a tension wrap — these cannot be clamped squarely
4. crosscut the hex prism into pucks at boardThickness + 2 × flattenAllowance
5. reorient toEndGrain
6. laminate pucks on the honeycomb lattice above, like species meeting only at corners
7. resolve the ragged edge per `edgeResolution`
8. flatten, trim
```

Validation that comes free: `V-GEOM-050` asserts `|hexAcrossFlats − 2T| < tol`. If the rip width
is off, the rhombi are not rhombi, they will not close into a hexagon, and gaps will open in the
glue-up. One assertion catches the most common way this board fails.

Three 60° rhombi close exactly because each contributes its 120° corner: `3 × 120° = 360°`.

---

## True herringbone

**Difficulty** advanced · **Glue-ups** 3

Most "herringbone" end-grain boards are made with mitered crosscuts, which produces oblique
prisms — the grain is no longer perpendicular to the face, self-healing degrades, and the board
tears out when flattened
([KB-A07](01-woodworking-domain.md#kb-a07--mitered-crosscuts-produce-oblique-prisms)).

There is a better way, and it depends on an observation that makes the third stage free:

> **Rotating a finished end-grain block 90° about its vertical axis keeps the grain vertical.**

The grain runs through the thickness, so spinning a block in the face plane does not change the
grain direction at all. That means tiles can be rotated into a second orientation without
compromising the end grain — which is exactly what herringbone needs.

```
1-2. Stage 1 + 2: build an ordinary end-grain block of striped cells
     (as per Checkerboard steps 1–6)
3.   Rip and crosscut that block into rectangular tiles, a × b
4.   Laminate the tiles, rotating alternate tiles 90° about the vertical axis
5.   flatten, trim
```

Grain stays perpendicular to the working face throughout. Cost: a third glue-up, and sawing
through an end-grain block is hard on blades.

The generator offers the mitered shortcut as an explicit alternative, with `V-GRAIN-020`
attached, so the trade-off is the user's to make rather than hidden.

---

## The rest of the catalogue

| Pattern | Difficulty | Glue-ups | Mechanism |
| --- | --- | --- | --- |
| Classic stripes | beginner | 1 | Stage-1 panel, never crosscut. Edge grain. |
| End-grain stripes | beginner | 2 | Uniform strips; slices not rotated |
| Three-wood bands | beginner | 2 | Checkerboard with a 3-species repeat |
| Diagonal accent | beginner | 2 | One or two contrasting strips at a bevel |
| Zig-zag | intermediate | 2 | Bevel-ripped strips; alternate slices flipped ([KB-A06](01-woodworking-domain.md#kb-a06--angled-layer-boundaries-bevel-ripped-strips)) |
| Chevron | intermediate | 2 | Zig-zag with mirrored rather than repeated rows |
| Snake skin | intermediate | 2 | Progressive trailing angles across the layer stack |
| Spiral | intermediate | 2 | Angles sweep across the stack with alternate slices rotated. The single-stage angled spiral, not the multi-stage pinwheel. |
| Stochastic | beginner | 2 | Seeded random species assignment on a grid |
| **3D cube** | advanced | 2 | Honeycomb of hex prisms, each from three bevel-ripped rhombi ([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)) |
| **Herringbone** | advanced | 2 | Striped 2:1 tiles in diagonal runs, alternate ones turned 90° |
| **Pinwheel** | advanced | 2 | Four striped tiles round an accent square, in a 3u × 3u block |
| **Basket weave** | intermediate | 2 | Square striped tiles alternating a quarter turn |

The four multi-stage patterns land at **two** glue-ups, not three. Each is a stage-1 striped panel
or hex prism, then the final lay-up — the tile's internal pattern comes from the stage-1 panel
rather than from a separate stage. Counting them as three would overstate the commitment, and the
count is on the pattern chip precisely so a user can judge that before buying lumber.

The tile geometry follows from the stock thickness alone. A stage-1 panel of `n` strips ripped
from stock `T` thick is `n × s` wide and `T` thick; crosscut and stood on end, that panel face *is*
the tile. Herringbone and pinwheel want a 2:1 tile, so `n × s = 2T`; basket weave wants a square
one, so `n × s = T`. One number on the planer sets the whole pattern.

**Stochastic** deserves a note: it is trivial to implement and disproportionately fun. A seed
makes it reproducible, so a design can be shared and rebuilt, and the seed goes in the project
file. It is also the gentlest introduction to the free tier — random-within-a-grid is always
buildable, so it gives creative latitude with zero risk of an unbuildable result.

---

## The decomposer

Tier 2's engine: given a painted target mosaic, find a construction graph that produces it.

This is the hardest component in the system, and the spec's position is to **be honest about its
limits rather than overpromise**. A tool that silently approximates a painted design produces a
board that does not match the drawing — a worse outcome than a clear refusal.

### Strategy, cheapest first

```ts
function decompose(target: Partition, shop: ShopProfile): DecomposeResult;

type DecomposeResult =
  | { ok: true;  graph: Graph; stages: number; exact: true }
  | { ok: true;  graph: Graph; stages: number; exact: false; diff: Partition }
  | { ok: false; unreachable: Polygon[]; reason: string; suggestion?: Partition };
```

**1 — Grid detection.** If every face is a rectangle on a common lattice, emit the two-stage
recipe directly. Fast, exact, and covers most of what people actually paint.

**2 — Guillotine decomposition.** Recursively look for a straight edge-to-edge cut that splits the
partition in two, down to single faces. The reverse of that recursion is a nesting of rip and
laminate operations. This is a classic and tractable search; it covers all stripe variants and
most irregular rectangular layouts.

Search order matters for output quality, not just speed: prefer cuts that minimise the resulting
tree depth, because tree depth becomes **glue-up count**, and a 6-stage solution to something a
user painted casually is not a useful answer.

**3 — Band segmentation plus multi-stage.** If no single guillotine cut works, look for a
partition into groups that are *individually* guillotine-cuttable, then assemble those. This is
the multi-stage case ([KB-A04](01-woodworking-domain.md#kb-a04--multi-stage-sub-assemblies)) and
covers herringbone, pinwheel, and basket weave.

**4 — Known tilings.** Match against a library of tilings with established prism recipes —
honeycomb via rhombus sticks being the one that matters
([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)).

**5 — Failure.** Report the specific faces that cannot be reached and why, and offer a snapped
alternative with a visible diff.

### As built

Strategies 1 and 2 collapsed into one, and it is a better answer than either. Strategy 3 falls out
of the same recursion, and strategy 4 is not implemented.

**Steps 1 and 2 are the same step.** Grid detection was specified as a fast path around the
guillotine search, on the assumption the search would be expensive. It is not. Splitting at *every*
valid line in one direction at once is lossless — a line that spans a child spans its parent, so
nothing is given up by taking them all — which reduces each node to two candidates instead of
O(X+Y) and makes the whole search a two-way memoised recursion. A grid is then simply the case
where the first `y` split yields bands of single pieces, reached in about a millisecond without a
special path to maintain.

**Step 3 needs no separate strategy.** Multi-stage *is* a deeper tree. A `y` split spanning the
full board length separates slices; a `y` split inside a slice is layers glued face to face before
the panel is ripped. Both are the same node type and the emitter reads the difference off the
geometry.

**Step 4 is not implemented, and the honest reason is that nothing can reach it.** A honeycomb
needs hexagonal faces, and the paint lattice is square — so a tiling matcher would sit behind a
door with no handle on this side. The tumbling-block generator covers the pattern from tier 1,
where it belongs. If a hex-capable region tool ever lands, this is where its matcher goes.

**Search order turned out to matter for a reason the spec did not name.** Minimising tree depth is
right, but depth alone picks the wrong tree for a plain grid: an `x`-rooted decomposition of a
6 × 8 grid ties on depth and has *fewer* splits, while costing six stage-1 panels against two.
Identical bands share a panel, and which bands are identical is only known after the search, so the
cost model cannot see the saving. Preferring a `y` root is what stands in for it.

**One narrowing, stated plainly in the UI.** A face must be an axis-aligned rectangle. Bevelled
faces are genuinely buildable — the layered generators build them — but they do not live on a
square lattice, so the paint surface refuses them with a message naming the angled generators
rather than implying the geometry is impossible.

### What the decomposer cannot do

Stated plainly, because the UI must not imply otherwise:

- **Curves.** A table saw cuts straight lines. Curved regions are rejected outright, not
  approximated into stair-steps.
- **Interior islands.** A face fully enclosed by another cannot be produced by through-cuts and
  lamination. This is a real geometric limit, not a missing feature.
- **Arbitrary rotations.** Only angles reachable by a bevel (≤45°) or a miter, and bevel-ripped
  pieces must still tile.
- **Unbounded stage counts.** The search is capped (default 4 stages). Past that the design is not
  practically buildable even if it is theoretically decomposable, and saying so is more useful
  than returning a 9-stage graph.

### Image import

A thin layer over the decomposer, and the most likely source of disappointment, so the funnel is
made explicit:

1. Load image; user sets the target cell grid.
2. Quantise to the species palette (nearest in perceptual colour space, honouring available
   species).
3. Hand the resulting grid to the decomposer — which, being a grid, always succeeds at step 1.
4. Show achieved-versus-source side by side.

Quantising to 3–4 wood tones loses nearly all photographic detail. The UI must show the quantised
preview **before** generating anything, so expectations are set by a picture rather than by hope.
Images with bold shapes and strong contrast work; photographs do not.

## Next

[`08-architecture-and-stack.md`](08-architecture-and-stack.md) — how this gets built and tested.
