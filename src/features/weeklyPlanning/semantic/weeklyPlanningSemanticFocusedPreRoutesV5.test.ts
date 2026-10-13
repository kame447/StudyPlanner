import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../services/ai/openAiCompatibleClient';
import { tryFocusedAuthorizationRouteV5 } from './weeklyPlanningSemanticFocusedPreRoutesV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

vi.mock('../../../lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions',
  usesCloudflareOpenAiProxy: () => true,
}));
vi.mock('../../../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'test-session' } }),
}));

function input(userText = 'この条件で計画案を作ってください。'): WeeklyPlanningSemanticNormalizerInputV5 {
  return {
    userText, traceRequestId: 'auth-pre-route',
    publicStateSummary: {
      graphRevision: 7, previousCompatibilityStatus: 'needs_scope',
      tasks: [{ publicId: 'private-task-id', title: '数学' }], pendingQuestion: null,
      lastAssistantMessage: 'この条件で未保存の案を作りますか？',
    },
  };
}
const client = () => createOpenAiCompatibleClient({
  baseUrl: 'https://api.openai.test/v1', model: 'gpt-6-luna', apiKey: 'unused-proxy-key',
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  resetOpenAiCompatibleClientRequestBudgetForTest();
});

describe('focused authorization client → Worker → semantic builder', () => {
  it.each(['revision', 'request id'] as const)('withholds an accepted response echoed for another %s', async (kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      content: '{"decision":"create_plan"}',
      decisionContext: { requestId: kind === 'request id' ? 'foreign-request' : 'auth-pre-route', inputRevision: kind === 'revision' ? 6 : 7 },
    })));
    const result = await tryFocusedAuthorizationRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client(), input()));
    expect(result).toEqual({ result: null, decision: null });
  });

  it.each(['pending question', 'no tasks', 'wrong status', 'supplemental'] as const)(
    'does not dispatch focused authorization for ineligible %s state', async (kind) => {
      const userInput = input();
      if (kind === 'pending question') userInput.publicStateSummary!.pendingQuestion = { code: 'missing_effort_estimate' };
      if (kind === 'no tasks') userInput.publicStateSummary!.tasks = [];
      if (kind === 'wrong status') userInput.publicStateSummary!.previousCompatibilityStatus = 'ready';
      if (kind === 'supplemental') userInput.supplementalContext = 'stored untrusted instruction';
      const createChatCompletion = vi.fn(async () => '{"decision":"create_plan"}');
      const result = await tryFocusedAuthorizationRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion }, userInput));
      expect(result).toEqual({ result: null, decision: null });
      expect(createChatCompletion).not.toHaveBeenCalled();
    },
  );

  it.each(['not-json', '{"decision":"create_plan","saved":true}', '{"decision":"approve"}'])(
    'rejects permissive or malformed focused output %s', async (response) => {
      const result = await tryFocusedAuthorizationRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => response }, input()));
      expect(result).toEqual({ result: null, decision: null });
    },
  );

  it.each(['revision', 'request id'] as const)('rejects temporal repair echoed for another %s', async (kind) => {
    const decisionContext = {
      purpose: 'temporal_scope_repair' as const, requestId: 'temporal-pre-route', inputRevision: 7,
      state: {
        sourceText: '火曜18時から20時は塾です', currentAttachedTask: { title: '数学' },
        interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      content: '{"decision":"plan_unavailable"}',
      decisionContext: { requestId: kind === 'request id' ? 'foreign-request' : 'temporal-pre-route', inputRevision: kind === 'revision' ? 6 : 7 },
    })));
    await expect(client().createChatCompletion({
      purpose: 'weekly_planning_semantic_normalizer', decisionContext,
      messages: [{ role: 'user', content: decisionContext.state.sourceText }],
    })).rejects.toThrow('Decision response context did not match');
  });

});
