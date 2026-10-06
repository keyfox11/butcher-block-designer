/**
 * Project construction.
 *
 * The shop profile lives on the project but is replaced on load, so a shared
 * design re-validates against whoever opens it rather than inheriting a
 * stranger's kerf setting.
 */

import type { Graph, EdgeTreatments, Project, ShopProfile, SpeciesId } from './types.js';
import { SCHEMA_VERSION } from './types.js';
import { DEFAULT_MEASUREMENT_PRECISION, DEFAULT_SHOP } from './defaults.js';

export interface CreateProjectOptions {
  readonly name: string;
  readonly graph: Graph;
  readonly speciesPalette: readonly SpeciesId[];
  readonly shopProfile?: ShopProfile;
  readonly edgeTreatments?: EdgeTreatments;
  readonly generator?: { id: string; params: Readonly<Record<string, unknown>> };
  readonly now?: () => Date;
}

export function createProject(options: CreateProjectOptions): Project {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const base = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: options.name,
      created: timestamp,
      modified: timestamp,
      units: 'imperial' as const,
      measurementPrecision: DEFAULT_MEASUREMENT_PRECISION,
    },
    shopProfile: options.shopProfile ?? DEFAULT_SHOP,
    speciesPalette: options.speciesPalette,
    graph: options.graph,
    edgeTreatments: options.edgeTreatments ?? {},
  };
  return options.generator ? { ...base, generator: options.generator } : base;
}
