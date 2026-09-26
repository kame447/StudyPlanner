import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { JEV_MODEL } from './decisionPolicy';
import { observeAiProxyRequest } from '../aiProxyRequestObserver';

const context = {
  purpose: 'focused_authorization', requestId: 'request-fixture-305', inputRevision: 7,
  previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
  state: { currentUserText: 'private-user-text', lastAssistantMessage: 'private-assistant-context' },
};
const calls: string[] = [];
let jevResponse: () => Promise<Response>;
let quotaAllowed = true;
let authAllowed = true;
let baselineStatus = 200;

function validResponse(independentMeaning = 0.001) {
  return {
    model: JEV_MODEL.responses[1],
    answers: {
      authorization: { type: 'choice', choice: 'create_plan', confidence: 0.999, probabilities: { create_plan: 1, fallback: 0 } },
      condition_change: { type: 'noul', noul: 0.001 },
      independent_meaning: { type: 'noul', noul: independentMeaning },
    },
    usage: { input_tokens: 200, output_tokens: 30, cost: 0.0000084 },
  };
}

function execute(mode = 'off', options: { origin?: string; payload?: Record<string, unknown>; noLifecycle?: boolean } = {}) {
  const pending: Promise<unknown>[] = [];
  const env = {
    OPENAI_API_KEY: crypto.randomUUID(), OPENROUTER_API_KEY: crypto.randomUUID(),
    FIREBASE_WEB_API_KEY: 'public-test-project', ALLOWED_ORIGIN: 'https://app.example',
    JEV_MODE: mode, JEV_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: quotaAllowed, retryAfterSeconds: 1 }) }) },
  };
  const response = worker.fetch(new Request('https://proxy.example/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer test-session', Origin: options.origin ?? 'https://app.example' },
    body: JSON.stringify({
      purpose: 'weekly_planning_semantic_normalizer',
      messages: [{ role: 'user', content: 'baseline-messages' }],
      decisionContext: context, ...options.payload,
    }),
  }), env as never, undefined, options.noLifecycle ? undefined : { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext);
  return { response, pending, env };
}

beforeEach(() => {
  calls.length = 0;
  quotaAllowed = true;
  authAllowed = true;
  baselineStatus = 200;
  jevResponse = async () => Response.json(validResponse());
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('identitytoolkit')) return Response.json({ users: authAllowed ? [{ localId: 'user-fixture', emailVerified: true }] : [] });
    if (url.endsWith('/api/alpha/decisions')) {
      const payload = JSON.parse(String(init?.body));
      expect(payload.state).toEqual(context.state);
      expect(payload).not.toHaveProperty('requestId');
      expect(payload).not.toHaveProperty('inputRevision');
      return jevResponse();
    }
    if (url.endsWith('/chat/completions')) {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('decisionContext');
      return Response.json({ choices: [{ message: { content: '{"decision":"fallback"}' } }], usage: { prompt_tokens: 10 } }, { status: baselineStatus });
    }
    throw new Error('Unexpected network call');
  }));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('focused authorization deployed proxy dispatch', () => {
  it('off preserves the original response and does not call Jev', async () => {
    const { response } = execute();
    expect(await (await response).json()).toEqual({ content: '{"decision":"fallback"}', usage: { prompt_tokens: 10 } });
    expect(calls.some((url) => url.includes('openrouter'))).toBe(false);
  });

  it('shadow returns the baseline without waiting for Jev and never uses its decision', async () => {
    let finish!: (value: Response) => void;
    jevResponse = () => new Promise((resolve) => { finish = resolve; });
    const { response, pending } = execute('shadow');
    expect((await (await response).json() as { content: string }).content).toBe('{"decision":"fallback"}');
    expect(pending).toHaveLength(1);
    finish(Response.json(validResponse()));
    await Promise.all(pending);
    expect(console.info).toHaveBeenCalledWith('[AI Decision]', expect.objectContaining({ outcome: 'shadow', comparisonMatches: false }));
  });

  it('does not start shadow work without waitUntil', async () => {
    await execute('shadow', { noLifecycle: true }).response;
    expect(calls.some((url) => url.includes('openrouter'))).toBe(false);
  });

  it('telemetry failure cannot replace the baseline response in shadow', async () => {
    vi.mocked(console.info).mockImplementation(() => { throw new Error('telemetry failure'); });
    const { response, pending } = execute('shadow');
    expect(await (await response).json()).toMatchObject({ content: '{"decision":"fallback"}' });
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  it('canary accepts a gated draft decision and avoids a spurious OpenAI metric', async () => {
    const { response, pending, env } = execute('canary');
    const result = await response;
    expect(await result.clone().json()).toMatchObject({ content: '{"decision":"create_plan"}', decisionContext: { inputRevision: 7, requestId: context.requestId } });
    expect(calls.filter((url) => url.endsWith('/chat/completions'))).toHaveLength(0);
    await Promise.all(pending);
    expect(console.info).toHaveBeenCalledWith('[AI Decision]', expect.objectContaining({ outcome: 'success', inputTokens: 200, reportedCostUsd: 0.0000084 }));
    const count = calls.length;
    await observeAiProxyRequest({ request: new Request('https://proxy.example/chat/completions', { method: 'POST' }), response: result, env: { ...env, OBSERVABILITY_IDENTITY_SECRET: 'x'.repeat(32) } as never, startedAtMs: 0, occurredAt: '' });
    expect(calls).toHaveLength(count);
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logged).not.toContain(context.state.currentUserText);
    expect(logged).not.toContain(context.state.lastAssistantMessage);
    expect(logged).not.toContain(env.OPENROUTER_API_KEY);
  });

  it('sends definite mixed meaning to generic without a focused LLM overriding the guard', async () => {
    jevResponse = async () => Response.json(validResponse(0.99));
    expect(await (await execute('canary').response).json()).toMatchObject({ content: '{"decision":"fallback"}' });
    expect(calls.filter((url) => url.endsWith('/chat/completions'))).toHaveLength(0);
  });

  it.each(['uncertain', 'malformed', '429', '500'])('falls back to the existing focused LLM on %s', async (kind) => {
    jevResponse = async () => {
      if (kind === 'malformed') return new Response('not-json');
      if (kind === '429' || kind === '500') return Response.json({}, { status: Number(kind) });
      const value = validResponse();
      value.answers.authorization.confidence = 0.5;
      return Response.json(value);
    };
    const { response, pending } = execute('canary');
    expect(await (await response).json()).toMatchObject({ content: '{"decision":"fallback"}' });
    await Promise.all(pending);
    expect(calls.filter((url) => url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(console.info).toHaveBeenCalledWith('[AI Decision]', expect.objectContaining({ outcome: 'fallback' }));
  });

  it('retains controlled failure when both providers fail', async () => {
    jevResponse = async () => Response.json({}, { status: 503 });
    baselineStatus = 503;
    expect((await execute('canary').response).status).toBe(502);
  });

  it('enforces origin, session, quota and bounded context before paid provider calls', async () => {
    expect((await execute('canary', { origin: 'https://untrusted.example' }).response).status).toBe(403);
    authAllowed = false;
    expect((await execute('canary').response).status).toBe(401);
    authAllowed = true;
    quotaAllowed = false;
    expect((await execute('canary').response).status).toBe(429);
    quotaAllowed = true;
    expect((await execute('canary', { payload: { decisionContext: { ...context, model: 'other' } } }).response).status).toBe(400);
    expect((await execute('canary', { payload: { decisionContext: { ...context, hasPendingQuestion: true } } }).response).status).toBe(400);
    expect(calls.some((url) => url.includes('openrouter') || url.includes('api.openai.com'))).toBe(false);
  });
});
