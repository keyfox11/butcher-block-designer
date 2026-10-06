# 01 — Woodworking Domain Knowledge Base

This is the foundation every other document rests on. It is the researched, cited, and where
possible *derived* body of fact that makes the tool's output trustworthy.

## How this document is used

Everything here is assigned a stable **KB id**. These are not decoration — they are the contract
between this document and the code:

- [`04-validation-rules.md`](04-validation-rules.md): every validation rule cites the KB id that
  justifies it. A rule with no citation is a bug.
- [`05-cut-list-and-instructions.md`](05-cut-list-and-instructions.md): instruction text is
  generated from templates that pull from KB entries, so build steps carry their own rationale.
- The implementation ships this as **data** (`core/knowledge/*.ts`), not as comments. The point
  is that a woodworker can audit it and a reviewer can check it against sources.

Confidence is marked on every entry:

| Mark | Meaning |
| --- | --- |
| **[derived]** | Follows from geometry. Proven here and numerically verified. |
| **[measured]** | Published physical property (USDA Wood Handbook lineage, manufacturer data). |
| **[consensus]** | Strong, consistent agreement across woodworking practice. |
| **[contested]** | Sources disagree. The tool must present the disagreement, not pick a side silently. |

---

## Part A — Construction methods

### KB-A01 — The two-stage glue-up **[consensus]**

The canonical end-grain board. Three stages in practice:

1. **Stage 1 — face/edge-grain panel.** Mill stock flat and square. Rip into strips. Glue the
   strips edge-to-edge into a panel with the grain running along its length. Flatten the panel.
2. **Stage 2 — crosscut and rotate.** Crosscut the panel into slices. Rotate each slice 90° so
   end grain faces up. Rearrange (offset, flip, rotate) and glue edge-to-edge again.
3. **Stage 3 — finish.** Flatten, square, treat edges, oil.

The pattern on the finished face is the *cross-section* of the stage-1 panel. This is the single
most important thing to internalise, and the reason the tool exists.

### KB-A02 — The dimensional relationships **[derived]**

Set up coordinates on the stage-1 panel:

- `X` = panel width = sum of the strip widths
- `Y` = panel thickness `D`
- `Z` = panel length `L` (grain runs along `Z`)

Crosscut perpendicular to `Z` at interval `s`. Each slice is `X × Y × s`. Rotate the slice 90°
about `X` so that `Z` becomes vertical:

- `X` stays horizontal → one finished board dimension
- `Y` (= `D`) becomes horizontal → accumulates as slices are added
- `Z` (= `s`) becomes vertical → **the finished board's thickness**

Therefore:

```
boardThickness   = s                                  // the crosscut slice width
boardDimAlongY   = n * D                              // n slices, each contributing D ("the pitch")
boardDimAlongX   = sum of strip widths                // the stage-1 panel width, passed straight through
faceCell(strip i) = w_i  ×  D                         // what you see on the finished face
panelLengthUsed  = n * s + (n - 1) * kerf             // n slices need n-1 internal cuts
```

Two consequences worth stating explicitly because they surprise people:

- **The finished board's thickness is set by the crosscut, not by the stock thickness.** The
  stock thickness becomes a *face* dimension.
- **For square checker cells you need `w_i = D`.** Mill stock to 1.5" thick and rip 1.5"-wide
  strips, and you get 1.5" squares — whatever you crosscut at.

Slice count, following [CBDJS](https://ericu.github.io/CBDJS/cb.html) (whose formulation we
verified exactly — see [KB-A03](#kb-a03--golden-case-1--cbdjs-defaults)):

```
n = floor(L / (s + kerf))
if (s * (n + 1) + n * kerf <= L) n += 1    // n+1 slices need only n internal kerfs
leftover = L - (n * s + (n - 1) * kerf)
```

The `+1` correction matters: the naive floor assumes a kerf after the final slice, which does not
exist, and so under-counts by one whenever the remainder is between `s` and `s + kerf`.

### KB-A03 — Golden case 1 — CBDJS defaults **[derived]**

A verification anchor, not an illustration. CBDJS's published defaults and their output:

| Input | Value |
| --- | --- |
| source panel length `L` | 20 |
| source panel thickness `D` | 1.2 |
| end-grain board thickness `s` | 1.5 |
| blade kerf | 0.125 |
| panel width | 6 |

Applying KB-A02:

```
n        = floor(20 / 1.625) = 12 ;  check 1.5*13 + 12*0.125 = 21 > 20, no increment  -> 12
boardLen = 12 * 1.2 = 14.4
leftover = 20 - (12*1.5 + 11*0.125) = 20 - 19.375 = 0.625
```

CBDJS reports **slices 12, end-grain length 14.4, leftover 0.625, width 6**. All four match
exactly. Any implementation of KB-A02 must reproduce this; it is golden test #1 in
[`08`](08-architecture-and-stack.md#testing-strategy).

### KB-A04 — Multi-stage sub-assemblies **[consensus]**

Stages 1 and 2 can nest. A stage-2 block can itself be ripped, crosscut, and re-glued as the
input to a further stage. This is how true herringbone, basket weave, and pinwheel patterns are
built, and it is precisely what a flat layer-stack model cannot express.

The operation vocabulary in [`02`](02-construction-graph.md) is recursive for this reason.

### KB-A05 — The hexagonal-prism method (3D tumbling block) **[derived]**

The 3D cube board is **not** built with the two-stage method and is not a grid. Per
[This Old House](https://www.thisoldhouse.com/kitchens/22713645/how-to-make-cube-cutting-board):
stock planed to 1¼–1⅜", table-saw bevel set so the blade is 60° to the table (**30° from
vertical**), three species ripped into rhombus sticks, three sticks glued into a six-sided
prism, taped rather than clamped, crosscut into ~2" pucks, then tiled so like species touch only
at corners.

**Derivation.** Take stock of thickness `T`. Make two parallel bevel rips at angle `β` from
vertical, spaced `W` apart measured along the face. The resulting cross-section is a
parallelogram whose:

- two horizontal sides (the stock's faces) have length `W`
- two slant sides have length `T / cos β`
- interior angle between them is `90° − β`

For the tumbling-block illusion we need a **60° rhombus**, so `β = 30°` gives the 60°/120°
angles, and the rhombus condition (all sides equal) fixes the rip width:

```
ripWidthOnFace  W = T / cos(30°) = 2T/sqrt(3) = 1.154700 * T          [the closure condition]
rhombusSide     s = W
```

Three 60° rhombi meet at a point with their 120° corners: `3 × 120° = 360°`, so they close
exactly, and the outer boundary is a **regular hexagon of side `s`**. Its across-flats dimension
collapses to something memorable:

```
hexAcrossFlats   = s * sqrt(3) = (2T/sqrt(3)) * sqrt(3) = 2T      [exact]
hexAcrossCorners = 2s = 4T/sqrt(3) = 2.309401 * T
```

**Golden case 2.** At `T = 1.25"` → rip width `1.4434"`, hex across-flats exactly `2.500"`.
At `T = 1.375"` → rip width `1.5877"`, across-flats `2.750"`. Both numerically verified, and
both land in This Old House's published stock range.

That `hexAcrossFlats = 2T` identity is a free correctness check: if a tool's hex puck is not
exactly twice the stock thickness across the flats, its rhombus is not a rhombus and the cubes
will not read as cubes.

**Build consequences the tool must handle:**

- Honeycomb tiling leaves a **jagged board edge**. Either trim into the outer ring of hexes
  (losing partial cubes) or cut filler pieces. The tool must plan one or the other, not ignore it.
- Three rhombi glued around a shared line cannot be clamped conventionally — the pieces slide.
  Painter's tape as a tension wrap is the documented technique.

### KB-A06 — Angled layer boundaries (bevel-ripped strips) **[derived]**

CBDJS's "trailing angle" is a bevel rip. Its source computes a layer's far-face boundary as:

```js
newRightY = leftY + (layerInfo.width + sourceThickness * Math.tan(trailingAngle * Math.PI / 180));
```

Physically: a cut plane tilted by `θ` shifts laterally by `D · tan θ` as it crosses a panel of
thickness `D`. So:

```
boundaryOffsetAcrossThickness = D * tan(theta)
```

This is what produces zig-zag, spiral, and snake-skin patterns — the strip boundaries are no
longer perpendicular to the face, so rotating alternate slices makes them chevron against each
other.

**Validity.** Every strip must have positive width across the *entire* thickness, not just at
one face. CBDJS checks only one direction and raises "this causes a bad cut"; the general
condition for strip `i` with near-face span `[a_i, b_i]` and far-face span `[a_i', b_i']` is:

```
b_i  - a_i  > minSafeRipWidth   AND   b_i' - a_i' > minSafeRipWidth
```

A strip that tapers to zero inside the panel is not a warning — it is a cut the saw cannot make.
See rule `V-GEOM-030` in [`04`](04-validation-rules.md).

### KB-A07 — Mitered crosscuts produce oblique prisms **[derived]**

Crosscutting the panel at a miter angle `μ` off perpendicular is tempting for herringbone. It
has a real cost that no reference tool mentions.

The slice becomes an *oblique* prism. When rotated, the exposed face is the miter plane, so:

```
exposedFaceScale = 1 / cos(mu)        // the cross-section appears stretched along the miter axis
grainToFaceAngle = mu                 // grain is no longer perpendicular to the working face
```

Consequences:

1. **Reduced self-healing.** End grain's signature benefit is that severed fibre ends close back
   over a knife cut. At `μ = 30°` the fibres meet the surface obliquely and that effect degrades.
2. **Worse tearout when flattening.** You are now partly cutting along the grain.
3. **The face pattern is sheared**, not merely rotated — so the preview must shear it too, or the
   picture lies.

**Recommendation:** prefer true multi-stage herringbone (KB-A04), which keeps grain perpendicular
by composing rectangles in two orientations. Support miter, but warn (`V-GRAIN-020`).

### KB-A08 — Flattening: the hard safety gate **[consensus]**

> **Never run an end-grain glue-up through a thickness planer.**

The cutterhead strikes unsupported fibre ends and tears them out catastrophically; the board can
also be seized and thrown. This is the single most consequential rule in the knowledge base and
is implemented as a **blocking** rule, not a warning.

Acceptable methods:

| Method | Max per pass | Notes |
| --- | --- | --- |
| **Drum sander** *(our shop baseline)* | ~1/64"–1/32" | Finished surface straight off the machine. Limited by drum width. |
| Router sled | 1/32" | Removes material faster but needs abrasive refinement after. Out of scope for our shop profile. |
| Hand plane | — | Skewed/diagonal passes; very sharp, low-angle. Crispest result, most skill. |

Default **flattening allowance 1/8" per face** (Old Line's default), so `+1/4"` total added to
the crosscut slice width. This is why `s` is cut oversize: see the allowance ledger in
[`05`](05-cut-list-and-instructions.md#the-allowance-ledger).

### KB-A09 — Squareness: crosscuts decide whether the board has gaps **[consensus]**

An out-of-square crosscut is the dominant cause of gapped stage-2 glue-ups. Each slice's error
doubles when adjacent slices are flipped, and errors accumulate across the glue-up.

- Use a **crosscut sled**, not a miter gauge.
- Tune it with the **five-cut method**, which resolves squareness to within a few thousandths.
- **"Clamping pressure will not cure a poor cut."** Forcing a bad joint closed stores stress that
  reappears as a split later.

### KB-A10 — Glue: choice, sizing, and pressure **[measured]** / **[consensus]**

**Titebond III** is the practical standard: waterproof (ANSI/HPVA Type I), FDA-approved for
indirect food contact, ~4,000 psi bond strength, long open assembly time.

**End grain is thirsty.** It wicks glue away from the joint, starving it. The technique is to
**size the joint**: apply a light coat, let it tack, then a second coat before clamping. Published
spread rate for end grain is roughly double that of flatsawn faces.

**Clamping pressure.** Hardwoods want **175–250 psi**. Pressure acts across the joint area, and
in a multi-piece glue-up the force passes through every joint at once:

```
requiredForce = targetPressure * jointArea
jointArea     = (board dimension perpendicular to clamping) * boardThickness
clampsNeeded  = ceil(requiredForce / forcePerClamp)
```

Worked example — a 12"-wide, 1.5"-thick board: `jointArea = 18 in²`, and at 200 psi that is
**3,600 lbf**, needing ~6 parallel clamps at ~600 lbf each.

**[contested]** — present honestly: the 175–250 psi figure comes from adhesive engineering, and
plenty of sound boards are built with less. Under-clamping usually shows as visible glue lines
rather than outright failure. The tool should **report the number and the assumption**, not
refuse the design.

### KB-A11 — Glue-up sequencing for angled assemblies **[consensus]**

Joints that are not perpendicular to the clamping axis convert clamp pressure into *lateral*
force, so pieces slide out of registration. For angled patterns (KB-A06) and the hexagonal method
(KB-A05):

- Glue **row by row**, allowing ~30 minutes between rows, rather than clamping a full slab at once.
- Use cauls to keep faces coplanar; a stepped glue-up wastes flattening allowance.
- Tape-as-tension is the technique for hex prisms, which cannot be clamped squarely at all.

### KB-A12 — Material budget **[consensus]**

End-grain construction consumes **1.5–2.5×** the lumber of an equivalent edge-grain board,
because the panel length is spent on slice width plus a kerf per slice, and because the panel
must be long enough to yield every slice.

```
boardFeet = (thickness_in * width_in * length_in) / 144
```

Rough-stock yield after defects, milling, and squaring: **65% default** (range 50–70%). So
`roughStockNeeded = usableNeeded / yieldFactor`.

Waste factors by stock grade: clear S4S with straight cuts 12–15%; typical mixed-cut project
18–20%; rough-sawn 25–30%.

---

## Part B — Wood movement and structure

### KB-B01 — Why end-grain boards move the way they do **[derived]**

Wood moves very differently along its three axes:

| Direction | Typical green-to-oven-dry movement |
| --- | --- |
| Tangential (along growth rings) | up to ~8–10% |
| Radial (across rings) | roughly half of tangential |
| **Longitudinal (along grain)** | **0.1–0.2% — negligible** |

In an **edge-grain** board the grain runs lengthwise, so the length is stable and essentially all
movement appears across the width. One axis to manage.

In an **end-grain** board the grain runs through the **thickness**. So:

- **Thickness is remarkably stable** (longitudinal, negligible).
- **Both the length and the width move**, because the tangential and radial axes now both lie in
  the face plane.

This is the structural explanation for everything else in Part B. An end-grain board wants to
grow and shrink in two directions at once, and it has glue lines running in two directions too.
It is why these boards must be thick, why they crack more readily than edge-grain boards, and why
species and grain orientation have to be controlled rather than mixed casually.

### KB-B02 — Grain orientation must be *consistent* (the counterintuitive rule) **[consensus]**

> In edge-grain panels you **alternate** growth-ring direction so cupping cancels out.
> In end-grain boards you must do the **opposite** — keep ring orientation **consistent**, and
> never glue a quartersawn face to a flatsawn face.

The reasoning follows directly from KB-B01. Because rotating a blank to end grain puts the
tangential and radial axes in the face plane, two adjacent cells with different ring orientation
try to expand along *different axes* by *different amounts*. The glue line between them is loaded
in shear every humidity cycle, and shear is what opens it.

This is worth calling out loudly in the UI. General woodworking advice about alternating grain is
correct *for panels* and actively harmful here, so a user applying remembered advice will build a
board that fails.

Practical guidance: select strips with rings running as close to 90° or parallel to one edge as
possible; quartersawn moves roughly half as much as flatsawn and is the better choice throughout.

### KB-B03 — Species movement data **[measured]**

The dimensional change coefficient `C` gives fractional movement per 1% change in moisture
content over the usable 6–14% MC range:

```
deltaDimension = dimension * C * deltaMoistureContentPercent
```

| Species | Janka (lbf) | Radial % | Tangential % | T/R | `C` (tangential) | Food-safety class |
| --- | --- | --- | --- | --- | --- | --- |
| Hard (sugar) maple | 1450 | 4.8 | 9.9 | 2.06 | 0.00353 | safe — closed pore, the standard |
| Black walnut | 1010 | 5.5 | 7.8 | 1.42 | 0.00274 | safe |
| Black cherry | 950 | 3.7 | 7.1 | 1.92 | 0.00248 | safe (soft end of range) |
| African padauk | 1970 | 2.9 | 5.2 | 1.79 | 0.00180 | safe in use; irritant dust |
| Purpleheart | 1860–2520 | 3.8 | 6.4 | 1.68 | 0.00212 | **contested** — see KB-B06 |
| Sapele | ~1410 | — | — | — | — | safe |
| Beech | ~1300 | — | — | — | — | safe — traditional butcher block |
| Teak | ~1070 | — | — | — | — | safe; silica dulls blades fast |

Sanity check on the coefficients: `C ≈ tangentialShrinkage / 28` (28% being the nominal fibre
saturation point). Maple: `9.9 / 28 = 0.00354` against a published `0.00353`. The relationship
holds, which is a useful guard when adding species.

**[contested]** Sources differ on sugar maple — 4.8/9.9 and 4.9/9.5 both appear. The spread is
small but real; the data table carries a `provenance` field per row and the UI shows it on hover.
Do not silently average conflicting sources.

### KB-B04 — Worked movement example **[derived]**

A 12"-wide board in a kitchen cycling from 6% MC (heated winter) to 12% MC (humid summer),
`ΔMC = 6`:

| Species | Movement across 12" |
| --- | --- |
| Hard maple | `12 × 0.00353 × 6 = 0.254"` (≈ 1/4") |
| Black walnut | `12 × 0.00274 × 6 = 0.197"` |
| Padauk | `12 × 0.00180 × 6 = 0.130"` |

Two readings of this table, both important:

1. **A quarter inch of seasonal movement on a 12" board is normal.** This is why boards are not
   screwed down, why feet are fitted rather than glued across the grain, and why "it got tighter
   in summer" is expected behaviour.
2. **Maple against padauk is a near-2:1 movement mismatch** (`0.00353 / 0.00180 = 1.96`). The
   classic maple/walnut/cherry palette spans only 1.42:1, which is why it has been the standard
   combination for a century. Mixing the extremes puts a permanent differential strain across
   every glue line.

The threshold at which this becomes a warning is a design decision — see
[`04-validation-rules.md`](04-validation-rules.md), rule `V-MOVE-010`.

### KB-B05 — Failure modes **[consensus]**

Why end-grain boards fail, with the cause the tool can actually act on:

| Failure | Mechanism | What the tool does |
| --- | --- | --- |
| Glue-line split | Moisture cycling loads joints in shear; no adhesive survives unlimited cycles | Movement check (`V-MOVE-*`), oiling instructions |
| Cracking from thinness | Thin boards lack the section to resist splitting forces | Min-thickness rule (`V-DIM-010`) |
| Cupping / warping | Trapped moisture under the board, or mixed grain orientation | Feet in the build steps; `V-GRAIN-010` |
| Movement after build | Stock was not dry or not acclimated | Instruction gate on MC and acclimation |
| Gapped joints | Out-of-square crosscuts | `V-TOOL-*`, five-cut step (KB-A09) |
| Starved joints | End grain wicked the glue away | Mandatory sizing step (KB-A10) |
| Adhesive failure | Wrong glue for a wet, food-contact service life | Glue recommendation in build steps |

Water enters end grain far faster than long grain — the fibre ends are open straws. That is both
why these boards need diligent oiling and why the underside needs airflow.

### KB-B06 — Food safety **[consensus]** / **[contested]**

Three classes, carried as data so the UI can gate and explain:

**Safe.** Hard maple, cherry, black walnut, beech, sapele, teak. Closed-pore hardwoods with long
kitchen service records.

**Avoid for hygiene — open pore.** Red oak, white ash. The pores are large enough to hold food
residue and stain, and are difficult to clean properly. Not toxic; just a poor cutting surface.

**Avoid for toxicity or allergens.** Cocobolo (high allergen content), yew, oleander, laburnum,
and anything in the poison-ivy family.

**[contested] Purpleheart** and some other exotics: widely used and widely sold in boards, but
some sources report irritant or leaching concerns. The tool shows the disagreement and lets the
user decide rather than pretending consensus exists.

**Finish.** Food-grade **mineral oil**: 20-minute soak, wiped back, repeated 3× over 48 hours.
Then a 4:1 mineral-oil/beeswax paste for a harder surface film. Reapply when water stops beading.

**Avoid nut-derived oils** (walnut oil in particular) as a finish — a board is handled by guests
and allergen exposure is not the maker's risk to take.

---

## Part C — Dimensions and features

### KB-C01 — Thickness **[consensus]**

| Requirement | Minimum |
| --- | --- |
| Finished end-grain board | **1.5"** |
| With a juice groove | **1.75"–2"** |

Below 1.5" an end-grain board does not have the section to resist splitting — the failure mode is
closer to splitting firewood than to flexing a plank. Thickness is set by the crosscut (KB-A02),
so it is cheap to add at design time and impossible to add later.

### KB-C02 — Juice groove **[consensus]**

| Parameter | Value |
| --- | --- |
| Depth (end grain) | **3/8"** |
| Width | 3/4" |
| Inset from edge | 3/4"–1" |
| Depth as fraction of thickness | **≤ 25%** |

The inset keeps the groove clear of the corner radius and leaves enough rim that the edge does
not feel fragile. The 25% rule is the tool's own constraint and is self-consistent with the
others: `3/8" / 1.5" = 25%` exactly, which is why a grooved board wants to be thicker.

A groove cut into end grain exposes a large area of open fibre and needs oiling attention.

### KB-C03 — Feet **[consensus]**

Rubber or silicone feet at four corners, fixed with stainless screws. Not cosmetic: they create
an airflow gap so the underside does not sit in trapped moisture, which is a direct cause of
cupping and splitting (KB-B05).

Screws must not be in a pattern that fights seasonal movement (KB-B04) — corners only, not a rail
across the width.

### KB-C04 — Edge treatment **[consensus]**

A chamfer or roundover on all edges, and especially on the underside lift edges. Sharp end-grain
arrises are fragile and chip. A 45° bevel on the bottom edges also makes a heavy board liftable.

### KB-C05 — Moisture content and acclimation **[consensus]**

Use kiln-dried or properly air-dried stock. Let it acclimate in the shop before milling, and keep
**glue and wood at the same temperature** through the glue-up — thermal differences change open
time and cure behaviour unpredictably.

Stock that is still losing moisture will move after the board is finished, loading every joint.
This cannot be corrected later and is worth a blocking checklist item in the instructions.

---

## Part D — The tooling envelope

Our shop profile is **table saw + crosscut sled + drum sander**. These are the limits the
validator enforces.

### KB-D01 — Table saw cut depth falls off with bevel **[measured]**

A tilted blade loses vertical reach. The cosine model is the first approximation:

```
maxDepth(beta) ~= bladeMaxHeight * cos(beta)
```

But manufacturers publish two measured points and the real curve is slightly worse than cosine.
A typical 10" saw: 3-1/8" at 90°, 2-1/4" at 45°. The measured ratio is `2.25/3.125 = 0.72`
against `cos 45° = 0.707`.

**Design decision:** the shop profile stores both published depths and interpolates between them,
rather than assuming the cosine model. It is more honest, and it is the difference between
"your saw can just make this cut" and a stalled blade mid-rip.

### KB-D02 — Table saw limits **[consensus]**

| Limit | Default |
| --- | --- |
| Bevel range | 0°–45° |
| Min safe rip width (freehand) | 3/8"–1/2"; narrower only with a jig or sled |
| Kerf | 1/8" full kerf, 3/32" thin kerf |

A design that calls for a 1/4"-wide, 20"-long rip is not a warning — it is an instruction to do
something unsafe, and the validator treats it as an error.

### KB-D03 — Crosscut sled limits **[consensus]**

Capacity is bounded by the sled's fence-to-blade travel and the saw's rear clearance. Minimum
safe workpiece length matters for the hex-puck method (KB-A05), where pucks are short and
narrow — a stop block and a hold-down are required, and below a threshold the cut should be
refused.

### KB-D04 — Drum sander limits **[consensus]**

| Limit | Note |
| --- | --- |
| Max width | The binding constraint. A closed-end 16" sander cannot flatten an 18" board; an open-end sander doubles capacity in two passes with a registration risk |
| Max thickness | Machine-specific |
| Removal per pass | ~1/64"–1/32". Heavier passes burn end grain and load the belt |

Board width versus drum width is a hard gate. It is better to tell someone at design time that
their board will not fit the sander than after the glue-up.

### KB-D05 — Clamp capacity **[consensus]**

The glue-up is bounded by clamp *reach* and by total available force (KB-A10). Both belong in the
shop profile, since "you need 6 clamps of 600 lbf" is only useful if the tool knows you own four.

---

## Open items

- **Species table coverage.** Seeded with the eight species above, with provenance. Expanding it
  is data entry, not code, and should accept the `C ≈ tangential/28` sanity check on new rows.
- **Movement threshold.** The exact rule for flagging an incompatible species mix is a judgement
  call and is specified in [`04-validation-rules.md`](04-validation-rules.md) rather than here.
- **Puck minimum size.** The safe lower bound for crosscutting hex pucks on a sled needs a real
  number; currently it is a shop-profile parameter with a conservative default.

## Next

[`02-construction-graph.md`](02-construction-graph.md) — turning all of this into a data model.
