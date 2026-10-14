import { createBoundFocusedContextualContextFixtureV5, focusedContextualSourceMessagesFixtureV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5.testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionEvaluation, DecisionMetadata, DecisionQuestionCatalog } from './decisionProvider';
import { AUTHORIZATION_QUESTIONS, gateDecision, JEV_MODEL, JEV_TIMEOUT_MS } from './decisionPolicy';
import { CONTEXTUAL_DECISION_CATALOG } from './contextualDecisionPolicy';
import { TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG } from './temporalScopeRepairDecisionPolicy';
import { USER_CONTEXT_ROUTING_DECISION_CATALOG } from './userContextRoutingPolicy';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import { dispatchFocusedAuthorization } from './focusedAuthorizationDispatch';
import { dispatchFocusedContextual } from './focusedContextualDispatch';
import { dispatchTemporalScopeRepair } from './temporalScopeRepairDispatch';
import { dispatchUserContextRouting } from './userContextRoutingDispatch';
import { jevExecutionMode } from './decisionExecutionMarker';

const metadata: DecisionMetadata = {
  provider: 'openrouter', requestedModel: JEV_MODEL.request, servedModel: JEV_MODEL.request,
  latencyMs: 1, inputTokens: null, outputTokens: null, costUsd: null,
  requestBytes: 40, responseBytes: 100,
};
const authorizationCatalog: DecisionQuestionCatalog<string> = {
  questions: AUTHORIZATION_QUESTIONS, choiceAnswerKey: 'authorization',
  decisions: ['create_plan', 'fallback'],
  conditionChangeAnswerKey: 'condition_change', independentMeaningAnswerKey: 'independent_meaning',
};
const catalogs: Array<{ name: string; catalog: DecisionQuestionCatalog<string> }> = [
  { name: 'authorization', catalog: authorizationCatalog },
  { name: 'contextual', catalog: CONTEXTUAL_DECISION_CATALOG },
  { name: 'temporal', catalog: TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG },
  { name: 'user-context', catalog: USER_CONTEXT_ROUTING_DECISION_CATALOG },
  { name: 'dynamic candidate', catalog: {
    questions: { candidate: { type: 'choice' }, condition_change: { type: 'noul' }, independent_meaning: { type: 'noul' } },
    choiceAnswerKey: 'candidate', decisions: ['leaf:0', 'none'],
    conditionChangeAnswerKey: 'condition_change', independentMeaningAnswerKey: 'independent_meaning',
  } },
];

function responseBody(catalog: DecisionQuestionCatalog<string>) {
  return {
    model: JEV_MODEL.request,
    answers: {
      [catalog.choiceAnswerKey]: {
        type: 'choice', choice: catalog.decisions[0], confidence: 1,
        probabilities: Object.fromEntries(catalog.decisions.map((choice, index) => [choice, index === 0 ? 1 : 0])),
      },
      [catalog.conditionChangeAnswerKey]: { type: 'noul', noul: 0 },
      [catalog.independentMeaningAnswerKey]: { type: 'noul', noul: 0 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('purpose-independent Decisions validation', () => {
  it.each(catalogs)('$name fixes the privacy routing preferences on the server-owned request', async ({ catalog }) => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(responseBody(catalog)));
    await createOpenRouterDecisionProvider({ apiKey: 'fixture', catalog, fetch: transport }).evaluate({});
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).provider)
      .toEqual({ zdr: true, data_collection: 'deny' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(catalogs)('$name rejects every malformed numeric/head/option variant without retry', async ({ catalog }) => {
    const variants: Array<(body: ReturnType<typeof responseBody>) => void> = [
      body => { body.answers[catalog.choiceAnswerKey].confidence = NaN; },
      body => { body.answers[catalog.choiceAnswerKey].confidence = Infinity; },
      body => { body.answers[catalog.choiceAnswerKey].confidence = -0.001; },
      body => { body.answers[catalog.choiceAnswerKey].confidence = 1.001; },
      body => { body.answers[catalog.choiceAnswerKey].probabilities![catalog.decisions[0]] = -1; },
      body => { body.answers[catalog.choiceAnswerKey].probabilities![catalog.decisions[0]] = 2; },
      body => { body.answers[catalog.choiceAnswerKey].probabilities![catalog.decisions[0]] = NaN; },
      body => { body.answers[catalog.choiceAnswerKey].probabilities!['unknown-option'] = 0; },
      body => { body.answers[catalog.choiceAnswerKey].choice = 'save'; },
      body => { delete body.answers[catalog.choiceAnswerKey]; },
      body => { delete body.answers[catalog.conditionChangeAnswerKey]; },
      body => { delete body.answers[catalog.independentMeaningAnswerKey]; },
      body => { body.answers[catalog.conditionChangeAnswerKey].noul = -0.1; },
      body => { body.answers[catalog.independentMeaningAnswerKey].noul = Infinity; },
    ];
    for (const mutate of variants) {
      const body = responseBody(catalog);
      mutate(body);
      // JSON serialization converts non-finite JS numbers into null, as on a real wire.
      const transport = vi.fn<typeof fetch>(async () => Response.json(body));
      const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture-secret', catalog, fetch: transport });
      expect(await provider.evaluate({ currentUserText: 'private-input-sentinel' }))
        .toMatchObject({ status: 'unavailable', reason: 'invalid_response' });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it.each(catalogs)('$name rejects unknown models and keeps corrupt usage unknown', async ({ catalog }) => {
    const body = { ...responseBody(catalog), usage: { input_tokens: -1, output_tokens: 0.5, cost: -0.1 } };
    const transport = vi.fn<typeof fetch>(async () => Response.json(body));
    const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture-secret', catalog, fetch: transport });
    expect(await provider.evaluate({})).toMatchObject({ status: 'evaluated', metadata: {
      inputTokens: null, outputTokens: null, costUsd: null,
    } });
    body.model = 'secret-unverified-model';
    const invalid = await provider.evaluate({});
    expect(invalid).toMatchObject({ status: 'unavailable', reason: 'model_mismatch', metadata: { servedModel: null } });
    expect(JSON.stringify(invalid)).not.toContain('secret-unverified-model');
  });

  it('separates an accepted semantic fallback, abstention, and provider unavailability', async () => {
    const body = responseBody(authorizationCatalog);
    const transport = vi.fn<typeof fetch>(async () => Response.json(body));
    const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture', fetch: transport });
    body.answers.independent_meaning.noul = 1;
    expect(gateDecision(await provider.evaluate({ currentUserText: 'fixture', lastAssistantMessage: null })))
      .toEqual({ status: 'accepted', decision: 'fallback' });
    body.answers.independent_meaning.noul = 0;
    body.answers.authorization.confidence = 0.1;
    expect(gateDecision(await provider.evaluate({ currentUserText: 'fixture', lastAssistantMessage: null })))
      .toEqual({ status: 'abstained', reason: 'uncertain' });
    transport.mockRejectedValueOnce(new Error('private-secret-error'));
    expect(gateDecision(await provider.evaluate({ currentUserText: 'fixture', lastAssistantMessage: null })))
      .toEqual({ status: 'unavailable', reason: 'network' });
  });
});

describe('the complete Decisions request deadline and cancellation', () => {
  it.each(['headers', 'body'] as const)('the default 1500 ms deadline covers %s and sends exactly once', async phase => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | null | undefined;
    const transport = vi.fn<typeof fetch>((_url, init) => {
      upstreamSignal = init?.signal;
      if (phase === 'headers') return new Promise((_resolve, reject) => {
        upstreamSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          upstreamSignal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
        },
      })));
    });
    const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture', fetch: transport });
    let settled = false;
    const pending = provider.evaluate({ currentUserText: 'private-input', lastAssistantMessage: null })
      .then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(upstreamSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'timeout', metadata: { latencyMs: 1500 } });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates in-flight caller cancellation to the body and removes listeners/timers', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    let upstreamSignal: AbortSignal | null | undefined;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      upstreamSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          upstreamSignal?.addEventListener('abort', () => controller.error(new Error('private-body-error')), { once: true });
        },
      }));
    });
    const provider = createOpenRouterDecisionProvider({ apiKey: 'fixture-secret', fetch: transport });
    const pending = provider.evaluate({ currentUserText: 'private-input', lastAssistantMessage: null }, caller.signal);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: 'unavailable', reason: 'cancelled' });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-input|private-body-error|fixture-secret/);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await provider.evaluate({ currentUserText: 'fixture', lastAssistantMessage: null }, caller.signal))
      .toMatchObject({ reason: 'cancelled' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a late success from a transport that resolves after cancellation', async () => {
    const caller = new AbortController();
    const upstream = deferred<Response>();
    const transport = vi.fn<typeof fetch>(() => upstream.promise);
    const pending = createOpenRouterDecisionProvider({ apiKey: 'fixture', fetch: transport })
      .evaluate({ currentUserText: 'fixture', lastAssistantMessage: null }, caller.signal);
    caller.abort();
    upstream.resolve(Response.json(responseBody(authorizationCatalog)));
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'cancelled' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

type DispatchFixture = {
  evaluate: (state: unknown, signal?: AbortSignal) => Promise<DecisionEvaluation<string>>;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (decision: unknown) => Response;
  signal: AbortSignal;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
};
const authorizationContext = {
  purpose: 'focused_authorization', requestId: 'request-robustness', inputRevision: 7,
  previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
  state: { currentUserText: 'private-current-text', lastAssistantMessage: 'private-assistant-text' },
} as const;
const contextualContext = createBoundFocusedContextualContextFixtureV5({ requestId: 'request-robustness', currentUserText: 'private-current-text' });
const temporalContext = {
  purpose: 'temporal_scope_repair', requestId: 'request-robustness', inputRevision: 7,
  state: { sourceText: 'private-current-text', currentAttachedTask: { title: 'private-task-title' },
    interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } },
} as const;
const routingContext = {
  purpose: 'user_context_routing', requestId: 'request-robustness', inputRevision: 7,
  state: { currentUserText: 'private-current-text' },
} as const;
function environment(prefix: string, mode: 'canary' | 'shadow') {
  return { JEV_MODE: mode, JEV_CANARY_PERCENT: '100',
    [`JEV_${prefix}_MODE`]: mode, [`JEV_${prefix}_CANARY_PERCENT`]: '100' };
}
const routes = [
  { name: 'authorization', decision: 'create_plan', catalog: authorizationCatalog, context: authorizationContext,
    run: (mode: 'canary' | 'shadow', p: DispatchFixture) => dispatchFocusedAuthorization({
      ...p, context: authorizationContext, env: environment('FOCUSED_AUTHORIZATION', mode),
      firebaseUid: 'fixture-owner', provider: { evaluate: p.evaluate } as never,
    }) },
  { name: 'contextual', decision: 'remaining', catalog: CONTEXTUAL_DECISION_CATALOG, context: contextualContext,
    run: (mode: 'canary' | 'shadow', p: DispatchFixture) => dispatchFocusedContextual({
      ...p, context: contextualContext, env: environment('FOCUSED_CONTEXTUAL_ANSWER', mode),
      firebaseUid: 'fixture-owner', provider: { evaluate: p.evaluate } as never,
    }) },
  { name: 'temporal', decision: 'plan_unavailable', catalog: TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG, context: temporalContext,
    run: (mode: 'canary' | 'shadow', p: DispatchFixture) => dispatchTemporalScopeRepair({
      ...p, context: temporalContext, env: environment('TEMPORAL_SCOPE_REPAIR', mode),
      firebaseUid: 'fixture-owner', provider: { evaluate: p.evaluate } as never,
    }) },
  { name: 'user-context', decision: 'bookshelf', catalog: USER_CONTEXT_ROUTING_DECISION_CATALOG, context: routingContext,
    run: (mode: 'canary' | 'shadow', p: DispatchFixture) => dispatchUserContextRouting({
      ...p, context: routingContext, env: environment('USER_CONTEXT_ROUTING', mode),
      firebaseUid: 'fixture-owner', provider: { evaluate: p.evaluate } as never,
    }) },
];
function accepted(route: typeof routes[number]): DecisionEvaluation<string> {
  return { status: 'evaluated', decision: route.decision, confidence: 1,
    probabilities: Object.fromEntries(route.catalog.decisions.map(d => [d, d === route.decision ? 1 : 0])),
    conditionChange: 0, independentMeaning: 0, metadata: { ...metadata } };
}
function dispatchFixture(result: DecisionEvaluation<string>): DispatchFixture {
  return { evaluate: vi.fn(async () => result),
    fallback: vi.fn(async () => new Response('unchanged-luna', { status: 207, headers: { 'X-Luna': 'preserved' } })),
    respond: vi.fn(decision => Response.json(decision)), signal: new AbortController().signal };
}

describe('common dispatch fallback, shadow and cancellation invariants', () => {
  it.each(routes)('$name contains both synchronous throws and rejected provider promises in canary and shadow', async route => {
    for (const mode of ['canary', 'shadow'] as const) {
      for (const synchronous of [true, false]) {
        vi.mocked(console.info).mockClear();
        const p = dispatchFixture(accepted(route));
        p.evaluate = vi.fn(() => {
          if (synchronous) throw new Error('private-provider-error');
          return Promise.reject(new Error('private-provider-error'));
        });
        const lifecycle: Promise<unknown>[] = [];
        p.executionContext = { waitUntil: work => lifecycle.push(work) };
        const response = await route.run(mode, p);
        expect(await response.text()).toBe('unchanged-luna');
        expect(jevExecutionMode(response)).toBe(mode);
        expect(p.evaluate).toHaveBeenCalledTimes(1);
        expect(p.fallback).toHaveBeenCalledTimes(1);
        expect(p.respond).not.toHaveBeenCalled();
        await expect(Promise.all(lifecycle)).resolves.toBeDefined();
        // Identity is unknown when an adapter never returned its typed metadata.
        // The baseline marker/dispatch ledger observes this exceptional path.
        expect(console.info).not.toHaveBeenCalled();
      }
    }
  });

  it.each(routes)('$name falls back once for every typed provider failure and preserves state/unknown telemetry', async route => {
    const before = structuredClone(route.context);
    for (const reason of ['configuration', 'timeout', 'network', 'http', 'invalid_response', 'model_mismatch', 'cancelled'] as const) {
      const p = dispatchFixture({ status: 'unavailable', reason, metadata: { ...metadata } });
      const response = await route.run('canary', p);
      expect(await response.text()).toBe('unchanged-luna');
      expect(response.status).toBe(207);
      expect(response.headers.get('X-Luna')).toBe('preserved');
      expect(jevExecutionMode(response)).toBe('canary');
      expect(p.evaluate).toHaveBeenCalledTimes(1);
      expect(p.fallback).toHaveBeenCalledTimes(1);
      expect(p.respond).not.toHaveBeenCalled();
      expect(route.context).toEqual(before);
      expect(console.info).toHaveBeenLastCalledWith('[AI Decision]', expect.objectContaining({
        gate: 'unavailable', reason, inputTokens: null, outputTokens: null, reportedCostUsd: null,
      }));
    }
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/private-current-text|private-assistant-text|private-task-title/);
  });

  it.each(routes)('$name invokes no retry when the one permitted Luna fallback also fails', async route => {
    const p = dispatchFixture({ status: 'unavailable', reason: 'network', metadata });
    p.fallback = vi.fn(async () => { throw new Error('private-luna-failure'); });
    await expect(route.run('canary', p)).rejects.toThrow();
    expect(p.evaluate).toHaveBeenCalledTimes(1);
    expect(p.fallback).toHaveBeenCalledTimes(1);
    expect(p.respond).not.toHaveBeenCalled();
  });

  it.each(routes)('$name rejects a late accepted result after caller abort without invoking Luna', async route => {
    const caller = new AbortController();
    const evaluation = deferred<DecisionEvaluation<string>>();
    const p = dispatchFixture(accepted(route));
    p.signal = caller.signal;
    p.evaluate = vi.fn((_state, signal) => {
      expect(signal?.aborted).toBe(false);
      return evaluation.promise;
    });
    const pending = route.run('canary', p);
    const failure = pending.catch((error: unknown) => error);
    caller.abort();
    evaluation.resolve(accepted(route));
    expect(await failure).toBeInstanceOf(Error);
    expect(p.fallback).not.toHaveBeenCalled();
    expect(p.respond).not.toHaveBeenCalled();
  });

  it.each(routes)('$name shadow returns Luna before Jev settles, survives telemetry failure and never mutates context', async route => {
    const before = structuredClone(route.context);
    const evaluation = deferred<DecisionEvaluation<string>>();
    const lifecycle: Promise<unknown>[] = [];
    const p = dispatchFixture(accepted(route));
    p.evaluate = vi.fn(() => evaluation.promise);
    p.executionContext = { waitUntil: promise => lifecycle.push(promise) };
    const response = await route.run('shadow', p);
    expect(await response.text()).toBe('unchanged-luna');
    expect(response.status).toBe(207);
    expect(response.headers.get('X-Luna')).toBe('preserved');
    expect(jevExecutionMode(response)).toBe('shadow');
    expect(lifecycle).toHaveLength(1);
    expect(p.respond).not.toHaveBeenCalled();
    expect(p.fallback).toHaveBeenCalledTimes(1);
    vi.mocked(console.info).mockImplementationOnce(() => { throw new Error('telemetry sink unavailable'); });
    evaluation.resolve(accepted(route));
    await expect(Promise.all(lifecycle)).resolves.toBeDefined();
    expect(p.respond).not.toHaveBeenCalled();
    expect(p.evaluate).toHaveBeenCalledTimes(1);
    expect(route.context).toEqual(before);
  });

  it.each(routes)('$name starts no shadow provider without a Worker lifecycle', async route => {
    const p = dispatchFixture(accepted(route));
    expect(await (await route.run('shadow', p)).text()).toBe('unchanged-luna');
    expect(p.evaluate).not.toHaveBeenCalled();
    expect(p.respond).not.toHaveBeenCalled();
    expect(p.fallback).toHaveBeenCalledTimes(1);
  });

  it('authorization rechecks source freshness before a delayed accepted result', async () => {
    const evaluation = deferred<DecisionEvaluation>();
    let current = true;
    const fallback = vi.fn(async () => new Response('luna-after-drift'));
    const respond = vi.fn((decision: string) => Response.json(decision));
    const pending = dispatchFocusedAuthorization({ context: authorizationContext,
      env: environment('FOCUSED_AUTHORIZATION', 'canary'), firebaseUid: 'fixture-owner',
      signal: new AbortController().signal, provider: { evaluate: () => evaluation.promise },
      fallback, respond, isContextCurrent: () => current });
    current = false;
    evaluation.resolve(accepted(routes[0]) as DecisionEvaluation);
    expect(await (await pending).text()).toBe('luna-after-drift');
    expect(respond).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenLastCalledWith('[AI Decision]', expect.objectContaining({
      gate: 'unavailable', reason: 'stale_context',
    }));
  });
});
