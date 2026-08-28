import {
  PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
  type ObservabilityCorrelation,
  type PlanningOutcomeMetricPayload,
  type PlanningOutcomeTelemetryDraft,
  type PlanningOutcomeType,
} from '../../../shared/productObservabilityContract';
import type { ProductTelemetrySink } from './productTelemetry';

export interface PlanningOutcomeTelemetryInput {
  outcomeType: PlanningOutcomeType;
  featureSessionId: string;
  dedupeKey: string;
  requestId?: string;
  traceSessionId?: string;
  stateRevision?: number | null;
  turnIndex?: number | null;
  previewCount?: number | null;
  unscheduledCount?: number | null;
  fallbackUsed?: boolean | null;
  repairUsed?: boolean | null;
  staleObserved?: boolean | null;
  approvalFailureObserved?: boolean | null;
  schedulerVersion?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  occurredAt?: string;
}

export interface PlanningOutcomeTelemetryPort {
  recordOutcome(input: PlanningOutcomeTelemetryInput): void;
}

export interface PlanningOutcomeTelemetryPortOptions {
  appVersion: string;
  sink: ProductTelemetrySink;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

function boundedEventKey(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96);
}

export function createPlanningOutcomeEventId(
  outcomeType: PlanningOutcomeType,
  dedupeKey: string,
): string {
  const key = boundedEventKey(dedupeKey.trim());
  if (!key) throw new Error('Planning outcome dedupeKey is required.');
  return `planning-${outcomeType}-${key}`.slice(0, 159);
}

function correlationFromInput(input: PlanningOutcomeTelemetryInput): ObservabilityCorrelation & {
  featureSessionId: string;
} {
  return {
    featureSessionId: input.featureSessionId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.traceSessionId ? { traceSessionId: input.traceSessionId } : {}),
    ...(input.stateRevision === null || input.stateRevision === undefined
      ? {}
      : { stateRevision: input.stateRevision }),
  };
}

function payloadFromInput(input: PlanningOutcomeTelemetryInput): PlanningOutcomeMetricPayload {
  return {
    outcomeType: input.outcomeType,
    turnIndex: input.turnIndex ?? null,
    stateRevision: input.stateRevision ?? null,
    previewCount: input.previewCount ?? null,
    unscheduledCount: input.unscheduledCount ?? null,
    fallbackUsed: input.fallbackUsed ?? null,
    repairUsed: input.repairUsed ?? null,
    staleObserved: input.staleObserved ?? null,
    approvalFailureObserved: input.approvalFailureObserved ?? null,
    schedulerVersion: input.schedulerVersion ?? null,
    promptVersion: input.promptVersion ?? null,
    model: input.model ?? null,
  };
}

export function createPlanningOutcomeTelemetryPort(
  options: PlanningOutcomeTelemetryPortOptions,
): PlanningOutcomeTelemetryPort {
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? (() => undefined);

  return {
    recordOutcome(input) {
      const event: PlanningOutcomeTelemetryDraft = {
        schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
        eventId: createPlanningOutcomeEventId(input.outcomeType, input.dedupeKey),
        eventType: 'planning_outcome',
        occurredAt: input.occurredAt ?? now().toISOString(),
        appVersion: options.appVersion,
        source: 'weekly_planning',
        correlation: correlationFromInput(input),
        payload: payloadFromInput(input),
      };
      void options.sink.write(event).catch(onError);
    },
  };
}

export function createNoopPlanningOutcomeTelemetryPort(): PlanningOutcomeTelemetryPort {
  return { recordOutcome() {} };
}
