export const PRODUCT_OBSERVABILITY_SCHEMA_VERSION = 1 as const;

export const PRODUCT_ACTIVITY_ACTIONS = [
  'app_active',
  'plan_created',
  'plan_updated',
  'plan_deleted',
  'actual_recorded',
  'actual_updated',
  'actual_deleted',
  'todo_created',
  'todo_completed',
  'todo_updated',
  'material_created',
  'material_updated',
  'weekly_planning_opened',
] as const;

export type ProductActivityAction = (typeof PRODUCT_ACTIVITY_ACTIONS)[number];

export const OBSERVABILITY_SOURCES = [
  'web_app',
  'ai_proxy',
  'weekly_planning',
  'system',
] as const;

export type ObservabilitySource = (typeof OBSERVABILITY_SOURCES)[number];

export type ObservabilityEnvironment =
  | 'production'
  | 'preview'
  | 'development'
  | 'test';

export interface ObservabilityCorrelation {
  appSessionId?: string;
  featureSessionId?: string;
  requestId?: string;
  traceSessionId?: string;
  stateRevision?: number;
}

export interface ProductActivityTelemetryDraft {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_SCHEMA_VERSION;
  eventId: string;
  eventType: 'product_activity';
  occurredAt: string;
  appVersion: string;
  source: 'web_app';
  correlation?: ObservabilityCorrelation;
  payload: {
    action: ProductActivityAction;
  };
}

export type AiRequestMetricStatus =
  | 'success'
  | 'quota_rejected'
  | 'timeout'
  | 'network_failure'
  | 'provider_error'
  | 'empty_response'
  | 'invalid_response'
  | 'cancelled'
  | 'unknown_failure';

export interface AiRequestMetricPayload {
  operationKind:
    | 'chat_completion'
    | 'timetable_ocr'
    | 'planning_attachment'
    | 'planning_transcription';
  purpose: string;
  phase: 'initial' | 'repair' | 'single' | 'unknown';
  provider: 'openai' | 'gemini';
  model: string;
  status: AiRequestMetricStatus;
  errorCategory: Exclude<AiRequestMetricStatus, 'success'> | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens?: number | null;
  durationMs: number;
  requestBytes: number;
  responseBytes: number | null;
  pricingVersion: string | null;
  estimatedCostMicros: number | null;
}

export const PLANNING_OUTCOME_TYPES = [
  'session_started',
  'preview_generated',
  'approval_started',
  'approval_completed',
  'save_completed',
  'abandoned',
  'failed',
  'fallback_used',
  'semantic_repair_used',
  'stale_observed',
  'unscheduled_observed',
  'approval_failure_observed',
] as const;

export type PlanningOutcomeType = (typeof PLANNING_OUTCOME_TYPES)[number];

export interface PlanningOutcomeMetricPayload {
  outcomeType: PlanningOutcomeType;
  turnIndex: number | null;
  stateRevision: number | null;
  previewCount: number | null;
  unscheduledCount: number | null;
  fallbackUsed: boolean | null;
  repairUsed: boolean | null;
  staleObserved: boolean | null;
  approvalFailureObserved: boolean | null;
  schedulerVersion: string | null;
  promptVersion: string | null;
  model: string | null;
}

export interface PlanningOutcomeTelemetryDraft {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_SCHEMA_VERSION;
  eventId: string;
  eventType: 'planning_outcome';
  occurredAt: string;
  appVersion: string;
  source: 'weekly_planning';
  correlation: ObservabilityCorrelation & {
    featureSessionId: string;
  };
  payload: PlanningOutcomeMetricPayload;
}

export type ProductObservabilityTelemetryDraft =
  | ProductActivityTelemetryDraft
  | PlanningOutcomeTelemetryDraft;

export interface StoredObservabilityEvent<TPayload> {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_SCHEMA_VERSION;
  eventId: string;
  eventType: 'product_activity' | 'ai_request_metric' | 'planning_outcome';
  occurredAt: string;
  observedAt: string;
  actorSubjectId: string;
  environment: ObservabilityEnvironment;
  appVersion: string;
  source: ObservabilitySource;
  correlation: ObservabilityCorrelation;
  payload: TPayload;
  expireAt: string;
}

const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const MAX_VERSION_LENGTH = 96;
const MAX_CORRELATION_ID_LENGTH = 180;
const MAX_DIMENSION_LENGTH = 128;
const activityActionSet = new Set<string>(PRODUCT_ACTIVITY_ACTIONS);
const planningOutcomeTypeSet = new Set<string>(PLANNING_OUTCOME_TYPES);
const sourceSet = new Set<string>(OBSERVABILITY_SOURCES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isNullableBoundedString(value: unknown, maxLength: number): boolean {
  return value === null || isBoundedString(value, maxLength);
}

function isNullableNonNegativeInteger(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0);
}

function isNullableBoolean(value: unknown): boolean {
  return value === null || typeof value === 'boolean';
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 40
    && Number.isFinite(new Date(value).getTime());
}

function isValidEventEnvelope(
  value: Record<string, unknown>,
  eventType: ProductObservabilityTelemetryDraft['eventType'],
  source: ProductObservabilityTelemetryDraft['source'],
): string | null {
  if (!hasOnlyKeys(value, [
    'schemaVersion',
    'eventId',
    'eventType',
    'occurredAt',
    'appVersion',
    'source',
    'correlation',
    'payload',
  ])) return 'Telemetry payload contains unknown fields.';
  if (value.schemaVersion !== PRODUCT_OBSERVABILITY_SCHEMA_VERSION) {
    return 'Unsupported telemetry schema version.';
  }
  if (typeof value.eventId !== 'string' || !EVENT_ID_PATTERN.test(value.eventId)) {
    return 'Telemetry eventId is invalid.';
  }
  if (value.eventType !== eventType) return 'Telemetry eventType is invalid.';
  if (!isValidIsoTimestamp(value.occurredAt)) return 'Telemetry occurredAt is invalid.';
  if (!isBoundedString(value.appVersion, MAX_VERSION_LENGTH)) {
    return 'Telemetry appVersion is invalid.';
  }
  if (value.source !== source || !sourceSet.has(value.source)) {
    return 'Telemetry source is invalid.';
  }
  return null;
}

function isValidCorrelation(value: unknown): value is ObservabilityCorrelation {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    'appSessionId',
    'featureSessionId',
    'requestId',
    'traceSessionId',
    'stateRevision',
  ])) return false;

  for (const key of ['appSessionId', 'featureSessionId', 'requestId', 'traceSessionId'] as const) {
    const entry = value[key];
    if (entry !== undefined && !isBoundedString(entry, MAX_CORRELATION_ID_LENGTH)) {
      return false;
    }
  }

  return value.stateRevision === undefined
    || (Number.isSafeInteger(value.stateRevision) && Number(value.stateRevision) >= 0);
}

export function validateProductActivityTelemetryDraft(
  value: unknown,
): { ok: true; value: ProductActivityTelemetryDraft } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Telemetry payload must be an object.' };
  const envelopeError = isValidEventEnvelope(value, 'product_activity', 'web_app');
  if (envelopeError) return { ok: false, error: envelopeError };
  if (!isValidCorrelation(value.correlation)) {
    return { ok: false, error: 'Telemetry correlation is invalid.' };
  }
  if (!isRecord(value.payload)
    || !hasOnlyKeys(value.payload, ['action'])
    || typeof value.payload.action !== 'string'
    || !activityActionSet.has(value.payload.action)) {
    return { ok: false, error: 'Telemetry activity payload is invalid.' };
  }
  return { ok: true, value: value as unknown as ProductActivityTelemetryDraft };
}

export function validatePlanningOutcomeTelemetryDraft(
  value: unknown,
): { ok: true; value: PlanningOutcomeTelemetryDraft } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Telemetry payload must be an object.' };
  const envelopeError = isValidEventEnvelope(value, 'planning_outcome', 'weekly_planning');
  if (envelopeError) return { ok: false, error: envelopeError };
  if (!isValidCorrelation(value.correlation)
    || !isRecord(value.correlation)
    || !isBoundedString(value.correlation.featureSessionId, MAX_CORRELATION_ID_LENGTH)) {
    return { ok: false, error: 'Telemetry planning correlation is invalid.' };
  }
  if (!isRecord(value.payload)
    || !hasOnlyKeys(value.payload, [
      'outcomeType',
      'turnIndex',
      'stateRevision',
      'previewCount',
      'unscheduledCount',
      'fallbackUsed',
      'repairUsed',
      'staleObserved',
      'approvalFailureObserved',
      'schedulerVersion',
      'promptVersion',
      'model',
    ])
    || typeof value.payload.outcomeType !== 'string'
    || !planningOutcomeTypeSet.has(value.payload.outcomeType)
    || !isNullableNonNegativeInteger(value.payload.turnIndex)
    || !isNullableNonNegativeInteger(value.payload.stateRevision)
    || !isNullableNonNegativeInteger(value.payload.previewCount)
    || !isNullableNonNegativeInteger(value.payload.unscheduledCount)
    || !isNullableBoolean(value.payload.fallbackUsed)
    || !isNullableBoolean(value.payload.repairUsed)
    || !isNullableBoolean(value.payload.staleObserved)
    || !isNullableBoolean(value.payload.approvalFailureObserved)
    || !isNullableBoundedString(value.payload.schedulerVersion, MAX_DIMENSION_LENGTH)
    || !isNullableBoundedString(value.payload.promptVersion, MAX_DIMENSION_LENGTH)
    || !isNullableBoundedString(value.payload.model, MAX_DIMENSION_LENGTH)) {
    return { ok: false, error: 'Telemetry planning outcome payload is invalid.' };
  }
  return { ok: true, value: value as unknown as PlanningOutcomeTelemetryDraft };
}

export function validateProductObservabilityTelemetryDraft(
  value: unknown,
): { ok: true; value: ProductObservabilityTelemetryDraft } | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.eventType !== 'string') {
    return { ok: false, error: 'Telemetry payload must be an object with an eventType.' };
  }
  if (value.eventType === 'product_activity') return validateProductActivityTelemetryDraft(value);
  if (value.eventType === 'planning_outcome') return validatePlanningOutcomeTelemetryDraft(value);
  return { ok: false, error: 'Telemetry eventType is invalid.' };
}
