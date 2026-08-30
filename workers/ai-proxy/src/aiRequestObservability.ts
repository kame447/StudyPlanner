import type {
  AiRequestMetricPayload,
  AiRequestMetricStatus,
} from '../../../shared/productObservabilityContract';
import { estimateAiRequestCost } from './aiUsagePricing';
import {
  ProductObservabilityStore,
  type ProductObservabilityEnv,
} from './productObservabilityStore';

export interface AiRequestUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens?: number | null;
}

type ExtendedAiRequestMetricPayload = AiRequestMetricPayload & {
  reasoningTokens: number | null;
};

interface MetricMessage {
  role?: string;
  content?: string;
}

export interface RecordAiRequestMetricParams {
  env: ProductObservabilityEnv;
  firebaseUid: string;
  requestId: string;
  occurredAt: string;
  appVersion: string;
  operationKind: AiRequestMetricPayload['operationKind'];
  purpose: string;
  phase: AiRequestMetricPayload['phase'];
  provider: AiRequestMetricPayload['provider'];
  model: string;
  status: AiRequestMetricStatus;
  requestBytes: number;
  responseBytes: number | null;
  usage?: AiRequestUsage | null;
  startedAtMs: number;
  nowMs?: number;
  onError?: (error: unknown) => void;
}

const MIN_IDENTITY_SECRET_LENGTH = 32;

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function emptyAiRequestUsage(): AiRequestUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    cachedTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };
}

export function parseOpenAiUsage(value: unknown): AiRequestUsage {
  const root = record(value);
  const usage = record(root?.usage);
  const promptDetails = record(usage?.prompt_tokens_details);
  const completionDetails = record(usage?.completion_tokens_details);
  return {
    promptTokens: nonNegativeInteger(usage?.prompt_tokens),
    completionTokens: nonNegativeInteger(usage?.completion_tokens),
    totalTokens: nonNegativeInteger(usage?.total_tokens),
    cachedTokens: nonNegativeInteger(promptDetails?.cached_tokens),
    cacheWriteTokens: nonNegativeInteger(promptDetails?.cache_write_tokens),
    reasoningTokens: nonNegativeInteger(completionDetails?.reasoning_tokens),
  };
}

export function resolveAiRequestPhase(
  purpose: string | undefined,
  messages: readonly MetricMessage[] | undefined,
): AiRequestMetricPayload['phase'] {
  if (!purpose) return 'unknown';
  if (purpose !== 'weekly_planning_semantic_normalizer') return 'single';
  const entries = messages ?? [];
  const hasAssistantContext = entries.some((message) => message.role === 'assistant');
  const hasRepairEnvelope = entries.some((message) =>
    message.role === 'user'
      && typeof message.content === 'string'
      && message.content.includes('"validationErrors"')
      && message.content.includes('"requiredChanges"'));
  return hasAssistantContext && hasRepairEnvelope ? 'repair' : 'initial';
}

export function createAiRequestId(
  cryptoApi: Pick<Crypto, 'randomUUID'> = crypto,
): string {
  return `ai-request-${cryptoApi.randomUUID()}`;
}

export function isAiRequestObservabilityConfigured(env: ProductObservabilityEnv): boolean {
  return (env.OBSERVABILITY_IDENTITY_SECRET?.trim().length ?? 0) >= MIN_IDENTITY_SECRET_LENGTH;
}

export async function recordAiRequestMetricBestEffort(
  params: RecordAiRequestMetricParams,
): Promise<void> {
  if (!isAiRequestObservabilityConfigured(params.env)) return;

  const nowMs = params.nowMs ?? Date.now();
  const usage = params.usage ?? emptyAiRequestUsage();
  const errorCategory = params.status === 'success' ? null : params.status;
  const pricing = estimateAiRequestCost({
    provider: params.provider,
    model: params.model,
    operationKind: params.operationKind,
    usage,
  });
  const payload: ExtendedAiRequestMetricPayload = {
    operationKind: params.operationKind,
    purpose: params.purpose,
    phase: params.phase,
    provider: params.provider,
    model: params.model,
    status: params.status,
    errorCategory,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens ?? null,
    durationMs: Math.max(0, nowMs - params.startedAtMs),
    requestBytes: Math.max(0, Math.floor(params.requestBytes)),
    responseBytes: params.responseBytes === null
      ? null
      : Math.max(0, Math.floor(params.responseBytes)),
    pricingVersion: pricing.pricingVersion,
    estimatedCostMicros: pricing.estimatedCostMicros,
  };

  try {
    await new ProductObservabilityStore(params.env).storeAiRequestMetric({
      firebaseUid: params.firebaseUid,
      requestId: params.requestId,
      occurredAt: params.occurredAt,
      appVersion: params.appVersion,
      payload,
    });
  } catch (error) {
    params.onError?.(error);
  }
}

export function scheduleAiRequestMetric(
  context: Pick<ExecutionContext, 'waitUntil'> | undefined,
  promise: Promise<void>,
): void {
  if (context) {
    context.waitUntil(promise);
    return;
  }
  void promise;
}
