import { afterEach, expect, it, vi } from 'vitest';
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

const STARTED = '2026-11-02T00:00:00.000Z';
const WEEK = '2026-11-02';
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (intent: 'create_plan' | 'discuss', add: unknown[] = []) => JSON.stringify({
  planningIntent: intent, conversationActs: [], delta: { ...empty, add }, answer: null,
});
const task = (localId: string, title: string) => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: string) => ({
  kind: 'workload', localId, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'remaining',
  amount, unitCode, unitLabel: unitCode === 'minute' ? '分' : 'ページ', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null,
});
const env = { OPENAI_API_KEY: 'synthetic-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
} as unknown as AiProxyWorkerEnv;

function harness(focusedDecision = { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
  minutes: 5, precision: 'approximate', quantityRole: null } as Record<string, unknown>) {
  let record: DurableTurnRecord | undefined;
  let checkpoint: string | null = null;
  let sequence = 0;
  let failure: '500' | 'timeout' | null = null;
  let semantic = reading('discuss');
  const provider = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // This is the actual Worker's upstream boundary; no datastore or external request can escape it.
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    if (failure === '500') return Response.json({ error: { message: 'synthetic provider unavailable' } }, { status: 500 });
    if (failure === 'timeout') throw new DOMException('synthetic provider timeout', 'TimeoutError');
    const body = JSON.parse(String(init?.body));
    const name = body.response_format?.json_schema?.name;
    const content = name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name ? semantic
      : name === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name
        ? JSON.stringify(focusedDecision)
        : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', provider);
  const job = new DurableTurnJob({ read: async () => structuredClone(record),
    write: async next => { record = structuredClone(next); }, alarmAt: async () => {},
  }, () => Date.parse(STARTED));
  const alarm = () => job.run(async (raw, dispatch, ip, deadline) => serializeWeeklyPlanningTurnResult(
    await executeDurableVNextTurn(env, JSON.parse(raw), dispatch, ip, deadline)));
  const turn = async (userText: string, nextSemantic: string, nextFailure: typeof failure = null) => {
    failure = nextFailure;
    semantic = nextSemantic;
    const baseRevision = sequence++ * 2;
    const requestId = `chat:request:${sequence}`;
    const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: WEEK,
      checkpoint, legacyV5Checkpoint: null,
      input: { userId: 'alice', conversationId: 'chat', traceRequestId: requestId, inputStateRevision: baseRevision,
        messages: [], userText, selectedDate: WEEK, plans: [], scheduleTemplates: [],
        requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: STARTED,
          timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) },
    };
    const identity = { ownerId: 'alice', conversationId: 'chat', requestId, baseRevision, startedAt: Date.parse(STARTED) };
    expect((await job.accept({ ...identity, payload: JSON.stringify(input) })).status).toBe('queued');
    await alarm();
    const completed = await job.status(identity);
    expect(completed, `${nextFailure ?? 'healthy'}: publish the conversation result, including an unapplied failure`).toMatchObject({ status: 'completed' });
    const result = JSON.parse(completed!.result!) as WeeklyPlanningVNextDurableTurnResult;
    checkpoint = result.checkpointAfter;
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw: checkpoint!, ownerId: 'alice', weekStartDate: WEEK });
    expect(parsed).not.toBeNull();
    return { result, checkpoint: parsed!, identity };
  };
  return { turn, provider, alarm, job };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['500', 'timeout'] as const)('retains an unsaved VNext preview or shown question through provider %s, changes method on repeated failure, and handles the next utterance', async failure => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED);
    for (const phase of ['preview', 'question'] as const) {
      const h = harness();
      const preview = phase === 'preview';
      const seeded = await h.turn(preview ? '数学を60分、この条件で予定を作ってください。' : '数学を7ページ',
        reading(preview ? 'create_plan' : 'discuss', [task('math', '数学'), work('math-work', 'math', preview ? 60 : 7, preview ? 'minute' : 'page')]));
      const before = seeded.checkpoint.vnext;
      if (preview) expect(before.preview).not.toBeNull();
      else expect(before.presentedQuestion).not.toBeNull();
      let firstReply = '';
      for (const count of [1, 2]) {
        const startCalls = h.provider.mock.calls.length;
        const failedText = '数学を90分に変えてください。';
        const failed = await h.turn(failedText, reading('discuss'), failure);
        expect(failed.checkpoint.vnext.state).toEqual(before.state);
        expect(failed.checkpoint.vnext.preview).toEqual(before.preview);
        expect(failed.checkpoint.vnext.presentedQuestion).toEqual(before.presentedQuestion);
        expect(failed.checkpoint.vnext.failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: count });
        expect(failed.checkpoint.vnext.messages).toContainEqual({ role: 'user', content: failedText });
        const reply = failed.result.result.message;
        expect(reply).toContain('今回の内容は計画に反映していません。');
        expect(reply).not.toContain('保存しました');
        expect(failed.result.result.draftCandidates).toEqual([]);
        if (count === 1) firstReply = reply;
        else {
          expect(reply).not.toBe(firstReply);
          expect(reply).toContain(preview ? '予定案を確認するか、復旧後に変更を再送できます。' : 'これまでの会話を確認し、復旧後に今回の内容を再送できます。');
        }
        // A pending slot may use the existing bounded choice/focused/full-reading composition;
        // none of these distinct dispatches may be retried and a terminal alarm never sends again.
        const attempts = h.provider.mock.calls.slice(startCalls).map(([, init]) => String(init?.body));
        expect(attempts.length).toBeGreaterThan(0);
        expect(attempts.length).toBeLessThanOrEqual(3);
        expect(new Set(attempts).size).toBe(attempts.length);
        const sent = h.provider.mock.calls.length;
        await h.alarm();
        expect(h.provider).toHaveBeenCalledTimes(sent);
        expect(await h.job.status({ ...failed.identity, ownerId: 'bob' })).toBeNull();
        await expect(h.job.accept({ ...failed.identity, ownerId: 'bob', requestId: 'foreign', baseRevision: failed.identity.baseRevision + 2,
          payload: '{}' })).rejects.toMatchObject({ code: 'owner_mismatch' });
        expect(h.provider).toHaveBeenCalledTimes(sent);
      }
      const recovered = await h.turn(preview ? '英語も30分追加して予定を作ってください。' : '1ページ5分くらいです',
        preview ? reading('create_plan', [task('english', '英語'), work('english-work', 'english', 30, 'minute')]) : reading('discuss'));
      expect(recovered.checkpoint.vnext.state.graph.revision).toBeGreaterThan(before.state.graph.revision);
      expect(recovered.checkpoint.vnext.state.graph.tasks).toEqual(expect.arrayContaining(before.state.graph.tasks));
      expect(recovered.checkpoint.vnext.failureRecovery).toBeUndefined();
      expect(recovered.result.result.message).not.toContain('保存しました');
    }
});

it('retains an unanswered streak of two through a durable provider 500 and advances it only after the next successful empty reading', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED);
  const h = harness({ decision: 'fallback', effortTarget: null, effortMeasurement: null,
    minutes: null, precision: null, quantityRole: null });
  const seed = await h.turn('数学を7ページ', reading('discuss', [task('math', '数学'), work('math-work', 'math', 7, 'page')]));
  expect(seed.checkpoint.vnext.presentedQuestion).not.toBeNull();
  const first = await h.turn('全部', reading('discuss'));
  expect(first.checkpoint.vnext.unansweredQuestionStreak).toMatchObject({ count: 1 });
  const second = await h.turn('ない', reading('discuss'));
  const retained = second.checkpoint.vnext;
  expect(retained.unansweredQuestionStreak).toMatchObject({ count: 2,
    questionKey: seed.checkpoint.vnext.presentedQuestion!.questionKey,
    graphRevision: seed.checkpoint.vnext.state.graph.revision });
  const failed = await h.turn('接続を待っています', reading('discuss'), '500');
  expect(failed.checkpoint.vnext.unansweredQuestionStreak).toEqual(retained.unansweredQuestionStreak);
  expect(failed.checkpoint.vnext.failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: 1 });
  expect(failed.checkpoint.vnext.state).toEqual(retained.state);
  expect(failed.checkpoint.vnext.preview).toEqual(retained.preview);
  expect(failed.checkpoint.vnext.presentedQuestion).toEqual(retained.presentedQuestion);
  expect(failed.checkpoint.vnext.messages).toContainEqual({ role: 'user', content: '接続を待っています' });
  expect(failed.result.result.message).toContain('今回の内容は計画に反映していません。');
  expect(failed.result.result.draftCandidates).toEqual([]);
  const third = await h.turn('そういうこと', reading('discuss'));
  expect(third.checkpoint.vnext.unansweredQuestionStreak).toMatchObject({ ...retained.unansweredQuestionStreak, count: 3 });
  expect(third.checkpoint.vnext.failureRecovery).toBeUndefined();
  expect(third.checkpoint.vnext.state).toEqual(retained.state);
  expect(third.result.result.message).not.toBe(second.result.result.message);
  expect(third.result.result.message).not.toContain('保存しました');
  expect(third.result.result.draftCandidates).toEqual([]);
});
