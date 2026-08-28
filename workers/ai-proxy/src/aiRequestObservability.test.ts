import { describe, expect, it, vi } from 'vitest';
import {
  createAiRequestId,
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
