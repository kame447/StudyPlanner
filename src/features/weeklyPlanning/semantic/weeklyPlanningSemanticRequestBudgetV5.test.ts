import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { describe, expect, it } from 'vitest';
import {
  AI_PROXY_CHAT_REQUEST_LIMITS,
  measureJsonUtf8Bytes,
} from '../../../../shared/aiProxyContract';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

describe('Stable V5 AI proxy request budget', () => {
  it('fits a schema-heavy eight-turn request inside the shared proxy contract', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return JSON.stringify({
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          planningIntent: 'discuss',
          planningWindow: null,
          tasks: [],
          relations: [],
          availabilityDeclarations: [],
          constraintSourceRequests: [],
          uncertainties: [],
          corrections: [],
          decisions: [],
        });
      },
    };
    const recentConversation = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}:` + 'あ'.repeat(4_000),
    }));
    const publicStateSummary = {
      runtime: 'weekly-planning-stable-v5',
      graphRevision: 18,
      tasks: Array.from({ length: 40 }, (_, index) => ({
        publicId: `task:${index}`,
        category: index % 2 === 0 ? 'study' : 'non_study',
        title: `予定${index}`,
      })),
      workloads: Array.from({ length: 40 }, (_, index) => ({
        publicId: `workload:${index}`,
        taskPublicId: `task:${index}`,
        quantityRole: 'target',
        amount: index + 1,
        unitCode: 'page',
        unitLabel: 'ページ',
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この条件を確認してください。',
      recentConversation,
      publicStateSummary,
    });
    expect(result.status).toBe('accepted');

    const call = calls[0];
    const wireRequest = {
      purpose: call.purpose,
      temperature: call.temperature,
      messages: call.messages,
      response_format: call.responseFormat,
      max_completion_tokens: call.maxCompletionTokens,
    };
    const requestBytes = measureJsonUtf8Bytes(wireRequest);
    const messages = call.messages as Array<{ content: string }>;
    const messageLengths = messages.map((message) => message.content.length);

    expect(requestBytes).toBeGreaterThan(32 * 1024);
    expect(requestBytes).toBeLessThanOrEqual(
      AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes,
    );
    expect(Math.max(...messageLengths)).toBeLessThanOrEqual(
      AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength,
    );
    expect(messageLengths.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(
      AI_PROXY_CHAT_REQUEST_LIMITS.maxTotalMessageContentLength,
    );
    expect(call.maxCompletionTokens).toBeLessThanOrEqual(
      AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens,
    );
  });
});

describe('recovery dispatch census at the common normalizer client boundary', () => {
  const diagnostics = (run: WeeklyPlanningSemanticNormalizerRunV5) => run.diagnostics({
    attemptCount: 1, repairAttempted: false, validationErrors: [], providerError: null,
  }).providerDispatch;

  it('counts direct focused calls and tracked semantic/repair calls in one invocation', async () => {
    const run = new WeeklyPlanningSemanticNormalizerRunV5({
      createChatCompletion: async () => '{}',
    }, { userText: '確認' });
    await run.client.createChatCompletion({ messages: [] });
    await run.callGeneric([], 'initial');
    await run.callGeneric([], 'repair');
    expect(diagnostics(run)).toEqual({ count: 3, anyFailure: false, complete: true });
  });

  it('keeps an earlier provider failure closed even after a later successful dispatch', async () => {
    let calls = 0;
    const run = new WeeklyPlanningSemanticNormalizerRunV5({
      async createChatCompletion() { if (++calls === 1) throw new Error('offline'); return '{}'; },
    }, { userText: '確認' });
    await expect(run.client.createChatCompletion({ messages: [] })).rejects.toThrow('offline');
    await run.callGeneric([], 'initial');
    expect(diagnostics(run)).toEqual({ count: 2, anyFailure: true, complete: true });
  });

  it('does not certify counts while any concurrent provider request remains unsettled', async () => {
    let resolve!: (value: string) => void;
    const run = new WeeklyPlanningSemanticNormalizerRunV5({
      createChatCompletion: () => new Promise<string>((done) => { resolve = done; }),
    }, { userText: '確認' });
    const pending = run.client.createChatCompletion({ messages: [] });
    expect(diagnostics(run)).toEqual({ count: 1, anyFailure: false, complete: false });
    resolve('{}'); await pending;
    expect(diagnostics(run)).toEqual({ count: 1, anyFailure: false, complete: true });
  });
});
