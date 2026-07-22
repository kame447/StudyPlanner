import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';

export const WEEKLY_PLANNING_PERSONALIZATION_SCHEMA_VERSION = 2;
export const WEEKLY_PLANNING_PLACEMENT_FEATURE_VERSION = 'placement-features-v1' as const;
export const WEEKLY_PLANNING_PLACEMENT_WEIGHT_VERSION = 'placement-weights-v1' as const;

export type WeeklyPlanningPersonalizationConfidence =
  | 'confirmed'
  | 'high'
  | 'medium'
  | 'low';

export type WeeklyPlanningPersonalizationOrigin =
  | 'user_confirmed'
  | 'plan_actual_summary'
  | 'conversation_summary'
  | 'system_default';

export type WeeklyPlanningPersonalizationScope =
  | { kind: 'global' }
  | { kind: 'subject'; key: string }
  | { kind: 'task'; key: string };

export interface WeeklyPlanningPersonalizationFact<T> {
  value: T;
  origin: WeeklyPlanningPersonalizationOrigin;
  confidence: WeeklyPlanningPersonalizationConfidence;
  scope: WeeklyPlanningPersonalizationScope;
  updatedAt: string;
  confirmedAt?: string;
  expiresAt?: string;
  sourceRef?: {
    kind: 'explicit_setting' | 'plan_actual_pair' | 'derived_summary';
    id?: string;
  };
}

export const WEEKLY_PLANNING_PLACEMENT_FEATURE_IDS = [
  'completion_affinity',
  'start_delay_penalty',
  'interruption_penalty',
  'reschedule_penalty',
  'time_band_affinity',
  'weekday_affinity',
  'session_length_affinity',
  'transition_cost',
  'sleep_proximity_penalty',
  'workload_density_penalty',
  'subject_affinity',
] as const;
export type WeeklyPlanningPlacementFeatureId =
  (typeof WEEKLY_PLANNING_PLACEMENT_FEATURE_IDS)[number];

export interface WeeklyPlanningPlacementParameter {
  featureId: WeeklyPlanningPlacementFeatureId;
  contextKey: string;
  coefficient: WeeklyPlanningPersonalizationFact<number>;
}

export interface WeeklyPlanningPlacementModelProfile {
  featureVersion: typeof WEEKLY_PLANNING_PLACEMENT_FEATURE_VERSION;
  weightVersion: typeof WEEKLY_PLANNING_PLACEMENT_WEIGHT_VERSION;
  parameters: Record<string, WeeklyPlanningPlacementParameter>;
}

export interface WeeklyPlanningPersonalizationProfile {
  schemaVersion: typeof WEEKLY_PLANNING_PERSONALIZATION_SCHEMA_VERSION;
  weekStartsOn?: WeeklyPlanningPersonalizationFact<WeeklyPlanningWeekStartsOn>;
  subjectEstimateMultipliers: Record<string, WeeklyPlanningPersonalizationFact<number>>;
  preferredSessionMinutes?: WeeklyPlanningPersonalizationFact<number>;
  placementModel: WeeklyPlanningPlacementModelProfile;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function safeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}

function safeScope(value: unknown): WeeklyPlanningPersonalizationScope | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'global') return { kind: 'global' };
  if (value.kind === 'subject' || value.kind === 'task') {
    const key = safeKey(value.key);
    return key ? { kind: value.kind, key } : undefined;
  }
  return undefined;
}

function safeFact<T>(
  value: unknown,
  parseValue: (input: unknown) => T | undefined,
): WeeklyPlanningPersonalizationFact<T> | undefined {
  if (!isRecord(value)) return undefined;
  const parsedValue = parseValue(value.value);
  const scope = safeScope(value.scope);
  if (parsedValue === undefined || !scope || !isIsoDateTime(value.updatedAt)) return undefined;
  if (!['user_confirmed', 'plan_actual_summary', 'conversation_summary', 'system_default']
    .includes(String(value.origin))) return undefined;
  if (!['confirmed', 'high', 'medium', 'low'].includes(String(value.confidence))) return undefined;

  const sourceRefKind = isRecord(value.sourceRef)
    && ['explicit_setting', 'plan_actual_pair', 'derived_summary'].includes(String(value.sourceRef.kind))
      ? value.sourceRef.kind as 'explicit_setting' | 'plan_actual_pair' | 'derived_summary'
      : undefined;
  const sourceRefId = isRecord(value.sourceRef) ? safeKey(value.sourceRef.id) : undefined;
  const sourceRef = sourceRefKind
    ? { kind: sourceRefKind, ...(sourceRefId ? { id: sourceRefId } : {}) }
    : undefined;

  return {
    value: parsedValue,
    origin: value.origin as WeeklyPlanningPersonalizationOrigin,
    confidence: value.confidence as WeeklyPlanningPersonalizationConfidence,
    scope,
    updatedAt: value.updatedAt,
    ...(isIsoDateTime(value.confirmedAt) ? { confirmedAt: value.confirmedAt } : {}),
    ...(isIsoDateTime(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
    ...(sourceRef ? { sourceRef } : {}),
  };
}

function emptyPlacementModel(): WeeklyPlanningPlacementModelProfile {
  return {
    featureVersion: WEEKLY_PLANNING_PLACEMENT_FEATURE_VERSION,
    weightVersion: WEEKLY_PLANNING_PLACEMENT_WEIGHT_VERSION,
    parameters: {},
  };
}

function safePlacementModel(value: unknown): WeeklyPlanningPlacementModelProfile {
  const output = emptyPlacementModel();
  if (!isRecord(value)
    || value.featureVersion !== WEEKLY_PLANNING_PLACEMENT_FEATURE_VERSION
    || value.weightVersion !== WEEKLY_PLANNING_PLACEMENT_WEIGHT_VERSION
    || !isRecord(value.parameters)) {
    return output;
  }

  Object.entries(value.parameters).slice(0, 300).forEach(([parameterKey, parameter]) => {
    const normalizedParameterKey = safeKey(parameterKey);
    if (!normalizedParameterKey || !isRecord(parameter)) return;
    const featureId = WEEKLY_PLANNING_PLACEMENT_FEATURE_IDS.includes(
      parameter.featureId as WeeklyPlanningPlacementFeatureId,
    )
      ? parameter.featureId as WeeklyPlanningPlacementFeatureId
      : undefined;
    const contextKey = safeKey(parameter.contextKey);
    const coefficient = safeFact(parameter.coefficient, (input) =>
      typeof input === 'number' && Number.isFinite(input) && input >= -4 && input <= 4
        ? input
        : undefined);
    if (!featureId || !contextKey || !coefficient) return;
    output.parameters[normalizedParameterKey] = {
      featureId,
      contextKey,
      coefficient,
    };
  });
  return output;
}

export function createEmptyWeeklyPlanningPersonalizationProfile(
  now = new Date().toISOString(),
): WeeklyPlanningPersonalizationProfile {
  return {
    schemaVersion: WEEKLY_PLANNING_PERSONALIZATION_SCHEMA_VERSION,
    subjectEstimateMultipliers: {},
    placementModel: emptyPlacementModel(),
    updatedAt: now,
  };
}

export function sanitizeWeeklyPlanningPersonalizationProfile(
  value: unknown,
): WeeklyPlanningPersonalizationProfile | null {
  if (!isRecord(value)
    || (value.schemaVersion !== 1
      && value.schemaVersion !== WEEKLY_PLANNING_PERSONALIZATION_SCHEMA_VERSION)
    || !isIsoDateTime(value.updatedAt)) {
    return null;
  }

  const weekStartsOn = safeFact(value.weekStartsOn, (input) =>
    input === 'monday' || input === 'sunday' ? input : undefined);
  const preferredSessionMinutes = safeFact(value.preferredSessionMinutes, (input) =>
    typeof input === 'number' && Number.isFinite(input) && input >= 10 && input <= 240
      ? Math.round(input)
      : undefined);
  const subjectEstimateMultipliers: Record<string, WeeklyPlanningPersonalizationFact<number>> = {};
  if (isRecord(value.subjectEstimateMultipliers)) {
    Object.entries(value.subjectEstimateMultipliers).slice(0, 100).forEach(([key, fact]) => {
      const normalizedKey = safeKey(key);
      const normalizedFact = safeFact(fact, (input) =>
        typeof input === 'number' && Number.isFinite(input) && input >= 0.25 && input <= 4
          ? input
          : undefined);
      if (normalizedKey && normalizedFact && normalizedFact.scope.kind === 'subject') {
        subjectEstimateMultipliers[normalizedKey] = normalizedFact;
      }
    });
  }

  return {
    schemaVersion: WEEKLY_PLANNING_PERSONALIZATION_SCHEMA_VERSION,
    subjectEstimateMultipliers,
    placementModel: value.schemaVersion === 1
      ? emptyPlacementModel()
      : safePlacementModel(value.placementModel),
    updatedAt: value.updatedAt,
    ...(weekStartsOn ? { weekStartsOn } : {}),
    ...(preferredSessionMinutes ? { preferredSessionMinutes } : {}),
  };
}

export function createConfirmedWeekStartFact(
  weekStartsOn: WeeklyPlanningWeekStartsOn,
  now = new Date().toISOString(),
): WeeklyPlanningPersonalizationFact<WeeklyPlanningWeekStartsOn> {
  return {
    value: weekStartsOn,
    origin: 'user_confirmed',
    confidence: 'confirmed',
    scope: { kind: 'global' },
    updatedAt: now,
    confirmedAt: now,
    sourceRef: { kind: 'explicit_setting' },
  };
}
