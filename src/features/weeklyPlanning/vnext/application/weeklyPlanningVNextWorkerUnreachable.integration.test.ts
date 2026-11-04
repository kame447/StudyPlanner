import { expect, it, vi } from 'vitest';
import type { PlanningState, WeeklyPlanningAction } from '../../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../../weeklyPlanningTurnController';
import { submitWeeklyPlanningApplicationTurnWithServices, type WeeklyPlanningTurnApplicationServices } from '../../application/weeklyPlanningTurnApplicationCore';
import { readDurableWeeklyTurnReceipt, type DurableTurnClientPorts } from '../../application/weeklyPlanningDurableTurnClient';
import { WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE } from '../../application/weeklyPlanningDurableWorkerUnavailableError';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeGateway } from './weeklyPlanningVNextRuntimeGateway';
import { executeIsolatedWeeklyPlanningVNextTurn } from './weeklyPlanningVNextIsolatedTurn';
import type { WeeklyPlanningVNextDurableTurnInput } from './weeklyPlanningVNextDurableTurn';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';

// Inject only transport ports; execute the production reconciliation loop and gateway unchanged.
const transport = vi.hoisted(() => ({ ports: undefined as DurableTurnClientPorts | undefined }));
vi.mock('../../application/weeklyPlanningDurableTurnClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../application/weeklyPlanningDurableTurnClient')>();
  return { ...actual, executeDurableWeeklyTurn: ((receipt, options) => actual.executeDurableWeeklyTurn(receipt,
    { ...options, ports: transport.ports })) as typeof actual.executeDurableWeeklyTurn };
});

const OWNER = 'synthetic-worker-unreachable-owner';
const WEEK = '2026-11-02';
const START = Date.parse(`${WEEK}T00:00:00.000Z`);
const CONVERSATION = 'worker-unreachable-conversation';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'minutes', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];

it('keeps an unsaved VNext preview through prolonged Worker unreachability, explains non-application, and continues the same conversation after recovery', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START);
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'disabled');
  const memory = createMemoryStorageHarness();
  const restore = installWeeklyPlanningTestStorage(memory.storage);
  try {
    let now = START;
    let state = createInitialPlanningState(WEEK);
    const getState = () => state;
    const dispatch = (action: WeeklyPlanningAction) => { state = weeklyPlanningReducer(state, action); return state; };
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
    const session = createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION);
    const script = [
      { planningIntent: 'create_plan', conversationActs: [], delta: { ...EMPTY, add: facts }, answer: null },
      { planningIntent: 'discuss', conversationActs: [], delta: EMPTY, answer: null },
    ];
    const client = { createChatCompletion: vi.fn(async () => {
      const next = script.shift();
      if (!next) throw new Error('synthetic provider script exhausted');
      return JSON.stringify(next);
    }) };
    const saveBlock = vi.fn(async () => { throw new Error('unexpected Plan write'); });
    const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
    const provider: Pick<WeeklyPlanningVNextExperimentalPorts, 'client' | 'interpret' | 'createRenderer'> = {
      client, interpret: createWeeklyPlanningVNextProviderInterpreter(),
      createRenderer: () => ({ async render() {
        return { status: 'rendered', text: '数学60分の予定案です。まだ保存していません。', rawResponse: '' };
      } }),
    };
    const gateway = createWeeklyPlanningVNextRuntimeGateway({ session: local, ports: () => ({ ...provider,
      checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
      plans: { findExistingPlanId: async () => undefined, saveBlock },
      approvalLedger: { read: () => null, write: approvalWrite },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => new Date(now).toISOString(),
    }) });
    const outcomes = { committed: vi.fn(), discarded: vi.fn(), failed: vi.fn() };
    const services: WeeklyPlanningTurnApplicationServices = { ...gateway,
      submitControlledTurn: submitWeeklyPlanningControlledTurn, outcomeLifecycle: outcomes };
    const submit = (userText: string) => submitWeeklyPlanningApplicationTurnWithServices({
      session, userId: OWNER, ownerId: OWNER, userText, selectedDate: WEEK,
      plans: [], scheduleTemplates: [], getState, dispatch, now: () => new Date(now).toISOString(),
      weekStartsOn: 'monday', timeZone: 'Asia/Tokyo',
      plannerDataAvailability: { status: 'ready', ownerId: OWNER,
        observedAt: new Date(now).toISOString(), lastSuccessfulAt: new Date(now).toISOString() },
    }, services);

    expect((await submit('今週の数学を60分、この条件で予定を作ってください。')).accepted).toBe(true);
    const before = structuredClone(state);
    const beforeCheckpoint = local.checkpoint.read();
    expect(before.previewCandidates).toHaveLength(1);
    expect(local.readCheckpoint()!.vnext.state.graph.workloads[0].amount).toBe(60);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);

    let recovered = false;
    let lostRequest: { conversationId: string; requestId: string; baseRevision: number; startedAt: number;
      payload: WeeklyPlanningVNextDurableTurnInput } | undefined;
    const requests: { method: string; url: string }[] = [];
    const observations: { state: PlanningState; checkpoint: string | null; input: string | undefined }[] = [];
    let checkedDuplicate = false;
    const workerExecutions = vi.fn(executeIsolatedWeeklyPlanningVNextTurn);
    const fetch = vi.fn<DurableTurnClientPorts['fetch']>(async (url, init) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url: String(url) });
      if (!recovered) {
        if (method === 'POST') {
          lostRequest = JSON.parse(String(init?.body)) as NonNullable<typeof lostRequest>;
          throw new TypeError('synthetic connection lost before acknowledgement');
        }
        // Keep the production backoff clock moving, then exercise the terminal 503 path.
        return new Response(null, { status: now - START < 60_000 ? 500 : 503 });
      }
      expect(method).toBe('POST');
      const request = JSON.parse(String(init?.body)) as NonNullable<typeof lostRequest>;
      const result = await workerExecutions(request.payload, provider);
      return Response.json({ identity: { ownerId: OWNER, conversationId: request.conversationId,
        requestId: request.requestId, baseRevision: request.baseRevision, startedAt: request.startedAt },
      status: 'completed', expiresAt: now + 86_400_000, result: JSON.stringify(result) });
    });
    transport.ports = { fetch, endpoint: 'https://worker.invalid/weekly-planning/turns',
      token: async () => 'synthetic-owner-token', now: () => now, wait: async (ms) => {
        now += ms;
        observations.push({ state: structuredClone(state), checkpoint: local.checkpoint.read(),
          input: readDurableWeeklyTurnReceipt(OWNER, 'vnext')?.payload.input.userText });
        if (!checkedDuplicate) {
          checkedDuplicate = true;
          expect(await submit('照合中の二重送信')).toEqual({ accepted: false, draftCandidates: [] });
        }
      } };
    vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled');
    // Rejection versus a handled failure is internal. Inspect the published state in either case.
    await submit('数学を90分に変えてください。').catch(() => undefined);

    expect(now - START).toBeGreaterThanOrEqual(60_000);
    expect(observations.length).toBeGreaterThan(1);
    for (const observed of observations) {
      expect(observed.state.pendingTurn?.requestId).toBe(lostRequest!.requestId);
      expect(observed.state.messages[observed.state.messages.length - 1]?.content).toBe('数学を90分に変えてください。');
      expect(observed.state.previewCandidates).toEqual(before.previewCandidates);
      expect(observed.state.draftBlocks).toEqual(before.draftBlocks);
      expect(observed.checkpoint).toBe(beforeCheckpoint);
      expect(observed.input).toBe('数学を90分に変えてください。');
    }
    expect(requests[0].method).toBe('POST');
    expect(requests.slice(1).every(request => request.method === 'GET')).toBe(true);
    for (const request of requests.slice(1)) {
      const query = new URL(request.url).searchParams;
      expect(query.get('conversationId')).toBe(CONVERSATION);
      expect(query.get('requestId')).toBe(lostRequest!.requestId);
    }
    expect(workerExecutions).not.toHaveBeenCalled();
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(state.pendingTurn).toBeUndefined();
    expect(local.checkpoint.read()).toBe(beforeCheckpoint);
    expect(state.intakeState).toEqual(before.intakeState);
    expect(state.previewCandidates).toEqual(before.previewCandidates);
    expect(state.draftBlocks).toEqual(before.draftBlocks);
    expect(outcomes.failed).toHaveBeenCalledTimes(1);
    expect(outcomes.committed).toHaveBeenCalledTimes(1);
    const failureReply = state.messages[state.messages.length - 1];
    expect(failureReply.role).toBe('assistant');
    expect(failureReply.content).toBe(WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE);

    recovered = true;
    expect((await submit('今の仮案を見せてください。')).accepted).toBe(true);
    expect(state.pendingTurn).toBeUndefined();
    expect(state.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual([
      '今週の数学を60分、この条件で予定を作ってください。', '数学を90分に変えてください。', '今の仮案を見せてください。',
    ]);
    expect(workerExecutions).toHaveBeenCalledTimes(1);
    const recoveredPayload = workerExecutions.mock.calls[0][0];
    expect(recoveredPayload.input.conversationId).toBe(CONVERSATION);
    expect(recoveredPayload.input.traceRequestId).not.toBe(lostRequest!.requestId);
    expect(recoveredPayload.checkpoint).toBe(beforeCheckpoint);
    expect(recoveredPayload.input.userText).toBe('今の仮案を見せてください。');
    expect(recoveredPayload.input.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '数学を90分に変えてください。' }), failureReply,
    ]));
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(2);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(outcomes.committed).toHaveBeenCalledTimes(2);
    expect(state.previewCandidates).toEqual(before.previewCandidates);
    expect(local.readCheckpoint()!.vnext.state.graph.workloads[0].amount).toBe(60);
    expect(saveBlock).not.toHaveBeenCalled();
    expect(approvalWrite).not.toHaveBeenCalled();
  } finally {
    transport.ports = undefined;
    restore(); vi.unstubAllEnvs(); vi.useRealTimers();
  }
});
