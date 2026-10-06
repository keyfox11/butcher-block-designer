# Handoff

Context for picking this up cold. Everything here is either **not recoverable** from the code, or
expensive enough to rediscover that it is worth writing down.

Three documents, three jobs. The [`README`](../README.md) says **what exists and how to run it**,
including a table of what is specified but not yet built. The spec in [`docs/spec/`](spec/) is
**the design**. Commit messages carry the reasoning for individual changes. This file carries what
sits *between* them: why the code deviates from the spec where it does, which invariant catches
which class of bug, and the traps that cost time.

**Status:** P0, P1 and P2 complete. 491 tests, CI green.
**The next phase is an open decision** — see [§6](#6-the-open-decision).

---

## 1. Where things stand

| Phase | State | Exit criterion |
| --- | --- | --- |
| **P0** — correctness core | ✅ done | Checkerboard cut list reproduces CBDJS golden case G1 exactly; ledger traces every dimension to rough stock; conservation holds over random graphs |
| **P1** — angles, 3-D, sharing | ✅ done | All five CBDJS examples reproduce with correct cut lists and 3-D previews; share links well inside the 2,000-char budget (223–263 as measured at P1; ~370 now that the generator payload carries three more parameters) |
| **P2** — multi-stage | ✅ done | 3D cube from a single `stockThickness` with `hexAcrossFlats == 2T` verified on the built geometry; honeycomb assembly map labels all 35 pucks; two explicit edge resolutions; herringbone, pinwheel and basket weave with grain perpendicular throughout and no mitered crosscut anywhere |
| P3 — free paint + decomposer | ⬜ next | |
| P4 — edge treatments, polish | ⬜ | |

Implemented: 14 patterns, 30 validation rules, cut list + allowance ledger + instructions +
assembly maps, 2-D canvas, 3-D viewport, share links, project files, shop profile UI.

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

Still the broadest net, and it caught the worst bug in P2.

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

## 6. The open decision

**P2 is finished and nothing is half-built. The next direction was deliberately left open**, so
this section exists to be picked up cold rather than re-derived. Four options were put forward;
none was chosen.

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
3. **Resolve deployment.** Pages needs a paid plan on a private repo. Until then nobody can open
   this at a bench, which is where it is meant to be used.

*Why first: the tool's entire premise is output you can trust at the saw. With G4 captured there
are now two independent cross-checks pinning the dimensional model from both directions, so what
remains in this bundle is a dimension that prints inconsistently and a tool nobody can open at a
bench.*

### B — Finish the validator

The ~7 specced rules that do not exist. Small, well-defined, and it closes the honesty gap
completely. See the table in [§7](#7-the-validator-gap).

### C — P4, edge treatments

Juice groove, chamfer, roundover, feet — with `V-DIM-030` and `V-DIM-050`, which need them to
exist before they can do anything. The most user-visible gap: a cutting board designer with no
juice groove option is incomplete, and the geometry is already specified.

### D — P3, free paint and the decomposer

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
| **Pages on a private repo** | GitHub Pages serves from a private repo only on a paid plan. Repo is private, plan unknown. Resolve before writing a deploy workflow — CI builds but does not publish. Options in [`08`](spec/08-architecture-and-stack.md#open-dependency-pages-requires-a-paid-plan-on-a-private-repo). |
| **Minimum safe puck size** | For crosscutting hex pucks on a sled. Still a conservative shop-profile default; the tumbling block now exercises it, so a real number is measurable. |
| **Multi-stage material cost** | A tumbling block runs ~3.6× finished volume and herringbone ~3.1×, against KB-A12's 1.5–2.5× band for an ordinary end-grain board. `V-MAT-020` warns and now names where the wood goes. Whether the band should scale with pattern class is a judgement call left open rather than guessed. |
| **Custom species, tier-3 graph view** | On P2's list, not built. The species table has 9 rows, 4 of them with `null` coefficients where no source was found — `V-MOVE-010` reports that it cannot fully assess those mixes rather than substituting a plausible number. |
| **Sugar maple provenance** | Sources give both 4.8/9.9 and 4.9/9.5. Recorded, not averaged. |
| **Bundle size** | `BoardScene` chunk is ~1 MB (275 kB gzipped). Lazy-loaded, so it is off the first paint. |

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
