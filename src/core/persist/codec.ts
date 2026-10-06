/**
 * Project files and shareable URLs.
 *
 * Two deliberate differences from CBDJS's share links, which are otherwise one
 * of its best features:
 *
 * 1. Versioned, so a link made today still opens after the schema changes.
 * 2. The shop profile is NOT included. A shared design re-validates against
 *    whoever opens it, so a board that fits an 18" drum sander correctly
 *    reports as too wide for a 16" one, and nobody inherits a stranger's kerf
 *    setting and gets a cut list systematically off by a 32nd per strip.
 *
 * A shared design is a DESIGN. The build plan is generated locally, by the
 * person who is going to cut the wood.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { EdgeTreatments, Graph, Project, SpeciesId } from '../model/types.js';
import { SCHEMA_VERSION } from '../model/types.js';

export class CodecError extends Error {}

/** Target for broad compatibility with chat clients and forum software. */
export const URL_LENGTH_BUDGET = 2000;

export interface SharePayload {
  readonly name: string;
  readonly measurementPrecision: number;
  readonly speciesPalette: readonly SpeciesId[];
  readonly edgeTreatments: EdgeTreatments;
  /**
   * A generated design encodes only its generator and parameters -- a dozen
   * numbers rather than a hundred nodes. Most shared links take this path and
   * land near 200 characters.
   */
  readonly generator?: { id: string; params: Readonly<Record<string, unknown>> };
  /** Only for a hand-edited graph that no generator can reproduce. */
  readonly graph?: Graph;
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

export function encodeShare(project: Project): string {
  const payload: SharePayload = {
    name: project.meta.name,
    measurementPrecision: project.meta.measurementPrecision,
    speciesPalette: project.speciesPalette,
    edgeTreatments: project.edgeTreatments,
    // Prefer the generator: regenerating from parameters is both far smaller
    // and keeps the design re-parameterisable after a round trip.
    ...(project.generator
      ? { generator: project.generator }
      : { graph: project.graph }),
  };

  const json = JSON.stringify(payload);
  const compressed = deflateSync(strToU8(json), { level: 9 });
  return `${SCHEMA_VERSION}.${base64UrlEncode(compressed)}`;
}

/**
 * The design lives in the hash fragment, never the path.
 *
 * GitHub Pages is a static host with no rewrite rules, so a deep link on a path
 * would 404 on refresh. A fragment is never sent to the server: it cannot 404,
 * it survives refresh and bookmarking, and it works on any static host with no
 * per-host configuration. It also keeps the payload out of server access logs.
 */
export function shareUrl(project: Project, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/#/d/${encodeShare(project)}`;
}

export function extractShareToken(url: string): string | null {
  const match = /#\/d\/([A-Za-z0-9._~-]+)/.exec(url);
  return match?.[1] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                    */
/* -------------------------------------------------------------------------- */

export function decodeShare(token: string): { version: number; payload: SharePayload } {
  const separator = token.indexOf('.');
  if (separator < 1) {
    throw new CodecError('This link appears incomplete — it is missing its version prefix.');
  }

  // The version sits OUTSIDE the compressed blob so a decoder can dispatch
  // before attempting to decompress.
  const version = Number(token.slice(0, separator));
  if (!Number.isInteger(version) || version < 1) {
    throw new CodecError('This link has an unrecognised version.');
  }
  if (version > SCHEMA_VERSION) {
    throw new CodecError(
      `This link was made with a newer version of the designer (v${version}; this is v${SCHEMA_VERSION}). ` +
        'Loading it could silently misread the design, so it is refused rather than guessed at.',
    );
  }

  let json: string;
  try {
    json = strFromU8(inflateSync(base64UrlDecode(token.slice(separator + 1))));
  } catch (error) {
    // A CodecError already carries a precise diagnosis, so it keeps it. Only an
    // unrecognised failure falls back to the generic message -- truncation by a
    // chat client being the expected cause.
    if (error instanceof CodecError) throw error;
    throw new CodecError('This link appears incomplete or corrupted — it may have been truncated.');
  }

  const payload = migrate(version, parseJson(json));
  assertValidPayload(payload);
  return { version, payload };
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new CodecError('This link does not contain a readable design.');
  }
}

/**
 * A decoded payload is untrusted input from a stranger, so it is checked before
 * it reaches the store. The alternative is letting a malformed link put the app
 * into an invalid state.
 */
function assertValidPayload(value: unknown): asserts value is SharePayload {
  if (typeof value !== 'object' || value === null) {
    throw new CodecError('This link does not contain a readable design.');
  }
  const p = value as Partial<SharePayload>;
  if (typeof p.name !== 'string') throw new CodecError('Shared design is missing its name.');
  if (!Array.isArray(p.speciesPalette)) {
    throw new CodecError('Shared design is missing its species.');
  }
  if (!p.generator && !p.graph) {
    throw new CodecError('Shared design contains neither a pattern nor a construction graph.');
  }
  if (p.graph && (typeof p.graph !== 'object' || !p.graph.nodes || !p.graph.output)) {
    throw new CodecError('Shared design has a malformed construction graph.');
  }
}

/* -------------------------------------------------------------------------- */
/* Migrations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Keyed by the version each one upgrades FROM.
 *
 * Pure and total, and tested against a committed fixture per historical
 * version so the oldest file in the wild stays covered.
 */
const MIGRATIONS: Record<number, (doc: unknown) => unknown> = {
  // v1 is current; the first entry arrives with v2.
};

export function migrate(fromVersion: number, doc: unknown): SharePayload {
  let current = doc;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      throw new CodecError(`No migration from schema v${v}; this link cannot be opened.`);
    }
    current = step(current);
  }
  return current as SharePayload;
}

/* -------------------------------------------------------------------------- */
/* Project files                                                               */
/* -------------------------------------------------------------------------- */

/** Human-readable and diffable on purpose: a project file in Git should review. */
export function serialiseProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function deserialiseProject(text: string): Project {
  const doc = parseJson(text) as Partial<Project>;
  if (typeof doc.schemaVersion !== 'number') {
    throw new CodecError('This file is not a butcher-block-designer project.');
  }
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new CodecError(
      `This project was saved by a newer version (v${doc.schemaVersion}; this is v${SCHEMA_VERSION}). ` +
        'A half-loaded cut list is more dangerous than a refusal, so it is not opened.',
    );
  }
  if (!doc.graph || !doc.meta || !doc.shopProfile) {
    throw new CodecError('This project file is missing required sections.');
  }
  return doc as Project;
}

/* -------------------------------------------------------------------------- */
/* base64url                                                                   */
/* -------------------------------------------------------------------------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Implemented directly so the codec works identically in Node and the browser. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64[c & 63];
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array {
  const lookup = new Map([...B64].map((ch, i) => [ch, i]));
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const value = lookup.get(ch);
    if (value === undefined) throw new CodecError(`Unexpected character "${ch}" in link.`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
