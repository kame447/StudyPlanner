import { afterEach, expect, it, vi } from 'vitest';
import { AiQuotaDurableObject, type AiQuotaCheckRequest, type AiQuotaCheckResult } from '../aiQuotaDurableObject';
import { enforceQuota, type AiProxyWorkerEnv } from '../worker';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import { executeDurableWeeklyTurn, type DurableTurnClientPorts, type DurableWeeklyTurnReceipt } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import { WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE, WeeklyPlanningDurableWorkerUnavailableError } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableWorkerUnavailableError';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { createInitialPlanningState } from '../../../../src/features/weeklyPlanning/weeklyPlanningReducer';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';

const OWNER = 'quota-owner';
const WEEK = '2026-11-02';
const NOW = '2026-11-02T00:00:00.000Z';
const IP = '203.0.113.8';
const reading = (title: string, amount: number) => JSON.stringify({ planningIntent: 'create_plan', conversationActs: [], answer: null,
  delta: { add: [{ kind: 'task', localId: 'task', category: 'study', title },
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining',
      amount, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }],
  patch: [], remove: [], relate: [], defer: [] } });
type Buckets = Record<string, { windowId: string; count: number; resetAt: number }>;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('stops an unpublished VNext turn when the real quota rejects its second call, preserves the old preview, and accepts a new utterance in the next window', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const decisions: Array<{ name: string; request: AiQuotaCheckRequest; result: AiQuotaCheckResult }> = [];
  const quotas = new Map<string, { object: AiQuotaDurableObject; state: () => Buckets }>();
  const quotaFor = (name: string) => {
    let entry = quotas.get(name);
    if (!entry) {
      let state: Buckets = {};
      const object = new AiQuotaDurableObject({ storage: { get: async () => structuredClone(state),
        put: async (_key: string, next: Buckets) => { state = structuredClone(next); } } } as never, {});
      entry = { object, state: () => structuredClone(state) };
      quotas.set(name, entry);
    }
    return entry;
  };
  const env = { OPENAI_API_KEY: 'synthetic-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
    AI_QUOTA: { getByName: (name: string) => ({ async checkAndConsume(request: AiQuotaCheckRequest) {
      const result = await quotaFor(name).object.checkAndConsume(request);
      decisions.push({ name, request: structuredClone(request), result });
      return result;
    } }) },
  } as unknown as AiProxyWorkerEnv;
  let record: DurableTurnRecord | undefined;
  let checkpoint: string | null = null;
  let semantic = '';
  let sequence = 0;
  const upstreamSchemas: string[] = [];
  const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    const schema = body.response_format?.json_schema?.name;
    upstreamSchemas.push(schema);
    const content = schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name ? semantic
      : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', upstream);
  const job = new DurableTurnJob({ read: async () => structuredClone(record),
    write: async next => { record = structuredClone(next); }, alarmAt: async () => {} });
  const alarm = () => job.run(async (raw, dispatch, ip, deadline) => serializeWeeklyPlanningTurnResult(
    await executeDurableVNextTurn(env, JSON.parse(raw), dispatch, ip, deadline)));
  const methods: string[] = [];
  const ports: DurableTurnClientPorts = { endpoint: 'https://quota.fixture.test/weekly-planning/turns', now: Date.now,
    token: async owner => { expect(owner).toBe(OWNER); return 'synthetic-token'; }, wait: async () => {},
    fetch: async (url, init) => {
      expect(String(url).startsWith('https://quota.fixture.test/weekly-planning/turns')).toBe(true);
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const accepted = await job.accept({ ...body, ownerId: OWNER, sourceIp: IP, payload: JSON.stringify(body.payload) });
        await alarm();
        return Response.json(accepted, { status: 202 });
      }
      const query = new URL(String(url)).searchParams;
      const state = await job.status({ ownerId: OWNER, conversationId: query.get('conversationId')!, requestId: query.get('requestId')! });
      return state ? Response.json(state) : new Response(null, { status: 404 });
    },
  };
  const turn = async (userText: string, nextReading: string) => {
    semantic = nextReading;
    const baseRevision = sequence++ * 2;
    const requestId = `chat:request:${sequence}`;
    const startedAt = new Date().toISOString();
    const payload: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: WEEK, checkpoint, legacyV5Checkpoint: null,
      input: { userId: OWNER, conversationId: 'chat', traceRequestId: requestId, inputStateRevision: baseRevision, messages: [], userText,
        selectedDate: WEEK, plans: [], scheduleTemplates: [], requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: startedAt,
          timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
    const receipt: DurableWeeklyTurnReceipt<WeeklyPlanningVNextDurableTurnInput> = { version: 1, ownerId: OWNER,
      snapshot: { ...createInitialPlanningState(WEEK), revision: baseRevision }, payload,
      pending: { conversationId: 'chat', requestId, turnId: requestId, weekStartDate: WEEK, baseRevision, startedAt } };
    const result = await executeDurableWeeklyTurn<WeeklyPlanningVNextDurableTurnResult>(receipt, { ports });
    checkpoint = result.checkpointAfter;
    expect(result.result.message).not.toContain('保存しました');
    return parseWeeklyPlanningVNextSessionCheckpoint({ raw: checkpoint!, ownerId: OWNER, weekStartDate: WEEK })!.vnext;
  };

  const seeded = await turn('数学を60分、この条件で予定を作ってください。', reading('数学', 60));
  expect(seeded.preview).not.toBeNull();
  expect(seeded.state.graph.tasks.map(task => task.title)).toEqual(['数学']);
  expect(upstream).toHaveBeenCalledTimes(2);
  const uid = quotaFor(`uid:${OWNER}`);
  expect(uid.state()['chat:uid:minute'].count).toBe(2);
  // Fill the preceding-call budget with the real Worker rules and real DO, without model requests.
  for (let count = 2; count < 29; count += 1) {
    expect(await enforceQuota(new Request('https://quota.fixture.test/chat/completions', {
      headers: { 'CF-Connecting-IP': IP } }), env, OWNER, 'chat')).toBeNull();
  }
  expect(uid.state()['chat:uid:minute'].count).toBe(29);
  expect(upstream).toHaveBeenCalledTimes(2);
  methods.length = 0;
  const before = checkpoint;
  const callsBefore = upstreamSchemas.length;
  const failed = turn('英語も30分追加して予定を作ってください。', reading('英語', 30));
  await expect(failed).rejects.toBeInstanceOf(WeeklyPlanningDurableWorkerUnavailableError);
  await expect(failed).rejects.toMatchObject({ userMessage: WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE });
  expect(record).toMatchObject({ status: 'failed', failure: 'provider_failure' });
  expect(record?.result).toBeUndefined();
  expect(methods).toEqual(['POST', 'GET']);
  expect(upstreamSchemas.slice(callsBefore)).toEqual([VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name]);
  expect(upstream).toHaveBeenCalledTimes(callsBefore + 1);
  expect(decisions.filter(decision => !decision.result.allowed)).toEqual([expect.objectContaining({ name: `uid:${OWNER}`,
    result: { allowed: false, retryAfterSeconds: 60, exceededRule: 'chat:uid:minute', limit: 30, remaining: 0 } })]);
  expect(uid.state()['chat:uid:minute'].count).toBe(30);
  expect(checkpoint).toBe(before);
  const retained = parseWeeklyPlanningVNextSessionCheckpoint({ raw: checkpoint!, ownerId: OWNER, weekStartDate: WEEK })!.vnext;
  expect(retained.state).toEqual(seeded.state);
  expect(retained.preview).toEqual(seeded.preview);
  const sent = upstream.mock.calls.length;
  const quotaChecks = decisions.length;
  await alarm();
  expect(upstream).toHaveBeenCalledTimes(sent);
  expect(decisions).toHaveLength(quotaChecks);
  expect(await job.status({ ownerId: 'other-owner', conversationId: 'chat', requestId: 'chat:request:2' })).toBeNull();

  vi.setSystemTime(Date.parse(NOW) + 60_000);
  const next = await turn('英語は45分で予定を作ってください。', reading('英語', 45));
  expect(record?.status).toBe('completed');
  expect(next.preview).not.toBeNull();
  expect(next.state.graph.tasks.map(task => task.title)).toEqual(['数学', '英語']);
  expect(next.state.graph.workloads.map(work => work.amount)).toEqual([60, 45]);
  expect(uid.state()['chat:uid:minute'].count).toBe(2);
  expect(upstream).toHaveBeenCalledTimes(sent + 2);
  const completedCalls = upstream.mock.calls.length;
  await alarm();
  expect(upstream).toHaveBeenCalledTimes(completedCalls);
});
