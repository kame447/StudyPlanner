// A learning consultation in the production durable VNext job (#246): the native reading finds nothing to plan, so
// two more journaled dispatches (purpose, advice) answer it; replay reuses them; a refused answer is the old planning reply.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableTurnJob, type DurableTurnRecord, type DurableTurnExecute } from './durableTurnJob';
import { executeDurableVNextJob } from './durableVNextTurn';
import type { AiProxyWorkerEnv } from '../worker';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { LEARNING_CONSULTATION_ANSWER_VERSION, LEARNING_CONSULTATION_TURN_PURPOSE_VERSION } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { RENDERER_TECHNICAL_STOP } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { VNEXT_ADVICE_NOTICE } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextConsultation';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';

const week = '2026-11-02';
const startedAt = Date.parse('2026-11-07T06:00:00.000Z');
const nativeSchema = VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name;
const purposeSchema = 'weekly_planning_vnext_turn_purpose_v1';
const adviceSchema = 'weekly_planning_vnext_advice_v1';
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const nothingToPlan = JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null,
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] } });
const advice = { schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION, kind: 'proposal', userFacingAnswer: 'まず文法の基礎問題集を1周しましょう。',
  options: [{ title: '基礎固め', strategySummary: '文法から', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method', rationale: '土台が先です。',
    assumptionRefs: [], evidenceRefs: [], uncertainty: 'medium' }] }], assumptions: ['高校レベル'], overallUncertainty: 'medium' };
const env = { OPENAI_API_KEY: 'synthetic-only-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
const payload = (): WeeklyPlanningVNextDurableTurnInput => ({ core: 'vnext', weekStartDate: week, checkpoint: null, legacyV5Checkpoint: null,
  input: { userId: 'alice', conversationId: 'chat', traceRequestId: 'chat:request:1', inputStateRevision: 0, messages: [],
    userText: '英語が苦手なんだけど何から始めればいい？', selectedDate: '2026-11-07', plans: [], scheduleTemplates: [],
    requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: new Date(startedAt).toISOString(), timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } });

function harness() {
  const turn = payload();
  let record: DurableTurnRecord | undefined; let failCompletion = false; let dispatchCount = 0;
  const storage = { read: async () => structuredClone(record), alarmAt: async () => {},
    write: async (next: DurableTurnRecord) => {
      if (failCompletion && next.status === 'completed') { failCompletion = false; throw new Error('synthetic storage interruption'); }
      record = structuredClone(next);
    } };
  const execute: DurableTurnExecute = (raw, dispatch, ip, deadline) => executeDurableVNextJob(env, JSON.parse(raw),
    (request, send) => { dispatchCount++; return dispatch(request, send); }, ip, deadline);
  return { input: { ownerId: 'alice', conversationId: 'chat', requestId: turn.input.traceRequestId!, baseRevision: 0, startedAt, payload: JSON.stringify(turn) },
    create: () => new DurableTurnJob(storage, () => startedAt), execute, read: () => record, dispatches: () => dispatchCount,
    failCompletionOnce: () => { failCompletion = true; },
    output: () => { expect(record?.status).toBe('completed'); return JSON.parse(record!.result!) as WeeklyPlanningVNextDurableTurnResult; } };
}

function provider(replies: { purpose?: unknown; advice?: unknown; unavailable?: 'purpose' | 'advice'; native?: string } = {}) {
  const calls: { schema: string; model: string | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name ?? 'none';
    calls.push({ schema, model: body.model });
    if ((replies.unavailable === 'purpose' && schema === purposeSchema) || (replies.unavailable === 'advice' && schema === adviceSchema)) {
      return Response.json({ error: { message: 'synthetic unavailable' } }, { status: 503 });
    }
    const content = schema === nativeSchema ? (replies.native ?? nothingToPlan)
      : schema === purposeSchema ? JSON.stringify(replies.purpose ?? { schemaVersion: LEARNING_CONSULTATION_TURN_PURPOSE_VERSION, kind: 'learning_consultation' })
      : schema === adviceSchema ? JSON.stringify(replies.advice ?? advice)
      : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  return calls;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(startedAt); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('answers a consultation with advice in three dispatches and plans nothing', async () => {
  const calls = provider(); const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual([nativeSchema, purposeSchema, adviceSchema]);
  // Both purposes already have a model in the Worker's policy, so no Worker change routes them.
  expect(calls.every(call => call.model === 'gpt-6-luna')).toBe(true);
  expect(h.dispatches()).toBe(3);
  const out = h.output();
  expect(out.result.message).toBe(`まず文法の基礎問題集を1周しましょう。\n\n${VNEXT_ADVICE_NOTICE}`);
  expect(out.result.draftCandidates).toEqual([]);
  expect(out.result.responseSource).toBe('ai');
  const stored = parseWeeklyPlanningVNextSessionCheckpoint({ raw: out.checkpointAfter!, ownerId: 'alice', weekStartDate: week })!.vnext;
  expect(stored.state.graph.tasks).toEqual([]);
  expect(stored.preview).toBeNull();
  expect(stored.messages.at(-1)).toEqual({ role: 'assistant', content: out.result.message });
});

it('replays the journal after the result write was interrupted, with no new dispatch', async () => {
  const calls = provider(); const h = harness(); h.failCompletionOnce();
  await h.create().accept(h.input);
  await expect(h.create().run(h.execute)).rejects.toThrow('Durable turn storage operation failed');
  const sent = calls.length;
  await h.create().run(h.execute);
  expect(calls).toHaveLength(sent);
  expect(h.output().result.message).toContain('文法の基礎問題集');
});

it('answers with the planning question when the purpose is not a consultation, with the same two requests as before plus one', async () => {
  const calls = provider({ purpose: { schemaVersion: LEARNING_CONSULTATION_TURN_PURPOSE_VERSION, kind: 'unresolved' } }); const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual([nativeSchema, purposeSchema, rendererSchema]);
  expect(h.output().result.message).not.toContain(VNEXT_ADVICE_NOTICE);
});

it('answers with the planning question when the advice is outside the contract', async () => {
  const calls = provider({ advice: { ...advice, options: [{ ...advice.options[0], recommendations: [{ ...advice.options[0].recommendations[0], evidenceRefs: ['made-up'] }] }] } });
  const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual([nativeSchema, purposeSchema, adviceSchema, rendererSchema]);
  expect(h.output().result.message).not.toContain(VNEXT_ADVICE_NOTICE);
});

// The durable job stops all dispatch after any provider failure (durableTurnJob.ts), so a failed consultation call is not
// followed by the planning question's renderer call: the turn ends with the renderer's technical-stop reply, completed,
// with nothing planned and nothing half-advised. Replay reuses the journal, including the failed dispatch.
it.each(['purpose', 'advice'] as const)('ends a turn whose %s call failed at the provider with the technical-stop reply, nothing planned', async unavailable => {
  const calls = provider({ unavailable }); const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual(unavailable === 'purpose' ? [nativeSchema, purposeSchema] : [nativeSchema, purposeSchema, adviceSchema]);
  expect(h.read()?.status).toBe('completed');
  const out = h.output();
  expect(out.result.message).toBe(RENDERER_TECHNICAL_STOP);
  expect(out.result.responseSource).toBe('deterministic_fallback');
  expect(out.result.draftCandidates).toEqual([]);
  const stored = parseWeeklyPlanningVNextSessionCheckpoint({ raw: out.checkpointAfter!, ownerId: 'alice', weekStartDate: week })!.vnext;
  expect(stored.state.graph.tasks).toEqual([]);
  expect(stored.preview).toBeNull();
  const sent = calls.length;
  await h.create().run(h.execute);
  expect(calls).toHaveLength(sent);
  expect(h.read()?.result).toBe(JSON.stringify(out));
});

const onlyATask = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
  delta: { add: [{ kind: 'task', localId: 'task', category: 'study', title: '英語' }], patch: [], remove: [], relate: [], defer: [] } });

it('answers a consultation whose reading only named a task with advice, dropping the task name (#246 slice 2)', async () => {
  const calls = provider({ native: onlyATask }); const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual([nativeSchema, purposeSchema, adviceSchema]);
  const out = h.output();
  expect(out.result.message).toContain(VNEXT_ADVICE_NOTICE);
  const stored = parseWeeklyPlanningVNextSessionCheckpoint({ raw: out.checkpointAfter!, ownerId: 'alice', weekStartDate: week })!.vnext;
  expect(stored.state.graph.tasks).toEqual([]);
  expect(stored.state.graph.revision).toBe(0);
});

it('keeps the task name and asks the planning question when a task-only reading is not a consultation', async () => {
  const calls = provider({ native: onlyATask, purpose: { schemaVersion: LEARNING_CONSULTATION_TURN_PURPOSE_VERSION, kind: 'planning_operation' } }); const h = harness();
  await h.create().accept(h.input); await h.create().run(h.execute);
  expect(calls.map(call => call.schema)).toEqual([nativeSchema, purposeSchema, rendererSchema]);
  const stored = parseWeeklyPlanningVNextSessionCheckpoint({ raw: h.output().checkpointAfter!, ownerId: 'alice', weekStartDate: week })!.vnext;
  expect(stored.state.graph.tasks.map(task => task.title)).toEqual(['英語']);
});
