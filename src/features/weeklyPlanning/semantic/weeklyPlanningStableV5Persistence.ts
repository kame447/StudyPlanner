import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  parseWeeklyPlanningFactGraphV5,
  serializeWeeklyPlanningFactGraphV5,
  validateWeeklyPlanningFactGraphValueV5,
} from './weeklyPlanningFactGraphValidatorV5';

export const WEEKLY_PLANNING_STABLE_V5_ENVELOPE_VERSION =
  'weekly-planning-fact-graph-envelope-v5' as const;

export const WEEKLY_PLANNING_STABLE_V5_MIGRATION_VERSION =
  'weekly-planning-stable-v5-migration-v1' as const;

export interface WeeklyPlanningStableV5MigrationMetadata {
  sourceStateVersion: string;
  sourceSchemaVersion: string | null;
  sourceFactGraphVersion: string | null;
  migrationVersion: typeof WEEKLY_PLANNING_STABLE_V5_MIGRATION_VERSION;
  migratedAt: string;
}

export interface WeeklyPlanningStableV5PersistedEnvelope {
  envelopeVersion: typeof WEEKLY_PLANNING_STABLE_V5_ENVELOPE_VERSION;
  ownerId: string;
  graph: WeeklyPlanningFactGraphV5;
  migration: WeeklyPlanningStableV5MigrationMetadata;
}

export type WeeklyPlanningStableV5PersistenceErrorCode =
  | 'invalid-json'
  | 'not-object'
  | 'unknown-envelope-version'
  | 'owner-mismatch'
  | 'invalid-owner'
  | 'invalid-migration-metadata'
  | 'invalid-graph';

export interface WeeklyPlanningStableV5PersistenceError {
  code: WeeklyPlanningStableV5PersistenceErrorCode;
  details?: string[];
}

export interface WeeklyPlanningStableV5DecodeResult {
  envelope: WeeklyPlanningStableV5PersistedEnvelope | null;
  errors: WeeklyPlanningStableV5PersistenceError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateMigrationMetadata(
  value: unknown,
): value is WeeklyPlanningStableV5MigrationMetadata {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    'migratedAt',
    'migrationVersion',
    'sourceFactGraphVersion',
    'sourceSchemaVersion',
    'sourceStateVersion',
  ].sort();
  if (keys.join('|') !== expected.join('|')) return false;
  return isNonEmptyString(value.sourceStateVersion)
    && (value.sourceSchemaVersion === null || isNonEmptyString(value.sourceSchemaVersion))
    && (value.sourceFactGraphVersion === null
      || isNonEmptyString(value.sourceFactGraphVersion))
    && value.migrationVersion === WEEKLY_PLANNING_STABLE_V5_MIGRATION_VERSION
    && isIsoDateTime(value.migratedAt);
}

export function createWeeklyPlanningStableV5Envelope(params: {
  ownerId: string;
  graph: WeeklyPlanningFactGraphV5;
  sourceStateVersion: string;
  sourceSchemaVersion?: string | null;
  sourceFactGraphVersion?: string | null;
  migratedAt: string;
}): WeeklyPlanningStableV5PersistedEnvelope {
  if (!isNonEmptyString(params.ownerId)) throw new Error('ownerId is required.');
  if (!isNonEmptyString(params.sourceStateVersion)) {
    throw new Error('sourceStateVersion is required.');
  }
  if (!isIsoDateTime(params.migratedAt)) {
    throw new Error('migratedAt must be a canonical ISO timestamp.');
  }
  const graphValidation = validateWeeklyPlanningFactGraphValueV5(params.graph);
  if (!graphValidation.graph) {
    throw new Error(`Invalid WeeklyPlanningFactGraphV5: ${graphValidation.errors.join(',')}`);
  }
  return {
    envelopeVersion: WEEKLY_PLANNING_STABLE_V5_ENVELOPE_VERSION,
    ownerId: params.ownerId,
    graph: params.graph,
    migration: {
      sourceStateVersion: params.sourceStateVersion,
      sourceSchemaVersion: params.sourceSchemaVersion ?? null,
      sourceFactGraphVersion: params.sourceFactGraphVersion ?? null,
      migrationVersion: WEEKLY_PLANNING_STABLE_V5_MIGRATION_VERSION,
      migratedAt: params.migratedAt,
    },
  };
}

export function serializeWeeklyPlanningStableV5Envelope(
  envelope: WeeklyPlanningStableV5PersistedEnvelope,
): string {
  const validation = decodeWeeklyPlanningStableV5Envelope(
    JSON.stringify(envelope),
    envelope.ownerId,
  );
  if (!validation.envelope) {
    throw new Error(
      `Invalid Stable V5 envelope: ${validation.errors.map((error) => error.code).join(',')}`,
    );
  }
  serializeWeeklyPlanningFactGraphV5(envelope.graph);
  return JSON.stringify(envelope);
}

export function decodeWeeklyPlanningStableV5Envelope(
  content: string,
  expectedOwnerId: string,
): WeeklyPlanningStableV5DecodeResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { envelope: null, errors: [{ code: 'invalid-json' }] };
  }
  if (!isRecord(value)) return { envelope: null, errors: [{ code: 'not-object' }] };

  const errors: WeeklyPlanningStableV5PersistenceError[] = [];
  const keys = Object.keys(value).sort();
  const expectedKeys = ['envelopeVersion', 'ownerId', 'graph', 'migration'].sort();
  if (keys.join('|') !== expectedKeys.join('|')) {
    errors.push({ code: 'not-object', details: ['unexpected-envelope-keys'] });
  }
  if (value.envelopeVersion !== WEEKLY_PLANNING_STABLE_V5_ENVELOPE_VERSION) {
    errors.push({ code: 'unknown-envelope-version' });
  }
  if (!isNonEmptyString(value.ownerId)) {
    errors.push({ code: 'invalid-owner' });
  } else if (value.ownerId !== expectedOwnerId) {
    errors.push({ code: 'owner-mismatch' });
  }
  if (!validateMigrationMetadata(value.migration)) {
    errors.push({ code: 'invalid-migration-metadata' });
  }

  const graphResult = isRecord(value.graph)
    ? parseWeeklyPlanningFactGraphV5(JSON.stringify(value.graph))
    : { graph: null, errors: ['graph:not-object'] };
  if (!graphResult.graph) {
    errors.push({ code: 'invalid-graph', details: graphResult.errors });
  }

  return {
    envelope: errors.length === 0
      ? value as unknown as WeeklyPlanningStableV5PersistedEnvelope
      : null,
    errors,
  };
}
