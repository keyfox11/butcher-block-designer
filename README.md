# Butcher Block Designer

Design an end-grain cutting board — including patterns no other tool can represent — and get a
cut list you can actually trust at the saw.

A browser app. Pick a pattern, set the dimensions and species, and it produces a shopping list in
board feet, a cut list with fence settings, step-by-step build instructions, per-glue-up assembly
maps, and a 3-D preview. It refuses to generate a plan it believes is unbuildable, and it tells
you why.

> **Status: working tool, P2 complete.** 14 patterns, 27 validation rules, 443 tests, CI green.
> P3 — the free-paint canvas and its decomposer — is next.
>
> **Picking this up cold? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first.** It covers which
> invariant catches which class of bug, where the code deviates from the spec and why, and the
> traps that cost time.

---

## Quick start

Requires **Node 20 or newer**.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Everything runs locally; there is no server and no account.

To check out the interesting part first, pick **3D cube** from the pattern list and open the
**Cut list** tab. That board is a honeycomb of hexagonal prisms, which is exactly the shape no
layer-stack tool can describe.

### The commands that matter

```bash
npm run check    # what CI runs: spec consistency, typecheck, lint, core/ boundary, tests
npm test         # vitest
npm run build    # tsc -b && vite build
```

`npm run check` is the gate. It is one command on purpose: a check you have to remember to run is
a check that does not run.

---

## Why another cutting board designer?

Four tools already exist in this space:

- [cuttingboarddesigner.app](https://cuttingboarddesigner.app/)
- [Old Line Woodcraft — End Grain Strips calculator](https://oldlinewoodcraft.com/toolbox/end-grain-strips)
- [CBDJS (Cutting Board Designer JS)](https://ericu.github.io/CBDJS/cb.html)
- [cuttingboarddesigner.com](https://www.cuttingboarddesigner.com/)

They are limited in the same way, and it is a structural limitation rather than a missing feature.
Each treats **the design as the input and the cut list as the output**. CBDJS, for example, models
a board as a 1-D list of horizontal layers; its entire output math is three lines. A whole class of
real end-grain boards therefore cannot be represented at all — the 3D tumbling block being the
clearest case, since it is a *honeycomb of hexagonal prisms* and not a grid in any orientation.

This project inverts the relationship.

> **The construction sequence is the source of truth, and the picture is derived from it.**

A design is stored as a DAG of physical operations — mill this billet, rip it into these strips at
this bevel, glue them, crosscut, stand the slices on end, glue again, flatten, trim. The 2-D face,
the 3-D solid and the cut list are all produced by *simulating that sequence*. The cut list cannot
disagree with the picture, because they are the same computation.

Two things follow that are hard to get any other way:

- **Expressiveness equals reality.** Anything a woodworker can build is a sequence of these
  operations, so anything they can build is representable. The model also *cannot* express a board
  whose pattern varies through its thickness — and no real end-grain board does. A model that is
  wrong in neither direction is the sign it matches the domain.
- **Kerf and waste are not bookkeeping.** A saw cut is modelled as subtracting a slab one kerf
  wide, so conservation of material is a property of the operation rather than something the code
  has to remember. The classic error in this domain — kerf counted once per strip instead of once
  per cut — becomes unrepresentable.

See [`docs/spec/00-overview.md`](docs/spec/00-overview.md) for the full argument and a
feature-by-feature comparison.

---

## What it does today

**14 patterns**, each a generator that emits a construction graph rather than a picture:

| | |
| --- | --- |
| **Beginner** | Checkerboard · Brick / running bond · Classic stripes · Three-wood bands · Diagonal accent · Random (seeded) |
| **Intermediate** | Zig-zag · Chevron · Snake skin · Spiral · Basket weave |
| **Advanced** | **3D cube / tumbling block** · **True herringbone** · **Pinwheel** |

The last three are multi-stage: a *tile* is not a piece of wood but a small glued-up assembly with
its own internal pattern. The 3D cube derives everything from a single number — the stock
thickness — via the closure condition `ripWidth = T / cos 30°`, which makes the hexagon exactly
`2T` across the flats.

**27 validation rules** across seven categories — safety, tooling envelope, geometry, grain
orientation, dimensions, food safety, material budget. Errors block export; the cut list is what
somebody takes to the saw. Every rule cites a knowledge-base entry, and that citation is enforced
by a test.

**Output.** Shopping list in board feet; an allowance ledger tracing every finished dimension back
to rough stock; a cut list reporting fence settings rather than abstract offsets; phased build
instructions with clamp counts and cure times; per-glue-up assembly maps printed at 1:1 with every
piece labelled and its orientation marked; versioned project files; shareable URLs (~370
characters, against a 2,000 budget).

**Assumed shop.** Table saw with a crosscut sled, and a drum sander. No router sled, no CNC. A
deliberate constraint, not an omission: the validator rejects geometry that cannot be cut on a
table saw, which is what keeps the instructions honest.

### Specified but not yet built

The spec in `docs/spec/` describes the finished tool, so parts of it are ahead of the code. The
gaps that matter:

| Gap | Where |
| --- | --- |
| **`V-MOVE-*` — wood-movement validation (3 rules)** | Specified in [`04`](docs/spec/04-validation-rules.md); not implemented. `moistureSwingPercent` is editable in the Shop panel and currently **read by nothing**. |
| `V-TOL-*` — accumulated tolerance (2 rules) | Specified; not implemented. |
| Sled capacity and clamp reach checks | `sledCapacity` and `clampMaxReach` are in the shop profile; no rule reads them. |
| `V-GEOM-040` constructibility proof | Narrowed to a clampability check. The full decomposition *is* the P3 decomposer and should be built once, there. |
| Free-paint canvas, image import, decomposer | P3. |
| Graph view (tier 3), custom species | Specified; not built. The species table has 9 entries with provenance. |
| Edge treatments — chamfer, juice groove, feet | P4. |
| `trim` by arbitrary outline | Every edge resolution needed so far is an anchored rectangle. |

**Explicitly out of scope.** CNC / DXF / STEP export, any pattern requiring CNC, and metric units.

---

## Repo layout

```
src/core/      everything that has to be correct — no React, no DOM (11k lines)
  units/         exact integer arithmetic: 1 tick = 1/8000"
  model/         the construction graph: Workpiece, Op, ShopProfile, Project
  geometry/      the evaluator; polygon clipping; the topological union
  knowledge/     the cited knowledge base and the species table
  validation/    the 27 rules, as data
  cutlist/       allowance ledger, cut list, instructions, assembly maps
  generators/    one module per pattern family
  persist/       project files and share-link codec
src/ui/        React views: 2-D canvas, 3-D viewport, panels, print sheets
src/app/       composition root
docs/spec/     the design, 12 documents
docs/HANDOFF.md  read this first when resuming
tools/         the spec checker
```

The `core/` boundary is enforced in CI by dependency-cruiser: if anything under `core/` imports
React, the DOM or `ui/`, the build fails. That boundary is the reason the geometry, validation and
cut-list logic are independently testable, and it is why the test suite can be fast and exhaustive.

---

## How the tool earns trust

Its output gets acted on with a table saw and several hundred dollars of hardwood, so guessing is
not acceptable. Four commitments, each mechanically enforced:

**1. Formulas are verified against known results.** Golden cases: CBDJS's published defaults
reproduce exactly (G1); the 3D-cube closure at `T = 1.25"` and `T = 1.375"` (G2, G3); and the
`hexAcrossFlats = 2T` identity checked on the *built* geometry rather than on the generator's own
arithmetic (G5). *G4, Old Line's worked example, is still uncaptured.*

**2. Woodworking knowledge is data, not prose.** 24 knowledge-base entries, each with a confidence
level and sources. Safety rules — such as *never run an end-grain glue-up through a thickness
planer* — are blocking validation rules. That one is stronger still: the thickness-planer variant
is **absent from the operation type**, so it is unrepresentable rather than merely rejected.

**3. Invariants, not just examples.** Conservation of mass is checked per node, so a failure names
the operation at fault. The faces of every cross-section must tile their outline. A non-grid
lay-up's gaps are found *topologically* — a missing cell is an enclosed ring, located exactly,
rather than a number that has to beat a tolerance. Property-based tests over randomly generated
graphs; 443 tests in total.

**4. The spec is checked mechanically.**

```bash
node tools/check-spec.mjs
```

Every link and anchor resolves, every referenced knowledge-base and rule id is defined, every KB
entry is actually cited, rule numbering has no accidental gaps, and the safety contract holds.
Exits non-zero, so it gates CI.

> Worth knowing: no two of the bugs found during development were caught by the same mechanism.
> Conservation of mass is the strongest invariant but not the broadest — it is blind to anything
> that merely *deforms* material. The accounting of which check caught which bug is in
> [`docs/HANDOFF.md`](docs/HANDOFF.md), and is the most useful page in the repo.

---

## Documentation

| Doc | What it covers |
| --- | --- |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Start here when resuming.** Status, spec deviations, which invariant catches which bug, traps, the P3 plan |
| [`00-overview.md`](docs/spec/00-overview.md) | Vision, goals, non-goals, competitive analysis, the core thesis |
| [`01-woodworking-domain.md`](docs/spec/01-woodworking-domain.md) | **The knowledge base.** Verified construction math, failure modes, species data, safety rules |
| [`02-construction-graph.md`](docs/spec/02-construction-graph.md) | The data model: operation DAG, `Workpiece` type, exact arithmetic |
| [`03-geometry-engine.md`](docs/spec/03-geometry-engine.md) | Simulating each operation; the union outline; deriving the 2-D mosaic and 3-D solid |
| [`04-validation-rules.md`](docs/spec/04-validation-rules.md) | Buildability validator: tooling envelope, constructibility, wood movement, food safety |
| [`05-cut-list-and-instructions.md`](docs/spec/05-cut-list-and-instructions.md) | Allowance ledger, cut list, step generation, glue-up assembly maps |
| [`06-design-surface-ux.md`](docs/spec/06-design-surface-ux.md) | The linked views and the shop profile |
| [`07-pattern-library.md`](docs/spec/07-pattern-library.md) | Pattern generators, and the free-paint solver with honest limits |
| [`08-architecture-and-stack.md`](docs/spec/08-architecture-and-stack.md) | React + TS + Three.js, module boundaries, testing strategy |
| [`09-exports.md`](docs/spec/09-exports.md) | Printable output, project files, shareable URLs |
| [`10-roadmap.md`](docs/spec/10-roadmap.md) | Phased build plan, P0 through P4 |
| [`references.md`](docs/spec/references.md) | Every source, and what each one established |

If you only read two specs, read `01` and `02`. The domain knowledge in `01` is what makes the
output trustworthy; the model in `02` is what makes it expressive.

---

## Status and licence

Private repository, no licence yet — all rights reserved by default. Not deployed: GitHub Pages
serves a private repo only on a paid plan, which is unresolved, so CI builds the app but does not
publish it.

Nothing here has been built in wood yet. The arithmetic is verified against published results and
the geometry is checked by construction, but the first real board is still the real test.
