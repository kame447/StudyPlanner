import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import { canarySelected, decisionMode, gateDecision, JEV_MODEL } from './decisionPolicy';

const state = { currentUserText: '今の条件で計画案を作ってください', lastAssistantMessage: 'この条件で計画案を作りますか？' };

export function decisionResponse() {
  return {
    model: JEV_MODEL.responses[1],
    answers: {
      authorization: { type: 'choice', choice: 'create_plan', confidence: 0.999, probabilities: { create_plan: 0.9999, fallback: 0.0001 } },
      condition_change: { type: 'noul', noul: 0.001 },
      independent_meaning: { type: 'noul', noul: 0.001 },
    },
    usage: { input_tokens: 320, output_tokens: 40, cost: 0.00001344 },
  };
}

function adapter(value: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(value), { status }));
  const provider = createOpenRouterDecisionProvider({ apiKey: crypto.randomUUID(), fetch: fetchMock });
  return { provider, fetchMock };
}

afterEach(() => vi.useRealTimers());

describe('OpenRouter Decisions contract and gates', () => {
  it('uses the verified Decisions endpoint, pinned model and typed questions, retaining usage/cost', async () => {
    const { provider, fetchMock } = adapter(decisionResponse());
    const result = await provider.evaluate(state);
    expect(result).toMatchObject({ status: 'evaluated', decision: 'create_plan', metadata: { inputTokens: 320, outputTokens: 40, costUsd: 0.00001344 } });
    expect(gateDecision(result)).toEqual({ status: 'accepted', decision: 'create_plan' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(init?.redirect).toBe('manual');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(JEV_MODEL.request);
    expect(body.state).toEqual(state);
    expect(body.questions.authorization.type).toBe('choice');
    expect(body.questions.condition_change.type).toBe('noul');
    expect(body).not.toHaveProperty('messages');
  });

  it.each([401, 402, 429, 500, 503])('does not retry HTTP %i or retain upstream error text', async (status) => {
    const { provider, fetchMock } = adapter({ error: 'private-upstream-message' }, status);
    const result = await provider.evaluate(state);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private-upstream-message');
  });

  it.each([301, 302, 303, 307, 308])('rejects redirect %i without forwarding credentials to its destination', async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status, headers: { Location: 'https://untrusted.example/decisions' } });
    });
    const provider = createOpenRouterDecisionProvider({ apiKey: crypto.randomUUID(), fetch: fetchMock });
    expect(await provider.evaluate(state)).toMatchObject({ status: 'unavailable', reason: 'http', httpStatus: status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing head', (x: any) => { delete x.answers.condition_change; }],
    ['unknown choice', (x: any) => { x.answers.authorization.choice = 'save'; }],
    ['string confidence', (x: any) => { x.answers.authorization.confidence = '1'; }],
    ['out of range Noul', (x: any) => { x.answers.independent_meaning.noul = 2; }],
    ['extra choice', (x: any) => { x.answers.authorization.probabilities.save = 0; }],
    ['invalid sum', (x: any) => { x.answers.authorization.probabilities.fallback = 0.6; }],
    ['contradictory choice', (x: any) => { x.answers.authorization.choice = 'fallback'; }],
    ['null answer', (x: any) => { x.answers = null; }],
  ])('rejects %s', async (_name, mutate) => {
    const value = decisionResponse();
    mutate(value);
    expect(await adapter(value).provider.evaluate(state)).toMatchObject({ status: 'unavailable', reason: 'invalid_response' });
  });

  it.each(['typesafe/jev-latest', 'typesafe/jev-1.14', 'typesafe/jev-1.13-20990101', null])('rejects an unverified model %s', async (model) => {
    expect(await adapter({ ...decisionResponse(), model }).provider.evaluate(state))
      .toMatchObject({ status: 'unavailable', reason: 'model_mismatch' });
  });

  it('abstains at a boundary or conflicting auxiliary head, and routes definite mixed meaning to generic', async () => {
    const low = decisionResponse();
    low.answers.authorization.confidence = 0.8;
    expect(gateDecision(await adapter(low).provider.evaluate(state))).toMatchObject({ status: 'abstained' });
    const mixed = decisionResponse();
    mixed.answers.independent_meaning.noul = 0.5;
    expect(gateDecision(await adapter(mixed).provider.evaluate(state))).toMatchObject({ status: 'abstained' });
    mixed.answers.independent_meaning.noul = 0.99;
    expect(gateDecision(await adapter(mixed).provider.evaluate(state))).toEqual({ status: 'accepted', decision: 'fallback' });
  });

  it('keeps missing usage and cost unknown', async () => {
    const value = { ...decisionResponse(), usage: {} };
    expect(await adapter(value).provider.evaluate(state)).toMatchObject({ metadata: { inputTokens: null, outputTokens: null, costUsd: null } });
  });

  it('covers missing credentials, invalid JSON and network errors without propagating secrets', async () => {
    expect(await createOpenRouterDecisionProvider({}).evaluate(state)).toMatchObject({ reason: 'configuration' });
    const provider = createOpenRouterDecisionProvider({ apiKey: crypto.randomUUID(), fetch: vi.fn(async () => new Response('invalid')) });
    expect(await provider.evaluate(state)).toMatchObject({ reason: 'invalid_response' });
    const network = createOpenRouterDecisionProvider({ apiKey: crypto.randomUUID(), fetch: vi.fn(async () => { throw new Error('private-network-message'); }) });
    const result = await network.evaluate(state);
    expect(result).toMatchObject({ reason: 'network' });
    expect(JSON.stringify(result)).not.toContain('private-network-message');
  });

  it('bounds response-body time and distinguishes cancellation', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn<typeof fetch>(async (_url, init) => ({
      ok: true,
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
      }),
    } as Response));
    const provider = createOpenRouterDecisionProvider({ apiKey: crypto.randomUUID(), fetch: hangingFetch, timeoutMs: 100 });
    const pending = provider.evaluate(state);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ reason: 'timeout' });
    const controller = new AbortController();
    controller.abort();
    expect(await provider.evaluate(state, controller.signal)).toMatchObject({ reason: 'cancelled' });
  });

  it('defaults off and requires an explicit valid canary percentage', () => {
    expect(decisionMode({})).toBe('off');
    expect(decisionMode({ JEV_MODE: 'typo' })).toBe('off');
    expect(canarySelected({ JEV_MODE: 'canary' }, 0)).toBe(false);
    expect(canarySelected({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '5' }, 0.04)).toBe(true);
    expect(canarySelected({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '5' }, 0.06)).toBe(false);
    expect(canarySelected({ JEV_MODE: 'off', JEV_CANARY_PERCENT: '100' }, 0)).toBe(false);
  });
});
