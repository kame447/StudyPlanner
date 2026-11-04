import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductObservabilityStore } from './productObservabilityStore';
import {
  createAiRequestId,
  recordAiRequestMetricBestEffort,
  type RecordAiRequestMetricParams,
  isAiRequestObservabilityConfigured,
  parseOpenAiUsage,
  resolveAiRequestPhase,
  scheduleAiRequestMetric,
} from './aiRequestObservability';

describe('AI request observability', () => {
  it('normalizes provider usage without inventing missing values', () => {
    expect(parseOpenAiUsage({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 80,
          cache_write_tokens: 20,
        },
        completion_tokens_details: {
          reasoning_tokens: 12,
        },
      },
    })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cachedTokens: 80,
      cacheWriteTokens: 20,
      reasoningTokens: 12,
    });

    expect(parseOpenAiUsage({ usage: {} })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
  });

  it('rejects invalid provider usage numbers instead of coercing them to zero', () => {
    expect(parseOpenAiUsage({
      usage: {
        prompt_tokens: -1,
        completion_tokens: 1.2,
        total_tokens: '10',
        prompt_tokens_details: {
          cached_tokens: -2,
          cache_write_tokens: '5',
        },
        completion_tokens_details: {
          reasoning_tokens: -8,
        },
      },
    })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
  });

  it('classifies semantic repair only from the existing typed request envelope shape', () => {
    expect(resolveAiRequestPhase('weekly_planning_semantic_normalizer', [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'initial' },
    ])).toBe('initial');

    expect(resolveAiRequestPhase('weekly_planning_semantic_normalizer', [
      { role: 'assistant', content: '{}' },
      { role: 'user', content: '{"validationErrors":[],"requiredChanges":[]}' },
    ])).toBe('repair');

    expect(resolveAiRequestPhase('weekly_planning_renderer', [])).toBe('single');
    expect(resolveAiRequestPhase(undefined, [])).toBe('unknown');
  });

  it('requires the server-only identity secret before attempting persistence', () => {
    expect(isAiRequestObservabilityConfigured({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private',
      OBSERVABILITY_IDENTITY_SECRET: 'short',
    })).toBe(false);
    expect(isAiRequestObservabilityConfigured({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private',
      OBSERVABILITY_IDENTITY_SECRET: 'x'.repeat(32),
    })).toBe(true);
  });

  it('creates a stable-format server request id', () => {
    expect(createAiRequestId({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }))
      .toBe('ai-request-00000000-0000-4000-8000-000000000000');
  });

  it('uses waitUntil when execution context is available', async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const task = Promise.resolve();
    scheduleAiRequestMetric({ waitUntil }, task);
    expect(waitUntil).toHaveBeenCalledWith(task);
  });
});


function metricParams(): RecordAiRequestMetricParams {
  return {
    env: {
      FIREBASE_PROJECT_ID: 'test-project', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused', OBSERVABILITY_IDENTITY_SECRET: 'x'.repeat(32),
    },
    firebaseUid: 'test-user', requestId: 'ai-request-test', occurredAt: '2026-11-03T00:00:00.000Z',
    appVersion: 'test', operationKind: 'chat_completion', purpose: 'weekly_planning',
    phase: 'initial', provider: 'openai', model: 'unpriced-model', status: 'success',
    requestBytes: 12.9, responseBytes: null, startedAtMs: 1000,
  };
}

describe('AI metric payload and best-effort delivery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps unknown usage and costs while resolving the clock once before delivery', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1250);
    const store = vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric').mockResolvedValue();
    const params = metricParams();
    await recordAiRequestMetricBestEffort(params);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith({
      firebaseUid: params.firebaseUid, requestId: params.requestId, correlation: undefined,
      occurredAt: params.occurredAt, appVersion: params.appVersion,
      payload: {
        operationKind: 'chat_completion', purpose: 'weekly_planning', phase: 'initial',
        provider: 'openai', model: 'unpriced-model', status: 'success', errorCategory: null,
        promptTokens: null, completionTokens: null, totalTokens: null, cachedTokens: null,
        cacheWriteTokens: null, reasoningTokens: null, durationMs: 250, requestBytes: 12,
        responseBytes: null, pricingVersion: null, estimatedCostMicros: null,
      },
    });
  });

  it('preserves reported-cost precedence, usage and clamped timing without reading the clock', async () => {
    const clock = vi.spyOn(Date, 'now');
    const store = vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric').mockResolvedValue();
    const params = metricParams();
    params.nowMs = 900;
    params.responseBytes = 8.9;
    params.status = 'provider_error';
    params.usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 2, cacheWriteTokens: 0, reasoningTokens: 3 };
    params.decision = {
      mode: 'shadow', outcome: 'shadow', gate: 'accepted', reason: null, requestedModel: 'unpriced-model',
      catalogVersion: 'test', gateVersion: 'test', inputRevision: 1, rawChoiceMatchesBaseline: true,
      gatedRouteMatchesBaseline: true, reportedCostUsd: 0.0012345, choice: 'create_plan', confidence: null,
      createPlanProbability: null, fallbackProbability: null, conditionChangeProbability: null, independentMeaningProbability: null,
    };
    await recordAiRequestMetricBestEffort(params);
    expect(clock).not.toHaveBeenCalled();
    const payload = store.mock.calls[0][0].payload;
    expect(payload).toMatchObject({ ...params.usage, status: 'provider_error', errorCategory: 'provider_error',
      durationMs: 0, requestBytes: 12, responseBytes: 8, pricingVersion: 'openrouter-reported-usd', estimatedCostMicros: 1235 });
    expect(payload.decision).toBe(params.decision);
  });

  it('does no clock or persistence work when observability is not configured', async () => {
    const clock = vi.spyOn(Date, 'now');
    const store = vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric').mockResolvedValue();
    const params = metricParams();
    params.env.OBSERVABILITY_IDENTITY_SECRET = 'short';
    await recordAiRequestMetricBestEffort(params);
    expect(clock).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it('reports the original storage error once without rejecting delivery', async () => {
    const error = new Error('storage unavailable');
    vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric').mockRejectedValue(error);
    const onError = vi.fn();
    await expect(recordAiRequestMetricBestEffort({ ...metricParams(), nowMs: 1250, onError })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});
