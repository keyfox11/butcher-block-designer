# 09 — Exports and Persistence

Four outputs: printed shop documents, assembly maps, project files, and shareable URLs.

**Out of scope:** CNC and CAD export (DXF, SVG-for-machining, STEP, STL). The shop profile is a
table saw and a drum sander ([`00`](00-overview.md#assumed-shop)), and exporting toolpaths for
machines the validator does not model would produce output nobody should trust.

## Printed shop documents

Content and layout are specified in
[`05-cut-list-and-instructions.md`](05-cut-list-and-instructions.md#printed-output). The mechanism:

**Paged HTML with a dedicated print stylesheet, printed to PDF by the browser.** No PDF library
([`08`](08-architecture-and-stack.md#stack)).

```css
@page { size: letter portrait; margin: 0.5in; }

/* Never split a step or an assembly map across pages. */
.step, .assembly-map { break-inside: avoid; }
.phase               { break-before: page; }

/* Safety callouts must survive a monochrome printer. */
.safety-critical {
  border: 3px solid #000; padding: 0.25in; font-weight: 700;
  print-color-adjust: exact;
}
```

Requirements that matter specifically because this is read in a workshop:

- **Monochrome-safe.** Species are distinguished by **hatch pattern** as well as colour, so a
  greyscale print is still usable. Shop printers are usually monochrome, and a cut list where all
  the woods look identical is worthless.
- **Machine settings in large type.** These get read at arm's length beside a running saw.
- **Scale bars on every assembly map**, with the scale stated numerically as well, since printers
  rescale.
- **Warnings travel with the export.** A design exported with warnings prints them on the cover.
  Exporting with `error` findings is blocked ([`04`](04-validation-rules.md#severity-semantics)).
- **Page-size aware.** Letter and A4 both supported; the assembly-map scale adapts.

Separately exportable sections, because they get used at different times: shopping list (at the
lumberyard), cut list and instructions (at the bench), care sheet (given away with a gifted
board).

## Assembly maps

Structure is specified in [`05`](05-cut-list-and-instructions.md#assembly-maps). Export notes:

- Rendered as **SVG**, reusing the 2-D canvas renderer directly — one renderer, so the printed
  map and the screen cannot disagree.
- One page per glue-up stage.
- Also exportable as standalone SVG/PNG, for sharing a build plan or posting a project.

## Project files

```jsonc
{
  "schemaVersion": 3,
  "meta": { "name": "Walnut checker 12x16", "units": "imperial", "measurementPrecision": 31 },
  "shopProfile": { /* ... */ },
  "speciesPalette": ["hard-maple", "black-walnut"],
  "graph": { "nodes": { /* ... */ }, "output": { "node": "n17", "port": 0 } },
  "edgeTreatments": { /* ... */ },
  "generator": { "id": "checkerboard", "params": { /* ... */ } }
}
```

- Extension `.bbd`, JSON content. Human-readable and diffable on purpose — a project file in a
  Git repo should produce a reviewable diff.
- Versioned with tested migrations ([`02`](02-construction-graph.md#schema-versioning)).
- Loading a **newer** version than the code understands fails with a clear message rather than
  partially parsing. A half-loaded cut list is more dangerous than a refusal, because it looks
  complete.
- The `generator` block is retained so a design stays re-parameterisable after a round trip.

**Autosave** to `localStorage` on a debounce, with crash recovery on load. Capped at the last few
projects, with a clear notice of what was recovered — silent restoration of stale state is its own
bug report.

## Shareable URLs

CBDJS has this feature and it is genuinely one of its best. Ours differs in two ways that matter:
it is **versioned**, and it deliberately **omits the shop profile**.

```
https://<host>/d/3.<base64url(deflate(cbor(payload)))>
```

The leading `3.` is the schema version, outside the compressed blob so a decoder can dispatch
before attempting to decompress.

### The payload omits the shop profile

```ts
interface SharePayload {
  meta: Pick<Meta, 'name' | 'units' | 'measurementPrecision'>;
  speciesPalette: SpeciesId[];
  graph: Graph;
  edgeTreatments: EdgeTreatments;
  generator?: { id: string; params: Record<string, unknown> };
  // shopProfile is NOT included
}
```

This is the interesting design decision. A shared design **re-validates against the recipient's
own shop**, so:

- A board that is buildable in a shop with an 18" drum sander correctly reports
  `V-TOOL-050` for someone with a 16" one.
- Nobody inherits a stranger's kerf setting and gets a cut list that is systematically off by
  1/32" per strip.

Shared designs are *designs*, not build plans. The build plan is generated locally, by the person
who is going to cut the wood.

### Size budget

Target **under 2,000 characters** for broad compatibility with chat clients, email, and forum
software that truncates long links.

Two tiers handle this:

| Case | Encoding | Typical size |
| --- | --- | --- |
| Generator-backed design | `{generatorId, params}` only — regenerate the graph on load | **~100–200 chars** |
| Hand-edited graph | Full compressed graph | ~600–1,500 chars |
| Too large | Offer a project-file download instead, with a clear explanation | — |

The generator tier is a large win and it comes free from keeping `generator` in the project
model: a parameterised checkerboard is a dozen numbers, not a hundred nodes. Most shared links
will be this tier.

### Robustness

- **Strict decode.** A corrupted or truncated URL fails with "this link appears incomplete"
  rather than loading a partial graph. Truncation by a chat client is the expected failure mode,
  so it gets a specific message.
- **Validate after decode.** A decoded payload is untrusted input: check invariants
  ([`02`](02-construction-graph.md#invariants)) before putting it in the store. A shared link is
  data from a stranger, and it should not be able to put the app into an invalid state.
- **Node-id stability.** Ids survive encode/decode, since findings and selections reference them.

## Not exported

| Thing | Why not |
| --- | --- |
| DXF / machining SVG | No CNC in the shop profile; unvalidated toolpaths are worse than none |
| STEP / STL | Needs a B-rep kernel the architecture deliberately avoids ([`08`](08-architecture-and-stack.md#stack)) |
| Cost estimates | Board feet yes, prices no — they are regional, volatile, and would date instantly |
| Cloud sync | Local-first; project files and URLs cover sharing without a backend |

## Next

[`10-roadmap.md`](10-roadmap.md) — the order to build it in.
