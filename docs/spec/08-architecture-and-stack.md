# 08 — Architecture, Stack, and Testing

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Build | **Vite** | Fast HMR; the geometry core benefits from tight iteration |
| Framework | **React 19 + TypeScript (strict)** | Branded unit types ([`02`](02-construction-graph.md)) need a real type checker. *Revised from 18: `@react-three/fiber@9` requires 19, and pinning a 3-D library backwards to keep a React version with no reason to stay on it is the wrong trade.* |
| State | **Zustand + immer** | Normalised graph store; immer inverse patches give undo/redo for free |
| 3-D | **three + @react-three/fiber + @react-three/drei** | Declarative Three.js that composes with React state |
| 2-D | **SVG** (React-rendered) | Crisp at any zoom, free hit-testing, directly reusable for print and export |
| Polygons | **none — implemented directly** | Half-plane clipping on integer ticks, ~60 lines. *Revised from clipper2-js: the vocabulary only needs half-plane clips and non-overlapping placement* ([`03`](03-geometry-engine.md#clipping-implemented-directly-no-boolean-library)) |
| Print / PDF | **Paged HTML + print stylesheet** | Browser prints to PDF. No PDF library, no font embedding, no layout engine to fight |
| URL codec | **JSON + deflate (fflate) + base64url** | Versioned, unlike CBDJS's scheme. *Revised from CBOR: the generator fast path makes payloads ~200 chars, so a CBOR dependency bought nothing* |
| Tests | **Vitest + fast-check** | Property-based testing is the backbone of the correctness story |

Deliberately **not** included:

- **A PDF library** (jsPDF, pdfmake). Browser print-to-PDF handles paged HTML well, and the
  printed cut list is mostly tables and SVG — exactly what HTML is good at. A PDF library would
  mean reimplementing layout for no benefit.
- **A CAD kernel** (OpenCascade, manifold). The operation vocabulary is restricted to prisms and
  straight cuts on purpose. A general B-rep kernel would be megabytes of WASM to do less reliably
  what 2-D integer polygon booleans do exactly.
- **A backend.** Local-first. Project files and shareable URLs cover persistence
  ([`09`](09-exports.md)).

## Deployment

**GitHub Pages** (decision, 2026-10-06). The app is a fully static, local-first SPA with no
backend, so Pages is sufficient and needs no additional account.

Two consequences that have to be settled before the first build rather than retrofitted:

| Concern | Handling |
| --- | --- |
| **Base path** | Pages serves from `/<repo>/`, so Vite needs `base: '/butcher-block-designer/'`. Hardcoding absolute asset paths anywhere will break the deploy. |
| **Client-side routes** | Shared design URLs are `/d/<version>.<payload>` ([`09`](09-exports.md#shareable-urls)). Pages has no rewrite rules, so a deep link 404s on refresh. |

The route problem has a standard fix — a `404.html` that redirects into `index.html` with the
original path preserved — but the simpler option is worth taking first: encode the design in the
**hash fragment** (`/#/d/3.<payload>`) rather than the path. The fragment is never sent to the
server, so it cannot 404, it survives refresh and bookmarking, and it keeps the shared-link
feature working on any static host without per-host configuration.

Deploy via a GitHub Actions workflow on push to `main`, running `tools/check-spec.mjs` and the
test suite as gates before publishing.

### Open dependency: Pages requires a paid plan on a private repo

The repository is **private**, and GitHub Pages only serves from a private repository on a paid
plan (Pro, Team, or Enterprise). On a free account, Pages requires the repository to be public.

This is not blocking — deployment is a P1 concern and the app builds and runs locally regardless
— but it has to be resolved before the deploy workflow is written. Three ways out:

| Option | Trade-off |
| --- | --- |
| Make the repo public when deploying | Free. Means publishing the source, which also means deciding a licence. |
| GitHub Pro | Keeps the repo private and Pages works unchanged. |
| Deploy elsewhere | Netlify and Vercel both serve private-repo builds on their free tiers. Costs nothing but adds an account, and the hash-fragment routing above means no per-host config is needed either way. |

The hash-fragment decision was made partly for this reason: it keeps the shared-link feature
working identically on any static host, so changing hosts later is a one-line config change
rather than a rework.

## Module boundaries

```
src/
  core/                 ← ZERO React imports. Zero DOM. Pure and independently testable.
    units/              Ticks, MilliDeg; parse/format fractions and metric
    model/              Project, Graph, Op, Workpiece, Partition; invariant checks
    geometry/           evaluate(); integer polygon ops; partition algebra
    knowledge/          THE KB AS DATA: species table, rule text, instruction templates
    validation/         rules/*.ts, validate()
    cutlist/            allowance ledger, cut list, instruction generation, assembly maps
    generators/         pattern generators
    decompose/          the target → graph solver
    persist/            schema versioning + migrations, URL codec
  ui/
    canvas2d/           SVG face view
    viewport3d/         r3f scene, materials, grain textures
    graph/              node editor
    panels/             parameters, findings, species palette, shop profile
    print/              paged print layouts
  app/                  routing, store wiring, layout shell
```

### The `core/` boundary is enforced, not aspirational

A CI check (dependency-cruiser or an ESLint `no-restricted-imports` rule) **fails the build** if
anything under `core/` imports React, a DOM global, or anything from `ui/`.

This is worth enforcing mechanically rather than by convention because `core/` holds everything
that has to be *correct* — the geometry, the validation, the cut list. Keeping it free of
framework entanglement means:

- It can be tested without a renderer, so the test suite is fast and the property-based tests
  (below) are practical to run on every commit.
- It can be run in a worker if the decomposer needs it, with no refactor.
- It could be reused in a CLI or a future native shell without being rewritten.

The dependency arrow points one way: `ui → core`, never back.

### Knowledge as data

`core/knowledge/` ships [`01-woodworking-domain.md`](01-woodworking-domain.md) as typed data:

```ts
export const SPECIES: Record<SpeciesId, Species> = { /* KB-B03 */ };
export const KB: Record<KbId, KbEntry> = { /* every cited entry, with text and sources */ };
export const TEMPLATES: Record<TemplateId, string> = { /* instruction templates */ };
```

Validation rules cite `KbId`s and instruction templates interpolate from `KB`, so woodworking
knowledge exists in exactly one place. Correcting a figure corrects every warning and every
generated instruction that depends on it.

## State and history

```ts
interface Store {
  project: Project;
  // derived, recomputed on change
  evaluated: EvalResult;
  findings: Finding[];
  cutList: CutList;

  history: { past: Patch[][]; future: Patch[][] };
  selection: { nodes: NodeId[]; pieces: PieceId[] };
  view: { mode: '2d' | '3d' | 'split' | 'graph'; camera: CameraState };
}
```

- Mutations go through immer `produceWithPatches`; inverse patches push onto `history.past`.
- Derived values recompute on a debounced frame, with memoisation keyed by node content hash
  ([`03`](03-geometry-engine.md#the-evaluator)).
- `selection` is shared across all views, which is what makes "click a finding, see the pieces"
  work in 2-D, 3-D, the graph, and the cut list simultaneously.
- Patches are serialisable — useful for a future collaborative mode, and immediately useful for
  reproducing a bug report from a patch log.

## Testing strategy

This is how the tool earns the right to be trusted with someone's lumber. Four layers, in
increasing order of power.

### 1 — Golden cases against known results

The anchors. Each is a published, independently-produced result that our formulas must reproduce.

| # | Case | Assertion |
| --- | --- | --- |
| **G1** | CBDJS defaults: `L=20, D=1.2, s=1.5, kerf=0.125` | slices **12**, length **14.4**, leftover **0.625**, width **6** — exact ([KB-A03](01-woodworking-domain.md#kb-a03--golden-case-1--cbdjs-defaults)) |
| **G2** | 3D cube closure at `T=1.25` | ripWidth **1.4434**, hexAcrossFlats **2.500** exactly ([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)) |
| **G3** | 3D cube closure at `T=1.375` | ripWidth **1.5877**, hexAcrossFlats **2.750** exactly |
| **G4** | Old Line calculator worked example | Slab dimensions, crosscut width, segment count agree |
| **G5** | `hexAcrossFlats == 2T` identity | Holds for all `T` in range — a closed-form invariant, not a sampled check |

G1–G3 are already verified by hand during specification. G4 must be verified during
implementation against the live tool.

### 2 — Property-based tests (the strongest layer)

Using `fast-check` over randomly generated construction graphs. These catch bugs nobody thought
to write a test for.

```ts
// The headline property.
test.prop([arbitraryGraph()])('conservation of mass', (graph) => {
  const r = evaluate(graph, graph.output, newCache());
  for (const species of speciesIn(graph)) {
    const vIn  = inputVolume(graph, species);
    const vOut = outputVolume(r, species)
               + r.ledger.kerf[species]
               + offcutVolume(r, species)
               + r.ledger.removed[species];
    expect(relativeError(vIn, vOut)).toBeLessThan(0.001);   // invariant I-5
  }
});
```

**Why this one property matters so much.** It is a physical conservation law, so it holds for
*any* graph of any complexity, and it fails loudly for an entire class of defects without anyone
anticipating the specific failure:

- a bevel modelled with the wrong sign
- kerf counted per strip instead of per cut (the classic error in this domain)
- kerf double-counted at panel ends
- an offcut dropped from the ledger
- a flatten operation removing from the wrong axis

Every one of those produces a wrong cut list and a board that comes out the wrong size. One
property test covers them all.

Modelling cuts as polygon subtraction ([`03`](03-geometry-engine.md#cuts-as-polygon-subtraction))
makes this property hold *by construction* rather than by bookkeeping — but the test stays, because
it also guards the ledger, the flatten paths, and every future operation.

Other properties worth asserting:

| Property | Statement |
| --- | --- |
| Partition validity | Every `evaluate` result satisfies invariant I-3: no gaps, no overlaps |
| Serialisation round-trip | `decode(encode(p))` deep-equals `p`, for arbitrary projects |
| URL round-trip | Same, through the compressed base64url codec |
| Idempotent validation | `validate` is pure: same input, same findings, same order |
| Reorient is near-identity | `toEndGrain` changes interpretation, never cross-section geometry |
| Monotone material | Adding a piece never decreases total board feet |

### 3 — Rule fixture suite

For every rule in [`04`](04-validation-rules.md), **two** fixtures:

- a design that triggers it
- a **near-miss** that must not

The near-miss cases are the valuable half. A `V-DIM-010` fixture at exactly 1.500" thickness
catches an off-by-one-tick comparison that a 1.000" fixture never would. Threshold rules fail at
their boundaries, so that is where they get tested.

Plus two meta-tests on the rule set itself:

```ts
test('every rule cites at least one KB entry that exists', () => { /* ... */ });
test('every V-SAFE-* rule has severity "error"', () => { /* ... */ });
```

The citation-integrity test is the mechanism that keeps unsourced woodworking opinion out of the
codebase ([`04`](04-validation-rules.md#rules-are-data)).

### 4 — No false positives on the classics

A regression suite of boards that **must validate completely clean**:

- maple/walnut checkerboard, 1.5" cells, 12" × 16" × 1.5"
- three-wood brick pattern
- 3D cube built exactly to KB-A05
- classic stripe edge-grain board

A validator that warns about the most commonly built board in the hobby trains users to ignore
warnings, which destroys the value of every genuine finding. This suite is the guard against
over-strict thresholds, and it is the reason the movement rule
([`04`](04-validation-rules.md#v-move--wood-movement)) must let maple/walnut/cherry through.

### Migration fixtures

One committed project file per historical `schemaVersion`, with a test that each loads and
migrates to current. The oldest file anyone has saved is always covered
([`02`](02-construction-graph.md#schema-versioning)).

## Performance targets

| Interaction | Target |
| --- | --- |
| Parameter slider drag → re-render | within one frame (16 ms) |
| Full re-evaluation, typical design (~50 nodes) | < 10 ms |
| Validation pass | < 5 ms |
| Decomposer, grid target | < 50 ms |
| Decomposer, multi-stage search | < 2 s, in a worker, cancellable |
| 3-D rebuild on partition change | < 100 ms |

The decomposer is the only operation allowed to be slow, and it runs in a worker with a progress
indicator and a cancel button. Everything else must feel immediate, because the design loop is
"nudge a number, look at the result" and latency there is what makes a tool feel bad.

## Code quality

- TypeScript `strict`, plus `noUncheckedIndexedAccess` — the graph is full of index lookups.
- Branded `Ticks` / `MilliDeg`; a raw `number` where a length belongs is a compile error.
- No `any` in `core/`, enforced by lint.
- Dependency-cruiser enforcing the `core/` boundary and acyclic module imports.

## Next

[`09-exports.md`](09-exports.md) — getting designs out of the tool.
