# 10 — Roadmap

Five phases. Each has an exit criterion that is a **demonstrable capability**, not a checklist of
files written.

The ordering principle: **the correctness core comes first and the creative surface comes last.**
That is the opposite of the tempting order — a pattern gallery demos well on day one — but
getting the geometry and the allowance ledger right is what the whole premise rests on. A
beautiful designer attached to a wrong cut list is a worse product than a plain one attached to a
right cut list.

---

## P0 — The correctness core

**Goal:** generate a cut list for a checkerboard board that is provably right.

- `core/units` — `Ticks`, `MilliDeg`, fraction parse/format
- `core/model` — `Project`, `Graph`, `Op`, `Workpiece`, `Partition`; invariant checks
- `core/geometry` — `evaluate()`, cuts as polygon subtraction over clipper2
- `core/knowledge` — species table and the KB entries P0 rules need
- `core/validation` — the `V-SAFE-*`, `V-DIM-*`, and `V-MAT-*` rules
- `core/cutlist` — allowance ledger, cut list, instruction generation
- `core/generators` — checkerboard (including the odd-column two-panel case) and brick
- Minimal UI: parameter panel, 2-D SVG canvas, findings list, print view
- **Golden tests G1–G4, and the conservation-of-mass property test**

**Exit criterion.** A maple/walnut checkerboard produces a printable cut list whose dimensional
math reproduces CBDJS's published output exactly (G1), whose allowance ledger traces every
finished dimension back to rough stock, and for which conservation of mass holds across randomly
generated graphs.

At this point the tool is already more trustworthy than any of the reference tools, while looking
like far less.

---

## P1 — Angles, 3-D, and sharing

**Goal:** everything CBDJS can express, plus a real preview and shareable links.

- Bevel rips; angled layer boundaries ([KB-A06](01-woodworking-domain.md#kb-a06--angled-layer-boundaries-bevel-ripped-strips))
- Generators: zig-zag, chevron, snake skin, stripes, three-wood bands, diagonal accent, stochastic
- `V-GEOM-030` both-faces taper check; `V-TOOL-*` envelope rules including bevel depth interpolation
- Three.js viewport: end-grain and long-grain materials, edge treatments, scale reference
- Assembly maps
- URL codec with the generator-params fast path; project file save/load with migrations
- Shop profile UI

**Exit criterion.** Reproduce all five CBDJS example designs (simple checkerboard, complex
checkerboard, zig-zag, spiral, snake skin), with a correct cut list and a 3-D preview for each,
and share any of them as a URL under 2,000 characters.

---

## P2 — Multi-stage and the full knowledge base

**Goal:** the patterns no existing tool can express.

- Multi-stage sub-assemblies ([KB-A04](01-woodworking-domain.md#kb-a04--multi-stage-sub-assemblies))
- Non-grid lamination: honeycomb lattice placement and edge resolution
- Generators: **3D cube / tumbling block**, true herringbone, pinwheel, basket weave
- `V-GEOM-050` hex closure check; `V-GEOM-040` constructibility proof
- Complete `V-MOVE-*`, `V-GRAIN-*`, `V-FOOD-*`, `V-TOL-*` rule sets
- Full species table with provenance; custom species
- Graph view (tier 3)

**Exit criterion.** A 3D cube board generated from a single `stockThickness` parameter, with
`hexAcrossFlats == 2T` verified (G2, G3, G5), a correct honeycomb assembly map, and an explicit
edge resolution — plus a true herringbone board whose grain stays perpendicular to the face
throughout.

This is the phase where the central architectural bet pays off. If the construction-graph model
is right, these patterns are a generator each. If it is wrong, this is where that becomes
obvious — which is why it comes before the free-paint surface that depends on the same machinery.

---

## P3 — Creative freedom

**Goal:** the free-paint tier.

- Paint and region-draw editing on the 2-D canvas (tier 2)
- `core/decompose`: grid detection → guillotine search → band segmentation → known tilings
- Target-versus-achieved display; unreachable-region reporting; snap-to-buildable with diff
- Image import with quantisation preview
- Worker-based decomposition with progress and cancel

**Exit criterion.** Paint an irregular non-grid pattern, receive a valid construction graph with
its glue-up count, and for a deliberately unbuildable pattern (a curve, an interior island)
receive a clear refusal naming the offending regions — never a silent approximation.

---

## P4 — Finish

**Goal:** the things that make it pleasant and giftable.

- Edge treatments: chamfer, roundover, juice groove, feet, with their validation rules
- Full pattern gallery with visual thumbnails and glue-up counts
- Onboarding flow
- Care sheet export
- Accessibility pass: hatch patterns throughout, keyboard navigation, screen-reader findings
- Metric mode as a first-class mode
- Performance pass against the targets in [`08`](08-architecture-and-stack.md#performance-targets)

**Exit criterion.** A first-time user reaches a plausible, validated board in under a minute,
prints a shop-ready document, and the whole print is legible in monochrome.

---

## Sequencing notes

**Why validation is spread across phases rather than built once.** Rules depend on features. The
movement rules need the full species table; the geometry rules need bevels and multi-stage. Each
rule lands with the capability it governs, together with its fixture pair
([`08`](08-architecture-and-stack.md#3--rule-fixture-suite)).

**Why 3-D is P1 and not P0.** It is the most demo-able feature and contributes nothing to
correctness. Doing it first would be optimising for the demo over the deliverable. It lands as
soon as the core is trustworthy, which is early enough.

**Why the decomposer is last.** It is the hardest component, its value depends on multi-stage
support existing (P2), and it is the one piece that may not fully succeed. Putting it last means
P0–P2 ship a genuinely useful tool regardless of how far P3 gets.

**The riskiest assumption** is that the construction-graph model is expressive enough. P2 is the
test. If the honeycomb and herringbone generators turn out to need operations outside the
vocabulary in [`02`](02-construction-graph.md#operations), that is a signal to extend the
vocabulary — not to special-case the generators. Special-casing would reintroduce exactly the
picture/cut-list divergence this design exists to eliminate.

## Open questions for implementation

1. **Old Line golden case (G4).** The worked example needs to be captured from the live tool and
   committed as a fixture. The other four golden cases are already verified.
2. **Minimum safe puck size** for crosscutting hex pucks on a sled needs a real number rather
   than a conservative guess. Currently a shop-profile parameter with a cautious default.
3. **Guillotine search ordering.** Minimising tree depth minimises glue-ups, but the best search
   heuristic needs empirical tuning against real painted targets.
4. **Species data provenance.** Sugar maple appears as both 4.8/9.9 and 4.9/9.5 across sources.
   The spread is small, but the table carries a `provenance` field per row and the conflict
   should be recorded rather than averaged away
   ([KB-B03](01-woodworking-domain.md#kb-b03--species-movement-data)).

**Resolved during specification:** the `V-MOVE-010` movement threshold, which was the only
judgement-call number in the rule set. It is now derived and calibrated against named palettes in
[`04`](04-validation-rules.md#v-move--wood-movement), with a fixture table that pins the
behaviour.
