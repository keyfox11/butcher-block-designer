/**
 * The woodworking knowledge base, as data.
 *
 * Every validation rule cites an entry here, and every instruction template
 * interpolates from one. Keeping it as data rather than as prose scattered
 * through the code means a woodworker can audit it, a reviewer can check it
 * against sources, and correcting a figure corrects every warning and every
 * generated instruction that depends on it.
 *
 * Ids match docs/spec/01-woodworking-domain.md.
 */

export type KbId = string;

export type Confidence =
  /** Follows from geometry. Proven and numerically verified. */
  | 'derived'
  /** Published physical property. */
  | 'measured'
  /** Strong, consistent agreement across practice. */
  | 'consensus'
  /** Sources disagree. Present the disagreement rather than picking a side. */
  | 'contested';

export interface KbEntry {
  readonly id: KbId;
  readonly title: string;
  readonly confidence: Confidence;
  /** Short enough to render inside a finding without truncation. */
  readonly text: string;
  readonly sources: readonly string[];
}

function entry(e: KbEntry): KbEntry {
  return e;
}

export const KB: Readonly<Record<KbId, KbEntry>> = {
  'KB-A02': entry({
    id: 'KB-A02',
    title: 'The dimensional relationships',
    confidence: 'derived',
    text:
      'An end-grain board’s thickness comes from the crosscut slice width, not the stock thickness. ' +
      'The stock thickness becomes the pitch: each rotated slice contributes it to one finished face ' +
      'dimension. The stage-1 panel width passes straight through as the other.',
    sources: ['Old Line Woodcraft end-grain calculator', 'CBDJS source'],
  }),

  'KB-A06': entry({
    id: 'KB-A06',
    title: 'Angled layer boundaries (bevel-ripped strips)',
    confidence: 'derived',
    text:
      'A tilted blade shifts the cut sideways by thickness × tan(angle) as it crosses the stock, ' +
      'so a bevelled strip is a DIFFERENT width at each face. Checking only the fence setting misses ' +
      'a strip that tapers away inside the panel — which is not a risky cut but one the saw cannot ' +
      'make. Both faces must be checked; checking a single direction, as CBDJS does, lets a strip ' +
      'that opens at one face and closes at the other through.',
    sources: ['CBDJS source: trailing-angle layer model', 'Derived geometry'],
  }),

  'KB-A08': entry({
    id: 'KB-A08',
    title: 'Flattening: the hard safety gate',
    confidence: 'consensus',
    text:
      'Never run an end-grain glue-up through a thickness planer. The cutterhead strikes unsupported ' +
      'fibre ends and tears them out catastrophically, and the board can be seized and thrown. ' +
      'Flatten with a drum sander, or a router sled at no more than 1/32" per pass.',
    sources: [
      'Woodworking for Amateurs: why end grain dulls blades',
      'FineWoodworking forum: planing end grain',
    ],
  }),

  'KB-A09': entry({
    id: 'KB-A09',
    title: 'Squareness decides whether the board has gaps',
    confidence: 'consensus',
    text:
      'An out-of-square crosscut is the dominant cause of gapped end-grain glue-ups, and the error ' +
      'doubles when adjacent slices are flipped. Use a crosscut sled tuned with the five-cut method, ' +
      'not a miter gauge. Clamping pressure will not cure a poor cut — forcing a bad joint closed ' +
      'stores stress that reappears later as a split.',
    sources: ['Woodworking Advisor: end-grain patterns', 'Pickers Ridge: 7 common problems'],
  }),

  'KB-A10': entry({
    id: 'KB-A10',
    title: 'Glue: choice, sizing, and pressure',
    confidence: 'consensus',
    text:
      'Titebond III is the practical standard: waterproof, FDA-approved for indirect food contact, ' +
      'about 4,000 psi. End grain wicks glue away and starves the joint, so size it — a light coat, ' +
      'let it tack, then a second coat before clamping. Hardwoods want 175–250 psi of clamping ' +
      'pressure, though many sound boards are built below that; under-clamping usually shows as ' +
      'visible glue lines rather than outright failure.',
    sources: ['Woodcraft: glue for end-grain boards', 'WoodWeb: adhesives for cutting boards'],
  }),

  'KB-A11': entry({
    id: 'KB-A11',
    title: 'Glue-up sequencing for angled assemblies',
    confidence: 'consensus',
    text:
      'Joints that are not perpendicular to the clamping axis turn clamp pressure into lateral force, ' +
      'so pieces slide out of registration. Glue row by row with about 30 minutes between rows rather ' +
      'than clamping a full slab at once, and use cauls to keep faces coplanar.',
    sources: ['Cutting Board Designer: 3D cube pattern guide'],
  }),

  'KB-A12': entry({
    id: 'KB-A12',
    title: 'Material budget',
    confidence: 'consensus',
    text:
      'End-grain construction consumes 1.5–2.5× the lumber of an equivalent edge-grain board, ' +
      'because panel length is spent on slice width plus a kerf per slice. Board feet = ' +
      '(thickness × width × length) / 144. Expect roughly 65% usable yield from rough stock.',
    sources: ['Old Line Woodcraft', 'Cutlist Planner lumber calculator'],
  }),

  'KB-B01': entry({
    id: 'KB-B01',
    title: 'Why end-grain boards move the way they do',
    confidence: 'derived',
    text:
      'Wood barely moves along the grain (0.1–0.2%). In an end-grain board the grain runs through ' +
      'the thickness, so the thickness is remarkably stable while BOTH face dimensions move — the ' +
      'inverse of an edge-grain board. That is why these boards must be thick and why they crack more ' +
      'readily: they want to grow in two directions at once, with glue lines running both ways.',
    sources: ['Purdue Extension FNR-163: shrinking and swelling of wood'],
  }),

  'KB-B02': entry({
    id: 'KB-B02',
    title: 'Grain orientation must be consistent',
    confidence: 'consensus',
    text:
      'In edge-grain panels you alternate growth-ring direction so cupping cancels. In end-grain boards ' +
      'you must do the opposite: keep ring orientation consistent, and never glue a quartersawn face to ' +
      'a flatsawn one. Rotating a blank to end grain puts the tangential and radial axes in the face ' +
      'plane, so mixed orientation makes adjacent cells expand along different axes and shears the ' +
      'glue line between them.',
    sources: ['Sawmill Creek: grain orientation in end-grain boards', 'LumberJocks'],
  }),

  'KB-B04': entry({
    id: 'KB-B04',
    title: 'Seasonal movement',
    confidence: 'measured',
    text:
      'Movement = dimension × coefficient × moisture-content change. A 12" maple board cycling ' +
      '6% to 12% moves about 1/4" — which is normal, not a fault. Mixing species with very different ' +
      'coefficients puts a permanent differential strain across every glue line; the classic ' +
      'maple/walnut/cherry palette spans only 1.42:1, which is why it has held up for a century.',
    sources: ['Engineers Edge shrinkage values', 'Bevel and Bond: vertical vs flat grain'],
  }),

  'KB-B06': entry({
    id: 'KB-B06',
    title: 'Food safety',
    confidence: 'consensus',
    text:
      'Safe: hard maple, cherry, walnut, beech, sapele, teak. Avoid for hygiene: open-pore woods such ' +
      'as red oak and ash, which hold residue and stain. Avoid for toxicity or allergens: cocobolo, ' +
      'yew, oleander, laburnum. Finish with food-grade mineral oil — a 20-minute soak, wiped back, ' +
      'three times over 48 hours — then a 4:1 oil/beeswax paste. Never use nut-derived oils.',
    sources: ['Woodworker’s Journal: woods to avoid', 'Turning Blanks: food safe woods'],
  }),

  'KB-C01': entry({
    id: 'KB-C01',
    title: 'Thickness',
    confidence: 'consensus',
    text:
      'A finished end-grain board should be at least 1 1/2" thick, and 1 3/4"–2" if it carries a ' +
      'juice groove. Below 1 1/2" it lacks the section to resist splitting forces. Thickness is set by ' +
      'the crosscut, so it is cheap to add at design time and impossible to add later.',
    sources: ['Pickers Ridge: 7 common problems', 'Hardwood Lumber Co. specifications'],
  }),

  'KB-C02': entry({
    id: 'KB-C02',
    title: 'Juice groove',
    confidence: 'consensus',
    text:
      'For end grain: 3/8" deep, 3/4" wide, inset 3/4"–1" from the edge, and never deeper than 25% ' +
      'of the board thickness. The inset keeps the groove clear of the corner radius and leaves enough ' +
      'rim that the edge is not fragile. A groove cut into end grain exposes open fibre and needs ' +
      'extra oiling attention.',
    sources: ['All Flavor Workshop: cutting a juice groove', 'Cutting Board Designer'],
  }),

  'KB-C03': entry({
    id: 'KB-C03',
    title: 'Feet',
    confidence: 'consensus',
    text:
      'Rubber or silicone feet at four corners, fixed with stainless screws. Not cosmetic: they create ' +
      'an airflow gap so the underside does not sit in trapped moisture, which is a direct cause of ' +
      'cupping and splitting. Fix at corners only, never on a rail across the width, so the fixing ' +
      'does not fight seasonal movement.',
    sources: ['Pickers Ridge: 7 common problems'],
  }),

  'KB-C04': entry({
    id: 'KB-C04',
    title: 'Edge treatment',
    confidence: 'consensus',
    text:
      'Chamfer or round over all edges, especially the underside lift edges. Sharp end-grain arrises ' +
      'are fragile and chip. A chamfer can be cut on the table saw as a 45-degree bevel rip; a ' +
      'roundover or a juice groove needs a router.',
    sources: ['General practice'],
  }),

  'KB-C05': entry({
    id: 'KB-C05',
    title: 'Moisture content and acclimation',
    confidence: 'consensus',
    text:
      'Use kiln-dried or properly air-dried stock and let it acclimate in the shop before milling. Keep ' +
      'glue and wood at the same temperature through the glue-up. Stock still losing moisture will move ' +
      'after the board is finished, loading every joint — and that cannot be corrected later.',
    sources: ['Pickers Ridge: 7 common problems', 'WoodWeb: adhesives'],
  }),

  'KB-D01': entry({
    id: 'KB-D01',
    title: 'Table saw cut depth falls off with bevel',
    confidence: 'measured',
    text:
      'A tilted blade loses vertical reach. A typical 10" saw cuts 3 1/8" at 90 degrees but only ' +
      '2 1/4" at 45 — a ratio of 0.72, close to but not equal to the cosine model’s 0.707. ' +
      'Depth is interpolated between the two published points rather than computed from cos(bevel), ' +
      'because a saw’s real curve depends on its arbor and throat geometry, not on trigonometry. ' +
      'Here cosine happens to understate reach by about 2%; on another saw it could overstate it, ' +
      'and overstating a limit is the dangerous direction.',
    sources: ['Manufacturer specifications'],
  }),

  'KB-D02': entry({
    id: 'KB-D02',
    title: 'Table saw limits',
    confidence: 'consensus',
    text:
      'Bevel range 0–45 degrees. Minimum safe freehand rip width is about 3/8"–1/2"; anything ' +
      'narrower needs a jig or a sled. A design calling for a very narrow, long rip is not a risky cut ' +
      '— it is an instruction to do something unsafe.',
    sources: ['General shop practice'],
  }),

  'KB-D03': entry({
    id: 'KB-D03',
    title: 'Crosscut sled limits',
    confidence: 'consensus',
    text:
      'Capacity is bounded by fence-to-blade travel and rear clearance. Short workpieces — hex ' +
      'pucks in particular — need a stop block and a hold-down, and below a threshold the cut ' +
      'should be refused rather than attempted.',
    sources: ['General shop practice'],
  }),

  'KB-D04': entry({
    id: 'KB-D04',
    title: 'Drum sander limits',
    confidence: 'consensus',
    text:
      'Width is the binding constraint: a closed-end 16" sander cannot flatten an 18" board, while an ' +
      'open-end machine doubles capacity across two passes at the cost of a registration ridge. Remove ' +
      'about 1/64"–1/32" per pass; heavier passes burn end grain and load the belt.',
    sources: ['LumberJocks: end grain board flattening'],
  }),

  'KB-D05': entry({
    id: 'KB-D05',
    title: 'Clamp capacity',
    confidence: 'consensus',
    text:
      'A glue-up is bounded by clamp reach and by total available force. Required force is the target ' +
      'pressure times the joint area, and in a multi-piece glue-up that force passes through every ' +
      'joint at once.',
    sources: ['WoodWeb: adhesives and gluing methods'],
  }),
};

export function kb(id: KbId): KbEntry {
  const found = KB[id];
  if (!found) throw new Error(`Unknown knowledge-base entry: ${id}`);
  return found;
}
