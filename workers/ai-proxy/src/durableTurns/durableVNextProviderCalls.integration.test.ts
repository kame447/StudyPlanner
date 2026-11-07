import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableTurnJob, type DurableTurnRecord, type DurableTurnExecute } from './durableTurnJob';
import { executeDurableVNextJob } from './durableVNextTurn';
import type { AiProxyWorkerEnv } from '../worker';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';

const week = '2026-11-02';
const startedAt = Date.parse('2026-11-07T06:00:00.000Z');
const nativeSchema = VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name;
const focusedSchema = FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name;
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const semantic = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
  delta: { add: [
    { kind: 'task', localId: 'task', category: 'study', title: '数学' },
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null,
      quantityRole: 'remaining', amount: 7, unitCode: 'page', unitLabel: 'ページ',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  ], patch: [], remove: [], relate: [], defer: [] } });
const focused = JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target',
  effortMeasurement: 'duration_per_unit', minutes: 5, precision: 'approximate', quantityRole: null });
const env = { OPENAI_API_KEY: 'synthetic-only-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
function payload(): WeeklyPlanningVNextDurableTurnInput {
  return { core: 'vnext', weekStartDate: week, checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'alice', conversationId: 'chat', traceRequestId: 'chat:request:1', inputStateRevision: 0,
      messages: [], userText: '数学を7ページ', selectedDate: '2026-11-07', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: new Date(startedAt).toISOString(),
        timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
}
function harness(turn = payload()) {
  let record: DurableTurnRecord | undefined;
  let failCompletion = false;
  const storage = { read: async () => structuredClone(record), alarmAt: async () => {},
    write: async (next: DurableTurnRecord) => {
      if (failCompletion && next.status === 'completed') { failCompletion = false; throw new Error('synthetic storage interruption'); }
      record = structuredClone(next);
    } };
  let dispatchCount = 0;
  const execute: DurableTurnExecute = (raw, dispatch, ip, deadline) => executeDurableVNextJob(env, JSON.parse(raw),
    (request, send) => { dispatchCount++; return dispatch(request, send); }, ip, deadline);
  return { input: { ownerId: 'alice', conversationId: 'chat', requestId: turn.input.traceRequestId!,
      baseRevision: turn.input.inputStateRevision ?? 0, startedAt, payload: JSON.stringify(turn) },
    create: () => new DurableTurnJob(storage, () => startedAt), execute,
    read: () => record, dispatches: () => dispatchCount,
    failCompletionOnce: () => { failCompletion = true; } };
}
function provider(options: { firstGate?: Promise<void>; onFirstSend?: () => void; failure?: 'semantic' | 'renderer' } = {}) {
  const calls: { schema: string; fingerprint: string; bytes: number }[] = [];
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const raw = init!.body as string;
    const body = JSON.parse(raw);
    const schema = body.response_format?.json_schema?.name ?? 'none';
    calls.push({ schema, fingerprint: createHash('sha256').update(raw).digest('hex'), bytes: Buffer.byteLength(raw) });
    if (calls.length === 1) { options.onFirstSend?.(); if (options.firstGate) await options.firstGate; }
    const native = schema === nativeSchema;
    const isFocused = schema === focusedSchema;
    if ((options.failure === 'semantic' && native) || (options.failure === 'renderer' && !native && !isFocused)) {
      return Response.json({ error: { message: 'synthetic unavailable' } }, { status: 503 });
    }
    const content = native ? semantic : isFocused ? focused : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', send);
  return { calls, send };
}
function output(h: ReturnType<typeof harness>) {
  expect(h.read()?.status).toBe('completed');
  return JSON.parse(h.read()!.result!) as WeeklyPlanningVNextDurableTurnResult;
}
function expectRequests(p: ReturnType<typeof provider>, h: ReturnType<typeof harness>, schemas: string[], logicalDispatches = schemas.length) {
  expect(p.calls.map(c => c.schema)).toEqual(schemas);
  expect(h.dispatches()).toBe(logicalDispatches);
  expect(new Set(p.calls.map(c => c.fingerprint)).size).toBe(p.calls.length);
  expect(p.calls.every(c => c.bytes > 0)).toBe(true);
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(startedAt); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('counts a normal production VNext job', async () => {
  const p = provider(); const h = harness(); const job = h.create();
  await job.accept(h.input); await job.run(h.execute);
  const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output(h).checkpointAfter!, ownerId: 'alice', weekStartDate: week });
  expect(checkpoint?.vnext.state.graph.tasks.map(t => t.title)).toEqual(['数学']);
  expectRequests(p, h, [nativeSchema, rendererSchema]);
});
it('shares simultaneous accept/alarm invocations through the existing job', async () => {
  let release!: () => void;
  let entered!: () => void;
  const sent = new Promise<void>(r => { entered = r; });
  const p = provider({ firstGate: new Promise<void>(r => { release = r; }), onFirstSend: entered });
  const h = harness(); const job = h.create();
  await job.accept(h.input); const first = job.run(h.execute);
  await sent;
  await job.accept(h.input); const second = job.run(h.execute);
  expect(second).toBe(first); release(); await Promise.all([first, second]); output(h);
  expectRequests(p, h, [nativeSchema, rendererSchema]);
});
it('reuses completed receipt after duplicate acceptance and a fresh job instance', async () => {
  const p = provider(); const h = harness(); const job = h.create();
  await job.accept(h.input); await job.run(h.execute); const before = h.read()!.result;
  const sent = p.calls.length; const resumed = h.create();
  expect((await resumed.accept(h.input)).status).toBe('completed'); await resumed.run(h.execute);
  expect(p.calls).toHaveLength(sent); expect(h.read()!.result).toBe(before);
  expectRequests(p, h, [nativeSchema, rendererSchema]);
});
it('replays the real journal after result persistence is interrupted', async () => {
  const p = provider(); const h = harness(); const job = h.create(); h.failCompletionOnce();
  await job.accept(h.input); await expect(job.run(h.execute)).rejects.toThrow('Durable turn storage operation failed');
  expect(h.read()?.status).toBe('running'); expect(h.read()?.journal?.every(e => e.status === 'completed')).toBe(true);
  const sent = p.calls.length; await h.create().run(h.execute); output(h);
  expect(p.calls).toHaveLength(sent); expectRequests(p, h, [nativeSchema, rendererSchema], 4);
});
it('sends nothing when cancelled before execution', async () => {
  const p = provider(); const h = harness(); const job = h.create();
  await job.accept(h.input); await job.cancel(h.input); await job.run(h.execute);
  expect(h.read()?.failure).toBe('cancelled'); expectRequests(p, h, []);
});
it('does not expose another owner receipt or dispatch for that owner', async () => {
  const p = provider(); const h = harness(); const job = h.create();
  await job.accept(h.input);
  await expect(job.accept({ ...h.input, ownerId: 'bob' })).rejects.toThrow('owner_mismatch');
  expect(h.read()?.identity.ownerId).toBe('alice'); expectRequests(p, h, []);
});
it.each(['semantic', 'renderer'] as const)('counts %s failure without extra recovery dispatch', async failure => {
  const p = provider({ failure }); const h = harness(); const job = h.create();
  await job.accept(h.input); await job.run(h.execute); output(h);
  const sent = p.calls.length; await h.create().run(h.execute);
  expect(p.calls).toHaveLength(sent);
  expectRequests(p, h, failure === 'semantic' ? [nativeSchema] : [nativeSchema, rendererSchema]);
});
it('counts the focused next-turn path on its saved checkpoint', async () => {
  const p = provider(); const first = harness(); const job = first.create();
  await job.accept(first.input); await job.run(first.execute);
  const next = payload(); next.checkpoint = output(first).checkpointAfter;
  next.input.traceRequestId = 'chat:request:2'; next.input.inputStateRevision = 2; next.input.userText = '1枚5分';
  p.calls.length = 0;
  const second = harness(next); const secondJob = second.create();
  await secondJob.accept(second.input); await secondJob.run(second.execute); output(second);
  expectRequests(p, second, [focusedSchema, rendererSchema]);
});
