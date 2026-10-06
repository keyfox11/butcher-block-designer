# References

Every source used in building this spec, grouped by topic, with **what each one established**.

A note on source quality. Woodworking knowledge is unevenly documented: physical properties come
from research lineages (the USDA Wood Handbook and its derivatives), while technique is largely
transmitted through forums, blogs, and video. Both are used here, and the confidence marks in
[`01-woodworking-domain.md`](01-woodworking-domain.md#how-this-document-is-used) distinguish them:
**[measured]** for published physical data, **[consensus]** for broad practitioner agreement,
**[derived]** for what we proved ourselves, and **[contested]** where sources genuinely disagree.

Where a forum thread is cited for a technique, it is because the same technique appears
consistently across independent sources — not because one post was persuasive.

---

## The reference tools

| Source | Established |
| --- | --- |
| [CBDJS — Cutting Board Designer JS](https://ericu.github.io/CBDJS/cb.html) · [source](https://github.com/ericu/CBDJS) | **The most important source.** Reading its single 30 KB `cb.html` gave us the complete data model (1-D layer list with `{wood, width, trailingAngle}`), the exact slice-count and leftover formulas, the `D × tan θ` angled-boundary math, and its "bad cut" validity check. Its published defaults became golden case G1. Its 1-D limitation is what motivated the construction-graph architecture. |
| [Old Line Woodcraft — End Grain Strips calculator](https://oldlinewoodcraft.com/toolbox/end-grain-strips) | The **"pitch"** concept — that stage-1 panel thickness is what each rotated segment contributes to the finished dimension. The **only source that runs the arithmetic backwards** (finished board → slab), which is why it became golden case G4: two fixtures were captured from the live tool and committed ([KB-A13](01-woodworking-domain.md#kb-a13--golden-case-4--old-lines-calculator-run-backwards)). That capture also established, beyond the published prose, that its segment count is `ceil` and silently overshoots the requested dimension, and that its squaring allowance is **added to the slab** where ours is subtracted from the grid. Also: the 1/8"-per-face cleanup allowance default, kerf handling, the two-direction planning model (plan-the-slab vs what-can-I-make), and the **1.5–2.5× end-grain material multiplier**. |
| [cuttingboarddesigner.app](https://cuttingboarddesigner.app/) | Competitive feature baseline: five templates, six built-in species, live 3-D, AR preview, kerf-aware cut list, cloud sync. Established what "table stakes" looks like. |
| [— 3D cube pattern guide](https://cuttingboarddesigner.app/blog/end-grain-3d-cube-pattern/) | The 60°-off-square geometry and the "60° from the table / 30° from vertical" equivalence; typical strip widths (0.75"–1.25"); species roles (light = lit face, mid = shadow, dark = darkest shadow); the row-by-row glue-up with 30-minute cures and why (lateral stress at 60° joints); the label-and-dry-fit discipline. |
| [— juice groove guide](https://cuttingboarddesigner.app/blog/juice-groove-cutting-board/) | 3/8" depth for end grain, 3/4"–1" inset, and the thickness implication (1.75"–2" minimum with a groove). |
| [cuttingboarddesigner.com](https://www.cuttingboarddesigner.com/) | Listed for completeness; the page returned no inspectable feature detail. |

## End-grain construction technique

| Source | Established |
| --- | --- |
| [This Old House — How to Make a Cube Cutting Board](https://www.thisoldhouse.com/kitchens/22713645/how-to-make-cube-cutting-board) | **The 3D cube cut list.** 6/4 stock planed to 1¼"–1⅜", blade at 60° to the table, three rhombus blanks glued into a six-sided prism, painter's tape as tension wrap, ~2" pucks cut oversize, pucks arranged so like species touch only at corners. This is what let us derive and verify the hexagonal-prism geometry (KB-A05). |
| [Fix This Build That — End Grain Cutting Board](https://fixthisbuildthat.com/how-to-make-end-grain-cutting-board-plans/) | The two-stage glue-up sequence; flattening the stage-1 panel before crosscutting; crosscut segment width becoming the finished thickness. |
| [DIY Montreal — Brick Pattern End Grain Board](https://www.diymontreal.com/brick-pattern-end-grain-cutting-board/) | The brick/running-bond offset approach. |
| [Woodworking Advisor — End Grain Patterns](https://woodworkingadvisor.com/end-grain-cutting-boards-patterns/) | Pattern catalogue breadth; the cut-and-rotate-at-45° basis of herringbone and pinwheel; the five-cut sled squaring method and why tessellating patterns demand it. |
| [Instructables — 3D End Grain Cutting Board](https://www.instructables.com/3D-End-Grain-Cutting-Board-1/) | Corroborating build sequence for the hex method. |
| [Inland Woodworkers — Q-Bert 3D board](https://inlandwoodworkers.org/wp-content/uploads/2020/01/Cutting-board-instructions.pdf) | Image-only PDF; no extractable text. Listed for completeness. |

## Flattening and machining

| Source | Established |
| --- | --- |
| [Woodworking for Amateurs — Why end grain dulls blades](https://blog.woodworkingforamateurs.com/end-grain-cutting-boards-why-they-dull-blades-and-how-to-mill-them-safely/) | **The planer prohibition** and its mechanism: the cutterhead attacks unsupported fibre ends, causing severe tearout, kickback risk, and rapid dulling. Router sled limited to 1/32" per pass. Became KB-A08, the one `critical` safety note. |
| [FineWoodworking — Planing end grain with a thickness planer](https://www.finewoodworking.com/forum/planing-end-grain-w-thickness-planer) | Corroborates the prohibition; documents the "technically possible but not recommended" position we chose not to encode. |
| [LumberJocks — End grain board flattening](https://www.lumberjocks.com/threads/end-grain-cutting-board-flattening.39892/) | The two acceptable methods and their trade-off: drum sander gives a finished surface but removes little per pass; router sled removes more but needs abrasive refinement. |

## Adhesives and clamping

| Source | Established |
| --- | --- |
| [Woodcraft — Best glue for end grain cutting boards](https://www.woodcraft.com/blogs/shop-knowledge-guides/what-glue-should-you-use-for-end-grain-cutting-boards) | Titebond III as the standard; FDA indirect food contact; **glue sizing for end grain** — halve the spread rate because end grain wicks glue and starves the joint. |
| [Titebond III product data](https://www.titebond.com/) | ~4,000 psi bond strength, Type I waterproof, long open assembly time, 45 °F minimum application temperature. |
| [WoodWeb — Adhesives and gluing methods for cutting boards](https://woodweb.com/knowledge_base/Adhesives_and_Gluing_Methods_for_Cutting_Boards.html) | Hardwood clamping pressure of **175–250 psi**; the glue-line-thickness relationship to movement; keeping glue and stock at a common temperature. The 175–250 figure is marked **[contested]** for cutting boards specifically, since many sound boards are built below it. |

## Wood movement and failure

| Source | Established |
| --- | --- |
| [Purdue Extension FNR-163 — Shrinking and swelling of wood](https://www.extension.purdue.edu/extmedia/fnr/fnr-163.pdf) | The three-axis movement model: tangential greatest, radial about half, **longitudinal 0.1–0.2% (negligible)**. The fibre-saturation-point basis of shrinkage coefficients (~28%). This is the basis of KB-B01, and therefore of the explanation for why end-grain boards move in two face directions while their thickness stays stable. |
| [Engineers Edge — Shrinkage values of domestic hardwoods](https://www.engineersedge.com/civil_engineering/shrinkage_values_of_domestic_hardwoods_9997.htm) | Per-species radial and tangential shrinkage percentages. |
| [Wikipedia — Janka hardness test](https://en.wikipedia.org/wiki/Janka_hardness_test) · [Bell Forest Products Janka chart](https://www.bellforestproducts.com/info/janka-hardness/) | Janka values for the species table. |
| [Sawmill Creek — Grain orientation in end grain cutting boards](https://sawmillcreek.org/threads/grain-orientation-in-end-grain-cutting-boards.211639/) · [LumberJocks — End grain boards grain direction](https://www.lumberjocks.com/threads/end-grain-cutting-boards-grain-direction.82713/) | **KB-B02, the counterintuitive rule:** keep ring orientation *consistent* in end-grain boards and never glue quartersawn to flatsawn. Appears consistently across independent threads. |
| [The Wood Whisperer — Avoiding cupped panels](https://thewoodwhisperer.com/articles/avoiding-cupped-panels/) | The *contrasting* practice for edge-grain panels — alternate ring direction so cupping cancels. Cited specifically to establish the contrast, since this is the advice users will misapply. |
| [Bevel and Bond — Vertical vs flat grain strips](https://bevelandbond.com/blogs/blog/vertical-grain-vs-flat-grain-strips-edge-grain-cutting-board) | Quartersawn moves roughly half as much as flatsawn; concrete per-species movement figures across a 12" width. |
| [Pickers Ridge — 7 common problems with end grain boards](https://pickersridge.com.au/7-common-problems-with-end-grain-cutting-boards/) | **KB-B05, the failure-mode table:** insufficient thickness, drying out in service, undried stock, poor joint cuts ("clamping pressure will not cure a poor cut"), mixed grain orientation, wrong adhesive, missing feet. |
| [The Wood Whisperer — Cutting Board Disaster](https://thewoodwhisperer.com/videos/cutting-board-disaster/) · [FineWoodworking — Walnut end-grain boards keep cracking](https://www.finewoodworking.com/forum/walnut-end-grain-cutting-boards-keep-cracking) | Glue-line failure under moisture cycling; why water enters end grain faster; the role of oiling as a buffer. |

## Food safety and finishing

| Source | Established |
| --- | --- |
| [Woodworker's Journal — Woods to avoid for cutting boards](https://www.woodworkersjournal.com/woods-avoid-making-cutting-boards/) | The avoid list: toxic species (yew, oleander, laburnum), high-allergen species (cocobolo), and the **[contested]** status of purpleheart. |
| [Turning Blanks — Food safe woods](https://www.turningblanks.net/blogs/education-center/food-safe-woods-which-wood-species-are-safe-for-kitchen-projects) | The safe list: hard maple, cherry, walnut, beech, sapele, teak. |
| [Oishya — Best wood for cutting boards](https://oishya.com/journal/what-wood-is-best-for-cutting-boards-butcher-blocks/) | The **~900–1800 lbf Janka window** — softer scars, harder dulls knives. Open-pore woods (red oak, ash) to avoid for hygiene rather than toxicity. |

## Dimensions and features

| Source | Established |
| --- | --- |
| [All Flavor Workshop — How to cut a juice groove](https://allflavorworkshop.com/how-to-cut-a-juice-groove-in-a-cutting-board/) | Juice groove depth range (3/8"–1/2"), width, inset, and the corner-radius interaction. |
| [Hardwood Lumber Co. — End grain board specs](https://hardwood-lumber.com/specialty-end-grain-cutting-board/) | Commercial end-grain board thickness conventions; groove dimensions in production use. |
| [John Boos cutting boards](https://www.johnboos.com/collections/cutting-boards) | Commercial reference for butcher-block proportions and thickness at the large end. |

## Material estimation

| Source | Established |
| --- | --- |
| [Cutlist Planner — Lumber calculator](https://cutlistplanner.com/lumber-calculator) | Board-foot formula; waste factors by stock grade (12–15% clear S4S, 18–20% typical, 25–30% rough-sawn). |
| [Board Foot Calculator — methodology](https://boardfootcalculator.net/calculation-methodology) | The `t × w × l / 144` formula and S2S/S4S surfacing allowances (4/4 yields ~13/16"). |
| [Woodcalcs — Lumber yield](https://woodcalcs.uk/timber-and-board/lumber-yield-calculator/) | The **65% default yield factor** from rough stock (50–70% range). |

## Implementation

| Source | Established |
| --- | --- |
| [Clipper2](https://github.com/AngusJohnson/Clipper2) | Integer-coordinate polygon booleans and offsetting. Chosen over float-based alternatives precisely because its integer coordinates match our `Ticks` model, which eliminates the coincident-edge sliver problem rather than requiring an epsilon heuristic to paper over it. |
| [fast-check](https://github.com/dubzzz/fast-check) | Property-based testing, used for the conservation-of-mass invariant that underpins the correctness story. |

---

## What we derived rather than cited

Marked **[derived]** in the knowledge base. These were worked out from geometry and verified
numerically, not taken from a source:

1. **The dimensional relationships** (KB-A02) — coordinate derivation of why board thickness
   comes from the crosscut, length from the pitch, and width straight through from the panel.
   Verified against CBDJS's published output (G1).
2. **The rhombus closure condition** (KB-A05) — `ripWidth = T / cos 30° = 1.1547 T`, and the
   consequence `hexAcrossFlats = 2T` *exactly*. Sources give the 60° angle; none states the rip
   width that makes the rhombus an actual rhombus, which is the thing that decides whether the
   hexagons close.
3. **The 3-rhombi-to-hexagon proof** — each rhombus contributes its 120° corner, `3 × 120° = 360°`.
4. **The oblique-prism consequences of a mitered crosscut** (KB-A07) — `1/cos μ` face shear and
   the resulting loss of grain perpendicularity. No reference tool models this.
5. **The end-grain movement asymmetry** (KB-B01) — that an end-grain board's *thickness* is
   stable (longitudinal) while both face dimensions move, which is the inverse of an edge-grain
   board and the structural explanation for most end-grain failures.
6. **The odd-column checkerboard problem** ([`07`](07-pattern-library.md#the-odd-column-problem)) —
   that rotating alternate slices 180° only offsets the pattern when the strip count is even, so
   odd counts require two inverted stage-1 panels.
7. **The free-rotation property of end-grain blocks** ([`07`](07-pattern-library.md#true-herringbone)) —
   that rotating a finished end-grain block 90° about its vertical axis preserves grain
   perpendicularity, which is what makes true multi-stage herringbone possible without mitering.
