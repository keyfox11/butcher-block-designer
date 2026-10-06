# Handoff

Context for picking this up cold. Everything here is either **not recoverable** from the code, or
expensive enough to rediscover that it is worth writing down.

The spec in [`docs/spec/`](spec/) is the design. The commit messages carry the detailed reasoning
for individual changes. This file carries what sits *between* them: why the code deviates from the
spec where it does, which invariant catches which class of bug, and the traps that cost time.

**Status:** P0 and P1 complete. P2 is next. 238 tests, CI green.

---

## 1. Where things stand

| Phase | State | Exit criterion |
| --- | --- | --- |
| **P0** — correctness core | ✅ done | Checkerboard cut list reproduces CBDJS golden case G1 exactly; ledger traces every dimension to rough stock; conservation holds over random graphs |
| **P1** — angles, 3-D, sharing | ✅ done | All five CBDJS examples reproduce with correct cut lists and 3-D previews; share links 223–263 chars against a 2,000 budget |
| **P2** — multi-stage | ⬜ next | 3D cube from a single `stockThickness` with `hexAcrossFlats == 2T` verified; true herringbone with grain perpendicular throughout |
| P3 — free paint + decomposer | ⬜ | |
| P4 — edge treatments, polish | ⬜ | |

Implemented: 10 patterns, 22 validation rules, cut list + allowance ledger + instructions +
assembly maps, 2-D canvas, 3-D viewport, share links, project files, shop profile UI.

---

## 2. Deviations from the spec, and why

The spec documents have been corrected for these, but they are listed together here because each
one looks like an oversight if you meet it cold.

| Spec originally said | Actual | Why |
| --- | --- | --- |
| `Ticks` = 1/1000 inch | **1/8000 inch** | 1/1000 cannot represent 1/32" (= 31.25), which is the tool's own default precision. 8000 = LCM(64, 1000) handles both binary fractions *and* 3-decimal input. A power of two fails too — 1/1024 cannot represent 1.2". |
| Use `clipper2-js` | **No boolean library** | The vocabulary only needs half-plane clips and non-overlapping placement. ~60 property-tested lines. |
| React 18 | **React 19** | `@react-three/fiber@9` requires it. |
| CBOR for URLs | **JSON + deflate** | The generator fast path makes payloads ~200 chars; CBOR bought nothing. |
| `RipOp.keepRemainder` | **removed** | A rip physically *always* produces a remainder. Whether anything uses it is a question about the graph, not a parameter of the operation. |
| — | **`LaminateOp.placement: 'butted'`** added | Bevelled strips interlock, so bounding-box placement overlaps them by up to 68%. Butting expresses the physical act. |

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

### Citation integrity — catches knowledge drifting out of the knowledge base

Every validation rule must cite a KB entry that exists. Caught `V-GEOM-030` citing `KB-A06`,
which existed in the spec document but had never been added to `core/knowledge/kb.ts`.

### Property tests — catch what fixtures never would

Caught the tolerance bug at **3 layers, −24.338°**. No hand-picked fixture would have found it.

### Reading the generated output

Caught two things no test asserted: instructions quoting a **1/32"** per-pass limit when the
profile said **1/64"** (`formatTicks` rounds; a limit must *floor*), and assembly maps numbering
80 cells when the builder picks up 10 slices.

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
A genuinely missing 1½" cell is still ~40× above the bound, so the check keeps its teeth.

**Bevelled strips have two different widths.** `width ± thickness × tan(angle)`. Both faces must
be checked (`V-GEOM-030`); CBDJS checks one direction only. Setup cuts must include the drift or
they compute to a negative width (−0.366" at 30°).

**`reorient` is a no-op on geometry.** It relabels which axis is "up". If it ever transforms
coordinates, the model is wrong.

---

## 5. Traps that cost time

- **Vite base path breaks HMR.** The GitHub Pages prefix is applied **only** to production builds.
  With it in dev, the HMR socket cannot connect and every edit silently serves a **stale module**.
  This produced a `Bounds is not defined` error against code that already had the import.
- **Bash heredocs are fragile here.** `python - <<'PY' || node -e '...'` hung forever on stdin
  (no python installed; `||` never fires because the left side never *exits*). Apostrophes in
  prose break single-quoted `node -e` scripts. Use `Write`/`Edit` for prose, and `command -v`
  rather than `||` when the left side reads stdin.
- **Browser screenshots go blank when the window is backgrounded.** The page is fine. Verify with
  `get_page_text` or `javascript_tool` instead — that is how the assembly maps were checked.
- **Console buffers are stale after a server restart.** Old errors keep their old URLs; check the
  URL in the stack trace before believing an error is current.

---

## 6. P2 — what's next

**Goal:** the patterns no existing tool can express.

- Multi-stage sub-assemblies (KB-A04)
- Non-grid lamination: honeycomb lattice placement and edge resolution
- Generators: **3D cube / tumbling block**, true herringbone, pinwheel, basket weave
- `V-GEOM-050` hex closure check; `V-GEOM-040` constructibility proof
- Complete `V-MOVE-*`, `V-GRAIN-*`, `V-FOOD-*`, `V-TOL-*` rule sets
- Full species table with provenance; custom species
- Graph view (tier 3)

### The riskiest assumption

> P2 is where the construction-graph bet gets tested.

If the honeycomb and herringbone generators need operations **outside** the vocabulary in
[`02`](spec/02-construction-graph.md#operations), that is a signal to **extend the vocabulary**,
not to special-case the generators. Special-casing would reintroduce exactly the picture/cut-list
divergence this design exists to eliminate.

### Geometry already derived and verified for P2

The 3D cube is **not** a grid and **not** the two-stage method. From
[KB-A05](spec/01-woodworking-domain.md):

```
bevel            = 30° from vertical (60° from the table)
ripWidthOnFace   = T / cos(30°) = 1.154700 × T     ← the closure condition
hexAcrossFlats   = 2 × T                           ← EXACT; free correctness check
hexAcrossCorners = 2.309401 × T

honeycomb lattice (pointy-top):
  dx = 2T,  dy = T√3,  alternate rows offset by T
```

Three 60° rhombi close exactly because each contributes its 120° corner (3 × 120° = 360°).
Verified: T = 1.25" → rip 1.4434", across-flats exactly 2.500".

**Build consequences:** honeycomb tiling leaves a jagged board edge (trim / filler / grow-to-whole
— all three are specced in [`03`](spec/03-geometry-engine.md)), and three rhombi glued around a
shared line cannot be clamped conventionally — painter's tape as a tension wrap is the documented
technique.

**True herringbone** depends on one observation that makes its third stage free: *rotating a
finished end-grain block 90° about its vertical axis keeps the grain vertical*. So tiles can be
rotated into a second orientation without compromising the end grain — which is what herringbone
needs, and why the mitered shortcut (`V-GRAIN-020`) is not required.

---

## 7. Open items

| Item | Notes |
| --- | --- |
| **Golden case G4** | Old Line's worked example was never captured. G1, G2, G3, G5 are verified. Capture from the live tool and commit as a fixture. |
| **Pages on a private repo** | GitHub Pages serves from a private repo only on a paid plan. Repo is private, plan unknown. Resolve before writing a deploy workflow — CI builds but does not publish. Options in [`08`](spec/08-architecture-and-stack.md#open-dependency-pages-requires-a-paid-plan-on-a-private-repo). |
| **Minimum safe puck size** | For crosscutting hex pucks on a sled. Currently a conservative shop-profile default; P2 needs a real number. |
| **Sugar maple provenance** | Sources give both 4.8/9.9 and 4.9/9.5. Recorded, not averaged. |
| **Bundle size** | `BoardScene` chunk is ~1 MB (275 kB gzipped). Lazy-loaded, so it is off the first paint. Acceptable; revisit only if P2 adds more 3-D. |

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
