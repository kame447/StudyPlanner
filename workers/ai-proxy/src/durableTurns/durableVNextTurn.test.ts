import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDurableTurnApi, type DurableTurnApiEnv } from './durableTurnApi';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const WEEK = '2026-10-12';
const STARTED = '2026-10-13T20:00:00.000Z';
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (add: unknown[], answer: unknown = null) => JSON.stringify({ planningIntent: 'discuss', conversationActs: [], delta: { ...emptyDelta, add }, answer });
const addTask = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
const addWork = { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining',
  amount: 7, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };

function payload(over: { requestId?: string; userText?: string; checkpoint?: string | null; startedAt?: string } = {}): WeeklyPlanningVNextDurableTurnInput {
  const requestId = over.requestId ?? 'chat:request:1';
  return { core: 'vnext', weekStartDate: WEEK, checkpoint: over.checkpoint ?? null, legacyV5Checkpoint: null,
    input: { userId: 'alice', conversationId: 'chat', traceRequestId: requestId, inputStateRevision: 0, messages: [],
      userText: over.userText ?? '数学を7ページ', selectedDate: '2026-10-13', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: over.startedAt ?? STARTED, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
}

const providerEnv = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;

/** A journal-backed dispatch like DurableTurnJob's: a saved response replays without a send. */
function journal() {
  const entries: { request: string; response: string }[] = [];
  let index = 0;
  return {
    entries,
    restart() { index = 0; },
    dispatch: async (request: string, send: () => Promise<string>) => {
      const saved = entries[index++];
      if (saved) { if (saved.request !== request) throw new Error('replay request changed'); return saved.response; }
      const response = await send(); entries.push({ request, response }); return response;
    },
  };
}
/** Reading for the semantic purpose; the real renderer schema is answered by the shared healthy fixture. */
const focused = JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
  minutes: 5, precision: 'approximate', quantityRole: null });
const providerFetch = (semantic: string = reading([addTask, addWork])) => vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(init!.body as string) as { response_format?: { json_schema?: { name?: string } }; messages: { content: string }[] };
  const schema = body.response_format?.json_schema?.name;
  const content = schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name ? semantic
    : schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name ? focused
    : await successfulWeeklyPlanningRendererCompletion(body);
  return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('VNext durable execution', () => {
  it('runs the shared VNext turn and returns the new checkpoint with the existing result envelope', async () => {
    vi.stubGlobal('fetch', providerFetch());
    const result = await executeDurableVNextTurn(providerEnv, payload(), journal().dispatch);
    expect(result).toMatchObject({ core: 'vnext', checkpointBefore: null, observedDate: '2026-10-14', stagedContextFacts: [] });
    expect(typeof result.result.message).toBe('string');
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: result.checkpointAfter!, ownerId: 'alice', weekStartDate: WEEK });
    expect(checkpoint).toMatchObject({ conversationId: 'chat' });
    expect(checkpoint!.vnext.state.graph.tasks.map(item => item.title)).toEqual(['数学']);
  });

  it('after a provider failure in the Worker no recovery renderer request follows (the V5 bound), while a structured rejection still recovers', async () => {
    const schemas: string[] = [];
    const countingFetch = (semantic: 'fail' | 'invalid') => vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { response_format?: { json_schema?: { name?: string } }; messages: { content: string }[] };
      const schema = body.response_format?.json_schema?.name ?? 'none';
      schemas.push(schema);
      if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
        if (semantic === 'fail') throw new TypeError('synthetic network outage');
        return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: '{}' } }] });
      }
      return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: await successfulWeeklyPlanningRendererCompletion(body) } }] });
    });
    vi.stubGlobal('fetch', countingFetch('fail'));
    const failed = await executeDurableVNextTurn(providerEnv, payload(), journal().dispatch);
    expect(schemas.filter(name => name !== VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name)).toEqual([]);
    // Nothing of the failed turn was accepted.
    const kept = failed.checkpointAfter === null ? null
      : parseWeeklyPlanningVNextSessionCheckpoint({ raw: failed.checkpointAfter, ownerId: 'alice', weekStartDate: WEEK });
    expect(kept?.vnext.state.graph.tasks ?? []).toEqual([]);
    schemas.length = 0;
    vi.stubGlobal('fetch', countingFetch('invalid'));
    await executeDurableVNextTurn(providerEnv, payload({ requestId: 'chat:request:2' }), journal().dispatch);
    // A rejected structured reading (every dispatch completed) is the case the renderer may recover.
    expect(schemas.filter(name => name !== VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name).length).toBeGreaterThan(0);
  });

  it('replays the whole turn byte for byte from the journal, including a second turn on the saved checkpoint', async () => {
    const first = journal();
    vi.stubGlobal('fetch', providerFetch());
    const seeded = await executeDurableVNextTurn(providerEnv, payload(), first.dispatch);
    const second = payload({ requestId: 'chat:request:2', userText: '1枚5分', checkpoint: seeded.checkpointAfter });
    second.input.inputStateRevision = 2;
    const run = journal();
    vi.stubGlobal('fetch', providerFetch(reading([])));
    const original = await executeDurableVNextTurn(providerEnv, second, run.dispatch);
    // The presented per-unit effort question is read by the focused interpreter under the turn-derived identity.
    expect(run.entries.some(entry => entry.request.includes('chat:request:2:focused'))).toBe(true);
    // A new alarm: nothing may be sent again and no ambient value may leak into the bytes.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('replay must not call the provider'); }));
    run.restart();
    const replayed = await executeDurableVNextTurn(providerEnv, second, run.dispatch);
    expect(replayed.checkpointAfter).toBe(original.checkpointAfter);
    // Only measured latency and the trace collector's wall-clock stamps (instrumentation) may differ between an execution and its replay.
    const stable = (value: unknown) => serializeWeeklyPlanningTurnResult(value as never).replace(/\\*"(?:latencyMs|occurredAt)\\*":(?:\d+|\\*"[^"\\]*\\*")/g, '');
    expect(stable(replayed)).toBe(stable(original));
  });

  it('does not call the provider for a turn cancelled before its alarm', async () => {
    const fetchMock = providerFetch(); vi.stubGlobal('fetch', fetchMock);
    let record: DurableTurnRecord | undefined;
    const startedAt = Date.parse(STARTED);
    const job = new DurableTurnJob({ read: async () => structuredClone(record), write: async next => { record = structuredClone(next); }, alarmAt: async () => {} }, () => startedAt);
    const identity = { ownerId: 'alice', conversationId: 'chat', requestId: 'chat:request:1', baseRevision: 0, startedAt };
    await job.accept({ ...identity, payload: JSON.stringify(payload()) });
    expect((await job.cancel(identity))?.failure).toBe('cancelled');
    await job.run(async (raw, dispatch) => serializeWeeklyPlanningTurnResult(
      await executeDurableVNextTurn(providerEnv, JSON.parse(raw), dispatch)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record?.status).toBe('failed');
  });

  it('completes through the existing job and exposes the checkpoint in the stored result', async () => {
    vi.stubGlobal('fetch', providerFetch());
    let record: DurableTurnRecord | undefined;
    const startedAt = Date.parse(STARTED);
    const job = new DurableTurnJob({ read: async () => structuredClone(record), write: async next => { record = structuredClone(next); }, alarmAt: async () => {} }, () => startedAt);
    await job.accept({ ownerId: 'alice', conversationId: 'chat', requestId: 'chat:request:1', baseRevision: 0, startedAt, payload: JSON.stringify(payload()) });
    await job.run(async (raw, dispatch, ip, deadline) => serializeWeeklyPlanningTurnResult(
      await executeDurableVNextTurn(providerEnv, JSON.parse(raw), dispatch, ip, deadline)));
    expect(record?.status).toBe('completed');
    const stored = JSON.parse(record!.result!) as WeeklyPlanningVNextDurableTurnResult;
    expect(stored.core).toBe('vnext');
    expect(stored.checkpointAfter).toEqual(expect.any(String));
  });
});

describe('VNext durable envelope validation', () => {
  function api() {
    const accepted: Array<{ payload: string }> = [];
    const namespace = { getByName: () => ({ accept: async (input: { payload: string }) => { accepted.push(input); return { accepted: true as const, value: { status: 'queued' } }; } }) };
    const env = { FIREBASE_WEB_API_KEY: 'k', OPENAI_API_KEY: 'p', ALLOWED_ORIGIN: 'https://app.test', DURABLE_WEEKLY_TURNS: 'enabled', AI_TURNS: namespace,
      AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as DurableTurnApiEnv;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ users: [{ localId: 'alice', emailVerified: true }] })));
    const post = (turn: WeeklyPlanningVNextDurableTurnInput | Record<string, unknown>) => handleDurableTurnApi(new Request('https://proxy.test/weekly-planning/turns', {
      method: 'POST', headers: { Authorization: 'Bearer t', Origin: 'https://app.test' },
      body: JSON.stringify({ conversationId: 'chat', requestId: (turn as WeeklyPlanningVNextDurableTurnInput).input?.traceRequestId ?? 'chat:request:1',
        baseRevision: 0, startedAt: Date.parse(STARTED), payload: turn }) }), env);
    return { accepted, post };
  }

  it('accepts the VNext envelope and stores its exact bytes', async () => {
    const { accepted, post } = api(); const turn = payload();
    expect((await post(turn)).status).toBe(202);
    expect(accepted[0].payload).toBe(JSON.stringify(turn));
  });

  it('rejects another owner, extra keys, an unknown core, a foreign or unreadable checkpoint and bad bounds', async () => {
    const { accepted, post } = api();
    const mutations: Array<(turn: WeeklyPlanningVNextDurableTurnInput & Record<string, unknown>) => void> = [
      turn => { turn.input.userId = 'bob'; },
      turn => { turn.input.plans = [{ userId: 'bob' }] as never; },
      turn => { turn.graph = {}; },
      turn => { turn.core = 'v5' as never; },
      turn => { turn.weekStartDate = 'next week'; },
      turn => { turn.checkpoint = 'not a checkpoint'; },
      turn => { turn.legacyV5Checkpoint = ''; },
      turn => { turn.checkpoint = 'x'.repeat(400 * 1024 + 1); },
      turn => { turn.input.requestContext.currentDate = '2026-01-01'; },
    ];
    for (const mutate of mutations) {
      const turn = structuredClone(payload()) as WeeklyPlanningVNextDurableTurnInput & Record<string, unknown>; mutate(turn);
      expect((await post(turn)).status).toBe(400);
    }
    expect(accepted).toHaveLength(0);
  });

  it('rejects a checkpoint that belongs to another conversation', async () => {
    vi.stubGlobal('fetch', providerFetch());
    const other = await executeDurableVNextTurn(providerEnv, { ...payload(), input: { ...payload().input, conversationId: 'other' } }, journal().dispatch);
    const { accepted, post } = api();
    expect((await post(payload({ checkpoint: other.checkpointAfter }))).status).toBe(400);
    expect(accepted).toHaveLength(0);
  });
});
