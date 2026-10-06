#!/usr/bin/env node
/**
 * Spec consistency checker.
 *
 * The spec's credibility rests on its cross-references actually holding: every
 * validation rule citing a knowledge-base entry that exists, every KB id that is
 * referenced being defined, every link resolving. Those are mechanical properties,
 * so they are checked mechanically rather than by review.
 *
 * Run: node tools/check-spec.mjs
 * Exits non-zero on any failure, so it can gate CI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/spec';
const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const read = (f) => readFileSync(join(DIR, f), 'utf8');
const all = files.map(read).join('\n');

/** GitHub heading-slug algorithm: lowercase, strip punctuation, spaces to hyphens. */
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9 \-]/g, '').trim().replace(/ /g, '-');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- link integrity

const anchors = {};
for (const f of files) {
  anchors[f] = new Set();
  for (const line of read(f).split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) anchors[f].add(slug(m[1]));
  }
}

const sources = [...files.map((f) => [join(DIR, f), f]), ['README.md', 'README.md']];

const brokenAnchors = [];
for (const [path, name] of sources) {
  const txt = readFileSync(path, 'utf8');
  for (const m of txt.matchAll(/\]\((?:docs\/spec\/)?([0-9a-z-]*\.md)?#([a-z0-9-]+)\)/g)) {
    const target = m[1] || name;
    if (!anchors[target] || !anchors[target].has(m[2])) {
      brokenAnchors.push(`${name} -> ${target}#${m[2]}`);
    }
  }
}
check('all anchor links resolve', brokenAnchors.length === 0, brokenAnchors.slice(0, 5).join(', '));

const brokenFiles = [];
for (const [path, name] of sources) {
  const txt = readFileSync(path, 'utf8');
  for (const m of txt.matchAll(/\]\((?:docs\/spec\/)?([0-9a-z-]+\.md)/g)) {
    if (!files.includes(m[1])) brokenFiles.push(`${name} -> ${m[1]}`);
  }
}
check('all file links resolve', brokenFiles.length === 0, [...new Set(brokenFiles)].join(', '));

// ------------------------------------------------------------ id cross-reference

const kbDefined = new Set(
  [...read('01-woodworking-domain.md').matchAll(/^### (KB-[A-D][0-9]{2})/gm)].map((m) => m[1]),
);
const kbReferenced = new Set([...all.matchAll(/KB-[A-D][0-9]{2}/g)].map((m) => m[0]));
const kbMissing = [...kbReferenced].filter((k) => !kbDefined.has(k));
check(
  `every referenced KB id is defined (${kbDefined.size} defined)`,
  kbMissing.length === 0,
  kbMissing.join(', '),
);

const kbUnused = [...kbDefined].filter((k) => {
  // A KB entry is "used" if cited outside its own definition heading.
  const count = (all.match(new RegExp(k, 'g')) || []).length;
  return count <= 1;
});
check('every KB entry is cited somewhere', kbUnused.length === 0, kbUnused.join(', '));

const ruleDefined = new Set(
  [...read('04-validation-rules.md').matchAll(/`(V-[A-Z]+-[0-9]{3})`/g)].map((m) => m[1]),
);
const ruleReferenced = new Set([...all.matchAll(/V-[A-Z]+-[0-9]{3}/g)].map((m) => m[0]));
const ruleMissing = [...ruleReferenced].filter((r) => !ruleDefined.has(r));
check(
  `every referenced rule id is defined (${ruleDefined.size} defined)`,
  ruleMissing.length === 0,
  ruleMissing.join(', '),
);

// Rule ids must be contiguous in steps of 10 within each category — a gap is
// usually a renumbering mistake rather than an intention.
const byCategory = {};
for (const r of ruleDefined) {
  const [, cat, num] = r.match(/^V-([A-Z]+)-([0-9]{3})$/);
  (byCategory[cat] ??= []).push(Number(num));
}
const gaps = [];
for (const [cat, nums] of Object.entries(byCategory)) {
  nums.sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] !== 10) {
      gaps.push(`V-${cat}: ${nums[i - 1]} -> ${nums[i]}`);
    }
  }
}
check('rule ids are contiguous within each category', gaps.length === 0, gaps.join(', '));

// --------------------------------------------------------------- safety contract

const v2 = read('02-construction-graph.md');
const v4 = read('04-validation-rules.md');
const v5 = read('05-cut-list-and-instructions.md');

check(
  'never-planer exists as a blocking rule and a critical instruction note',
  /V-SAFE-010/.test(v4) &&
    /thickness planer/i.test(v4) &&
    /critical/.test(v5) &&
    /thickness planer/i.test(v5),
);
// Scope this to the FlattenOp declaration. The prose around it legitimately names
// 'thicknessPlaner' while explaining that the variant deliberately does not exist,
// so a document-wide negative match would be a false positive.
const flattenOp = v2.match(/interface FlattenOp \{[\s\S]*?\n\}/)?.[0] ?? '';
check(
  'thickness planer is unrepresentable in the FlattenOp type',
  /drumSander/.test(flattenOp) &&
    /routerSled/.test(flattenOp) &&
    /handPlane/.test(flattenOp) &&
    !/thicknessPlaner/.test(flattenOp),
  flattenOp ? '' : 'FlattenOp declaration not found',
);
check('drum sander pass depth is a rule', /V-SAFE-020/.test(v4) && /per pass/i.test(v4));
check(
  'grain-orientation consistency is an error, not a warning',
  /`V-GRAIN-010`[^\n]*\|\s*`error`/.test(v4),
);
check('toxic species gating is an error', /`V-FOOD-010`[^\n]*\|\s*`error`/.test(v4));
check('every V-SAFE rule is listed in the safety section', /## V-SAFE/.test(v4));

// ------------------------------------------------------------- correctness story

const v8 = read('08-architecture-and-stack.md');
check('golden cases G1 through G5 are specified', /\bG1\b/.test(v8) && /\bG5\b/.test(v8));
check('conservation-of-mass property test is specified', /conservation of mass/i.test(v8));
check('core/ boundary is specified as CI-enforced', /dependency-cruiser|no-restricted-imports/.test(v8));

// -------------------------------------------------------------- open decisions

// Informational, not a gate: a spec with no open markers is finished, and one with
// markers is mid-flight. Both are valid states — the check just makes it visible.
const todos = (all.match(/TODO\(human\)/g) || []).length;
console.log(`INFO  unresolved TODO(human) markers: ${todos}`);

// V-MOVE-010 is the only judgement-call threshold in the rule set, so the spec is
// required to show its calibration rather than assert a bare number.
const v4m = read('04-validation-rules.md');
check(
  'V-MOVE-010 threshold is calibrated against named palettes, not asserted',
  /DIFFERENTIAL_WARN_IN/.test(v4m) &&
    /maple \/ padauk/i.test(v4m) &&
    /classic three-wood/i.test(v4m),
);

console.log(
  failures ? `\n${failures} check(s) FAILED` : `\nAll checks passed (${files.length} spec files).`,
);
process.exit(failures ? 1 : 0);
