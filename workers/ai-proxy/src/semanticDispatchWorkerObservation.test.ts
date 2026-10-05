import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { createSemanticRequestRecorder } from '../../../shared/semanticDispatchRecorder';
import { summarizeSemanticTurn, type SemanticTurnObservation } from '../../../shared/semanticDispatchLedger';
import { JEV_MODEL } from './decision/decisionPolicy';

const privateText = 'private-weekly-user-text';
const decisionContext = { purpose: 'focused_authorization', requestId: 'fixture-request-305', inputRevision: 7, previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false, state: { currentUserText: privateText, lastAssistantMessage: 'private-assistant-text' } };
function jev(accept = true) {
  return Response.json({ model: JEV_MODEL.responses[1], answers: {
    authorization: { type: 'choice', choice: 'create_plan', confidence: accept ? .999 : .5, probabilities: { create_plan: accept ? 1 : .5, fallback: accept ? 0 : .5 } },
    condition_change: { type: 'noul', noul: .001 }, independent_meaning: { type: 'noul', noul: .001 },
  }, usage: { input_tokens: 2, output_tokens: 1, cost: .001 } });
}
function harness(options: { mode?: string; masterMode?: string; domain?: 'weekly-planning' | 'user-context'; auth?: boolean; quota?: boolean; jev?: () => Promise<Response>; luna?: () => Promise<Response>; payload?: Record<string, unknown>; observed?: boolean } = {}) {
  const population = { source: 'fixture', domain: options.domain ?? 'weekly-planning', arm: 'baseline', corpusId: crypto.randomUUID() } as const;
  const turnId = crypto.randomUUID(); const requestId = crypto.randomUUID();
  const recorder = createSemanticRequestRecorder({ population, turnId, requestId, stage: 'focused', boundary: 'worker' });
  const startedAtMs = recorder.snapshot().startedAtMs;
  const calls: string[] = []; const background: Promise<unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    if (url.includes('identitytoolkit')) return Response.json({ users: options.auth === false ? [] : [{ localId: 'fixture-user', emailVerified: true }] });
    if (url.includes('openrouter')) return options.jev ? options.jev() : jev();
    if (url.includes('/chat/completions')) return options.luna ? options.luna() : Response.json({ choices: [{ message: { content: '{"decision":"fallback"}' } }] });
    throw new Error('Unexpected network path.');
  }));
  const purpose = (options.payload?.decisionContext as { purpose?: string } | undefined)?.purpose ?? decisionContext.purpose;
  const prefix = ({ focused_authorization: 'FOCUSED_AUTHORIZATION', focused_contextual_answer: 'FOCUSED_CONTEXTUAL_ANSWER', temporal_scope_repair: 'TEMPORAL_SCOPE_REPAIR', user_context_routing: 'USER_CONTEXT_ROUTING' } as Record<string, string>)[purpose];
  const env = { OPENAI_API_KEY: 'private-api-key', OPENROUTER_API_KEY: 'private-jev-key', FIREBASE_WEB_API_KEY: 'test', JEV_MODE: options.masterMode ?? options.mode ?? 'off', JEV_CANARY_PERCENT: '100',
    [`JEV_${prefix}_MODE`]: options.mode ?? 'off', [`JEV_${prefix}_CANARY_PERCENT`]: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: options.quota !== false, retryAfterSeconds: 1 }) }) } };
  const request = new Request('https://proxy.test/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer private-auth-token' }, body: JSON.stringify(options.payload ?? { purpose: 'weekly_planning_semantic_normalizer', decisionContext, messages: [{ role: 'user', content: privateText }] }) });
  const run = worker.fetch(request, env as never, undefined, { waitUntil: (promise: Promise<unknown>) => { background.push(promise); } } as ExecutionContext, undefined, options.observed === false ? undefined : recorder);
  return { run, recorder, calls, async summary() {
    await recorder.settle(); await Promise.allSettled(background);
    const turn: SemanticTurnObservation = { version: 1, population, turnId, pairId: crypto.randomUUID(), expectedRequestIds: [requestId], sealed: true, startedAtMs, completedAtMs: recorder.snapshot().settledAtMs, semanticResolution: 'unknown' };
    return summarizeSemanticTurn(turn, [recorder.snapshot()]);
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('actual Worker semantic sends (mock network only)', () => {
  it.each([
    { kind: 'authorization', domain: 'weekly-planning', context: decisionContext },
    { kind: 'contextual', domain: 'weekly-planning', context: { purpose: 'focused_contextual_answer', requestId: 'mixed-contextual', inputRevision: 1, questionCode: 'quantity_role_unresolved', state: { currentUserText: privateText, pendingQuestion: { targetQuantityRole: 'declared', questionBasis: null, hasEstimateTarget: false } } } },
    { kind: 'temporal', domain: 'weekly-planning', context: { purpose: 'temporal_scope_repair', requestId: 'mixed-temporal', inputRevision: 1, state: { sourceText: privateText, currentAttachedTask: { title: 'private-title' }, interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } } } },
    { kind: 'user-context', domain: 'user-context', context: { purpose: 'user_context_routing', requestId: 'mixed-user-context', inputRevision: 0, state: { currentUserText: privateText } } },
  ] as const)('records effective $kind shadow under global canary, never semantic fallback', async ({ domain, context }) => {
    let release!: (response: Response) => void;
    const late = new Promise<Response>(resolve => { release = resolve; });
    const h = harness({ mode: 'shadow', masterMode: 'canary', domain, jev: () => late,
      payload: { purpose: domain === 'user-context' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
        decisionContext: context, messages: [{ role: 'user', content: privateText }] } });
    const response = await h.run;
    expect(await response.json()).toMatchObject({ content: '{"decision":"fallback"}' });
    expect(h.recorder.snapshot().settledAtMs).toBeNull();
    release(jev());
    expect(await h.summary()).toMatchObject({ status: 'known', jevDispatches: 1, lunaDispatches: 1,
      // The summary counts Luna stages; the recorder below also proves Jev's stage.
      dispatchesByStage: { shadow: 0, focused: 1, fallback: 0 } });
    expect(h.recorder.snapshot().dispatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'jev', stage: 'shadow' }),
      expect.objectContaining({ family: 'luna', stage: 'focused' }),
    ]));
  });
  it('counts zero Luna for a Jev-fulfilled proxy success', async () => {
    const h = harness({ mode: 'canary' }); expect((await h.run).status).toBe(200);
    expect(await h.summary()).toMatchObject({ status: 'known', lunaDispatches: 0, jevDispatches: 1 });
    expect(h.calls.filter((url) => url.includes('/chat/completions'))).toHaveLength(0);
  });
  it('counts both Jev and Luna in one fallback request', async () => {
    const h = harness({ mode: 'canary', jev: async () => jev(false) }); await h.run;
    expect(await h.summary()).toMatchObject({ lunaDispatches: 1, jevDispatches: 1, lunaFree: false, dispatchesByStage: { fallback: 1 } });
  });
  it.each(['auth', 'schema', 'budget'])('records %s rejection before providers as zero without claiming success', async (reason) => {
    const h = harness({ auth: reason !== 'auth', quota: reason !== 'budget', payload: reason === 'schema' ? { purpose: 'weekly_planning_semantic_normalizer', messages: [] } : undefined });
    expect((await h.run).status).toBeGreaterThanOrEqual(400);
    expect(await h.summary()).toMatchObject({ status: 'known', lunaDispatches: 0, semanticResolution: 'unknown' });
  });
  it.each(['network', 'http', 'invalid'])('counts post-send %s failure despite absent usage', async (reason) => {
    const h = harness({ luna: async () => {
      if (reason === 'network') throw new Error('private-provider-failure');
      return new Response(reason === 'invalid' ? 'private-invalid-output' : '{}', { status: reason === 'http' ? 503 : 200 });
    } });
    expect((await h.run).status).toBeGreaterThanOrEqual(400);
    expect(await h.summary()).toMatchObject({ lunaDispatches: 1, lunaFree: false, usage: { costUsd: null } });
    expect(JSON.stringify(h.recorder.snapshot())).not.toContain('private-');
  });
  it('retains shadow work after the main response until it settles', async () => {
    let release!: (value: Response) => void;
    const late = new Promise<Response>((resolve) => { release = resolve; });
    const h = harness({ mode: 'shadow', jev: () => late }); await h.run;
    expect(h.recorder.snapshot().mainCompletedAtMs).not.toBeNull();
    expect(h.recorder.snapshot().settledAtMs).toBeNull();
    release(jev());
    expect(await h.summary()).toMatchObject({ status: 'known', lunaDispatches: 1, jevDispatches: 1 });
  });
  it('leaves the default path free of new collection or wire fields', async () => {
    const h = harness({ observed: false }); const response = await h.run;
    expect(await response.json()).toEqual({ content: '{"decision":"fallback"}' });
    expect(h.recorder.snapshot().dispatches).toEqual([]);
    expect(h.calls).toHaveLength(2);
  });
  it('excludes renderer calls and mixed domains instead of treating them as semantic evidence', async () => {
    const h = harness({ payload: { purpose: 'weekly_planning_renderer', messages: [{ role: 'user', content: privateText }] } }); await h.run;
    expect(await h.summary()).toMatchObject({ status: 'unknown', lunaDispatches: null });
    expect(h.recorder.snapshot().dispatches).toEqual([]);
  });
  it.each(['contextual', 'temporal', 'user-context'])('observes both providers through the existing %s injection port', async (kind) => {
    const context = kind === 'contextual' ? { purpose: 'focused_contextual_answer', requestId: 'request-contextual-fixture', inputRevision: 1, questionCode: 'quantity_role_unresolved', state: { currentUserText: privateText, pendingQuestion: { targetQuantityRole: 'declared', questionBasis: null, hasEstimateTarget: false } } }
      : kind === 'temporal' ? { purpose: 'temporal_scope_repair', requestId: 'request-temporal-fixture', inputRevision: 1, state: { sourceText: privateText, currentAttachedTask: { title: 'private-task-title' }, interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } } }
      : { purpose: 'user_context_routing', requestId: 'request-user-context-fixture', inputRevision: 0, state: { currentUserText: privateText } };
    // Authorization-shaped response is invalid for these catalogs, forcing the existing whole-request fallback.
    const h = harness({ mode: 'canary', domain: kind === 'user-context' ? 'user-context' : 'weekly-planning', payload: { purpose: kind === 'user-context' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer', decisionContext: context, messages: [{ role: 'user', content: privateText }] } });
    await h.run; expect(await h.summary()).toMatchObject({ status: 'known', lunaDispatches: 1, jevDispatches: 1 });
  });
});
