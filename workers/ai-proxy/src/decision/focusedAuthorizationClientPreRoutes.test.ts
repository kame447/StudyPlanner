import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../../src/services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5';
import { createFocusedAuthorizationDocumentV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedAuthorizationV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerContractsV5';

vi.mock('../../../../src/lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions',
  usesCloudflareOpenAiProxy: () => true,
}));
vi.mock('../../../../src/lib/firebaseClient', () => ({
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
  it.each(['accepted', 'accepted fallback', 'mixed', 'abstain', 'luna fallback', 'unavailable', 'dual failure'] as const)(
    'preserves the client route and closed authority for %s', async (kind) => {
      const dispatches: string[] = [];
      const proxyBodies: Record<string, unknown>[] = [];
      const userInput = input(kind === 'mixed' ? '作ってください。あと金曜だけ開始を30分遅らせたい。' : undefined);
      const snapshot = JSON.stringify(userInput);
      const env = {
        OPENAI_API_KEY: 'openai-mock', OPENROUTER_API_KEY: 'jev-mock',
        FIREBASE_WEB_API_KEY: 'firebase-mock', ALLOWED_ORIGIN: 'https://app.example',
        JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
        JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
        AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true }) }) },
      };
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const endpoint = String(url);
        if (endpoint === 'https://proxy.example/chat/completions') {
          const body = JSON.parse(String(init?.body)); proxyBodies.push(body);
          const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example');
          return worker.fetch(new Request(endpoint, { ...init, headers }), env as never);
        }
        if (endpoint.includes('identitytoolkit.googleapis.com')) {
          return Response.json({ users: [{ localId: 'user-fixture', emailVerified: true }] });
        }
        if (endpoint === 'https://openrouter.ai/api/alpha/decisions') {
          dispatches.push('jev');
          const body = JSON.parse(String(init?.body));
          expect(body.state).toEqual({ currentUserText: userInput.userText, lastAssistantMessage: userInput.publicStateSummary?.lastAssistantMessage });
          expect(JSON.stringify(body)).not.toContain('private-task-id');
          if (kind === 'unavailable' || kind === 'dual failure') return Response.json({}, { status: 503 });
          return Response.json({ model: 'typesafe/jev-1.13', answers: {
            authorization: { type: 'choice', choice: kind === 'accepted fallback' ? 'fallback' : 'create_plan', confidence: kind === 'abstain' || kind === 'luna fallback' ? 0.5 : 0.99, probabilities: kind === 'accepted fallback' ? { create_plan: 0.01, fallback: 0.99 } : { create_plan: 0.99, fallback: 0.01 } },
            condition_change: { type: 'noul', noul: 0 },
            independent_meaning: { type: 'noul', noul: kind === 'mixed' ? 0.99 : 0 },
          } });
        }
        if (endpoint === 'https://api.openai.com/v1/chat/completions') {
          const body = JSON.parse(String(init?.body));
          expect(body).not.toHaveProperty('decisionContext');
          const focused = body.response_format?.json_schema.name === 'weekly_planning_focused_authorization_v5';
          dispatches.push(focused ? 'luna-focused' : 'luna-generic');
          if (kind === 'dual failure') return Response.json({}, { status: 503 });
          if (!focused) expect(JSON.stringify(body.messages)).toContain(userInput.userText);
          return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(focused ? { decision: kind === 'luna fallback' ? 'fallback' : 'create_plan' } : createFocusedAuthorizationDocumentV5()) } }] });
        }
        throw new Error(`Unexpected endpoint ${endpoint}`);
      }));
      const result = await createWeeklyPlanningSemanticNormalizerV5(client()).normalize(userInput);
      expect(result.status).toBe(kind === 'dual failure' ? 'provider_failure' : 'accepted');
      expect(result.document).toEqual(kind === 'dual failure' ? null : createFocusedAuthorizationDocumentV5());
      expect(dispatches).toEqual(kind === 'accepted' ? ['jev']
        : kind === 'mixed' || kind === 'accepted fallback' ? ['jev', 'luna-generic']
          : kind === 'luna fallback' ? ['jev', 'luna-focused', 'luna-generic']
          : kind === 'dual failure' ? ['jev', 'luna-focused', 'luna-generic']
            : ['jev', 'luna-focused']);
      expect(JSON.stringify(userInput)).toBe(snapshot);
      expect(proxyBodies[0].decisionContext).toMatchObject({ purpose: 'focused_authorization', inputRevision: 7 });
      if (kind === 'mixed' || kind === 'accepted fallback' || kind === 'luna fallback' || kind === 'dual failure') expect(proxyBodies[1]).not.toHaveProperty('decisionContext');
      // This boundary can return an unsaved creation intent only; no persistence endpoint is available in this mock.
    },
  );

});
