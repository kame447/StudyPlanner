import { createBoundFocusedContextualContextFixtureV5, focusedContextualSourceMessagesFixtureV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5.testUtils';
// Regression oracles for strict schemas, provider failures and correlation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import { JEV_MODEL } from './decisionPolicy';
import { dispatchFocusedAuthorization } from './focusedAuthorizationDispatch';
import { dispatchFocusedContextual } from './focusedContextualDispatch';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../../src/services/ai/openAiCompatibleClient';

vi.mock('../../../../src/lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.fixture/chat/completions', usesCloudflareOpenAiProxy: () => true,
}));
vi.mock('../../../../src/lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'fixture-session' } }),
}));

const metadata = { provider: 'openrouter' as const, requestedModel: JEV_MODEL.request, servedModel: JEV_MODEL.request,
  latencyMs: 1, inputTokens: null, outputTokens: null, costUsd: null, requestBytes: 10, responseBytes: 100 };
const context = {
  purpose: 'focused_authorization' as const, requestId: 'request-before', inputRevision: 7,
  previousStatus: 'needs_scope' as const, hasTasks: true as const, hasPendingQuestion: false as const,
  state: { currentUserText: 'private-input', lastAssistantMessage: null },
};
function body() {
  return { model: JEV_MODEL.request, answers: {
    authorization: { type: 'choice', choice: 'create_plan', confidence: 1, probabilities: { create_plan: 1, fallback: 0 } },
    condition_change: { type: 'noul', noul: 0 }, independent_meaning: { type: 'noul', noul: 0 },
  } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetOpenAiCompatibleClientRequestBudgetForTest(); });

describe('decision port boundary regressions', () => {
  it.each(['extra head', 'extra Choice field', 'extra Noul field'])(
    'rejects %s rather than ignoring provider schema drift', async variant => {
      const response = body();
      if (variant === 'extra head') Object.assign(response.answers, { save: { type: 'noul', noul: 1 } });
      if (variant === 'extra Choice field') Object.assign(response.answers.authorization, { saveAuthorized: true });
      if (variant === 'extra Noul field') Object.assign(response.answers.condition_change, { confidence: 1 });
      const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture', fetch: vi.fn(async () => Response.json(response)) });
      expect(await provider.evaluate(context.state)).toMatchObject({ status: 'unavailable', reason: 'invalid_response' });
    },
  );

  it('uses Luna once when a DecisionProvider rejects its Promise', async () => {
    const fallback = vi.fn(async () => new Response('luna-baseline'));
    const respond = vi.fn(() => new Response('must-not-use'));
    const result = await dispatchFocusedAuthorization({ context,
      env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100' },
      firebaseUid: 'fixture-owner', signal: new AbortController().signal, fallback, respond,
      provider: { evaluate: vi.fn(async () => { throw new Error('private-provider-error'); }) },
    });
    expect(await result.text()).toBe('luna-baseline');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled();
  });

  it('preserves the shadow Luna response when a DecisionProvider throws synchronously', async () => {
    const lifecycle: Promise<unknown>[] = [];
    const fallback = vi.fn(async () => new Response('luna-baseline'));
    const result = await dispatchFocusedAuthorization({ context,
      env: { JEV_MODE: 'shadow', JEV_CANARY_PERCENT: '0', JEV_FOCUSED_AUTHORIZATION_MODE: 'shadow', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '0' },
      firebaseUid: 'fixture-owner', signal: new AbortController().signal, fallback, respond: () => new Response('must-not-use'),
      executionContext: { waitUntil: work => lifecycle.push(work) },
      provider: { evaluate: () => { throw new Error('private-provider-error'); } },
    });
    expect(await result.text()).toBe('luna-baseline');
    expect(fallback).toHaveBeenCalledTimes(1);
    await Promise.all(lifecycle);
  });

  it('records contextual source drift as unavailable when the stale result uses Luna', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await dispatchFocusedContextual({
      context: createBoundFocusedContextualContextFixtureV5({ requestId: 'contextual-before' }),
      env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: 'canary', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100' },
      firebaseUid: 'fixture-owner', signal: new AbortController().signal,
      fallback: async () => new Response('luna-after-drift'), respond: () => new Response('must-not-use'),
      isHarnessContextCurrent: () => false,
      provider: { evaluate: async () => ({ status: 'evaluated', decision: 'remaining', confidence: 1,
        probabilities: { target: 0, remaining: 1, completed: 0, focused_luna: 0, fallback: 0 },
        conditionChange: 0, independentMeaning: 0, metadata }) },
    });
    expect(await result.text()).toBe('luna-after-drift');
    expect(console.info).toHaveBeenCalledWith('[AI Decision]', expect.objectContaining({
      gate: 'unavailable', reason: 'stale_context', outcome: 'fallback',
    }));
  });

  it('binds a generic decision response to the serialized request when caller revision mutates in flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mutable = structuredClone(context);
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      const sent = JSON.parse(String(init?.body)).decisionContext;
      expect(sent.inputRevision).toBe(7);
      mutable.inputRevision = 8;
      mutable.requestId = 'request-after';
      return Response.json({ content: '{"decision":"create_plan"}',
        decisionContext: { requestId: mutable.requestId, inputRevision: mutable.inputRevision } });
    });
    vi.stubGlobal('fetch', transport);
    const client = createOpenAiCompatibleClient({ provider: 'openai', model: 'unused', apiKey: '', baseUrl: 'https://unused.fixture' });
    await expect(client.createChatCompletion({ messages: [{ role: 'user', content: 'private-input' }],
      purpose: 'weekly_planning_semantic_normalizer', decisionContext: mutable,
    })).rejects.toThrow('Decision response context did not match');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
