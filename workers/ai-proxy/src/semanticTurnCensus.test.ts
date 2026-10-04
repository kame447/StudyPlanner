import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { ProductObservabilityStore } from './productObservabilityStore';
import { JEV_MODEL } from './decision/decisionPolicy';
import { projectSemanticCensusMetadata } from '../../../shared/semanticTurnCensus';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function run(options: { mode?: string; purpose?: string; sinkFailure?: boolean; census?: string; abstain?: boolean; jevWork?: Promise<Response>; sinkWork?: Promise<void>; invalidMessages?: boolean } = {}) {
  const events: unknown[] = []; const providerBodies: unknown[] = []; const background: Promise<unknown>[] = [];
  vi.spyOn(ProductObservabilityStore.prototype, 'storeSemanticCensus').mockImplementation(async (_uid, input) => {
    if (options.sinkFailure) throw new Error('private-sink-secret'); if (options.sinkWork) await options.sinkWork; events.push(input);
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'private-user-sentinel', emailVerified: true }] });
    providerBodies.push(JSON.parse(init?.body as string));
    if (url.includes('openrouter') && options.jevWork) return options.jevWork;
    if (url.includes('openrouter')) return Response.json({ model: JEV_MODEL.responses[1], answers: {
      authorization: { type: 'choice', choice: 'create_plan', confidence: options.abstain ? .5 : .999, probabilities: { create_plan: options.abstain ? .5 : 1, fallback: options.abstain ? .5 : 0 } },
      condition_change: { type: 'noul', noul: .001 }, independent_meaning: { type: 'noul', noul: .001 },
    } });
    return Response.json({ choices: [{ message: { content: 'private-generated-output' } }] });
  }));
  const turnId = crypto.randomUUID(); const requestId = crypto.randomUUID();
  const purpose = options.purpose ?? 'weekly_planning_semantic_normalizer';
  const payload = { purpose, messages: options.invalidMessages ? [] : [{ role: 'user', content: '生の発話-private-sentinel' }],
    semanticCensus: { version: 1, domain: purpose === 'user_context_interpreter' ? 'user-context' : 'weekly-planning', turnId, requestId, stage: 'focused' },
    decisionContext: purpose === 'weekly_planning_semantic_normalizer' ? {
      purpose: 'focused_authorization', requestId: 'existing-private-request-id', inputRevision: 7,
      previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
      state: { currentUserText: 'private-current-text', lastAssistantMessage: 'private-generated-history' },
    } : undefined,
  };
  const env = { OPENAI_API_KEY: 'private-api-key', OPENROUTER_API_KEY: 'private-jev-key', FIREBASE_WEB_API_KEY: 'test',
    JEV_MODE: options.mode ?? 'off', JEV_CANARY_PERCENT: '100', SEMANTIC_CENSUS_MODE: options.census ?? 'typed',
    OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true }) }) },
  };
  const response = worker.fetch(new Request('https://proxy.test/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer private-token' }, body: JSON.stringify(payload) }), env as never, undefined, { waitUntil: (work: Promise<unknown>) => background.push(work) } as ExecutionContext);
  return { response, events, providerBodies, turnId, requestId, async settle() { await Promise.allSettled(background); } };
}
describe('production Worker census wrapper', () => {
  it.each(['off', 'canary'])('observes physical provider dispatch in %s without forwarding census to providers', async (mode) => {
    const h = run({ mode }); const response = await h.response; expect(response.status).toBe(200);
    await h.settle(); expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ joined: true, turnId: h.turnId, requestId: h.requestId, integrity: 'complete',
      lunaDispatches: mode === 'off' ? 1 : 0, jevDispatches: mode === 'off' ? 0 : 1 });
    expect(JSON.stringify(h.events)).not.toContain('private-');
    expect(JSON.stringify(h.providerBodies)).not.toContain('semanticCensus');
    expect(JSON.stringify(h.providerBodies)).not.toContain(h.turnId);
    expect(JSON.stringify(h.providerBodies)).not.toContain(h.requestId);
  });
  it('retains both physical sends of a Jev abstention and whole-request Luna fallback', async () => {
    const h = run({ mode: 'canary', abstain: true }); expect((await h.response).status).toBe(200); await h.settle();
    expect(h.events[0]).toMatchObject({ route: 'jev-then-luna', integrity: 'complete', lunaDispatches: 1, jevDispatches: 1 });
    expect(h.providerBodies).toHaveLength(2);
  });
  it('retains background shadow observation beyond the main user response', async () => {
    let release!: (response: Response) => void;
    const jevWork = new Promise<Response>((resolve) => { release = resolve; });
    const h = run({ mode: 'shadow', jevWork }); expect((await h.response).status).toBe(200);
    expect(h.events).toEqual([]);
    release(Response.json({ model: JEV_MODEL.responses[1], answers: {} })); await h.settle();
    expect(h.events[0]).toMatchObject({ lunaDispatches: 1, jevDispatches: 1, lateWork: true });
  });
  it('never awaits a slow census write before returning the original user response', async () => {
    let release!: () => void;
    const sinkWork = new Promise<void>((resolve) => { release = resolve; });
    const h = run({ sinkWork }); const response = await h.response;
    expect(await response.json()).toMatchObject({ content: 'private-generated-output' });
    expect(h.events).toEqual([]); release(); await h.settle(); expect(h.events).toHaveLength(1);
  });
  it('records authenticated schema rejection as a request-scope known zero without claiming semantic success', async () => {
    const h = run({ invalidMessages: true }); expect((await h.response).status).toBe(400); await h.settle();
    expect(h.events[0]).toMatchObject({ integrity: 'complete', route: 'rejected', outcome: 'failure', lunaDispatches: 0, jevDispatches: 0 });
    expect(h.events[0]).not.toHaveProperty('semanticResolution'); expect(h.providerBodies).toHaveLength(0);
  });
  it('keeps missing usage/cost NA and weekly/user-context populations separate', async () => {
    const h = run({ purpose: 'user_context_interpreter' }); await h.response; await h.settle();
    expect(h.events[0]).toMatchObject({ domain: 'user-context', lunaDispatches: 1, usage: { inputTokens: null, outputTokens: null, costUsd: null } });
  });
  it('does not delay or change the response when persistence fails', async () => {
    const h = run({ sinkFailure: true }); const response = await h.response;
    expect(await response.json()).toMatchObject({ content: 'private-generated-output' }); await h.settle();
    expect(h.providerBodies).toHaveLength(1); expect(h.events).toHaveLength(0);
  });
  it.each(['off', 'renderer'])('collects nothing for %s', async (kind) => {
    const h = run(kind === 'off' ? { census: 'off' } : { purpose: 'weekly_planning_renderer' });
    await h.response; await h.settle(); expect(h.events).toEqual([]);
  });
  it('keeps closed metadata fields unavailable rather than manufacturing semantic truth', () => {
    expect(projectSemanticCensusMetadata({ questionCode: 'missing_effort_estimate', targetCount: 1 })).toMatchObject({ targetCount: 1, propositionCount: null, propositionCategories: null, candidateCount: null, binding: 'unknown' });
  });
});
