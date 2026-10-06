# 06 — Design Surface and UX

## The core tension

The construction graph is the source of truth, but **almost nobody wants to edit a node graph to
design a cutting board.** If the only way in is a DAG editor, the tool is a toy for three people.

The resolution is progressive disclosure across three tiers. All three edit the same graph; they
differ in how much of it they expose.

| Tier | Who | Surface |
| --- | --- | --- |
| **1 — Parameters** | Default for everyone | Pick a pattern generator, adjust sliders and species. The graph is regenerated underneath. |
| **2 — Canvas** | Users with a specific design in mind | Paint directly on the 2-D face. The decomposer finds a graph. |
| **3 — Graph** | Power users, debugging, genuinely novel constructions | Edit operations directly. |

A design can be promoted between tiers but not always demoted. Editing a generated graph by hand
detaches it from its generator, so the parameter panel can no longer re-derive it. The UI says so
before the edit ("this will detach the design from the Checkerboard template"), rather than
silently losing the parameters.

## Layout

```
┌────────────┬──────────────────────────────────┬─────────────────┐
│            │                                  │                 │
│  PATTERN   │         VIEWPORT                 │   INSPECTOR     │
│  PICKER    │   ┌────────────┬─────────────┐   │                 │
│            │   │  2-D face  │  3-D board  │   │  Parameters     │
│  Species   │   │  (SVG)     │  (Three.js) │   │  ───────────    │
│  palette   │   └────────────┴─────────────┘   │  Dimensions     │
│            │                                  │  ───────────    │
│            │   [2D] [3D] [Split] [Graph]      │  Findings       │
├────────────┴──────────────────────────────────┤                 │
│  MATERIAL SUMMARY  ·  board feet  ·  warnings │  Shop profile   │
└───────────────────────────────────────────────┴─────────────────┘
```

- 2-D and 3-D are **linked, not alternatives.** Hovering a piece in one highlights it in the
  other, and selecting a finding highlights the pieces in both.
- The **material summary is always visible.** Board feet and warning count are how a user knows
  whether a design is getting out of hand, and hiding them behind a tab means they get checked
  once at the end.
- The graph view replaces the viewport rather than squeezing in beside it. It is a mode.

## The 2-D canvas

The primary view, because an end-grain board is fundamentally a flat pattern.

**Rendering.** SVG, one path per `PartitionFace`, filled with species colour plus a procedural
end-grain texture. SVG is chosen over Canvas2D for crisp zoom, free hit-testing, and because it
is directly reusable for printed assembly maps and export. If piece counts ever make it struggle,
the fallback is documented in [`08`](08-architecture-and-stack.md).

**Interactions by tier:**

| Tier | Canvas behaviour |
| --- | --- |
| 1 | Read-only. Click a piece to see its species, dimensions, and source operation. |
| 2 | Paint species onto cells; drag cell boundaries; draw regions. Each edit re-runs the decomposer. |
| 3 | Read-only again — the graph is being edited directly. |

**The paint loop (tier 2)** is the "wild designs" path, and its honesty is what makes it usable:

1. User paints. The canvas shows the *target*.
2. The decomposer runs (debounced) and attempts to find a construction graph.
3. **On success:** the canvas switches to showing the *achieved* pattern, and reports the stage
   count. More stages means more glue-ups and more work — the user should see that cost.
4. **On failure:** the unachievable regions are outlined, with an explanation of why
   ([`04`](04-validation-rules.md#v-geom-040--the-constructibility-proof)) and a one-click
   "snap to nearest buildable" that shows a diff of what would change.

Showing target-vs-achieved as distinct states is the crux. A tool that silently approximates a
painted design produces a board that does not look like what was drawn, which is a worse
betrayal than refusing.

## The 3-D preview

Three.js via react-three-fiber. Purpose is to answer "will this actually look good", which a flat
2-D fill cannot — end grain has depth and figure, and the sides show long grain.

- Orbit, pan, zoom. A reset-view control, because users get lost.
- End-grain texture on the faces, long grain on the sides
  ([`03`](03-geometry-engine.md#3-d-solid)).
- Edge treatments rendered: chamfer, roundover, juice groove, feet.
- Lighting preset that reads as a kitchen rather than a studio — the point is realism of
  appearance, not drama.
- **Scale reference** toggle: a chef's knife and a hand at true scale. "12 inches" means little
  in an empty viewport, and board size is the decision people most often get wrong.

Deliberately **not** included: AR. cuttingboarddesigner.app offers it and it is genuinely nice,
but it requires a native app, and our target is a browser SPA. The scale reference covers most of
the same need.

## The graph view (tier 3)

A node editor showing operations as nodes and workpieces flowing along edges, laid out
left-to-right by topological order.

- Each node shows its operation, key parameters, and output dimensions.
- Nodes with findings are badged by severity.
- Clicking a node highlights its pieces on the canvas and its rows in the cut list.
- Grouping: a generated subgraph collapses into a single labelled box ("Stage 1 — maple/walnut
  panel") so a hundred-node graph stays legible.

This view is also the debugging surface for the implementers. It should be good enough to
diagnose a geometry bug by inspection.

## The findings panel

Always present, never a modal.

```
⛔ 2 errors
  V-DIM-010  Finished thickness 1.25" is below the 1.5" minimum
             → Increase the crosscut slice width to at least 1.75"
             Why: below 1.5" an end-grain board lacks the section to resist
                  splitting forces.  [KB-C01]

⚠ 3 warnings
  V-MOVE-010 Maple and padauk differ in movement by 1.96×
  V-TOOL-050 Board width 18" exceeds drum sander width 16"
  ...
```

Requirements:

- **Grouped by severity, ordered by graph position** within a group, so the first error listed is
  the earliest problem in the build.
- **Deduplicated with counts.** Twenty narrow strips are one row, not twenty.
- **Every finding shows its rationale inline**, pulled from the cited KB entry. The user should
  not have to go looking to find out why.
- **Click to locate.** Highlights the nodes in the graph and the pieces on both canvases.
- **Errors block export** and say so explicitly at the export button, rather than failing when
  clicked.

## Species palette

Each species chip carries the data a decision actually needs:

```
┌──────────────────┐
│  ███  Hard maple │
│  Janka 1450      │
│  Movement 0.00353│
│  ✓ Food safe     │
└──────────────────┘
```

- Movement coefficient shown on the chip, not buried — it is how a user avoids a `V-MOVE-010`
  warning before hitting it.
- Food-safety status as an icon with a tooltip: safe / open-pore caution / **contested** /
  avoid. Contested species show the disagreement rather than a verdict
  ([KB-B06](01-woodworking-domain.md#kb-b06--food-safety)).
- Palette picker warns when a selection spans a wide movement range *before* the design is built.
- Custom species: user supplies colour, Janka, and movement coefficient. The `C ≈ tangential/28`
  relationship from KB-B03 is offered as a sanity check on entered values.

## Dimension input

Woodworkers think in fractions. `1 1/2`, `1-1/2`, `1.5`, and `1 1/2"` must all work, and the
display must come back as `1½"` rather than `1.5`.

```ts
parseDimension('1 1/2')   // 1500 ticks
parseDimension('1-1/2')   // 1500 ticks
parseDimension('1.5')     // 1500 ticks
parseDimension('38mm')    // 1496 ticks  (explicit unit overrides the project default)
formatDimension(1500)     // "1 1/2""
```

- Fractions snap to the project's measurement precision (default 1/32").
- When an underlying value is not representable at that precision, the field shows the rounded
  value **and** the residual — `1 1/2" (+0.003")` — so a solved size-exact dimension never lies
  ([`05`](05-cut-list-and-instructions.md#cell-exact-vs-size-exact)).
- Metric mode is a real mode, not a conversion display: input, storage rounding, and output all
  work in millimetres.

## Shop profile

A separate settings surface, stored separately from the design
([`02`](02-construction-graph.md#the-project-document)), so a shared design re-validates against
whoever opens it.

Grouped as the user thinks about their shop:

| Group | Fields |
| --- | --- |
| Table saw | Kerf, max depth at 90°, max depth at 45°, max bevel, min safe rip width |
| Crosscut sled | Capacity, min safe workpiece length |
| Drum sander | Width, max thickness, removal per pass |
| Clamps | Count, force each, max reach |
| Other tooling | Router (roundover, juice groove), drill (feet) — optional; absence gates those features via `V-TOOL-090` |
| Environment | Seasonal moisture-content swing |
| Precision | Measurement precision, per-cut tolerance |

Defaults describe a common hobby shop: 10" saw, 1/8" kerf, 16" drum sander, six parallel clamps.
Every field has a "why this matters" tooltip naming the rule it feeds — the profile is otherwise
a wall of numbers with no evident purpose.

## Onboarding

The first-run path has to get someone to a plausible board in under a minute, or they leave.

1. Pick a template from a visual gallery (not a dropdown).
2. Pick two or three species from the palette.
3. Set finished dimensions.
4. See the 3-D preview, the material summary, and any findings.

Deferred until asked for: shop profile (sensible defaults first), the graph view, free-paint mode.

## Accessibility

- Species are distinguished by **hatch pattern as well as colour**, everywhere — on screen, in
  print, and in exports. Wood species palettes are mostly browns and reds, which is close to
  worst-case for red-green colour blindness, and this also makes greyscale printing work.
- Full keyboard navigation of the parameter panel and findings list.
- Findings are announced to screen readers when the count changes.
- The 3-D view is enhancement, never the only way to get information; everything it conveys is
  also available in 2-D and in text.

## Next

[`07-pattern-library.md`](07-pattern-library.md) — the generators behind tier 1, and the
decomposer behind tier 2.
