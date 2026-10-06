# 00 — Overview

## The problem

End-grain cutting boards are made by a counterintuitive process. You glue up a striped panel
with the grain running *lengthwise*, crosscut that panel into slices, rotate every slice 90° so
the end grain faces up, and glue the slices back together. The pattern you see on the finished
board is not the pattern you glued up — it is the *cross-section* of what you glued up.

That indirection is why designing these boards by hand is error-prone, and why design tools
exist. It is also why those tools are limited.

## What's wrong with the existing tools

| Tool | Data model | Pattern expressiveness | Cut-list fidelity | Key limitation |
| --- | --- | --- | --- | --- |
| [cuttingboarddesigner.app](https://cuttingboarddesigner.app/) | Ordered stack of layers, each with width + angle | 5 templates (stripes, checkerboard, three-wood bands, diagonal accent, minimalist); flip/rotate alternate slices | Per-species dimensions, slice count, blade kerf | Layer-stack model; no multi-stage glue-ups, so no 3D cube and no true herringbone |
| [Old Line Woodcraft](https://oldlinewoodcraft.com/toolbox/end-grain-strips) | None — pure dimensional arithmetic | **No pattern model at all** | Excellent: slab dims, crosscut width, segment count, board feet, waste, kerf, cleanup allowance | Answers "what size slab do I need", never "what will it look like" |
| [CBDJS](https://ericu.github.io/CBDJS/cb.html) | 1-D list of layers: `{wood, width, trailingAngle}` | Checkerboard, zig-zag, spiral, snake skin via angled layer boundaries | Slices, leftover, per-species usage with kerf/scrap | 1-D model. Every slice is identical except an optional alternating flip/rotate |
| [cuttingboarddesigner.com](https://www.cuttingboarddesigner.com/) | Not inspectable | — | — | — |

They differ in polish, but they share one structural choice: **the design is the input and the
cut list is the output.** You describe a picture, and the tool works backward to guess at
material.

Two consequences follow, and both are serious.

**1. The cut list can disagree with the picture.** Nothing forces them to be consistent. The
picture is drawn by one code path and the numbers are computed by another.

**2. Whole families of real boards are inexpressible.** Here is the clearest case. The 3D
"tumbling block" board is one of the most sought-after end-grain patterns in woodworking. It is
built by bevel-ripping stock at 30° from vertical into three 60° rhombus sticks, gluing those
three sticks into a **regular hexagonal prism**, crosscutting that prism into pucks, and tiling
the pucks as a **honeycomb**. (Derived in full in [`01-woodworking-domain.md`](01-woodworking-domain.md).)

There is no grid in that process anywhere. A model built on rows and columns of rectangles
cannot describe it — not because the feature was skipped, but because the model has no vocabulary
for it.

### Evidence: CBDJS's complete output math

CBDJS is open source and a single 30 KB HTML file, which makes the limitation concrete rather
than inferred. This is the whole of its dimensional model:

```js
// slices that fit in the source panel's length
endgrainLayers = Math.floor(sourceLength / (endgrainThickness + kerf));
if (endgrainThickness * (endgrainLayers + 1) + endgrainLayers * kerf <= sourceLength) {
  ++endgrainLayers;
}
endgrainLength   = endgrainLayers * sourceThickness;   // finished board length
endgrainLeftover = sourceLength -
                   (endgrainLayers * endgrainThickness + (endgrainLayers - 1) * kerf);
boardWidth       = sum of layer widths;                // finished board width
```

The math is *correct*. We verified it reproduces its own published defaults exactly (see
[`01`](01-woodworking-domain.md#kb-a03--golden-case-1--cbdjs-defaults)). The limitation is not accuracy —
it is that a design is only ever "N horizontal bands."

## The thesis

> **Make the construction sequence the source of truth and derive the picture from it.**
> Then the cut list cannot be wrong, because the cut list *is* the design.

Instead of storing a picture, the tool stores the **sequence of physical operations** that
produces the board: mill this billet, rip it at these offsets with this bevel, glue these pieces
in this order, crosscut at this interval, rotate to end grain, glue again. The 2-D pattern and
the 3-D preview are *rendered from a simulation of that sequence*.

This buys four things at once:

- **Correctness by construction.** The cut list is a transcription of the operation graph, so it
  cannot drift from the picture. There is only one representation.
- **Expressiveness equal to reality.** Any board a woodworker can physically build is a sequence
  of these operations, so any such board is representable — grid or not.
- **Real buildability checking.** Because operations carry machine parameters, the tool can check
  them against an actual shop: blade height, bevel limit, sled capacity, drum sander width.
- **Instructions that are generated, not written.** A topological sort of the graph *is* the
  build order.

### Why the model is closed (the key insight)

Every intermediate workpiece in end-grain board making is a **prism** — an extrusion of a
species-partitioned 2-D polygon along an axis, with grain parallel to that axis. And the model
is closed under every operation that actually occurs:

| Stage | Cross-section | Extrusion length |
| --- | --- | --- |
| Stage-1 panel | (width × thickness) rectangle partitioned into strips | panel length `L` |
| Crosscut slice | unchanged | slice width `s` |
| **Rotate to end grain** | unchanged — *now reinterpreted as the board's face pattern* | `s` = board thickness |
| Stage-2 lamination | union of slice cross-sections placed side by side = the full face mosaic | `s` |

The rotation step is not a geometric transformation of the data at all. It is a
*reinterpretation* of which axis is "up". The polygon that was a cross-section becomes the face.

So: **the finished board's face pattern *is* the cross-section polygon, and its thickness *is*
the extrusion length.**

This model cannot represent a board whose pattern varies through its thickness — and no real
end-grain board does, because every piece in it runs from top face to bottom face. The model's
expressiveness is exactly equal to physical reality. Nothing buildable is excluded; nothing
unbuildable is admitted.

## Goals

1. **Trustworthy output above all.** Someone will take this cut list to a table saw with several
   hundred dollars of hardwood. Every number must be derivable, and every formula verified
   against a known result.
2. **Full creative freedom.** Arbitrary multi-stage patterns, angled and bevel-ripped geometry,
   non-grid tilings, and a free-paint mode for designs with no name.
3. **Honest buildability.** The tool knows what a table saw and a drum sander can do, and says
   plainly when a design exceeds them — rather than emitting a cut list that cannot be followed.
4. **Teach while it plans.** Surface *why* a rule exists (wood movement, glue-line shear, grain
   orientation) so the user ends up a better woodworker, not just a follower of steps.

## Non-goals

- **CNC/CAD export** (DXF, STEP, STL) and any pattern requiring CNC to build.
- **Cost estimation and lumber sourcing.** Board feet, yes; prices and vendors, no.
- **A general-purpose 3-D modeller.** The operation vocabulary is deliberately restricted to what
  a table saw, a sled, clamps, and a drum sander can do.
- **Edge-grain and face-grain boards as first-class citizens.** They fall out of the model for
  free (an edge-grain board is simply a stage-1 panel that is never crosscut), and will be
  supported — but the design effort targets end grain.

## Two user modes

**Guided.** Pick a pattern generator (checkerboard, brick, 3D cube, herringbone…), set
parameters, get a validated build. The generator emits an operation graph directly, so output is
guaranteed buildable. This is the common path and must be excellent.

**Free.** Paint a mosaic on the face canvas, or import an image and quantize it to a species
palette. A **decomposer** then searches for an operation graph that produces it. This is the
"wild designs" path. It is genuinely hard, it will not always succeed, and
[`07-pattern-library.md`](07-pattern-library.md) states its limits rather than overpromising:
when a target cannot be built, the tool reports *which regions* are the problem and offers the
nearest buildable snap.

## Assumed shop

Table saw with a crosscut sled, and a drum sander. **No router sled, no CNC.**

This is a constraint the spec leans into rather than apologises for. Because the tool knows the
tooling envelope, the validator can enforce real limits — for instance, maximum cut depth falls
off with bevel angle as `bladeMaxHeight × cos(bevel)`, which silently rules out some
otherwise-plausible designs. A tool that does not model this will happily tell you to make a cut
your saw cannot make.

## Next

[`01-woodworking-domain.md`](01-woodworking-domain.md) — the researched knowledge base that
everything else is built on top of.
