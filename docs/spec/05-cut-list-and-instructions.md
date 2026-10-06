# 05 — Cut List, Allowances, and Build Instructions

Shop output. Everything here is **generated** from the construction graph by a topological
traversal — never hand-authored, never maintained in parallel with the picture.

## The allowance ledger

The most common way a cutting board comes out wrong is an allowance that was never written down.
Someone cuts slices at the finished thickness, flattens the board, and ends up 1/4" thin.

So allowances are not applied silently inside a formula. They are presented as an **auditable
ledger**: every finished dimension traces back to raw stock, one line at a time, with each line
naming its cause.

### Two directions, not one

A subtlety that the reference tools gloss over: dimensions come from two different places.

| Kind | Flows | Example |
| --- | --- | --- |
| **Pattern-driven** | Forward — the designer picks it, the finished size follows | Strip widths, cell sizes, slice count |
| **Allowance-driven** | Backward — the finished target is fixed, the cut dimension follows | Crosscut slice width, panel length, rough stock |

The ledger shows both directions explicitly, because conflating them is what produces
"why is my board 11⅞ when I asked for 12?"

### Worked example

A 12" × 15" × 1.5" maple/walnut checkerboard with 1.5" cells:

```
THICKNESS                                    (allowance-driven, backward)
  target finished thickness                     1.500"
  + flattening, 2 faces × 1/8"                 +0.250"   [KB-A08]
  ────────────────────────────────────────────────────
  CUT SLICES AT                               = 1.750"

WIDTH                                        (pattern-driven, forward)
  8 strips × 1.500"                            12.000"
  stage-1 panel width                         = 12.000"
  − squaring trim, 2 edges × 1/16"              −0.125"
  ────────────────────────────────────────────────────
  finished width                              = 11.875"

LENGTH                                       (pattern-driven, via the pitch)
  10 slices × panel thickness 1.500"           15.000"   [KB-A02]
  − end trim, 2 ends × 1/16"                    −0.125"
  ────────────────────────────────────────────────────
  finished length                             = 14.875"

STAGE-1 PANEL LENGTH                         (allowance-driven, backward)
  10 slices × 1.750"                           17.500"
  + 9 internal kerfs × 0.125"                  + 1.125"   [KB-A02]
  + end trim allowance                         + 0.500"
  ────────────────────────────────────────────────────
  PANEL MUST BE AT LEAST                      = 19.125"

STOCK PER SPECIES                            (backward)
  maple:  4 strips × 1.500" wide, 19.125" long, 1.500" thick
          + 4 rip kerfs × 0.125"              = 6.500" of board width
          + milling allowance                  ...
          ÷ yield factor 0.65                  → board feet to buy   [KB-A12]
```

### Cell-exact vs size-exact

Notice the example asked for 12" × 15" and produced 11.875" × 14.875". That is correct — the trim
has to come from somewhere — but it is not always what the user wants. So the tool offers both,
as an explicit choice rather than a silent default:

| Mode | Behaviour | Cost |
| --- | --- | --- |
| **Cell-exact** (default) | Strip widths stay round (1.5"). Finished size lands where it lands. | Finished dimensions are not round numbers |
| **Size-exact** | Finished size is exactly as requested. Strip widths are solved backward. | Strip widths become awkward fractions — 12.125" ÷ 8 = 1.515625" |

Size-exact mode runs `V-TOL-020` ([`04`](04-validation-rules.md#v-tol--tolerance)) and warns when
a solved dimension is not achievable at the user's measurement precision. Telling someone to rip
to 1.515625" without comment would be worse than useless.

Default is cell-exact, because round strip widths are easier to cut accurately and
accumulated-error risk is lower — and because a board that is 11⅞" instead of 12" bothers nobody
once it is in a kitchen.

## Cut list

```ts
interface CutList {
  /** What to buy, per species. */
  purchase: PurchaseLine[];
  /** What to mill, per species. */
  milling: MillingLine[];
  /** Every piece to cut, grouped by the operation that produces it. */
  pieces: PieceGroup[];
  /** The allowance ledger above, as structured data. */
  ledger: LedgerSection[];
  /** Totals, waste, and the end-grain multiplier sanity check. */
  summary: MaterialSummary;
}

interface PieceGroup {
  fromNode: NodeId;
  operation: string;          // "Rip maple panel into strips"
  pieces: Array<{
    pieceId: PieceId;         // "M-03" — matches the assembly map label
    species: SpeciesId;
    /** Rounded to measurement precision, with the rounding error alongside. */
    dims: { thickness: Dimension; width: Dimension; length: Dimension };
    quantity: number;
    /** The number to set on the machine, not an abstract coordinate. */
    machineSetting: MachineSetting;
  }>;
}
```

### Machine settings, not coordinates

The cut list reports **what to set the machine to**, which is not the same as the geometry
([`03`](03-geometry-engine.md#rip--and-why-the-cut-list-reports-fence-settings)):

```ts
type MachineSetting =
  | { machine: 'tablesaw-rip'; fenceSetting: Dimension; bevel: Angle;
      /** Required when bevel ≠ 0 — gets this wrong and the pattern mirrors. */
      bladeTiltDirection: 'away-from-fence' | 'toward-fence';
      /** Both faces, because a bevelled strip has two different widths. */
      widthAtTableFace: Dimension; widthAtTopFace: Dimension }
  | { machine: 'sled-crosscut'; stopBlockSetting: Dimension; miter: Angle; bevel: Angle }
  | { machine: 'drum-sander'; targetThickness: Dimension; passCount: number; perPass: Dimension };
```

The `bladeTiltDirection` field is not padding. Standard safe practice tilts the blade away from
the fence so the workpiece is not trapped, and for the 3D cube a mirrored rhombus means the
illusion does not appear at all
([KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)). A
cut list that omits the direction has a 50% chance of producing the wrong board.

## Build instructions

Generated by topological sort, then grouped into phases a woodworker recognises:

| Phase | Contents |
| --- | --- |
| 0 — Prepare | Stock check, moisture content, acclimation, tool setup, five-cut sled squaring |
| 1 — Mill | Flatten, square, dimension each species |
| 2 — Stage-1 glue-up | Rip strips, dry fit, label, glue panel, flatten panel |
| 3 — Crosscut | Square the panel, crosscut slices, label every slice |
| 4 — Stage-2 glue-up | Arrange, dry fit, glue, clamp |
| 5 — Flatten & square | Drum sander passes, trim to final |
| 6 — Features | Juice groove, chamfer, feet |
| 7 — Finish | Sanding progression, oiling schedule, care instructions |

```ts
interface Step {
  number: number;
  phase: Phase;
  title: string;
  body: string;                 // rendered from a template + KB entries
  machineSetting?: MachineSetting;
  piecesIn: PieceId[];
  piecesOut: PieceId[];
  /** Blocking safety notes. Rendered prominently; cannot be collapsed. */
  safety: SafetyNote[];
  /** Cure times, acclimation waits — shown as a timeline. */
  wait?: { duration: string; reason: string };
  /** A verification the builder should perform before continuing. */
  checkpoint?: string;
  /** KB entries backing this step, so the step carries its own rationale. */
  cites: KbId[];
}
```

### Templates, not prose

Instruction text is rendered from templates that pull from the knowledge base, so woodworking
knowledge lives in exactly one place
([`01`](01-woodworking-domain.md#how-this-document-is-used)):

```
TEMPLATE glue-endgrain:
  Apply {glue.name} to all mating faces. {kb:A10.sizing}
  Clamp to approximately {pressure} psi — about {clampsNeeded} clamps at
  {clampForceEach} lbf across {jointArea} in² of joint.
  {if sequence == rowByRow} {kb:A11.rowByRow} {endif}
  Cure {glue.cureTime} before unclamping.
```

Change the sizing guidance in KB-A10 and every generated instruction updates. Nothing has to be
found and edited in a renderer.

### Checkpoints

Steps that gate on a verification, because the cost of discovering the problem later is high:

- *Before crosscutting:* "Verify the panel is flat and the ends are square. An out-of-square
  crosscut is the dominant cause of gapped end-grain glue-ups, and the error doubles when adjacent
  slices are flipped." — [KB-A09](01-woodworking-domain.md#kb-a09--squareness-crosscuts-decide-whether-the-board-has-gaps)
- *Before any glue-up:* "Dry fit the complete assembly and confirm it matches the assembly map.
  Label every piece." — [KB-A05](01-woodworking-domain.md#kb-a05--the-hexagonal-prism-method-3d-tumbling-block)
- *Before stage-2:* "Confirm growth-ring orientation is consistent across all slices." —
  [KB-B02](01-woodworking-domain.md#kb-b02--grain-orientation-must-be-consistent-the-counterintuitive-rule)
- *Before milling:* "Confirm stock is acclimated and at stable moisture content." —
  [KB-C05](01-woodworking-domain.md#kb-c05--moisture-content-and-acclimation)

### Safety notes

```ts
interface SafetyNote {
  kbId: KbId;
  severity: 'critical' | 'important';
  text: string;
}
```

`critical` notes are rendered as blocking callouts in both the UI and the printed output, and
cannot be collapsed or suppressed. There is exactly one `critical` note in the default set:

> **Do not run this board through a thickness planer.** End grain tears out catastrophically and
> the board can be seized and thrown. Flatten with a drum sander, taking no more than
> {removalPerPass} per pass. — KB-A08

It is attached automatically to every flattening step downstream of a `reorient` node. No design
can omit it, because it is derived from the graph rather than authored into a template.

## Assembly maps

For anything beyond a simple checkerboard, the cut list is not enough. A multi-stage glue-up has
dozens of near-identical pieces whose *orientation* carries the pattern, and getting one slice
flipped the wrong way ruins the board after the glue is already on.

So each glue-up step gets a printable **assembly map**:

```ts
interface AssemblyMap {
  nodeId: NodeId;
  stageLabel: string;              // "Stage 2 — slice layout"
  /** Scaled SVG of the assembly, viewed as the builder will see it on the bench. */
  svg: string;
  pieces: Array<{
    pieceId: PieceId;              // "S-07", matching the cut list
    species: SpeciesId;
    position: { x: Ticks; y: Ticks };
    /** Grain/ring direction arrow — the thing most easily got wrong. */
    orientationArrow: Angle;
    flipped: boolean;
    rotated180: boolean;
    /** Which end of the piece faces the reference edge. */
    referenceMark: 'top' | 'bottom' | 'left' | 'right';
  }>;
  /** Where the clamps go and which direction they pull. */
  clampPlan: ClampPlan;
}
```

Design requirements:

- **Printed at a stated scale**, with a scale bar, so it can be laid on the bench next to the parts.
- **Every piece labelled** with the same id as the cut list. One naming scheme throughout.
- **Orientation arrows on every piece**, not just the ones that differ. A map where only
  exceptions are marked relies on the builder noticing an absence.
- **Flip and rotate shown as distinct marks.** They are different operations with different
  results, and conflating them is a common source of mirrored patterns.
- **Clamp plan included**, with direction. For angled assemblies this is load-bearing advice:
  clamp pressure on a non-perpendicular joint converts to lateral force and the pieces slide
  ([KB-A11](01-woodworking-domain.md#kb-a11--glue-up-sequencing-for-angled-assemblies)).

### The dry-fit discipline

Lifted directly from documented 3D-cube practice, where it is the difference between success and
an expensive pile of firewood:

1. Label every piece before any glue is opened.
2. Dry fit the full assembly and compare against the map.
3. For angled assemblies, glue **row by row** with ~30 minutes between rows rather than clamping
   the whole slab at once.

These become generated steps, not advice in a sidebar.

## Printed output

Target: a woodworker prints this, carries it to the shop, and never needs the screen again.

| Section | Contents |
| --- | --- |
| Cover | Design name, finished dimensions, 2-D pattern, 3-D view, species legend |
| Shopping list | Board feet per species with yield factor applied, suggested board sizes |
| Allowance ledger | The full backward trace, so every number can be checked |
| Cut list | Grouped by operation, with machine settings |
| Instructions | Numbered steps with safety callouts, checkpoints, and cure timeline |
| Assembly maps | One page per glue-up stage, to scale |
| Care sheet | Oiling schedule and maintenance, suitable for giving away with a gifted board |

Rendered as paged HTML with a dedicated print stylesheet, printed to PDF by the browser — no PDF
library ([`08`](08-architecture-and-stack.md), [`09`](09-exports.md)).

Practical print requirements that are easy to get wrong and annoying in a shop:

- Black on white, high contrast. Shop lighting is bad and printers are often monochrome.
- Species distinguished by **hatch pattern as well as colour**, so a greyscale print stays readable.
- Large type for machine settings. These are read at arm's length next to a running saw.
- Page breaks never split a step or an assembly map.
- Warnings printed with their findings, so a design exported with warnings carries them along.

## Next

[`06-design-surface-ux.md`](06-design-surface-ux.md) — the interface that drives all of this.
