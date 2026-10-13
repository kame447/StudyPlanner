import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../../src/services/ai/openAiCompatibleClient';
import { createCandidateChoiceClient } from '../../../../src/services/ai/candidateChoiceClient';
import { choiceEvaluation, choiceRequest } from '../../../../shared/candidateChoiceFixtures.testUtils';

vi.mock('../../../../src/lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.fixture/chat/completions',
  usesCloudflareOpenAiProxy: () => true,
}));
vi.mock('../../../../src/lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'fixture-session' } }),
}));

const config = { provider: 'openai' as const, baseUrl: 'https://unused.fixture', model: 'unused', apiKey: '' };
const base = { requestId: 'request-correlation', inputRevision: 7 };
const contexts = [
  { ...base, purpose: 'focused_authorization', previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
    state: { currentUserText: 'private-input', lastAssistantMessage: null } },
  { ...base, purpose: 'focused_contextual_answer', questionCode: 'quantity_role_unresolved',
    state: { currentUserText: 'private-input', pendingQuestion: { targetQuantityRole: 'declared', questionBasis: null, hasEstimateTarget: false } } },
  { ...base, purpose: 'temporal_scope_repair', state: { sourceText: 'private-input', currentAttachedTask: { title: 'private-title' },
    interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } } },
  { ...base, purpose: 'user_context_routing', state: { currentUserText: 'private-input' } },
] as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  resetOpenAiCompatibleClientRequestBudgetForTest();
});

describe('purpose-independent response correlation at the consumer boundary', () => {
  it.each(contexts)('$purpose detaches correlation before the authentication await', async context => {
    const mutable = structuredClone({ ...context, inputRevision: 7, requestId: 'request-before' });
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).decisionContext).toMatchObject({ requestId: 'request-before', inputRevision: 7 });
      return Response.json({ content: 'captured-content', decisionContext: { requestId: 'request-before', inputRevision: 7 } });
    });
    vi.stubGlobal('fetch', transport);
    const pending = createOpenAiCompatibleClient(config).createChatCompletion({
      purpose: mutable.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
      messages: [{ role: 'user', content: 'private-input' }], decisionContext: mutable,
    });
    mutable.inputRevision = 8;
    mutable.requestId = 'request-after';
    expect(await pending).toBe('captured-content');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(contexts)('$purpose rejects a different request or revision without another provider send', async context => {
    for (const echo of [
      { ...base, requestId: 'another-request' },
      { ...base, inputRevision: 6 },
    ]) {
      const transport = vi.fn<typeof fetch>(async () => Response.json({ content: '{"decision":"fallback"}', decisionContext: echo }));
      vi.stubGlobal('fetch', transport);
      await expect(createOpenAiCompatibleClient(config).createChatCompletion({
        purpose: context.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
        messages: [{ role: 'user', content: 'private-input' }], decisionContext: context,
      })).rejects.toThrow('Decision response context did not match');
      expect(transport).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).decisionContext).toEqual(context);
    }
  });

  it.each(contexts)('$purpose accepts the captured request echo, preserving the baseline no-echo contract', async context => {
    for (const correlated of [true, false]) {
      const transport = vi.fn<typeof fetch>(async () => Response.json({ content: 'baseline-content',
        ...(correlated ? { decisionContext: base } : {}) }));
      vi.stubGlobal('fetch', transport);
      expect(await createOpenAiCompatibleClient(config).createChatCompletion({
        purpose: context.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
        messages: [{ role: 'user', content: 'private-input' }], decisionContext: context,
      })).toBe('baseline-content');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('candidate replies cannot cross request, selection epoch, candidate hash or menu node', async () => {
    const request = choiceRequest();
    for (const drift of [
      { requestId: 'another-request' }, { selectionEpoch: request.selectionEpoch + 1 },
      { candidateSetHash: `sha256:${'b'.repeat(64)}` }, { nodeId: 'another-node' },
    ]) {
      const transport = vi.fn<typeof fetch>(async () => Response.json({ ...choiceEvaluation(request), ...drift }));
      const client = createCandidateChoiceClient({
        proxyUrl: 'https://proxy.fixture/chat/completions', getToken: async () => 'fixture-session', transport,
        semanticPolicy: { calibrationEvidenceId: 'fixture-only-not-adoption', maximumConditionChange: 0.1, maximumIndependentMeaning: 0.1 },
      });
      await expect(client.choose(request, () => undefined)).rejects.toThrow('Unavailable or invalid candidate response');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
});
