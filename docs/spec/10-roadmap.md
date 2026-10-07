# 10 — Roadmap

Six phases. Each has an exit criterion that is a **demonstrable capability**, not a checklist of
files written.

P0 through P4 are ordered by dependency. [P5](#p5--interaction-repair) is not: it repairs
interaction on what already ships, so it can be taken at any point once there is something to
interact with.

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
- `core/geometry` — `evaluate()`, cuts as polygon subtraction
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

> **Outcome.** The bet paid, with one genuine extension rather than a special case. The honeycomb
> needed something the vocabulary could not express — the outline of an assembly that is not a
> rectangle — so the vocabulary gained a **true union** ([`03`](03-geometry-engine.md#the-union-outline))
> and `LaminateMember.rotate` was widened from a half-turn flag back to the `MilliDeg` this
> document originally specified. Both are used by every multi-stage pattern, not just the one that
> forced them, which is the test of whether an extension was the right shape.
>
> Each of the four patterns is a generator. None required the engine to know what pattern it was
> drawing. `V-GEOM-040` was narrowed to the part that is real before the decomposer exists — see
> [`04`](04-validation-rules.md#v-geom-040--the-constructibility-proof).

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
- *(Metric mode is out of scope — see [`06`](06-design-surface-ux.md#dimension-input))*
- Performance pass against the targets in [`08`](08-architecture-and-stack.md#performance-targets)

**Exit criterion.** A first-time user reaches a plausible, validated board in under a minute,
prints a shop-ready document, and the whole print is legible in monochrome.

---

## P5 — Interaction repair

**Goal:** make the controls that already exist behave well. Where P4 *adds* finishing features,
P5 *repairs* interaction behaviour on what already ships.

That difference is why it is a separate phase rather than more P4 bullets: every P4 item waits on
something unbuilt (edge treatments, the pattern gallery), while every item here is about the 14
patterns and the control panel that exist today. **P5 is orderable before P3 and P4**, and the
case for doing it early is that the defects below are met by every user on their first session.

### An illegal parameter must not destroy the design

The defect, precisely. `App.tsx` derives everything from `{patternId, params, shop}` in a single
`useMemo`. When a generator throws, the `catch` returns `{ ok: false }` and the entire viewport is
replaced by "This design cannot be built" above a **Reset to the reference board** button. The
design is gone. Nudging one slider one step too far discards every other choice the user made.

Worked example, reproducible from the app's own defaults: choose **basket weave**, set cell size
to 2½", and drag **stripes per tile** to 6. `multistage.ts` computes
`stripeWidth = floor(tileLong / stripes)`, finds it below `shop.minSafeRipWidth`, and throws. The
refusal is *correct* — ½" strips off a 2½" tile are genuinely unsafe to rip — but the response to
a correct refusal should not be to delete the user's work.

Three things need to change, and only the first is cosmetic:

| | What | Why it is not just a red outline |
| --- | --- | --- |
| 1 | Keep rendering the **last good** design, and mark it stale | The design must survive the illegal state, or "drag the slider back" is not available as a recovery |
| 2 | Attach the message to the **control at fault** | A thrown `Error` carries a sentence, not a field. Nothing in the error identifies `stripes`, so nothing can highlight that slider. Generators need to raise a typed refusal carrying the offending parameter |
| 3 | Give each control its **real** bounds | `Stripes per tile` is hardcoded `max={12}` regardless of cell size. The true ceiling is `floor(tileLong / minSafeRipWidth)` and depends on two other inputs |

Item 3 is the one that actually fixes it: a slider that stops at the last buildable value makes
the bad state **unreachable** rather than merely recoverable, which is the same move the operation
vocabulary makes with the thickness planer ([KB-A08](01-woodworking-domain.md#kb-a08--flattening-the-hard-safety-gate)).
Items 1 and 2 remain worth doing for the combinations that cannot be expressed as a per-control
range.

### Separate a refusal from a bug

The same `catch` handles both, and they are not the same thing. Of the 31 `throw` sites in
`core/generators/`, some are refusals addressed to the user — *"A checkerboard needs at least 2
columns and 2 rows"* — and others are internal invariants: *"Internal: no strip for column 3"*.
Showing the second as **This design cannot be built** tells the user to change their design to work
around what is actually a defect in the tool. Refusals belong on a control; invariant failures
belong in an error report that says so.

### The rest

- **Fence-setting precision.** The 3D cube wants a `1.73205"` fence and the cut list prints
  `1 23/32"` at the default 1/32", which builds a hexagon 0.023" under what the ledger states.
  Bevel rips should default to 1/64". Measured, not hypothetical — visible on the deployed site.
- **The Share button fails silently.** `navigator.clipboard.writeText` is called with no `.catch`,
  so a refused clipboard leaves an unhandled rejection and no feedback. The URL *is* already in
  the address bar, so the fallback message is accurate and cheap.
- **Findings should link to controls**, not only to pieces. A finding naming a parameter should
  focus the control that sets it.
- **Hover must not move anything.** Fixed, and recorded here as the class: the 2-D caption was
  sizing its own flex container, so the board changed scale by up to 24% as the cursor crossed
  pieces. Any status text whose content varies needs a box whose size does not.

**Exit criterion.** No sequence of control movements can reach a state that discards the user's
design. Every control that can be driven out of range says so on itself, in place, and can be
dragged back. No message addressed to the user describes an internal invariant.

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

1. **Minimum safe puck size** for crosscutting hex pucks on a sled needs a real number rather
   than a conservative guess. Currently a shop-profile parameter with a cautious default.
2. **Guillotine search ordering.** Minimising tree depth minimises glue-ups, but the best search
   heuristic needs empirical tuning against real painted targets.
3. **Species data provenance.** Sugar maple appears as both 4.8/9.9 and 4.9/9.5 across sources.
   The spread is small, but the table carries a `provenance` field per row and the conflict
   should be recorded rather than averaged away
   ([KB-B03](01-woodworking-domain.md#kb-b03--species-movement-data)).

**Resolved since:** the **Old Line golden case (G4)**. Two fixtures were captured from the live
calculator and committed, so all five golden cases are now verified; it also settled that their
segment count is `ceil` rather than `round`, and that its squaring allowance sits on the opposite
side of the finished dimension from ours
([KB-A13](01-woodworking-domain.md#kb-a13--golden-case-4--old-lines-calculator-run-backwards)).

**Resolved during specification:** the `V-MOVE-010` movement threshold, which was the only
judgement-call number in the rule set. It is now derived and calibrated against named palettes in
[`04`](04-validation-rules.md#v-move--wood-movement), with a fixture table that pins the
behaviour.
