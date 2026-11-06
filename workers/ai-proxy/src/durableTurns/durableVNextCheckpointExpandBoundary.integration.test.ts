import { afterEach, expect, it, vi } from 'vitest';
import { createInitialPlanningState } from '../../../../src/features/weeklyPlanning/weeklyPlanningReducer';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { createEmptyWeeklyPlanningVNextState } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { parseWeeklyPlanningVNextSessionCheckpoint as parseExpand, serializeWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { parseWeeklyPlanningVNextSessionCheckpoint as parseOld, serializeWeeklyPlanningVNextSessionCheckpoint as serializeOld } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint.f27b3a66.fixture';
import { parseWeeklyPlanningVNextSessionCheckpoint as parseStageA } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint.8413f709.fixture';
import { executeIsolatedWeeklyPlanningVNextTurn } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextIsolatedTurn';
import type { WeeklyPlanningVNextExperimentalPorts } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextRuntimeGateway } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeGateway';
import { decodeDurableTurnInput } from './durableTurnInput';
import { handleDurableTurnApi, type DurableTurnApiEnv } from './durableTurnApi';
import type { WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';

const durable = vi.hoisted(() => ({ execute: vi.fn<(...args: unknown[]) => Promise<WeeklyPlanningVNextDurableTurnResult>>(),
  save: vi.fn() }));
vi.mock('../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient', () => ({
  durableWeeklyPlanningEnabled: () => true,
  executeDurableWeeklyTurn: durable.execute,
  readDurableWeeklyTurnReceipt: () => null,
  saveDurableWeeklyTurnReceipt: durable.save,
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const ownerId = 'expand-owner';
const weekStartDate = '2026-11-02';
const conversationId = 'expand-conversation';
const startedAt = '2026-11-02T09:00:00.000Z';
const requestId = 'expand-request';
const pending = { conversationId, requestId, turnId: 'expand-turn', weekStartDate, baseRevision: 0, startedAt };

it('applies the same expanded checkpoint bytes at Worker admission and Pages result staging', async () => {
  // Same four-key envelope, fields and invalid values as the fixed-parser comparison table.
  const baseRaw = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId, weekStartDate, conversationId, savedAt: startedAt,
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] } });
  expect(baseRaw).not.toBeNull();
  const base = JSON.parse(baseRaw!);
  const failureRecovery = { reason: 'provider_error', consecutiveCount: 1 };
  const unansweredQuestionStreak = { questionKey: 'missing_effort_estimate:work', graphRevision: 0, count: 1 };
  const actualRecords = [{ id: 'record-1', occurrenceDate: '2026-10-26', subject: '数学', minutes: 30, status: 'pending' }];
  const pendingStudyRecordQuestion = { reason: 'missing_minutes', label: '英語' };
  const withFields = (fields: Record<string, unknown>) => JSON.stringify({ ...base, vnext: { ...base.vnext, ...fields } });
  const rows = [
    { name: 'four keys', raw: baseRaw!, accepted: true, oldAccepted: true },
    { name: 'failureRecovery', raw: withFields({ failureRecovery }), accepted: true, oldAccepted: false },
    { name: 'unansweredQuestionStreak', raw: withFields({ unansweredQuestionStreak }), accepted: true, oldAccepted: false },
    { name: 'both fields', raw: withFields({ failureRecovery, unansweredQuestionStreak }), accepted: true, oldAccepted: false },
    { name: 'actualRecords', raw: withFields({ actualRecords }), accepted: true, oldAccepted: false },
    { name: 'pendingStudyRecordQuestion', raw: withFields({ pendingStudyRecordQuestion }), accepted: true, oldAccepted: false },
    { name: 'all four optional fields', raw: withFields({ failureRecovery, unansweredQuestionStreak, actualRecords, pendingStudyRecordQuestion }), accepted: true, oldAccepted: false },
    { name: 'invalid actualRecords', raw: withFields({ actualRecords: [{ ...actualRecords[0], minutes: 0 }] }), accepted: false, oldAccepted: false },
    { name: 'invalid pendingStudyRecordQuestion', raw: withFields({ pendingStudyRecordQuestion: { ...pendingStudyRecordQuestion, reason: 'unknown' } }), accepted: false, oldAccepted: false },
    { name: 'invalid failureRecovery', raw: withFields({ failureRecovery: { ...failureRecovery, consecutiveCount: '1' } }), accepted: false, oldAccepted: false },
    { name: 'invalid unansweredQuestionStreak', raw: withFields({ unansweredQuestionStreak: { ...unansweredQuestionStreak, count: 0 } }), accepted: false, oldAccepted: false },
  ];
  // The already-expanded Stage A codec still rejects #974 record keys in either direction.
  // This fixture is the exact c30e1978 parser blob deployed by #991.
  for (const fields of [{ actualRecords }, { pendingStudyRecordQuestion }, { failureRecovery, unansweredQuestionStreak, actualRecords, pendingStudyRecordQuestion }]) {
    expect(parseStageA({ raw: withFields(fields), ownerId, weekStartDate })).toBeNull();
  }
  const acceptedTurn = vi.fn(async () => ({ accepted: true as const, value: { status: 'queued' } }));
  const env = { FIREBASE_WEB_API_KEY: 'test-web-key', OPENAI_API_KEY: 'test-provider-key', ALLOWED_ORIGIN: 'https://app.test',
    DURABLE_WEEKLY_TURNS: 'enabled', AI_TURNS: { getByName: () => ({ accept: acceptedTurn }) },
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
  } as unknown as DurableTurnApiEnv;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ users: [{ localId: ownerId, emailVerified: true }] })));

  for (const row of rows) {
    const input = { userId: ownerId, conversationId, traceRequestId: requestId, inputStateRevision: 0,
      messages: [], userText: '今週の予定', selectedDate: weekStartDate, plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: startedAt, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) };
    const body = { conversationId, requestId, baseRevision: 0, startedAt: Date.parse(startedAt),
      payload: { core: 'vnext', input, weekStartDate, checkpoint: row.raw, legacyV5Checkpoint: null } };
    expect(decodeDurableTurnInput(body, ownerId) !== null, `${row.name}: Worker decode`).toBe(row.accepted);
    expect(parseOld({ raw: row.raw, ownerId, weekStartDate }) !== null, `${row.name}: old parser negative control`).toBe(row.oldAccepted);
    acceptedTurn.mockClear();
    const request = new Request('https://proxy.test/weekly-planning/turns', { method: 'POST',
      headers: { Authorization: 'Bearer test-token', Origin: 'https://app.test' }, body: JSON.stringify(body) });
    const response = await handleDurableTurnApi(request, env);
    expect(response.status, `${row.name}: Worker API`).toBe(row.accepted ? 202 : 400);
    if (!row.accepted) expect(await response.json(), `${row.name}: rejection before turn`).toEqual({ error: 'invalid_input' });
    expect(acceptedTurn, `${row.name}: turn admission`).toHaveBeenCalledTimes(row.accepted ? 1 : 0);

    let stored: string | null = null;
    const checkpoint = { read: () => stored, write: (raw: string) => { stored = raw; }, remove: () => { stored = null; } };
    const gateway = createWeeklyPlanningVNextRuntimeGateway({ session: { checkpoint, legacyV5Checkpoint: { read: () => null } },
      ports: () => { throw new Error('local execution must not run'); } });
    durable.execute.mockResolvedValue({ core: 'vnext', checkpointBefore: null, checkpointAfter: row.raw,
      result: {} as WeeklyPlanningVNextDurableTurnResult['result'], stagedContextFacts: [], observedDate: weekStartDate });
    const execute = gateway.runtimeGateway.execute({ snapshot: createInitialPlanningState(weekStartDate), pending,
      userId: ownerId, userText: '今週の予定', selectedDate: weekStartDate, plans: [], scheduleTemplates: [],
      timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
    if (row.accepted) {
      await expect(execute, `${row.name}: Pages accepts result`).resolves.toEqual({});
      expect(stored, `${row.name}: staged until commit`).toBeNull();
      const stage = gateway.stagingLifecycle.prepare({ ownerId, pending });
      expect(stage, `${row.name}: stage available`).toBeDefined();
      expect(stored, `${row.name}: exact raw committed`).toBe(row.raw);
    } else {
      await expect(execute, `${row.name}: Pages rejects result`).rejects.toThrow('Invalid VNext result checkpoint.');
      expect(gateway.stagingLifecycle.prepare({ ownerId, pending }), `${row.name}: no stage`).toBeUndefined();
      expect(stored).toBeNull();
    }
  }
});

it.each([
  { order: 'Worker first: old Pages request → expanded Worker response', writeRequest: serializeOld, readResponse: parseOld },
  { order: 'Pages first: expanded Pages request → old Worker reader', writeRequest: serializeWeeklyPlanningVNextSessionCheckpoint, readResponse: parseExpand },
])('$order keeps healthy turns compatible and requires expanded readers for P1 failure recovery', async ({ writeRequest, readResponse }) => {
  // P1 is enabled only after both deployed readers expand. Healthy turns retain the legacy wire
  // format; a failure activates the recovery field and must use expanded readers on both sides.
  const raw = writeRequest({ ownerId, weekStartDate, conversationId, savedAt: startedAt,
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] } });
  expect(raw).not.toBeNull();
  expect(parseOld({ raw: raw!, ownerId, weekStartDate })).not.toBeNull();
  const input = { userId: ownerId, conversationId, traceRequestId: requestId, inputStateRevision: 0,
    messages: [], userText: '数学の勉強をします', selectedDate: weekStartDate, plans: [], scheduleTemplates: [],
    requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: startedAt, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) };
  const provider: Parameters<typeof executeIsolatedWeeklyPlanningVNextTurn>[1] = {
    client: {} as WeeklyPlanningVNextExperimentalPorts['client'],
    interpret: async () => ({ status: 'interpreted', planningIntent: 'discuss', answer: null,
      delta: { add: [{ kind: 'task', localId: 'math', category: 'study', title: '数学' }], patch: [], remove: [], relate: [], defer: [] },
      metrics: { calls: 1, repairs: 0, latencyMs: 1 } }),
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '数学の勉強ですね。', rawResponse: '' }) }),
  };
  // This is the actual producer shared by the Pages session and durable Worker, with only AI ports scripted.
  const first = await executeIsolatedWeeklyPlanningVNextTurn({ core: 'vnext', input, weekStartDate,
    checkpoint: raw, legacyV5Checkpoint: null }, provider);
  expect(first.checkpointAfter).not.toBeNull();
  const accepted = readResponse({ raw: first.checkpointAfter!, ownerId, weekStartDate });
  expect(accepted?.vnext.state.graph.tasks.map(task => task.title)).toEqual(['数学']);
  expect(parseOld({ raw: first.checkpointAfter!, ownerId, weekStartDate })).not.toBeNull();
  expect(Object.keys(JSON.parse(first.checkpointAfter!).vnext)).toEqual(['state', 'presentedQuestion', 'preview', 'messages']);

  provider.interpret = async () => ({ status: 'failed', reason: 'provider_error', errors: [],
    metrics: { calls: 1, repairs: 0, latencyMs: 1 } });
  const failed = await executeIsolatedWeeklyPlanningVNextTurn({ core: 'vnext', weekStartDate, checkpoint: first.checkpointAfter,
    legacyV5Checkpoint: null, input: { ...input, traceRequestId: `${requestId}:2`, userText: '続けて相談します',
      inputStateRevision: accepted!.vnext.state.graph.revision } }, provider);
  const afterFailure = parseExpand({ raw: failed.checkpointAfter!, ownerId, weekStartDate });
  expect(afterFailure?.vnext.state).toEqual(accepted!.vnext.state);
  expect(afterFailure?.vnext.failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: 1 });
  expect(parseOld({ raw: failed.checkpointAfter!, ownerId, weekStartDate })).toBeNull();
  expect(Object.keys(JSON.parse(failed.checkpointAfter!).vnext).sort())
    .toEqual(['failureRecovery', 'messages', 'presentedQuestion', 'preview', 'state']);
  expect(afterFailure?.vnext.messages.filter(message => message.role === 'user').map(message => message.content))
    .toEqual(['数学の勉強をします', '続けて相談します']);
});
