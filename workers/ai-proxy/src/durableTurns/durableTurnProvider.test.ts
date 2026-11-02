import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDurableTurnProvider, createDurableReplyReferenceChoicePort, createDurableVNextOptionChoicePort } from './durableTurnProvider';
import { VNEXT_OPTION_CHOICE_POLICY, VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeInterpreter';
import { choiceRequest, choiceEvaluation } from '../../../../shared/candidateChoiceFixtures.testUtils';
import type { AiProxyWorkerEnv } from '../worker';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('durable provider uses the existing proxy policy', () => {
  it('keeps per-IP/per-owner quota, purpose model, token budget and timeout', async () => {
    const checkAndConsume = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })); const getByName = vi.fn(() => ({ checkAndConsume }));
    const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName } } as unknown as AiProxyWorkerEnv;
    const fetch = vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'reply' } }] })); vi.stubGlobal('fetch', fetch);
    const dispatch = vi.fn(async (_request: string, send: () => Promise<string>) => send());
    const client = createDurableTurnProvider(env, 'alice', dispatch, '192.0.2.10');
    expect(await client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' })).toBe('reply');
    expect(getByName.mock.calls.map(([name]) => name)).toEqual(['ip:192.0.2.10', 'uid:alice']);
    const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 800 });
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
    expect(dispatch).toHaveBeenCalledTimes(1); expect(dispatch.mock.calls[0][0]).not.toContain('server-key');
  });
  it('quota failure prevents the provider request', async () => {
    const env = { OPENAI_API_KEY: 'server-key', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: false, retryAfterSeconds: 10 }) }) } } as unknown as AiProxyWorkerEnv;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send());
    await expect(client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('caps each dispatch by the remaining alarm execution deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'reply' } }] })));
    const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send(), 'unknown', Date.now() + 2500);
    await client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' });
    expect(timeout.mock.calls[0][0]).toBeGreaterThan(0);
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(2500);
  });

  it.each([new DOMException('private timeout details', 'TimeoutError'), new TypeError('private network details')])(
    'retains a safe transport classification instead of a generic provider_error', async error => {
      const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
      const fetch = vi.fn(async () => { throw error; }); vi.stubGlobal('fetch', fetch);
      const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send());
      await expect(client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' }))
        .rejects.toMatchObject({ providerFailure: { kind: error.name === 'TimeoutError' ? 'timeout' : 'network_error', httpStatus: 502, upstreamStatus: null } });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

});


describe('durable Jev reference choice journaling', () => {
  const request = () => {
    const original = choiceRequest();
    return { ...original, context: { ...original.context,
      question: { id: 'reply-target', code: 'reply_reference_target' },
      target: { kind: 'reply_reference', id: 'current_conversation' },
      scope: { referenceKind: 'existing_fact', selectionKind: 'target_slot_only' } } };
  };

  it('checks the frozen choice even when a durable replay returns cached provider evidence', async () => {
    const r = request();
    const before = vi.fn();
    const dispatch = vi.fn(async (_body: string, _send: () => Promise<string>) => JSON.stringify(choiceEvaluation(r)));
    const port = createDurableReplyReferenceChoicePort(
      {} as AiProxyWorkerEnv, 'owner', dispatch,
      { calibrationEvidenceId: 'test-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 });
    const selected = await port.choose(r, before);
    expect(before).toHaveBeenCalledTimes(1);
    expect(selected).toMatchObject({
      nodeId: r.menu.nodeId, optionId: 'leaf:0', semanticSufficiency: 'only_candidate_meaning',
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(dispatch.mock.calls[0][0]);
    expect(body.purpose).toBe('weekly_planning_semantic_normalizer');
    expect(body.decisionContext.request).toEqual(r);
    expect(body).not.toHaveProperty('ownerId');
  });

  it('rejects invalid or extra-meaning answers without changing the durable transcript', async () => {
    const r = request();
    const policy = { calibrationEvidenceId: 'test-only',
      maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 };
    const extra = createDurableReplyReferenceChoicePort({} as AiProxyWorkerEnv, 'owner',
      async () => JSON.stringify({ ...choiceEvaluation(r), independentMeaning: 0.5 }), policy);
    expect(await extra.choose(r, () => {})).toMatchObject({ semanticSufficiency: 'extra_or_uncertain_meaning' });
    const bad = createDurableReplyReferenceChoicePort({} as AiProxyWorkerEnv, 'owner',
      async () => JSON.stringify({ ...choiceEvaluation(r), candidateSetHash: 'sha256:tampered' }), policy);
    await expect(bad.choose(r, () => {})).rejects.toThrow('Invalid durable Jev reference choice result');
  });
});

describe('durable VNext closed-choice port (Jev) in the Worker', () => {
  const calibration = { policy: VNEXT_OPTION_CHOICE_POLICY, semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY };
  const request = () => choiceRequest();

  it('runs the frozen dev calibration, not a tuned or implicit one', () => {
    expect(VNEXT_OPTION_CHOICE_POLICY).toMatchObject({ id: 'vnext-frozen-dev', calibrationEvidenceId: 'vnext-dev-frozen-a25c9899' });
    expect(VNEXT_OPTION_CHOICE_SEMANTIC_POLICY).toEqual({ calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 });
  });

  it('journals the choice: the beforeDispatch gate runs even for a cached replay, and the gate result is the shared mapping', async () => {
    const r = request(); const before = vi.fn(); const observed = vi.fn();
    const dispatch = vi.fn(async (_body: string, _send: () => Promise<string>) => JSON.stringify(choiceEvaluation(r)));
    const port = createDurableVNextOptionChoicePort({} as AiProxyWorkerEnv, 'owner', dispatch, calibration);
    const selected = await port.choose(r, before, observed);
    expect(before).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(dispatch.mock.calls[0][0]).decisionContext.request).toEqual(r);
    expect(selected).toMatchObject({ nodeId: r.menu.nodeId, optionId: 'leaf:0', semanticSufficiency: 'only_candidate_meaning' });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ optionId: 'leaf:0' }), calibration.semanticPolicy);
  });

  it('treats extra meaning as insufficient and rejects a tampered or unavailable answer (negative controls)', async () => {
    const r = request();
    const extra = createDurableVNextOptionChoicePort({} as AiProxyWorkerEnv, 'owner',
      async () => JSON.stringify({ ...choiceEvaluation(r), independentMeaning: 0.9 }), calibration);
    expect(await extra.choose(r, () => {})).toMatchObject({ semanticSufficiency: 'extra_or_uncertain_meaning' });
    const tampered = createDurableVNextOptionChoicePort({} as AiProxyWorkerEnv, 'owner',
      async () => JSON.stringify({ ...choiceEvaluation(r), candidateSetHash: 'sha256:tampered' }), calibration);
    await expect(tampered.choose(r, () => {})).rejects.toThrow('Invalid durable Jev VNext option choice result');
    const env = { OPENAI_API_KEY: 'k', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: false, retryAfterSeconds: 5 }) }) } } as unknown as AiProxyWorkerEnv;
    vi.stubGlobal('fetch', vi.fn());
    const quota = createDurableVNextOptionChoicePort(env, 'owner', async (_body, send) => send(), calibration);
    await expect(quota.choose(r, () => {})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
