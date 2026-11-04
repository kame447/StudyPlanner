import { afterEach, expect, it, vi } from 'vitest';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const STARTED = '2026-11-02T00:00:00.000Z';
const WEEK = '2026-11-02';
const reading = (add: unknown[], answer: unknown = null) => JSON.stringify({
  planningIntent: 'discuss', conversationActs: [], delta: { add, patch: [], remove: [], relate: [], defer: [] }, answer,
});
const pages = (localId: string, quantityRole: string, amount: number) => ({
  kind: 'workload', localId, taskRef: { localId: 'math' }, componentRef: null, quantityRole,
  amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('journals an optional choice HTTP 500 as unavailable, reads the whole utterance with the main provider, and continues without saving or resending', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED);
  const env = { OPENAI_API_KEY: 'synthetic-key', OPENROUTER_API_KEY: 'synthetic-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
    JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
  } as unknown as AiProxyWorkerEnv;
  let record: DurableTurnRecord | undefined;
  const writes: DurableTurnRecord[] = [];
  let checkpoint: string | null = null;
  let sequence = 0;
  let semantic = '';
  const fullInputs: string[] = [];
  const choiceInputs: unknown[] = [];
  const provider = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url) === 'https://openrouter.ai/api/alpha/decisions') {
      choiceInputs.push(body.state);
      return Response.json({ error: { message: 'synthetic choice-only outage' } }, { status: 500 });
    }
    // No request to a datastore or a real provider can escape this upstream boundary.
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    const isFullReading = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name;
    let content: string;
    if (isFullReading) {
      const prompt = JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content);
      fullInputs.push(prompt.userText);
      const response = JSON.parse(semantic);
      if (response.answer?.kind === 'option') {
        // Model output uses this invocation's supplied aliases, never internal domain IDs.
        const option = prompt.presentedQuestion.options.find((candidate: { value: number }) => candidate.value === 8);
        expect(option).toBeDefined();
        response.answer.optionId = option.optionId;
      }
      content = JSON.stringify(response);
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', provider);
  const job = new DurableTurnJob({ read: async () => structuredClone(record),
    write: async next => { record = structuredClone(next); writes.push(structuredClone(next)); }, alarmAt: async () => {},
  }, () => Date.parse(STARTED));
  const alarm = () => job.run(async (raw, dispatch, ip, deadline) => serializeWeeklyPlanningTurnResult(
    await executeDurableVNextTurn(env, JSON.parse(raw), dispatch, ip, deadline)));
  const turn = async (userText: string, nextSemantic: string) => {
    semantic = nextSemantic;
    const baseRevision = sequence++ * 2;
    const requestId = `chat:request:${sequence}`;
    const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: WEEK,
      checkpoint, legacyV5Checkpoint: null,
      input: { userId: 'alice', conversationId: 'chat', traceRequestId: requestId, inputStateRevision: baseRevision,
        messages: [], userText, selectedDate: WEEK, plans: [], scheduleTemplates: [],
        requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: STARTED, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) },
    };
    const identity = { ownerId: 'alice', conversationId: 'chat', requestId, baseRevision, startedAt: Date.parse(STARTED) };
    expect((await job.accept({ ...identity, payload: JSON.stringify(input) })).status).toBe('queued');
    await alarm();
    const completed = await job.status(identity);
    expect(completed).toMatchObject({ status: 'completed' });
    const result = JSON.parse(completed!.result!) as WeeklyPlanningVNextDurableTurnResult;
    checkpoint = result.checkpointAfter;
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw: checkpoint!, ownerId: 'alice', weekStartDate: WEEK });
    expect(parsed).not.toBeNull();
    expect(result.result.draftCandidates).toEqual([]);
    expect(result.result.message).not.toContain('保存しました');
    expect(result.result.message).not.toContain('今回の内容は計画に反映していません。');
    expect(parsed!.vnext.failureRecovery).toBeUndefined();
    expect(await job.status({ ...identity, ownerId: 'bob' })).toBeNull();
    const calls = provider.mock.calls.length;
    await alarm();
    expect(provider).toHaveBeenCalledTimes(calls);
    const vnext = parsed!.vnext;
    return { ...vnext, shownQuestion: projectWeeklyPlanningVNext(vnext.state).questions.find(question => question.key === vnext.presentedQuestion?.questionKey) };
  };

  const seedText = '数学プリントは全部で20枚、12枚終わり、残り7枚です。';
  const seeded = await turn(seedText, reading([{ kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
    pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)]));
  expect(seeded.shownQuestion?.code).toBe('remaining_inconsistent');
  expect(choiceInputs).toEqual([]);

  const independentText = '英語の音読も30分やりたいです。';
  const continued = await turn(independentText, reading([{ kind: 'task', localId: 'english', category: 'study', title: '英語の音読' },
    { ...pages('english-work', 'remaining', 30), taskRef: { localId: 'english' }, unitCode: 'minute', unitLabel: '分' }]));
  expect(choiceInputs).toHaveLength(1);
  expect(choiceInputs[0]).toMatchObject({ currentUserText: independentText, context: { question: { code: 'remaining_inconsistent' } } });
  const receipt = writes.find(snapshot => snapshot.identity.requestId === 'chat:request:2' && snapshot.journal?.[0]?.status === 'completed')?.journal?.[0];
  expect(receipt).toMatchObject({ status: 'completed', response: JSON.stringify({ status: 'unavailable', reason: 'http' }) });
  expect(fullInputs).toEqual([seedText, independentText]);
  expect(continued.state.graph.tasks).toEqual(expect.arrayContaining(seeded.state.graph.tasks));
  expect(continued.state.graph.tasks).toContainEqual(expect.objectContaining({ title: '英語の音読' }));
  expect(continued.state.graph.workloads).toContainEqual(expect.objectContaining({ amount: 30, unitCode: 'minute' }));
  expect(continued.shownQuestion?.code).toBe('remaining_inconsistent');
  expect(continued.preview).toEqual(seeded.preview);

  // The following utterance can still answer the question; each optional outage has only one dispatch.
  const nextText = '数学は計算どおり残り8枚でいいです。';
  const next = await turn(nextText, reading([], { kind: 'option', optionId: 'remaining_follows_progress', minutes: null, per: null }));
  expect(choiceInputs).toHaveLength(2);
  expect(fullInputs).toEqual([seedText, independentText, nextText]);
  expect(next.state.graph.tasks).toEqual(expect.arrayContaining(continued.state.graph.tasks));
  expect(next.state.graph.workloads).toContainEqual(expect.objectContaining({ amount: 8, unitCode: 'page' }));
  expect(next.shownQuestion?.code).not.toBe('remaining_inconsistent');
});
