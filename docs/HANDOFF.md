# Handoff

Context for picking this up cold. Everything here is either **not recoverable** from the code, or
expensive enough to rediscover that it is worth writing down.

Three documents, three jobs. The [`README`](../README.md) says **what exists and how to run it**,
including a table of what is specified but not yet built. The spec in [`docs/spec/`](spec/) is
**the design**. Commit messages carry the reasoning for individual changes. This file carries what
sits *between* them: why the code deviates from the spec where it does, which invariant catches
which class of bug, and the traps that cost time.

**Status:** P0 through P3 complete. 531 tests, CI green. Public under [MIT](../LICENSE) and live
at <https://keyfox11.github.io/butcher-block-designer/>.

No `TODO(human)` markers remain. The last one — `chooseSplit` in `core/decompose/snap.ts` — was
settled on **fewest pieces crossed**; the reasoning and its known limit are in
[§10](#10-the-snap-heuristic).

---

## 1. Where things stand

| Phase | State | Exit criterion |
| --- | --- | --- |
| **P0** — correctness core | ✅ done | Checkerboard cut list reproduces CBDJS golden case G1 exactly; ledger traces every dimension to rough stock; conservation holds over random graphs |
| **P1** — angles, 3-D, sharing | ✅ done | All five CBDJS examples reproduce with correct cut lists and 3-D previews; share links well inside the 2,000-char budget (223–263 as measured at P1; ~370 now that the generator payload carries three more parameters) |
| **P2** — multi-stage | ✅ done | 3D cube from a single `stockThickness` with `hexAcrossFlats == 2T` verified on the built geometry; honeycomb assembly map labels all 35 pucks; two explicit edge resolutions; herringbone, pinwheel and basket weave with grain perpendicular throughout and no mitered crosscut anywhere |
| **P3** — free paint + decomposer | ✅ done | Paint an irregular non-grid pattern and get a graph with its glue-up count; paint a pinwheel, a curve or an enclosed region and get a refusal naming the offending regions, with the last good design still on screen. Verified on the deployed build, not only in tests |
| P4 — edge treatments, polish | ⬜ | |
| P5 — interaction repair | 🟨 partly | Item 1 (an illegal state must not destroy the design) is done *for tier 2*. Tier 1 still blanks the viewport when a generator throws |

Implemented: 14 patterns, a free-paint surface with image import, 30 validation rules, cut list +
allowance ledger + instructions + assembly maps, 2-D canvas, 3-D viewport, share links, project
files, shop profile UI.

> **P2's exit criterion was met, but three items on P2's own list were not done**, and the summary
> at the time said "P2 complete" without that. `V-MOVE-*` has since been implemented; custom species
> and the tier-3 graph view have not. The distinction matters: the exit criterion is what defines
> the phase, but the list is what someone reads to know what exists.

---

## 2. Deviations from the spec, and why

The spec documents have been corrected for these, but they are listed together here because each
one looks like an oversight if you meet it cold.

| Spec originally said | Actual | Why |
| --- | --- | --- |
| `Ticks` = 1/1000 inch | **1/8000 inch** | 1/1000 cannot represent 1/32" (= 31.25), the tool's own default precision. 8000 = LCM(64, 1000) handles both binary fractions *and* 3-decimal input. A power of two fails too — 1/1024 cannot represent 1.2". |
| Use `clipper2-js` | **No boolean library** | Half-plane clips plus a topological union. ~200 property-tested lines, no dependency. |
| React 18 | **React 19** | `@react-three/fiber@9` requires it. |
| CBOR for URLs | **JSON + deflate** | The generator fast path makes payloads ~200 chars; CBOR bought nothing. |
| `RipOp.keepRemainder` | **removed** | A rip physically *always* produces a remainder. Whether anything uses it is a question about the graph, not a parameter of the operation. |
| `LaminateOp.glue: GlueSpec` | **absent** | Glue choice is project-level, not per-joint; clamp pressure reads joint area from the geometry. |
| `TrimOp` `outline` target | **not implemented** | Every edge resolution needed is an anchored `rect`. A branch that throws beats one that silently approximates. |
| — | **`LaminateOp.placement`** added | `explicit` \| `butted` \| `free`. See below. |
| — | **`LaminateOp.sequence: 'taped'`** added | A real third method, not a weaker clamp. |
| — | **`TrimOp` anchor** added | A trim has a position, not just a size. |
| `rotate180: boolean` (P0/P1) | **`rotate: MilliDeg`** | Restores what the spec always said. P0/P1 narrowed it; the hexagon needs the general form. |
| Decomposer: grid detection *then* guillotine search | **One search** | Maximal splitting makes the general search as cheap as the fast path would have been. A grid is just the case where the first `y` split yields bands of single pieces. One code path instead of two that must agree. |
| `DecomposeResult` admits `exact: false` with a diff | **Never emitted** | The spec's own text forbids silent approximation. An approximation is offered as `Refusal.suggestion`, which the user has to accept. The variant stays in the type as documentation of what was deliberately not done. |
| Decomposer strategy 4, known tilings | **Not built** | Unreachable, not skipped: a honeycomb needs hexagonal faces and the paint lattice is square. |
| — | **`maxStockThickness`** added | How thick a board the shop can get. It gates every piece and produces a real refusal. Deliberately a `DecomposeOptions` field rather than a `ShopProfile` one, to avoid a schema bump for a P3-only setting — a candidate for promotion once the surface has been used. |

---

## 3. The invariants, and which bugs each one catches

This is the most important section. Several bugs were caught by exactly one mechanism and were
invisible to the others.

### Conservation of mass — catches anything that *loses* material

Per-node, not just global: a global check says "the graph is wrong", a per-node check says *which
operation* is wrong.

Caught: a rip silently dropping its remainder (189.84 cu in in, 182.81 accounted — the 7.03
worked back by hand to a 0.25" × 1.5" × 18.75" leftover strip).

**Blind to:** anything that merely *deforms* material.

### Tiling / lamination gap — catches anything that *deforms* material

Caught: stock sized from table-face widths alone, so a bevelled cut's sideways drift ran the
billet out and truncated the last strip to the wrong **shape**. Mass was conserved *perfectly*.

> Conservation is the strongest invariant but not the broadest. Keep both.

### Union topology — catches gaps the area check is too blunt to see

Added at P2. `laminate` finds a gap by comparing areas against a tolerance, so a missing cell has
to beat the accumulated snapping error of the whole panel. A union knows its own topology: a
missing cell is an **enclosed ring** — found exactly, at any size, with a position.

Caught: swapped tile rotations in herringbone and pinwheel, which produced overlaps and voids that
no area tolerance would have separated from noise.

### The 2T identity — catches what the topology check is blind to

`V-GEOM-050`. These two look redundant and are not, and it is worth knowing which asks what:

- The **union** asks whether the rhombi agree with *each other*. Fires first, on any error larger
  than the weld radius.
- **`V-GEOM-050`** asks whether the hexagon agrees with the *stock*. That is the band underneath.

Caught: the generator rounding `T × tan(30°)` instead of `T / cos(30°)`, to land the lattice on
exact integers. The hexagon assembled perfectly and came out two ticks wide — because across-flats
is `ripWidth × √3`, so rounding *that* quantity violates the identity rather than preserving it.

### An independent tool, run in the opposite direction — catches a shared blind spot

Golden case G4. The point is not that it agrees; it is that it is *independent and inverted*. G1
drives the model forwards (slab → board) against CBDJS. G4 drives it backwards (finished board →
slab) against Old Line. A sign error or an off-by-one in the kerf accounting can survive one
direction by being consistent with itself; surviving both means the relation holds, not just the
procedure.

Caught: nothing, which is the honest answer — the formulas already agreed to the tick at both
`n = 24` and `n = 17`. What it *did* surface was a divergence no test was asking about: the two
tools place the squaring allowance on opposite sides of the finished dimension. That is recorded
as a convention in [§8](#8-open-items) rather than fixed, because both are defensible and only
one of them is ours to choose.

**The transferable part:** an external cross-check is worth most when it enters the model from a
direction your own tests cannot. Two sources that both compute forwards would have agreed for the
same reasons.

### Reading the output — still the broadest net, and now the only one that caught a UI bug

Nothing in the test suite touches layout, so the two defects found on 2026-10-07 were found by
looking: the 2-D board changed scale as the cursor moved across it, and the 3-D scale reference
was a white rectangle described as "shown at true scale" without ever saying what scale.

The first is worth keeping because the cause is not where the symptom is. The board resized
because `.canvas-wrap` was shrink-to-fit, so its width came from its widest child — the **caption**
— and the SVG's `max-width: 100%` followed. Hovering swapped the caption for a species-and-piece
label of a different length, moving the board by up to 24%. Measured: 192px at the shortest label,
239px at the longest. Nothing in `BoardCanvas.tsx` is wrong; the bug is a feedback loop between two
CSS rules, and no amount of staring at the component would have found it.

**The transferable part:** any status text whose content varies needs a box whose size does not.

A third defect fell out of fixing the second. Sizing the camera from the board alone
(`span = max(widthIn, lengthIn)`) also set the `OrbitControls` clamp, so a board smaller than the
12¾" knife capped `maxDistance` below the distance needed to frame it — 11.5 units against ~21 at
a 2⅞" board — and the 3-D viewport rendered **black**. Found only because shrinking the board was
how I got a good look at the knife. A scale reference that blanks the view for small boards is
worse than no scale reference, and small boards are exactly where one earns its keep.

### Sampling the achieved board against the painting — catches a right board that is the wrong picture

Added at P3, and it is the only check that can see this class of fault. The paint tier is the first
place where the tool is *asked* for something rather than generating it, so "did it build?" and
"did it build what was asked for?" come apart.

A graph that evaluates proves the geometry is self-consistent. Conservation proves no wood went
missing. **Both hold for a board with two species transposed**, or a band placed a row off. The
property test therefore samples the finished cross-section at nine points per painted piece and
requires the species to match — mapping through the trim, since the finished board is inset by
`trimPerEdge` on each edge.

Over 250 random targets, every run must land in one of exactly two states: a refusal that names a
region, or an exact match. There is deliberately no third state.

### Reading the search's own cost model — catches a proxy that is blind to a real cost

The most instructive failure of the phase, and it came from a test asserting something that looked
cosmetic: that a plain grid decomposes as the ordinary two-stage board.

It did not. The search preferred an `x`-rooted tree — six columns, each a stack of eight cells —
because by its own cost model that is *cheaper*: 7 splits against 9. It is also six stage-1 panels
against two, which is roughly three times the lumber and five extra setups.

The proxy was not wrong, it was **blind**. Identical bands share one panel, and which bands are
identical is only knowable after the emitter has matched them up — downstream of the search that
has to choose. The fix was not a smarter proxy. It was recognising that the axis preference
*stands in* for the cost the proxy cannot see, and therefore has to outrank it.

**The transferable part:** when a search's cost model and the thing it is estimating are computed
in different passes, a tie-break that looks like taste may be carrying the whole estimate.

### An exact area identity, where a bounding box was a heuristic

The island check first used bounding-box containment, and called a circle drawn over a grid an
"interior island" because a dozen cells sit inside the circle's box.

The exact replacement came from the integer geometry the project already rests on: a polygon that
doubles back around a void has less shoelace area than its bounding box **by precisely that void**.
So `bboxArea(outer) − area(outer) === Σ area(enclosed)` is a test, not an estimate, and it
distinguishes "inside the box" from "inside the shape" with no tolerance at all.

### Citation integrity — catches knowledge drifting out of the knowledge base

Every validation rule must cite a KB entry that exists. Caught `V-GEOM-030` citing `KB-A06`,
which existed in the spec document but had never been added to `core/knowledge/kb.ts`.

### Property tests — catch what fixtures never would

Caught the tolerance bug at **3 layers, −24.338°**. No hand-picked fixture would have found it.

### Walking the registry with the app's own defaults

Added at P2, and it earned itself immediately: basket weave failed on the default stripe count,
because its tile is square and therefore half as long as a 2:1 tile. A user clicking it would have
met an error. **A pattern that only works at hand-picked settings is a pattern that greets its
first user with a crash.**

### Setting liveness — catches a control that does nothing

Added after the README audit, because of the gap it found. `moistureSwingPercent` sat in the shop
profile, editable in the UI, **read by nothing** for three phases: the `V-MOVE-*` rules that
consume it were specified and never implemented.

That is worse than a missing feature. The user sets the moisture swing to 10%, sees no warning, and
reasonably concludes the board was checked for seasonal movement. It was not.

Nothing caught it, and the reason is worth keeping: the citation-integrity test checks that rules
cite knowledge-base entries that exist. **There was no check in the other direction** — that every
input the user can set is consumed by something. `shop-profile.test.ts` now pushes each setting to
a hostile value and requires the generated plan to change. Three settings are still inert and are
named in the test, so implementing one breaks it until the list is updated.

### Reading the generated output

Still the broadest net. It caught the worst bug in P2, and the only bug in P3 that mattered.

**P3's catch: the print sheet keyed rows on species.** Every generated pattern uses one billet per
species, so species *happened* to be unique and the shopping list, the cover legend and the
allowance ledger all keyed on it. A painted design uses one billet per species **per stock
thickness per panel** — four walnut billets is ordinary — and React is entitled to resolve
duplicate keys by dropping children. A dropped row is a board missing from somebody's lumber order.

Two different fixes, because they were two different mistakes sharing one symptom. The shopping
*table* is right to list each board separately — you buy boards, not species — so it only needed a
key carrying the position. The cover *legend* is a colour key and was genuinely wrong: it showed
six walnut swatches where it should show one with the species total.

Found by reading the console on the deployed path, not by any test, and now pinned by one in
`decompose.test.ts` that asserts a painted design yields several purchase lines for one species.

> **Two traps fired while confirming the fix, both already in [§5](#5-traps-that-cost-time).** The
> console buffer did not clear across a reload *or* a navigate — the stack trace still carried the
> pre-edit HMR module id (`?t=...`), so the fixed page was being judged by errors from the broken
> one. A fresh tab settled it in seconds. **Check the module timestamp in a stack trace before
> believing an error is current**, and when in doubt open a new tab rather than arguing with a
> buffer.

- Instructions quoted a **1/32"** per-pass limit when the profile said **1/64"** (`formatTicks`
  rounds; a limit must *floor*).
- Assembly maps numbered 80 cells when the builder picks up 10 slices.
- The allowance ledger printed a **3" × 0" board** beside a picture of a 12" × 15" one. It encoded
  the two-stage model directly — finished width *is* the stage-1 panel's width, finished length
  *is* slice count × pitch — which is exactly right for a checkerboard and meaningless for a
  honeycomb, where the stage-1 assembly is a hex prism and consecutive pucks share a row so the
  pitch reads zero. **Every ledger test was written against grid patterns, so nothing caught it.**

---

## 4. Non-obvious invariants in the geometry

Things that look arbitrary and are not. Changing any of these silently breaks angled patterns.

**Cut lines are anchored at the workpiece's own top and bottom** (`sawCutEdges`). Every workpiece
has flat top and bottom faces, so those are where a cut crosses the boundary. Rounding *there*
makes bevelled cuts of flat-faced stock exact. Anchoring further out interpolates and re-rounds
every crossing, and the residue accumulates across every face of every slice.

**Fence settings are measured at the table face, not the bounding box** (`leftEdgeAtTableFace`).
They coincide only when the left edge leans one way — which is why uniform-angle patterns worked
and varying-angle ones did not.

**Butting is pairwise** (`laminateButted`). Butt each member against the *previous member*, never
against the running union: that union's outline is a bounding box sitting outside the true slanted
edge, so the error compounds along the panel.

**`buttedOutline` is a quadrilateral, not a bounding box.** Four parallelograms assemble into a
parallelogram; its bounding box includes triangular wedges the gap check reads as missing material.

**`SNAP_TICKS_PER_UNIT_BOUNDARY = 2`** is √2 rounded up: a snapped vertex moves up to √2/2 ticks,
and two faces sharing a boundary can move oppositely. The tolerance counts **every** boundary in
an assembly including internal face edges — bounding by outlines alone is ~3.5% too tight at 24°.

**`WELD_TICKS = 4`** is the union's tolerance, and it is a different number for a different reason:
each rounding step (member geometry, rotation, placement offset) moves a vertex up to half a tick,
two members meeting at a corner each carry that, so three is the worst case and four is the next
integer. It is 1/2000", a thousandth of the narrowest feature the tool will build.

**Bevelled strips have two different widths.** `width ± thickness × tan(angle)`. Both faces must
be checked (`V-GEOM-030`); CBDJS checks one direction only. Setup cuts must include the drift or
they compute to a negative width (−0.366" at 30°).

**`reorient` is a no-op on geometry.** It relabels which axis is "up". If it ever transforms
coordinates, the model is wrong.

**In a cut tree, the same axis means different operations at different depths — and it is forced,
not chosen.** A `y` split whose region spans the **full board length** separates slices, so each
part's y extent becomes a panel's stock thickness. A `y` split any deeper is inside one slice, so
its parts are layers glued face to face before the panel is ripped. There is no freedom here: an
`x` split preserves its parent's y range, so every part of a root-level `x` split still spans the
whole board length, and nothing below a full-length region can be anything but slices. `emit.ts`
tests `fullLength(rect)` rather than tracking depth, for exactly that reason.

**A piece's constraint is `min(width, height) ≤ maxStockThickness`, not `height`.** A stick can be
rolled a quarter turn about its own length before the glue goes on — free, and it leaves the grain
exactly where it was — so a tall narrow piece comes from stock as thick as it is *wide*, ripped to
its height. Without that, merging a column of cells would ask for stock as thick as the board is
long. `LaminateMember.rotate` carries it, and a rolled leaf needs a single-member laminate node of
its own because only a member placement can express a rotation.

**Round `j × pitch`, never `j × round(pitch)`.** A lattice whose pitch is irrational (the honeycomb
row pitch is `T√3`) accumulates half a tick per row otherwise, which exceeds the weld radius by
row eight. The *double* row period is exactly `3 × ripWidth` — an integer — which is what
`growToWhole` snaps to.

**A lay-up must overhang the finished size.** Covering the target exactly leaves the saw nothing
to remove wherever a cell edge lands on the trim line; in the model that shows up as one-tick
notches along the finished edge. This is the same reason you never cut a panel to final size and
hope.

**Trims on non-grid lay-ups must be anchored, not centred.** A ragged border has different depth on
each side, so a centred cut lands in the ragged zone on one edge while leaving a sliver on the
other. Measured on the pinwheel: bounding box 13.5", covered region ending at 12.25".

---

## 5. Traps that cost time

- **Vite base path breaks HMR.** The GitHub Pages prefix is applied **only** to production builds.
  With it in dev, the HMR socket cannot connect and every edit silently serves a **stale module**.
  This produced a `Bounds is not defined` error against code that already had the import.
- **Bash heredocs are fragile here.** A 300-line `cat > file <<'EOF'` of TypeScript failed to parse
  mid-content; `python - <<'PY' || node -e '...'` hung forever on stdin (no python installed, and
  `||` never fires because the left side never *exits*). Use `Write`/`Edit` for source files, and
  `command -v` rather than `||` when the left side reads stdin. Short heredocs are fine.
- **A bare `cat > file` with no heredoc reads stdin and hangs** — the same trap, met again at P3 in
  a throwaway `cat > "$TMPDIR/x" 2>/dev/null` where `$TMPDIR` was unset. It cost ten minutes and,
  worse, was briefly misread as the decomposer being slow on large grids. **If a command that
  should take milliseconds appears to hang, suspect the shell before the code.** Note it also
  stayed alive in the background for 25 minutes afterwards — a hung stdin read does not time out,
  so it is worth checking for strays after one.
- **The backtick trap above is easy to re-read and still walk into.** It fired again while writing
  this very section: a `node --input-type=module -e "..."` whose content held Markdown backticks
  silently dropped every `` `identifier` `` and left `` in [](path) `` in the file. The script
  reported success, because the shell had already eaten the text before node saw it. **Use
  `Write`/`Edit` for any content containing backticks** — the rule is in this document precisely
  because knowing it is not enough.
- **Backticks inside `node -e "..."` break the shell.** A double-quoted bash string treats them as
  command substitution, so any script containing a Markdown backtick or a JS template literal dies
  with `unexpected EOF`. It bit twice while editing docs. Use `Edit` for anything containing
  backticks, or a quoted heredoc feeding node's stdin.
- **Browser screenshots go blank when the window is backgrounded.** The page is fine. Verify with
  `get_page_text` or `javascript_tool` instead — that is how the assembly maps were checked.
- **HMR resets the app's view state.** After an edit the UI is back on the default pattern and the
  Face tab; re-select before reading the DOM, or you will read the checkerboard's output and think
  the new pattern is broken.
- **Console buffers are stale after a server restart.** Old errors keep their old URLs; check the
  URL in the stack trace before believing an error is current.

---

## 6. The open decision — resolved, and what is left of it

**P3 was taken, and is done.** What follows is the option list as it stood, annotated with what
remains. Options A, B and C are untouched and are the obvious candidates for what comes next; the
recommendation now is **E, then A**, for the reason E always had: it is the only item every user
meets on their first session.

> **What P3 cost, against what the spec expected.** The spec called the decomposer "the one piece
> that may not fully succeed". It was the cheapest part of the phase — see the outcome note in
> [`10`](spec/10-roadmap.md#p3--creative-freedom). The expense was in the two places nobody flagged:
> turning a proof of decomposability into a *build plan* a person would follow, and discovering
> that the search's cost model was blind to panel sharing.

The roadmap says P3 next, but that ordering is not binding — P3 is also the one component the spec
says may not fully succeed, and it benefits most from everything else being solid first.

### A — Shop-ready pass *(the recommendation at the time)*

The smallest bundle that makes a first real board possible and trustworthy.

1. ~~**Capture golden case G4.**~~ **Done.** Two fixtures captured from Old Line's live
   calculator, committed as `golden case G4` in `evaluate.test.ts` and recorded as
   [KB-A13](spec/01-woodworking-domain.md#kb-a13--golden-case-4--old-lines-calculator-run-backwards).
   It raised one open question of its own — see the convention note in [§8](#8-open-items).
2. **Fix fence-setting precision.** Measured, not hypothetical: the 3D cube at the default 1½"
   stock wants a fence of `1.73205"`. At the default 1/32" display precision the cut list prints
   `1 23/32"` (1.71875"), which is 0.0133" low. Build to that and across-flats comes out 2.977"
   while the ledger states 3.000" — the tool contradicting itself on its own headline identity.
   At 1/64" it prints `1 47/64"` (1.734375"), and across-flats lands at 3.004". **Bevel rips
   should default to 1/64".**
3. ~~**Resolve deployment.**~~ **Done.** Repo made public under [MIT](../LICENSE); `ci.yml` has a
   `deploy` job, gated on `check`, publishing to
   <https://keyfox11.github.io/butcher-block-designer/>. Reasoning in
   [`08`](spec/08-architecture-and-stack.md#resolved-public-repo-mit-deployed-from-ci).

**So option A is down to one item: fence-setting precision.**

*Why first: the tool's entire premise is output you can trust at the saw. Two of the three items
are now done — G4 pins the dimensional model from both directions, and the app is reachable at a
bench. What remains is a single dimension that prints inconsistently, which is the last thing
standing between the tool and a first real board.*

### E — P5, interaction repair *(added 2026-10-07, after using the deployed app)*

[P5](spec/10-roadmap.md#p5--interaction-repair) was added to the roadmap because three defects
turned up within minutes of real use, and one of them destroys work.

The headline: **an illegal parameter discards the whole design.** `App.tsx` derives everything
from one `useMemo`; when a generator throws, the catch returns `{ ok: false }` and the viewport is
replaced by "This design cannot be built" over a *Reset to the reference board* button. Drag
**stripes per tile** one step too far on a 2½" basket weave and every other choice is gone. The
refusal is correct — ½" strips are genuinely unsafe to rip — but a correct refusal should not
delete the user's work.

The fix that matters is not the red outline. `Stripes per tile` is hardcoded `max={12}`; the true
ceiling is `floor(tileLong / minSafeRipWidth)` and varies with cell size and shop profile. Give
the control its real bounds and the bad state becomes **unreachable** rather than recoverable.
Keeping the last good design and typing the error so it names its parameter are still needed for
the combinations no single control range can express.

*Why it might go first: it is the only option on this list that every user hits on their first
session, and unlike P3 and P4 it waits on nothing.*

### B — Finish the validator

The ~7 specced rules that do not exist. Small, well-defined, and it closes the honesty gap
completely. See the table in [§7](#7-the-validator-gap).

### C — P4, edge treatments

Juice groove, chamfer, roundover, feet — with `V-DIM-030` and `V-DIM-050`, which need them to
exist before they can do anything. The most user-visible gap: a cutting board designer with no
juice groove option is incomplete, and the geometry is already specified.

### D — P3, free paint and the decomposer ✅ **done**

The roadmap's next phase, and the biggest capability jump.

- Paint and region-draw editing on the 2-D canvas (tier 2)
- `core/decompose`: grid detection → guillotine search → band segmentation → known tilings
- Target-versus-achieved display; unreachable-region reporting; snap-to-buildable with diff
- Image import with quantisation preview; worker-based decomposition with progress and cancel

**What P2 leaves in place for it.** `V-GEOM-040` is currently narrowed to clampability (see
[`04`](spec/04-validation-rules.md#v-geom-040--the-constructibility-proof)). Its full form — the
guillotine/lamination/tiling decomposition — **is** the decomposer, so it should be built once, in
`core/decompose`, with the rule calling it rather than the two growing separate implementations.

The union outline is the piece most likely to be load-bearing: a painted region's buildability is a
question about whether its faces group into assemblies that each tile a rectangle, and the
hole/disconnection reporting already answers "does this group of faces form one connected piece
with no voids".

**The riskiest assumption.** The honest failure mode is a decomposer that *almost* works —
producing a graph for most painted targets and quietly approximating the rest. Approximating is the
one thing it must not do. A clear refusal naming the offending regions is a better product than a
cut list that cannot be followed, and the machinery to say which faces are unreachable exists.

> **How that risk actually landed.** It did not materialise, and the reason is structural rather
> than careful: maximal splitting makes the search *exhaustive*, so a failure is a proof that no
> decomposition exists rather than a search giving up. There was never a case where the tool "could
> not find" an answer and might have been tempted to approximate — it either finds the answer or
> knows there is none. `DecomposeResult.exact` is consequently always `true`, and the inexact
> variant the spec allowed is in the type purely as documentation of a road not taken.
>
> The union outline was predicted to be load-bearing. It was not — the arrangement is rectilinear,
> so exact integer rectangle arithmetic answered everything. What *was* load-bearing, and
> unforeseen, is that the emitter is a harder problem than the search.

---

## 7. The validator gap

30 rules implemented. The spec defines these and they do not exist:

| Rule | What it would check | Blocked on |
| --- | --- | --- |
| `V-TOOL-020` | Kerf is a large fraction of a strip's width | — |
| `V-TOOL-040` | Crosscut exceeds sled capacity | would light up the dead `sledCapacity` |
| `V-TOOL-070` | Clamping force below target pressure | partly covered by an instruction safety note |
| `V-TOOL-080` | Glue-up width exceeds clamp reach | would light up the dead `clampMaxReach` |
| `V-TOL-010/020` | Accumulated tolerance across n cuts | `toleranceBand()` exists in `core/units`, called by nothing |
| `V-DIM-030` | Juice groove inset under 3/4" | needs P4 edge treatments |
| `V-DIM-050` | Feet fixed in a pattern that fights movement | needs P4 edge treatments |

**Not gaps, despite looking like them:** `V-GEOM-010`, `V-GEOM-020` and `V-MAT-030` are marked
*structural* in the spec and are genuinely enforced — the evaluator throws on a partition that does
not tile, on laminate members of unequal length, and on a panel too short for its slice count. A
thrown `GeometryError` is a stronger guarantee than a finding, since it cannot be clicked past.

### A note on `V-MOVE-030`'s threshold

Of the three movement rules, only this one's number was **chosen rather than derived**.
`V-MOVE-010`'s 0.150" comes from a calibration table in [`04`](spec/04-validation-rules.md) that
reproduces exactly; `V-MOVE-020`'s 1/8" is where movement starts to matter for anything that has to
fit. `V-MOVE-030`'s 5/8" is a judgement call: half an inch is a 24" maple board and those get built
routinely, so the line had to sit above it. If it ever needs defending or moving, that is the
reasoning to argue with.

---

## 8. Open items

Things that are known and unresolved, excluding the four options in [§6](#6-the-open-decision) and
the rule gaps in [§7](#7-the-validator-gap).

| Item | Notes |
| --- | --- |
| **Nothing has been built in wood** | The arithmetic is verified against published results and the geometry is checked by construction, but no board from this tool has been made. That is the real test, and it will find things no invariant can. |
| **Grid-first vs finished-first** | Found by capturing G4, and the one question it left open. Old Line *adds* its squaring allowance to the slab, so you get the board you asked for. Our grid patterns *subtract* `2 × trimPerEdge` from the nominal grid, so a 16 × 24 grid of ¾" cells finishes at 11⅞" × 17⅞" rather than 12" × 18". Both reserve the same ⅛"; only which number the user states is different. Grid-first is consistent across every grid generator and dodges Old Line's silent `ceil` overshoot — but it does mean the app cannot be asked for a 12" board directly. A deliberate convention, not a defect; worth revisiting if the finished size turns out to be what people actually type. |
| **5.5 MB in git history** | `test-print.pdf` was committed in `b2c3ec0` and removed later, so every clone still pays for it. Its metadata carries the author name, which the commit metadata shows anyway. Dropping it needs a history rewrite and force-push — safe with one author, but it was judged not worth doing once the repo went public. |
| **Minimum safe puck size** | For crosscutting hex pucks on a sled. Still a conservative shop-profile default; the tumbling block now exercises it, so a real number is measurable. |
| **Multi-stage material cost** | A tumbling block runs ~3.6× finished volume and herringbone ~3.1×, against KB-A12's 1.5–2.5× band for an ordinary end-grain board. `V-MAT-020` warns and now names where the wood goes. Whether the band should scale with pattern class is a judgement call left open rather than guessed. |
| **Custom species, tier-3 graph view** | On P2's list, not built. The species table has 9 rows, 4 of them with `null` coefficients where no source was found — `V-MOVE-010` reports that it cannot fully assess those mixes rather than substituting a plausible number. |
| **Sugar maple provenance** | Sources give both 4.8/9.9 and 4.9/9.5. Recorded, not averaged. |
| **Bundle size** | `BoardScene` chunk is ~1 MB (275 kB gzipped). Lazy-loaded, so it is off the first paint. The decomposer worker is a separate 20 kB chunk, loaded only when the paint tier is opened. |
| **`maxStockThickness` is not in the shop profile** | It lives in `DecomposeOptions` with a 2" default (8/4 dressed), to avoid a schema bump for a P3-only field. It is a genuine shop property and gates a real refusal, so it should probably move — but moving it means `SCHEMA_VERSION` 3 and a codec migration, which is worth doing once rather than twice. |
| **Tier 1 still blanks on a refusal** | Tier 2 keeps the last good design; tier 1 does not. The machinery now exists on the paint side, so P5's first item is half-built and the other half is a known shape rather than a design question. |
| **The paint surface has no undo** | A merge that grows further than intended is only recoverable by splitting the pieces back or resizing the grid. Tier 1 does not need undo because its state is a handful of parameters; tier 2's state is a drawing, and drawings need undo. The first thing a real user will ask for. |
| **Decomposer refusals are not findings** | They go to the paint panel, not the findings panel, because they are about a *target* and findings are about a *graph*. Defensible, and it does mean the two halves of "what is wrong with my design" appear in two places. |

---

## 9. Commands

```bash
npm run check      # spec consistency + typecheck + lint + core/ boundary + tests
npm test           # vitest
npm run dev        # Vite (base '/' in dev — see the HMR trap above)
npm run build      # tsc -b && vite build (base '/butcher-block-designer/')
node tools/check-spec.mjs
```

`npm run check` is what CI runs. The `core/` boundary check (dependency-cruiser) fails the build
if anything under `core/` imports React, the DOM, or `ui/` — that boundary is what keeps the
geometry, validation, and cut-list logic independently testable.


---

## 10. The snap heuristic

`chooseSplit` in [`core/decompose/snap.ts`](../src/core/decompose/snap.ts). It was the last open
decision in P3 and is now settled; this records what was chosen and what it gives up, because the
choice is not recoverable from the code and the alternatives are all defensible.

**What it decides.** When a painted arrangement admits no edge-to-edge cut, splitting one piece
along a grid line unblocks it. Several lines usually would, and they differ in what they cost: how
many pieces they cut, how central they are, how large a piece they interrupt. This is roadmap open
question 2 ("the best search heuristic needs empirical tuning") in its most concrete form.

**Chosen: fewest pieces crossed**, then most central, then smallest total area crossed.

The first term is not really about cost, it is about *honesty*. Every crossed piece becomes two
with a glue line between them, and that glue line is the only visible change the snapper makes —
the species on both sides is unchanged, so the pattern stays pixel-identical. Minimising pieces
crossed is minimising how much the suggestion alters a drawing the user is being asked to accept.
It minimises work too, but that is the lesser reason.

Centrality second because tree depth is cure cycles and a balanced split keeps the tree shallow.
Area last because a user who merged a big region chose its visual weight deliberately, and a glue
line through the middle of it reads as more of an intrusion than one across a single cell.

**What it gives up, stated plainly: it is greedy per iteration, not globally optimal.** A line
crossing one piece may leave the region still blocked where a line crossing two would have cleared
it, so the repair loop can add more glue lines in total than a lookahead search would. Termination
is not at risk — each repair strictly raises the piece count, bounded by the cell count, and a
one-piece-per-cell grid always decomposes — but minimality is not claimed. Tuning this against real
painted targets is still open.

Measured on the canonical case: a pinwheel is repaired with **one** glue line, and the resulting
board is verified to match the original painting at every sample point.

**The other snap path needs no heuristic.** A piece too thick for stock is halved by
`thinOversizePieces` on its longer span, because the middle grid line is the only choice that
cannot need splitting again on the same pass.
