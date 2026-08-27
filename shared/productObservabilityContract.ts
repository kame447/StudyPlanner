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
  durationMs: number;
  requestBytes: number;
  responseBytes: number | null;
  pricingVersion: string | null;
  estimatedCostMicros: number | null;
}

export type PlanningOutcomeType =
  | 'session_started'
  | 'preview_generated'
  | 'approval_started'
  | 'approval_completed'
  | 'save_completed'
  | 'abandoned'
  | 'failed'
  | 'fallback_used'
  | 'semantic_repair_used'
  | 'stale_observed'
  | 'unscheduled_observed'
  | 'approval_failure_observed';

export interface PlanningOutcomeMetricPayload {
  outcomeType: PlanningOutcomeType;
  turnIndex: number | null;
  stateRevision: number | null;
  previewCount: number;
  unscheduledCount: number;
  fallbackUsed: boolean;
  repairUsed: boolean;
  staleObserved: boolean;
  approvalFailureObserved: boolean;
  schedulerVersion: string | null;
  promptVersion: string | null;
  model: string | null;
}

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
const activityActionSet = new Set<string>(PRODUCT_ACTIVITY_ACTIONS);
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

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 40
    && Number.isFinite(new Date(value).getTime());
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
  if (!isRecord(value)) {
    return { ok: false, error: 'Telemetry payload must be an object.' };
  }

  if (!hasOnlyKeys(value, [
    'schemaVersion',
    'eventId',
    'eventType',
    'occurredAt',
    'appVersion',
    'source',
    'correlation',
    'payload',
  ])) {
    return { ok: false, error: 'Telemetry payload contains unknown fields.' };
  }

  if (value.schemaVersion !== PRODUCT_OBSERVABILITY_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported telemetry schema version.' };
  }

  if (typeof value.eventId !== 'string' || !EVENT_ID_PATTERN.test(value.eventId)) {
    return { ok: false, error: 'Telemetry eventId is invalid.' };
  }

  if (value.eventType !== 'product_activity') {
    return { ok: false, error: 'Telemetry eventType is invalid.' };
  }

  if (!isValidIsoTimestamp(value.occurredAt)) {
    return { ok: false, error: 'Telemetry occurredAt is invalid.' };
  }

  if (!isBoundedString(value.appVersion, MAX_VERSION_LENGTH)) {
    return { ok: false, error: 'Telemetry appVersion is invalid.' };
  }

  if (value.source !== 'web_app' || !sourceSet.has(value.source)) {
    return { ok: false, error: 'Telemetry source is invalid.' };
  }

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
