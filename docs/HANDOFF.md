# Handoff

Context for picking this up cold. Everything here is either **not recoverable** from the code, or
expensive enough to rediscover that it is worth writing down.

The spec in [`docs/spec/`](spec/) is the design. The commit messages carry the detailed reasoning
for individual changes. This file carries what sits *between* them: why the code deviates from the
spec where it does, which invariant catches which class of bug, and the traps that cost time.

**Status:** P0, P1 and P2 complete. P3 is next. 443 tests, CI green.

---

## 1. Where things stand

| Phase | State | Exit criterion |
| --- | --- | --- |
| **P0** — correctness core | ✅ done | Checkerboard cut list reproduces CBDJS golden case G1 exactly; ledger traces every dimension to rough stock; conservation holds over random graphs |
| **P1** — angles, 3-D, sharing | ✅ done | All five CBDJS examples reproduce with correct cut lists and 3-D previews; share links 223–263 chars against a 2,000 budget |
| **P2** — multi-stage | ✅ done | 3D cube from a single `stockThickness` with `hexAcrossFlats == 2T` verified on the built geometry; honeycomb assembly map labels all 35 pucks; two explicit edge resolutions; herringbone, pinwheel and basket weave with grain perpendicular throughout and no mitered crosscut anywhere |
| P3 — free paint + decomposer | ⬜ next | |
| P4 — edge treatments, polish | ⬜ | |

Implemented: 14 patterns, 27 validation rules, cut list + allowance ledger + instructions +
assembly maps, 2-D canvas, 3-D viewport, share links, project files, shop profile UI.

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
- **Browser screenshots go blank when the window is backgrounded.** The page is fine. Verify with
  `get_page_text` or `javascript_tool` instead — that is how the assembly maps were checked.
- **HMR resets the app's view state.** After an edit the UI is back on the default pattern and the
  Face tab; re-select before reading the DOM, or you will read the checkerboard's output and think
  the new pattern is broken.
- **Console buffers are stale after a server restart.** Old errors keep their old URLs; check the
  URL in the stack trace before believing an error is current.

---

## 6. P3 — what's next

**Goal:** the free-paint tier — paint a mosaic, have the tool find a build for it.

- Paint and region-draw editing on the 2-D canvas (tier 2)
- `core/decompose`: grid detection → guillotine search → band segmentation → known tilings
- Target-versus-achieved display; unreachable-region reporting; snap-to-buildable with diff
- Image import with quantisation preview
- Worker-based decomposition with progress and cancel

### What P2 leaves in place for it

`V-GEOM-040` is currently narrowed to clampability (see
[`04`](spec/04-validation-rules.md#v-geom-040--the-constructibility-proof)). Its full form — the
guillotine/lamination/tiling decomposition — **is** the decomposer, so it should be built once, in
`core/decompose`, and the rule should call it rather than the two growing separate implementations.

The union outline is the piece most likely to be load-bearing here: a painted region's buildability
is a question about whether its faces can be grouped into assemblies that each tile a rectangle,
and the hole/disconnection reporting already answers the sub-question "does this group of faces
form one connected piece with no voids".

### The riskiest assumption

> P3 is the one component that may not fully succeed, and the spec says so.

The honest failure mode is a decomposer that *almost* works — producing a graph for most painted
targets and quietly approximating the rest. Approximating is the one thing it must not do. A clear
refusal naming the offending regions is a better product than a cut list that cannot be followed,
and the machinery to say exactly which faces are unreachable already exists.

---

## 7. Open items

| Item | Notes |
| --- | --- |
| **Golden case G4** | Old Line's worked example was never captured. G1, G2, G3, G5 are verified. Capture from the live tool and commit as a fixture. |
| **Pages on a private repo** | GitHub Pages serves from a private repo only on a paid plan. Repo is private, plan unknown. Resolve before writing a deploy workflow — CI builds but does not publish. Options in [`08`](spec/08-architecture-and-stack.md#open-dependency-pages-requires-a-paid-plan-on-a-private-repo). |
| **Minimum safe puck size** | For crosscutting hex pucks on a sled. Still a conservative shop-profile default; the tumbling block now exercises it, so a real number is measurable. |
| **Multi-stage material cost** | A tumbling block runs ~3.6× finished volume and herringbone ~3.1×, against KB-A12's 1.5–2.5× band for an ordinary end-grain board. `V-MAT-020` warns and now names where the wood goes. Whether the band should scale with pattern class is a judgement call left open rather than guessed. |
| **Display precision vs fence settings** | At the default 1/32", a rip width of 1.7321" prints as 1 23/32" — 0.014" off. Fine for a grid pattern, marginal for a hexagon where the error compounds across three joints. Consider defaulting bevel-rip fence settings to 1/64". |
| **Sugar maple provenance** | Sources give both 4.8/9.9 and 4.9/9.5. Recorded, not averaged. |
| **Bundle size** | `BoardScene` chunk is ~1 MB (275 kB gzipped). Lazy-loaded, so it is off the first paint. |

---

## 8. Commands

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
