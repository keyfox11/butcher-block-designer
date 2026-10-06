# 04 — Validation Rules

The validator is what separates this tool from a drawing program. It answers: *can this actually
be built, in this shop, out of these woods, and will it survive a year in a kitchen?*

## Rules are data

```ts
interface Rule {
  /** Stable id, e.g. "V-TOOL-010". Referenced from findings, tests, and docs. */
  id: RuleId;
  severity: 'error' | 'warning' | 'info';
  category: RuleCategory;
  /**
   * KB entries that justify this rule. REQUIRED and non-empty.
   * A rule without a citation is a bug — it means someone encoded an opinion.
   */
  cites: KbId[];
  /** Template; {placeholders} are filled from the finding's data. */
  message: string;
  /** What to do about it. Shown alongside the message. */
  remedy: string;
  check(ctx: ValidationContext): Finding[];
}

interface Finding {
  ruleId: RuleId;
  severity: 'error' | 'warning' | 'info';
  /** Which node(s) are at fault, so the UI can highlight them in the graph. */
  nodes: NodeId[];
  /** Which pieces, so the UI can highlight them on the 2-D canvas. */
  pieces?: PieceId[];
  data: Record<string, unknown>;   // fills the message template
  /** Resolved citation text, so the user can read *why* without leaving the panel. */
  rationale: string;
}
```

Three properties of this design are deliberate:

1. **Mandatory citations.** Every rule points at a [`01`](01-woodworking-domain.md) entry. This is
   enforced by a test that fails if any rule has an empty `cites` array or cites a KB id that
   does not exist. It is the mechanism that keeps woodworking opinion out of the codebase.
2. **Findings carry locations.** A finding highlights the offending node *and* the offending
   pieces, so "this is wrong" is always accompanied by "this, here".
3. **Rationale travels with the finding.** The user sees why, not just what. This is the "teach
   while it plans" goal from [`00`](00-overview.md#goals).

### Severity semantics

| Severity | Meaning | Effect |
| --- | --- | --- |
| `error` | Physically impossible, unsafe, or will fail | **Blocks export** of the cut list |
| `warning` | Buildable but risky or compromised | Export permitted, warning printed on the cut list |
| `info` | Worth knowing | Shown in the panel only |

Errors block export because the cut list is the thing someone takes to the saw. Emitting one that
cannot be followed is the specific failure this tool exists to prevent.

---

## V-SAFE — Safety (always blocking)

| Id | Rule | Cites |
| --- | --- | --- |
| `V-SAFE-010` | **Thickness planer on end-grain stock.** The `FlattenOp` type has no `thicknessPlaner` variant, so this is unrepresentable in a normally-constructed graph. The rule exists as defence in depth against imported, migrated, or hand-edited project files. | [KB-A08](01-woodworking-domain.md#kb-a08--flattening-the-hard-safety-gate) |
| `V-SAFE-020` | Flattening pass depth exceeds the machine's safe removal per pass. | KB-A08, KB-D04 |
| `V-SAFE-030` | Rip produces a strip narrower than `minSafeRipWidth` without a jig. | KB-D02 |
| `V-SAFE-040` | Crosscut workpiece shorter than `minSafeCrosscutLength` — the hex-puck case. | KB-D03 |

`V-SAFE-010` is worth a note on philosophy. Making the dangerous operation *unrepresentable in
the type system* is stronger than validating against it, costs nothing, and cannot be bypassed by
a user who clicks through a warning. The validation rule is the backstop, not the primary defence.

## V-TOOL — Tooling envelope

| Id | Rule | Cites |
| --- | --- | --- |
| `V-TOOL-010` | Cut depth exceeds blade capacity at the requested bevel. Uses the **interpolated** depth between the shop profile's measured 90° and 45° values, not the cosine model. | [KB-D01](01-woodworking-domain.md#kb-d01--table-saw-cut-depth-falls-off-with-bevel) |
| `V-TOOL-020` | Kerf is a large fraction of a strip's width — the rip wastes more than it keeps and is hard to hold accurately. Distinct from `V-SAFE-030`, which covers outright unsafe widths. | KB-D02, KB-A12 |
| `V-TOOL-030` | Bevel exceeds `maxBevel` (45° on a typical saw). | KB-D02 |
| `V-TOOL-040` | Crosscut exceeds sled capacity. | KB-D03 |
| `V-TOOL-050` | **Board width exceeds drum sander width.** | KB-D04 |
| `V-TOOL-060` | Board thickness exceeds drum sander capacity. | KB-D04 |
| `V-TOOL-070` | Available clamping force below target pressure for the largest glue-up. | KB-A10, KB-D05 |
| `V-TOOL-080` | Glue-up width exceeds clamp reach. | KB-D05 |
| `V-TOOL-090` | An edge treatment requires tooling absent from the shop profile. | KB-C02, KB-C04 |

`V-TOOL-050` deserves its emphasis. It is a `warning` rather than an `error` — an open-ended
drum sander can flatten a board wider than its drum in two passes, at the cost of a registration
step that risks a visible ridge. The finding explains that trade-off rather than simply refusing.
Discovering a board will not fit the sander *after* the final glue-up is a uniquely bad moment.

`V-TOOL-090` came out of auditing the pattern library against the stated shop profile, and it is
worth recording *why* it exists. Every pattern in [`07`](07-pattern-library.md) is cuttable with a
table saw, a sled, and a drum sander — but two of the **edge treatments** are not:

| Treatment | Tooling |
| --- | --- |
| Chamfer | Table saw, as a 45° bevel rip — **in profile** |
| Roundover | Router — **not in profile** |
| Juice groove | Router — **not in profile** |
| Feet | Drill — **not in profile** |

So `router` and `drill` are optional fields in the shop profile
([`02`](02-construction-graph.md#the-project-document)), and selecting a treatment that needs
absent tooling produces a `warning` naming the tool required. The alternative — generating a
"rout a 3/8" juice groove" instruction for someone with no router — is exactly the kind of
unfollowable step this validator exists to prevent.

`V-TOOL-070` reports the computed requirement from
[KB-A10](01-woodworking-domain.md#kb-a10--glue-choice-sizing-and-pressure):

```
requiredForce = targetPressure × jointArea
clampsNeeded  = ceil(requiredForce / clampForceEach)
```

Because the 175–250 psi figure is **[contested]** for cutting boards, this is a `warning` that
states both the target and the assumption, and notes that under-clamping typically shows as
visible glue lines rather than joint failure. The tool reports the number; the woodworker decides.

## V-GEOM — Constructibility

| Id | Rule | Cites |
| --- | --- | --- |
| `V-GEOM-010` | Partition invalid: gaps or overlaps between faces (invariant I-3). | — (structural) |
| `V-GEOM-020` | Lamination members have unequal length (invariant I-4). | — (structural) |
| `V-GEOM-030` | **Strip tapers below minimum width somewhere inside the panel.** Checked at *both* faces. | [KB-A06](01-woodworking-domain.md#kb-a06--angled-layer-boundaries-bevel-ripped-strips) |
| `V-GEOM-040` | Cross-section is not decomposable into table-saw cuts. See below. | KB-A01, KB-D02 |
| `V-GEOM-050` | Hex closure violated: the rhombus is not a rhombus. | [KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block) |
| `V-GEOM-060` | Honeycomb tiling leaves an unresolved ragged edge. | KB-A05 |

### `V-GEOM-030` — checking both faces

CBDJS checks the taper in one direction only and raises "this causes a bad cut". The general
condition requires both faces, because a bevel can open at one face while closing at the other:

```
widthAtFaceA = b_i  − a_i   > minSafeRipWidth
widthAtFaceB = b_i' − a_i'  > minSafeRipWidth     where offset = D × tan(θ)
```

This is an `error`, not a warning. A strip that narrows to nothing mid-panel is not a risky cut;
it is a cut the saw cannot make.

### `V-GEOM-040` — the constructibility proof

The most interesting rule in the validator. A cross-section is only buildable if it can be
produced by a sequence of **full-depth straight cuts and laminations** — because that is all a
table saw and clamps can do. A table saw cannot make a partial cut, a curved cut, or an interior
cut.

The check attempts a decomposition and reports the result:

1. **Guillotine test.** Can the partition be split by a single straight edge-to-edge line into
   two sub-partitions, recursively, down to single faces? If yes, it is buildable directly as
   nested rip/laminate operations. This covers all grid patterns and most stripe variants.
2. **Lamination test.** If not guillotine-cuttable, can it be partitioned into groups that *are*
   individually guillotine-cuttable and then assembled? This is the multi-stage case
   ([KB-A04](01-woodworking-domain.md#kb-a04--multi-stage-sub-assemblies)) and covers herringbone,
   basket weave, and pinwheel.
3. **Tiling test.** Is it a known tiling with a prism recipe — honeycomb via rhombus sticks
   (KB-A05)?
4. **Failure.** Report the specific faces that cannot be reached, so the UI highlights them.

A clean "no" with the offending region highlighted is a far better outcome than a cut list that
cannot be followed. This rule is also the engine behind the free-paint decomposer
([`07`](07-pattern-library.md#the-decomposer)).

### `V-GEOM-050` — the free correctness check

From [KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block), a
true 60° rhombus requires `ripWidth = T / cos(30°) = 1.1547 × T`, which implies
`hexAcrossFlats = 2T` exactly.

So the validator checks `|hexAcrossFlats − 2T| < tolerance`. If it fails, the rhombi will not
close into a hexagon, gaps will open in the glue-up, and the cubes will not read as cubes. This
costs one line and catches the single most common way a 3D cube board goes wrong.

## V-GRAIN — Grain orientation

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-GRAIN-010` | **Mixed growth-ring orientation in an end-grain board.** | `error` | [KB-B02](01-woodworking-domain.md#kb-b02--grain-orientation-must-be-consistent-the-counterintuitive-rule) |
| `V-GRAIN-020` | Non-zero crosscut miter: grain no longer perpendicular to the working face. | `warning` | [KB-A07](01-woodworking-domain.md#kb-a07--mitered-crosscuts-produce-oblique-prisms) |
| `V-GRAIN-030` | Lamination members disagree on grain axis (invariant I-6). | `error` | — |

`V-GRAIN-010` is an `error` rather than a warning, which is a deliberate and slightly unusual
call. The justification: general woodworking advice says to *alternate* ring direction in
panels, that advice is correct for panels and actively harmful for end-grain boards, and a user
applying remembered knowledge will build a board that fails. The finding text must state the
contrast explicitly:

> Mixing quartersawn and flatsawn faces in an end-grain board loads every glue line in shear each
> humidity cycle. This is the opposite of edge-grain panel practice, where alternating ring
> direction correctly cancels cupping — see KB-B02.

`V-GRAIN-020` explains the cost rather than just flagging it: reduced self-healing (the
*reason* to choose end grain at all), worse tearout when flattening, and a sheared face pattern.
Remedy: prefer true multi-stage herringbone.

## V-MOVE — Wood movement

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-MOVE-010` | Species movement mismatch across the board. | `warning` | [KB-B03](01-woodworking-domain.md#kb-b03--species-movement-data), [KB-B04](01-woodworking-domain.md#kb-b04--worked-movement-example) |
| `V-MOVE-020` | Predicted absolute seasonal movement is large. Informational — a quarter inch on a 12" maple board is *normal* (KB-B04), and a tool that alarms about normal behaviour trains users to ignore it. | `info` | KB-B04 |
| `V-MOVE-030` | Board width far beyond typical for the species mix. | `warning` | KB-B01, KB-B04 |

`V-MOVE-010` is the one rule in the validator whose threshold is a judgement call rather than a
machine limit or a geometric fact, so its derivation is given in full.

### Choosing the metric

Two obvious metrics both fail, in opposite directions:

| Metric | Fails because |
| --- | --- |
| **Coefficient ratio** `C_max / C_min` | Scale-free, so it flags a 6" maple/padauk board (which is fine) and stays silent on a 30" one (which is not) |
| **Raw coefficient gap × board size** | Ignores proportion, so a maple board with a 2% padauk pinstripe scores the same as a 50/50 maple/padauk board |

The fix for the second is to weight by how much of the board each species actually occupies. The
board as a whole moves at a **composite** coefficient — the share-weighted mean — and each
species is strained by its deviation from that composite. So the quantity that matters is the
share-weighted **mean absolute deviation**:

```
C_bar  = Σ share_i · C_i                          composite coefficient
MAD    = Σ share_i · |C_i − C_bar|
spread = 2 · MAD
```

The factor of 2 is for interpretability, not physics: it makes `spread` exactly equal the plain
coefficient gap for a balanced two-species board, so the number means what a woodworker would
expect it to mean, while still collapsing toward zero for a thin accent stripe.

```
differentialMovement = max(boardWidth, boardLength) · spread · ΔMC
```

Both face dimensions are used because an end-grain board moves in **both**
([KB-B01](01-woodworking-domain.md#kb-b01--why-end-grain-boards-move-the-way-they-do)) — unlike
an edge-grain board, where only the width moves.

### Calibrating the threshold

Anchored on empirical practice rather than invented stress limits: the maple/walnut/cherry
palette is known-good across a century of use at normal board sizes, so it must pass. Computed at
ΔMC = 6:

| Mix | 12" | 16" | 20" | 24" |
| --- | --- | --- | --- | --- |
| maple / walnut 50:50 | 0.057" | 0.076" | 0.095" | 0.114" |
| classic three-wood, equal | 0.059" | 0.079" | 0.098" | 0.118" |
| cherry / walnut 50:50 | 0.019" | 0.025" | 0.031" | 0.037" |
| **maple / padauk 50:50** | 0.125" | **0.166"** | **0.208"** | **0.249"** |
| maple + 2% padauk pinstripe | 0.010" | 0.013" | 0.016" | 0.020" |

A threshold of **0.150"** separates them cleanly: the classic palette stays silent out to 24",
maple/padauk flags from 16" upward, and the pinstripe is correctly ignored. The three-wood mix
also scores *below* the maple/cherry pair alone, which is physically right — walnut sits between
them and pulls the composite toward the middle.

Severity is `warning`, never `error`. Maple/padauk boards get built successfully all the time with
good maintenance; this is a risk the maker is entitled to accept.

### Implementation

```ts
// core/validation/rules/movement.ts

interface MovementContext {
  /** Finished board dimensions. */
  width: Ticks;
  length: Ticks;
  /** Dimensional change coefficients of every species used, keyed by id (KB-B03). */
  coefficients: Record<SpeciesId, number>;
  /** Fraction of the board's face area occupied by each species. */
  widthShare: Record<SpeciesId, number>;
  /** Expected seasonal moisture-content swing, percent (shop profile). */
  moistureSwingPercent: number;
  /** Count of glue lines running across the width. */
  jointCount: number;
}

/** Differential movement above which the mix is flagged, in inches. */
const DIFFERENTIAL_WARN_IN = 0.150;
/** Above this the wording escalates — still a warning, since it is the maker's wood. */
const DIFFERENTIAL_SEVERE_IN = 0.300;
/** Above this ratio the problem is the palette rather than the board's size. */
const RATIO_MISMATCH = 1.5;

function checkMovementCompatibility(ctx: MovementContext): Finding[] {
  const species = Object.keys(ctx.coefficients);

  // A single species has no differential by definition. Guard rather than
  // relying on the arithmetic to produce zero, so a missing share can't fake it.
  if (species.length < 2) return [];

  // Normalise defensively: shares should sum to 1, but a partial palette or a
  // rounding drift upstream must not silently scale the result.
  const shareTotal = species.reduce((s, id) => s + (ctx.widthShare[id] ?? 0), 0);
  if (shareTotal <= 0) return [];
  const share = (id: SpeciesId) => (ctx.widthShare[id] ?? 0) / shareTotal;

  const cBar = species.reduce((s, id) => s + share(id) * ctx.coefficients[id], 0);
  const mad = species.reduce(
    (s, id) => s + share(id) * Math.abs(ctx.coefficients[id] - cBar),
    0,
  );
  const spread = 2 * mad;

  const maxDim = Math.max(ticksToInches(ctx.width), ticksToInches(ctx.length));
  const differential = maxDim * spread * ctx.moistureSwingPercent;

  if (differential <= DIFFERENTIAL_WARN_IN) return [];

  const values = species.map((id) => ctx.coefficients[id]);
  const ratio = Math.max(...values) / Math.min(...values);

  // Which lever actually fixes it. A mismatched palette wants a species swap;
  // a compatible palette on a large board wants a smaller board. Reporting the
  // wrong remedy is worse than reporting none.
  const driver = ratio > RATIO_MISMATCH ? 'palette' : 'size';

  const byCoefficient = [...species].sort(
    (a, b) => ctx.coefficients[a] - ctx.coefficients[b],
  );

  return [{
    ruleId: 'V-MOVE-010',
    severity: 'warning',
    nodes: [],
    data: {
      differential,
      spread,
      ratio,
      maxDim,
      moistureSwing: ctx.moistureSwingPercent,
      tier: differential > DIFFERENTIAL_SEVERE_IN ? 'severe' : 'elevated',
      driver,
      lowest: byCoefficient[0],
      highest: byCoefficient[byCoefficient.length - 1],
    },
    rationale: KB['KB-B04'].text,
  }];
}
```

### Message templates

```
elevated / palette:
  {highest} and {lowest} differ in seasonal movement by {ratio}×. Across
  {maxDim}" at a {moistureSwing}% moisture swing that is about {differential}
  of differential movement, which loads every glue line between them in shear.
  → Substituting a species closer to {highest} would reduce this. The classic
    maple/walnut/cherry palette spans only 1.42×, which is why it has held up
    for a century.

elevated / size:
  These species are reasonably matched ({ratio}×), but at {maxDim}" the board is
  large enough that the remaining difference adds up to about {differential}.
  → Reducing the largest dimension, or keeping the board in a more stable
    humidity environment, would both help.

severe (either driver): as above, plus —
  This is well beyond the range demonstrated by common practice. Expect visible
  seasonal gapping, and keep the board diligently oiled.
```

Both templates report the number *and* the lever, because "these woods are mismatched" and "this
board is too big for these woods" have different fixes and the finding should not leave the user
guessing which applies.

### Tests

Fixture pairs, per [`08`](08-architecture-and-stack.md#3--rule-fixture-suite):

| Fixture | Expectation |
| --- | --- |
| maple/walnut 50:50 at 12" × 16" | clean — the no-false-positives-on-the-classics case |
| classic three-wood at 24" | clean |
| maple + 2% padauk pinstripe at 20" | clean — proportion weighting works |
| maple/padauk 50:50 at 16" | warns, `driver: 'palette'` |
| maple/walnut 50:50 at 40" | warns, `driver: 'size'` |
| single species, any size | clean, no arithmetic performed |
| shares summing to 0.98 | identical result to shares summing to 1.0 |

## V-DIM — Dimensions and features

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-DIM-010` | Finished thickness below 1.5". | `error` | [KB-C01](01-woodworking-domain.md#kb-c01--thickness) |
| `V-DIM-020` | Juice groove deeper than 25% of board thickness. | `error` | [KB-C02](01-woodworking-domain.md#kb-c02--juice-groove) |
| `V-DIM-030` | Juice groove inset under 3/4", or intersecting the corner radius. | `warning` | KB-C02 |
| `V-DIM-040` | Board thickness under 1.75" *with* a juice groove. | `warning` | KB-C01, KB-C02 |
| `V-DIM-050` | Feet fixed in a pattern that fights seasonal movement. | `warning` | [KB-C03](01-woodworking-domain.md#kb-c03--feet), KB-B04 |
| `V-DIM-060` | No edge treatment specified; sharp end-grain arrises chip. | `info` | [KB-C04](01-woodworking-domain.md#kb-c04--edge-treatment) |

## V-FOOD — Food safety

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-FOOD-010` | Species on the toxic/allergen list (cocobolo, yew, oleander, laburnum). | `error` | [KB-B06](01-woodworking-domain.md#kb-b06--food-safety) |
| `V-FOOD-020` | Open-pore species (red oak, white ash) — holds residue, hard to clean. | `warning` | KB-B06 |
| `V-FOOD-030` | **Contested** species such as purpleheart. Presents the disagreement; does not pick a side. | `info` | KB-B06 |
| `V-FOOD-040` | Janka hardness outside ~900–1800 lbf: too soft scars, too hard dulls knives. | `info` | KB-B03 |

`V-FOOD-030` is where the **[contested]** confidence mark earns its place. Purpleheart is widely
sold in finished boards and widely used, and some sources report irritant concerns. Silently
blocking it would be presumptuous; silently permitting it would withhold information. The finding
states that sources disagree, summarises both positions, and leaves the choice with the user.

## V-MAT — Material

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-MAT-010` | Board-feet rollup per species, including yield factor. | `info` | [KB-A12](01-woodworking-domain.md#kb-a12--material-budget) |
| `V-MAT-020` | End-grain material multiplier outside the expected 1.5–2.5× band — a sanity check on the whole plan. | `warning` | KB-A12 |
| `V-MAT-030` | Stage-1 panel too short to yield the requested slice count. | `error` | KB-A02 |
| `V-MAT-040` | Waste fraction unusually high; suggests a better slice/strip division. | `info` | KB-A12 |

`V-MAT-020` is a check on the *tool*, not only the design. If a plan claims an end-grain board
needs roughly the same lumber as an edge-grain one, something upstream is wrong. Cheap global
sanity checks like this catch modelling errors that per-node rules miss.

## V-TOL — Tolerance

| Id | Rule | Severity | Cites |
| --- | --- | --- | --- |
| `V-TOL-010` | Systematic tolerance across the glue-up exceeds a visible threshold. | `warning` | [`02`](02-construction-graph.md#accumulated-tolerance) |
| `V-TOL-020` | A required dimension is not achievable at the user's measurement precision. | `warning` | [`02`](02-construction-graph.md#where-exactness-genuinely-ends) |

`V-TOL-010` distinguishes random from systematic error, because the remedies differ: random
error means trim to final size at the end; systematic error means check the fence *before*
cutting twenty strips. "My board came out 1/8" narrow" is among the most common complaints in the
hobby, and it is nearly always systematic.

## Running the validator

```ts
function validate(project: Project, evaluated: EvalResult): Finding[];
```

- Pure, and fast enough to run on every edit (debounced one frame).
- Findings sorted by severity, then by graph order, so the first error is the earliest problem in
  the build rather than an arbitrary one.
- Deduplicated: twenty identical narrow strips produce one finding with a count, not twenty rows.

### Tests the rule set must pass

1. **Citation integrity.** Every rule has a non-empty `cites`, and every cited KB id exists.
2. **Severity audit.** Every `V-SAFE-*` rule is `error`.
3. **Fixture suite.** One known-bad design per rule that triggers it, and one near-miss that does
   not — the near-miss cases are what catch off-by-one threshold bugs.
4. **No false positives on the classics.** A standard maple/walnut checkerboard, a brick board,
   and a 3D cube built to KB-A05 must all validate clean. A validator that cries wolf on the most
   common board in the hobby is worse than no validator.

## Next

[`05-cut-list-and-instructions.md`](05-cut-list-and-instructions.md) — turning a validated graph
into shop output.
