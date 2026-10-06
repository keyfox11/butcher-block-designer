# Butcher Block Designer

A design spec for an end-grain cutting board / butcher block pattern designer that gives you
full creative freedom **without** sacrificing a cut list you can actually trust at the saw.

> **Status: design spec only.** No application code exists yet. This repository currently
> contains the specification that a future implementation will be built against.

## Why another cutting board designer?

Four tools already exist in this space:

- [cuttingboarddesigner.app](https://cuttingboarddesigner.app/)
- [Old Line Woodcraft — End Grain Strips calculator](https://oldlinewoodcraft.com/toolbox/end-grain-strips)
- [CBDJS (Cutting Board Designer JS)](https://ericu.github.io/CBDJS/cb.html)
- [cuttingboarddesigner.com](https://www.cuttingboarddesigner.com/)

They are all limited in the same way, and it is a structural limitation rather than a missing
feature. Each one treats **the design as the input and the cut list as the output**. CBDJS, for
example, models a board as a 1-D list of horizontal layers; its entire output math is three
lines. That means a whole class of real end-grain boards — the 3D tumbling-block being the
clearest example, since it is a *honeycomb of hexagonal prisms* and not a grid at all — simply
cannot be represented.

This spec inverts the relationship. **The construction sequence is the source of truth, and the
picture is derived from it.** The cut list cannot be wrong, because the cut list *is* the design.

See [`docs/spec/00-overview.md`](docs/spec/00-overview.md) for the full argument and a
feature-by-feature comparison.

## Reading order

| Doc | What it covers |
| --- | --- |
| [`00-overview.md`](docs/spec/00-overview.md) | Vision, goals, non-goals, competitive analysis, the core thesis |
| [`01-woodworking-domain.md`](docs/spec/01-woodworking-domain.md) | **The knowledge base.** Verified construction math, failure modes, species data, safety rules |
| [`02-construction-graph.md`](docs/spec/02-construction-graph.md) | The data model: operation DAG, `Workpiece` type, exact arithmetic |
| [`03-geometry-engine.md`](docs/spec/03-geometry-engine.md) | Simulating each operation; deriving the 2-D mosaic and 3-D solid |
| [`04-validation-rules.md`](docs/spec/04-validation-rules.md) | Buildability validator: tooling envelope, constructibility, wood movement, food safety |
| [`05-cut-list-and-instructions.md`](docs/spec/05-cut-list-and-instructions.md) | Allowance ledger, cut list, step generation, glue-up assembly maps |
| [`06-design-surface-ux.md`](docs/spec/06-design-surface-ux.md) | The three linked views and the shop profile |
| [`07-pattern-library.md`](docs/spec/07-pattern-library.md) | Pattern generators, and the free-paint solver (with honest limits) |
| [`08-architecture-and-stack.md`](docs/spec/08-architecture-and-stack.md) | React + TS + Three.js, module boundaries, testing strategy |
| [`09-exports.md`](docs/spec/09-exports.md) | Printable output, project files, shareable URLs |
| [`10-roadmap.md`](docs/spec/10-roadmap.md) | Phased build plan, P0 through P4 |
| [`references.md`](docs/spec/references.md) | Every source, and what each one established |

If you only read two documents, read `01` and `02`. The domain knowledge in `01` is what makes
the output trustworthy; the model in `02` is what makes it expressive.

## Scope at a glance

**Target platform.** Browser SPA — React + TypeScript + Three.js, built with Vite. Local-first.

**Assumed shop.** Table saw with a crosscut sled, and a drum sander. No router sled, no CNC.
This is a deliberate constraint, not an omission: the buildability validator rejects geometry
that cannot be cut on a table saw, which is what keeps the generated instructions honest.

**Exports.** Printable cut list and build instructions; per-stage glue-up assembly maps;
shareable design URLs; versioned project files.

**Explicitly out of scope.** CNC / DXF / STEP export, and any pattern that requires CNC to build.

## A note on correctness

This is a tool whose output people will act on with a table saw and several hundred dollars of
hardwood. Guessing is not acceptable. Two commitments run through the whole spec:

1. **Every formula is derived and verified against a known result.** The dimensional math was
   confirmed to reproduce CBDJS's published output exactly, and the 3D-cube geometry was derived
   to a closed form (`hexAcrossFlats = 2 × stockThickness`) that matches published build stock.
2. **Woodworking knowledge lives in a citable knowledge base, not in prose.** Safety rules —
   such as *never run an end-grain glue-up through a thickness planer* — are machine-readable
   blocking validation rules, not paragraphs a reader can skim past.

### Checking the spec

The spec's cross-references are mechanical properties, so they are checked mechanically:

```bash
node tools/check-spec.mjs
```

It verifies that every link and anchor resolves, that every referenced knowledge-base id and
validation-rule id is defined, that every KB entry is actually cited, that rule numbering has no
accidental gaps, and that the safety contract holds — the never-planer rule exists as a blocking
rule *and* a critical instruction note, and the thickness-planer variant is absent from the
operation type. Exits non-zero on failure, so it can gate CI.
