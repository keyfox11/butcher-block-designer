import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkerboard } from '../generators/checkerboard.js';
import { chevron, snakeSkin, spiral, stripes, zigZag } from '../generators/patterns.js';
import { DEFAULT_SHOP } from '../model/defaults.js';
import { createProject } from '../model/project.js';
import { SCHEMA_VERSION } from '../model/types.js';
import { degrees, inches } from '../units/ticks.js';
import {
  CodecError,
  URL_LENGTH_BUDGET,
  base64UrlDecode,
  base64UrlEncode,
  decodeShare,
  deserialiseProject,
  encodeShare,
  extractShareToken,
  serialiseProject,
  shareUrl,
} from './codec.js';

const WOODS = ['hard-maple', 'black-walnut'];

function generated() {
  const params = {
    cellSize: inches(1.5),
    speciesA: 'hard-maple',
    speciesB: 'black-walnut',
    columns: 8,
    rows: 10,
    boardThickness: inches(1.5),
  } as const;
  const { graph } = checkerboard(params, DEFAULT_SHOP);
  return createProject({
    name: 'maple/walnut checkerboard',
    graph,
    speciesPalette: WOODS,
    generator: { id: 'checkerboard', params: { ...params } },
  });
}

function handBuilt() {
  const { graph } = checkerboard(
    { cellSize: inches(1.5), speciesA: 'hard-maple', speciesB: 'black-walnut', columns: 8, rows: 10, boardThickness: inches(1.5) },
    DEFAULT_SHOP,
  );
  return createProject({ name: 'hand built', graph, speciesPalette: WOODS });
}

describe('share links', () => {
  it('round-trips a generated design', () => {
    const project = generated();
    const { payload } = decodeShare(encodeShare(project));
    expect(payload.name).toBe(project.meta.name);
    expect(payload.generator?.id).toBe('checkerboard');
    expect(payload.speciesPalette).toEqual(WOODS);
  });

  it('round-trips a hand-built graph', () => {
    const { payload } = decodeShare(encodeShare(handBuilt()));
    expect(payload.graph).toBeDefined();
    expect(Object.keys(payload.graph!.nodes).length).toBeGreaterThan(0);
  });

  it('omits the shop profile', () => {
    // A shared design re-validates against whoever opens it, so nobody
    // inherits a stranger's kerf and gets a cut list off by a 32nd per strip.
    const token = encodeShare(generated());
    expect(JSON.stringify(decodeShare(token).payload)).not.toMatch(/kerf|drumSander|clampForce/);
  });

  it('puts the design in the hash fragment, never the path', () => {
    // A static host has no rewrite rules, so a path deep-link 404s on refresh.
    const url = shareUrl(generated(), 'https://example.com/butcher-block-designer');
    expect(url).toContain('/#/d/');
    expect(extractShareToken(url)).toBe(encodeShare(generated()));
  });

  it('carries the version outside the compressed blob', () => {
    expect(encodeShare(generated()).startsWith(`${SCHEMA_VERSION}.`)).toBe(true);
  });
});

describe('URL size budget', () => {
  const PATTERNS: Array<[string, () => ReturnType<typeof stripes>]> = [
    ['stripes', () => stripes(WOODS, inches(1.5), 8, DEFAULT_SHOP)],
    ['zigZag', () => zigZag(WOODS, inches(1.5), 8, degrees(15), DEFAULT_SHOP)],
    ['chevron', () => chevron(WOODS, inches(1.5), 8, degrees(15), DEFAULT_SHOP)],
    ['snakeSkin', () => snakeSkin(WOODS, inches(1.5), 8, degrees(20), DEFAULT_SHOP)],
    ['spiral', () => spiral(WOODS, inches(1.5), 8, degrees(25), DEFAULT_SHOP)],
  ];

  it.each(PATTERNS.map(([n]) => n))('%s fits the 2000-character budget', (name) => {
    const make = PATTERNS.find(([n]) => n === name)![1];
    const { graph } = make();
    const project = createProject({
      name,
      graph,
      speciesPalette: WOODS,
      generator: { id: name, params: { count: 8 } },
    });
    const url = shareUrl(project, 'https://example.com/butcher-block-designer');
    expect(url.length).toBeLessThan(URL_LENGTH_BUDGET);
  });

  it('keeps a generator-backed link far smaller than a full graph', () => {
    // Regenerating from parameters is a dozen numbers rather than a hundred
    // nodes, which is why most shared links take that path.
    expect(encodeShare(generated()).length).toBeLessThan(encodeShare(handBuilt()).length / 2);
  });

  it('keeps even a full hand-built graph inside the budget', () => {
    expect(shareUrl(handBuilt(), 'https://example.com/bbd').length).toBeLessThan(URL_LENGTH_BUDGET);
  });
});

describe('decoding is strict', () => {
  it('rejects a truncated link with a specific message', () => {
    // Truncation by a chat client is the expected failure mode.
    const token = encodeShare(generated());
    expect(() => decodeShare(token.slice(0, token.length - 20))).toThrow(/incomplete|corrupted/);
  });

  it('rejects a link with no version prefix', () => {
    expect(() => decodeShare('notaversion')).toThrow(CodecError);
  });

  it('refuses a newer schema rather than guessing', () => {
    const token = encodeShare(generated());
    const bumped = `${SCHEMA_VERSION + 1}.${token.slice(token.indexOf('.') + 1)}`;
    expect(() => decodeShare(bumped)).toThrow(/newer version/);
  });

  it('rejects a payload with neither a pattern nor a graph', () => {
    // A decoded payload is untrusted input from a stranger.
    const project = { ...generated(), generator: undefined };
    const broken = { ...project, graph: undefined } as never;
    expect(() => decodeShare(encodeShare(broken))).toThrow(CodecError);
  });

  it('rejects unexpected characters', () => {
    expect(() => decodeShare('1.abc$def')).toThrow(/Unexpected character/);
  });
});

describe('project files', () => {
  it('round-trips', () => {
    const project = generated();
    const loaded = deserialiseProject(serialiseProject(project));
    expect(loaded.meta.name).toBe(project.meta.name);
    expect(loaded.shopProfile.kerf).toBe(project.shopProfile.kerf);
  });

  it('is human-readable and diffable', () => {
    expect(serialiseProject(generated())).toMatch(/\n {2}"meta": \{/);
  });

  it('refuses a newer schema rather than partially parsing', () => {
    // A half-loaded cut list is more dangerous than a refusal: it looks complete.
    const text = serialiseProject({ ...generated(), schemaVersion: SCHEMA_VERSION + 1 });
    expect(() => deserialiseProject(text)).toThrow(/newer version/);
  });

  it('rejects a file that is not a project', () => {
    expect(() => deserialiseProject('{"hello":"world"}')).toThrow(CodecError);
    expect(() => deserialiseProject('not json')).toThrow(CodecError);
  });
});

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (bytes) => {
        expect([...base64UrlDecode(base64UrlEncode(bytes))]).toEqual([...bytes]);
      }),
    );
  });

  it('emits only URL-safe characters', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(base64UrlEncode(bytes)).toMatch(/^[A-Za-z0-9_-]*$/);
      }),
    );
  });
});

describe('share round-trip (property)', () => {
  it('survives any generated design', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        (columns, rows, name) => {
          const params = {
            cellSize: inches(1.5),
            speciesA: 'hard-maple',
            speciesB: 'black-walnut',
            columns,
            rows,
            boardThickness: inches(1.5),
          } as const;
          const { graph } = checkerboard(params, DEFAULT_SHOP);
          const project = createProject({
            name,
            graph,
            speciesPalette: WOODS,
            generator: { id: 'checkerboard', params: { ...params } },
          });
          const { payload } = decodeShare(encodeShare(project));
          expect(payload.name).toBe(name);
          expect(payload.generator?.params).toEqual(params);
        },
      ),
      { numRuns: 30 },
    );
  });
});
