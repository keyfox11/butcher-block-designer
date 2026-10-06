import { describe, expect, it } from 'vitest';
import { evaluate } from '../geometry/evaluate.js';
import { tumblingBlock } from '../generators/tumbling.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import type { Graph, RipOp, ShopProfile } from '../model/types.js';
import { degrees, inches, ticks } from '../units/ticks.js';
import { RULES } from './rules.js';
import { validate } from './validate.js';

const SHOP: ShopProfile = DEFAULT_SHOP;

function cube(overrides: Partial<Parameters<typeof tumblingBlock>[0]> = {}) {
  return tumblingBlock(
    {
      stockThickness: inches(1.25),
      speciesTop: 'hard-maple',
      speciesLeft: 'black-walnut',
      speciesRight: 'cherry',
      targetWidth: inches(10),
      targetLength: inches(14),
      boardThickness: inches(1.5),
      ...overrides,
    },
    SHOP,
  );
}

function check(graph: Graph) {
  const evaluated = evaluate(graph, SHOP);
  const project = createProject({
    name: 'cube',
    graph,
    speciesPalette: ['hard-maple', 'black-walnut', 'cherry'],
    shopProfile: SHOP,
  });
  return validate({ project, evaluated, shop: SHOP }).findings;
}

function ids(findings: readonly { ruleId: string }[]): string[] {
  return [...new Set(findings.map((f) => f.ruleId))];
}

describe('a correct tumbling block', () => {
  it('raises no geometry errors', () => {
    const findings = check(cube().graph).filter(
      (f) => f.severity === 'error' && f.ruleId.startsWith('V-GEOM'),
    );
    expect(findings).toEqual([]);
  });

  it('raises no grain errors: every piece is end grain and squarely crosscut', () => {
    const findings = check(cube().graph).filter(
      (f) => f.severity === 'error' && f.ruleId.startsWith('V-GRAIN'),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * V-GEOM-050 is tested against a fabricated hexagon rather than against a
 * mis-generated one, and the reason is worth recording.
 *
 * Breaking the rip width in the real graph does not reach this rule: the union
 * in `laminateFree` refuses first, because three rhombi that are not 60° rhombi
 * do not close and the assembly comes apart into disconnected pieces. That is
 * the better failure -- it is exact, and it fires on any error larger than the
 * weld radius.
 *
 * What survives for this rule is the band underneath: a hexagon that closes
 * with ITSELF but disagrees with the stock it was cut from. That is not a
 * hypothetical. It is exactly what happened when the generator rounded
 * `T x tan(30)` instead of `T / cos(30)` -- the hexagon assembled perfectly and
 * came out two ticks wide. It also becomes the primary guard the moment graphs
 * can be edited by hand.
 */
describe('V-GEOM-050 — hex closure', () => {
  const RULE = RULES.find((r) => r.id === 'V-GEOM-050')!;

  /** A hexagon of the given across-flats, from three parallelograms of height T. */
  function hexContext(acrossFlats: number, stockThickness: number) {
    const F = acrossFlats;
    const C = (2 / Math.sqrt(3)) * F;
    const hexagon = [
      { x: 0, y: Math.round(C / 4) },
      { x: Math.round(F / 2), y: 0 },
      { x: F, y: Math.round(C / 4) },
      { x: F, y: Math.round((3 * C) / 4) },
      { x: Math.round(F / 2), y: Math.round(C) },
      { x: 0, y: Math.round((3 * C) / 4) },
    ];
    const rhombus = [
      { x: 0, y: 0 },
      { x: Math.round(F / Math.sqrt(3)), y: 0 },
      { x: Math.round(F / Math.sqrt(3)) + stockThickness, y: stockThickness },
      { x: stockThickness, y: stockThickness },
    ];

    const piece = (outline: typeof hexagon) => ({
      crossSection: {
        outline,
        faces: [
          { polygon: outline, species: 'hard-maple', pieceId: 'p', ringOrientation: 'quartersawn' as const },
        ],
      },
      length: inches(1.5),
      orientation: 'longGrain' as const,
      producedBy: 'stick',
    });

    const members = [0, 1, 2].map((i) => ({
      piece: { node: 'stick', port: i },
      offset: { x: ticks(0), y: ticks(0) },
      rotate: degrees(0),
      mirrored: false,
    }));

    const graph = {
      nodes: {
        hex: {
          id: 'hex',
          op: { kind: 'laminate' as const, members, placement: 'free' as const, sequence: 'simultaneous' as const },
        },
      },
      output: { node: 'hex', port: 0 },
    };

    return {
      project: { graph } as never,
      shop: SHOP,
      evaluated: {
        nodeOutputs: new Map([
          ['hex', [piece(hexagon)]],
          ['stick', [piece(rhombus), piece(rhombus), piece(rhombus)]],
        ]),
        memberPlacements: new Map(),
      } as never,
    };
  }

  it('is quiet when the hexagon is exactly 2T across the flats', () => {
    const T = inches(1.25);
    expect(RULE.check(hexContext(2 * T, T))).toEqual([]);
  });

  it('tolerates the arithmetic floor of a tick or two', () => {
    const T = inches(1.25);
    expect(RULE.check(hexContext(2 * T + 2, T))).toEqual([]);
  });

  it('fires once the hexagon disagrees with its stock by more than a 64th', () => {
    const T = inches(1.25);
    // The mistake a builder makes: ripping at T rather than at T / cos(30°),
    // which gives a hexagon of T x sqrt(3) rather than 2T.
    const findings = RULE.check(hexContext(Math.round(T * Math.sqrt(3)), T));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.message).toMatch(/across the flats/);
    // The remedy names the fence setting to use, not just that something is wrong.
    expect(findings[0]!.remedy).toMatch(/1 29\/64|1 7\/16/);
  });

  it('ignores an ordinary three-strip panel, which is not a hexagon attempt', () => {
    // Guarded by the six-corner test: a three-strip panel is a quadrilateral.
    expect(check(cube().graph).filter((f) => f.ruleId === 'V-GEOM-050')).toEqual([]);
  });
});

describe('the union refuses a broken hexagon before validation runs', () => {
  it('reports disconnected pieces when the rhombi are not rhombi', () => {
    const { graph } = cube();
    const nodes = Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => {
        if (node.op.kind !== 'rip') return [id, node];
        const op: RipOp = {
          ...node.op,
          // T rather than T / cos(30°): 13% narrow, so three of them cannot close.
          strips: node.op.strips.map((s, i) => (i === 0 ? s : { ...s, width: inches(1.25) })),
        };
        return [id, { ...node, op }];
      }),
    );
    expect(() => evaluate({ ...graph, nodes }, SHOP)).toThrow(/disconnected/);
  });
});

describe('V-GEOM-060 — the ragged honeycomb border', () => {
  it('fires when nothing squares the honeycomb up', () => {
    const { graph } = cube();
    // Take the board straight off the honeycomb, with no trim.
    const honeycomb = Object.values(graph.nodes).find(
      (n) => n.op.kind === 'laminate' && n.op.members.length > 3,
    )!;
    const findings = check({ ...graph, output: { node: honeycomb.id, port: 0 } });
    const ragged = findings.filter((f) => f.ruleId === 'V-GEOM-060');
    expect(ragged).toHaveLength(1);
    expect(ragged[0]!.remedy).toMatch(/trim through|border strips|whole number/);
  });

  it('is quiet once a trim resolves it', () => {
    expect(check(cube().graph).filter((f) => f.ruleId === 'V-GEOM-060')).toEqual([]);
  });

  it('is quiet for growToWhole, which still trims', () => {
    const { graph } = cube({ edgeResolution: 'growToWhole' });
    expect(check(graph).filter((f) => f.ruleId === 'V-GEOM-060')).toEqual([]);
  });
});

describe('V-GEOM-040 — a glue-up with no clamping axis', () => {
  it('fires when a honeycomb asks to be clamped all at once', () => {
    const { graph } = cube();
    const nodes = Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => {
        if (node.op.kind !== 'laminate' || node.op.members.length <= 3) return [id, node];
        return [id, { ...node, op: { ...node.op, sequence: 'simultaneous' as const } }];
      }),
    );
    const findings = check({ ...graph, nodes }).filter((f) => f.ruleId === 'V-GEOM-040');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.remedy).toMatch(/row by row|tape/);
  });

  it('is quiet when the honeycomb is glued row by row, as the generator asks', () => {
    expect(check(cube().graph).filter((f) => f.ruleId === 'V-GEOM-040')).toEqual([]);
  });

  it('is quiet for a hex prism, whose three rhombi do have a clamping axis', () => {
    // The prism is simultaneous and free-placed, but its three members are not
    // spread in two directions in a way that needs sequencing -- it is taped.
    const findings = check(cube().graph).filter((f) => f.ruleId === 'V-GEOM-040');
    expect(findings).toEqual([]);
  });
});

describe('V-GRAIN-020 — mitered crosscuts', () => {
  it('warns, and explains what the miter costs', () => {
    const { graph } = cube();
    const nodes = Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => {
        if (node.op.kind !== 'crosscut') return [id, node];
        return [id, { ...node, op: { ...node.op, miter: degrees(15) } }];
      }),
    );
    const findings = check({ ...graph, nodes }).filter((f) => f.ruleId === 'V-GRAIN-020');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe('warning');
    expect(findings[0]!.message).toMatch(/self-healing/);
    expect(findings[0]!.remedy).toMatch(/multi-stage/);
  });

  it('is quiet for a square crosscut', () => {
    expect(check(cube().graph).filter((f) => f.ruleId === 'V-GRAIN-020')).toEqual([]);
  });
});

describe('the new rules do not fire on the patterns that already worked', () => {
  it('leaves the tumbling block with a clean error list', () => {
    const errors = check(cube().graph).filter((f) => f.severity === 'error');
    expect(ids(errors)).toEqual([]);
  });
});
