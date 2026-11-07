import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { compareRealApiDateMeaning } from '../../../../src/features/weeklyPlanning/evals/vnextRealApiDateOracle';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact, VNextTurnDelta } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
const dispatch = (_raw: string, send: () => Promise<string>) => send();
const task: VNextAddFact = { kind: 'task', localId: 'english', category: 'study', title: '英語' };
const recurrence: VNextAddFact = { kind: 'recurrence', localId: 'repeat', taskRef: { localId: 'english' },
  targetRef: { localId: 'english' }, recurrenceKind: 'weekly', days: ['weekday:monday'], count: null };

function payload(date = '2026-11-02', week = '2026-11-02'): WeeklyPlanningVNextDurableTurnInput {
  return { core: 'vnext', weekStartDate: week, checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: 'migration', traceRequestId: 'migration:request:1',
      inputStateRevision: 0, messages: [], userText: '来週から毎週月曜日に英語を勉強する予定にしてください。',
      selectedDate: date, plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: `${date}T00:00:00.000Z`, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
}
type ScriptContext = { activeFacts: { workloads: { id: string; quantityRole: string }[] } };
type Script = VNextAddFact[] | ((context: ScriptContext) => Partial<VNextTurnDelta>);
function provider(steps: Script[]) {
  const nativeCalls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      nativeCalls.push(body);
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request, including repair');
      const context = body.messages.map((message: { content: string }) => {
        try { return JSON.parse(message.content); } catch { return null; }
      }).find((value: ScriptContext | null) => value?.activeFacts);
      const delta = typeof step === 'function' ? step(context) : { add: step };
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [],
        delta: { add: [], patch: [], remove: [], relate: [], defer: [], ...delta }, answer: null });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  return nativeCalls;
}
function read(raw: string, input: WeeklyPlanningVNextDurableTurnInput) {
  const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
  expect(checkpoint).not.toBeNull();
  return checkpoint!;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#978 V5 counterexamples through the production Worker turn', () => {
  it.each(['tomorrow', '2026-08-27'] as const)('retains the tomorrow window from %s, with no candidate or save authority', async value => {
    const input = payload('2026-08-26', '2026-08-24');
    input.input.userText = '明日の予定を立てたいです';
    const calls = provider([[{ kind: 'planning_window', localId: 'window', windowKind: value === 'tomorrow' ? 'relative_day' : 'absolute',
      value, start: value === 'tomorrow' ? null : value, end: value === 'tomorrow' ? null : value }]]);
    const output = await executeDurableVNextTurn(env, input, dispatch);
    const checkpoint = read(output.checkpointAfter!, input);
    expect(calls).toHaveLength(1);
    expect(compareRealApiDateMeaning({ graph: checkpoint.vnext.state.graph, requestContext: input.input.requestContext,
      oracle: { planningWindow: { startDate: '2026-08-27', endDate: '2026-08-27' } } })).toEqual([]);
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
  });

  it.each(['bound', 'window', 'missing'] as const)('checks the recurrence start after a real Worker turn (%s)', async representation => {
    const start: VNextAddFact[] = representation === 'missing' ? [] : representation === 'window'
      ? [{ kind: 'planning_window', localId: 'window', windowKind: 'relative_week', value: 'next_week', start: null, end: null }]
      : [{ kind: 'temporal_constraint', localId: 'start', taskRef: { localId: 'english' }, targetRef: { localId: 'english' },
        constraintKind: 'earliest_start', constraintLevel: 'hard', dateExpression: 'next_week', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' }];
    const calls = provider([[task, recurrence, ...start]]);
    const input = payload();
    const output = await executeDurableVNextTurn(env, input, dispatch);
    const checkpoint = read(output.checkpointAfter!, input);
    expect(calls).toHaveLength(1);
    const differences = compareRealApiDateMeaning({ graph: checkpoint.vnext.state.graph, requestContext: input.input.requestContext,
      oracle: { recurrence: { kind: 'weekly', days: ['weekday:monday'], startDate: '2026-11-09' } } });
    if (representation === 'missing') expect(differences).toEqual(['recurrence start missing: 2026-11-09']);
    else expect(differences).toEqual([]);
    // The historical missing-start model answer stays red in the oracle and safe in the product.
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    expect(checkpoint.vnext.state.graph.workloads).toEqual([]);
    expect(checkpoint.vnext.actualRecords ?? []).toEqual([]);
  });

  it('keeps busy-only context across a reload and does not treat the following yes as registration authority', async () => {
    const input = payload();
    input.input.userText = '11月3日16時から17時半までゼミがあります。';
    const calls = provider([[{ kind: 'availability_declaration', localId: 'busy', availabilityKind: 'unavailable',
      dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30',
      recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' }], []]);
    const first = await executeDurableVNextTurn(env, input, dispatch);
    const before = read(first.checkpointAfter!, input);
    const resumed = structuredClone(input);
    resumed.checkpoint = first.checkpointAfter;
    resumed.input.inputStateRevision = before.vnext.state.graph.revision;
    resumed.input.traceRequestId = 'migration:request:2';
    resumed.input.userText = 'うん、お願い。';
    const second = await executeDurableVNextTurn(env, resumed, dispatch);
    const after = read(second.checkpointAfter!, resumed);
    expect(calls).toHaveLength(2);
    expect(after.vnext.state.graph.availabilityDeclarations).toEqual(before.vnext.state.graph.availabilityDeclarations);
    expect(after.vnext.state.graph.tasks).toEqual([]);
    expect(second.result.draftCandidates).toEqual([]);
    expect(after.vnext.preview).toBeNull();
  });

  it.each([false, true])('preserves independent date/rate facts through completed 10→12 or an invalid correction (invalid=%s)', async invalid => {
    const work = (id: string, role: 'scope_total' | 'completed', amount: number): VNextAddFact => ({ kind: 'workload',
      localId: id, taskRef: { localId: 'english' }, componentRef: null, quantityRole: role, amount,
      unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
    const input = payload('2026-08-26', '2026-08-24');
    input.input.userText = 'スライドは全部20枚、10枚完了、1枚8分です。明日残りを終わらせたいです。';
    const correct = (context: ScriptContext): Partial<VNextTurnDelta> => ({ patch: [{ kind: 'workload', localId: 'corrected',
      targetFactId: invalid ? 'unregistered-reference' : context.activeFacts.workloads.find(w => w.quantityRole === 'completed')!.id,
      amountDelta: null, changes: { amount: 12, quantityRole: null, unitCode: null, unitLabel: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] });
    const calls = provider([[task, work('total', 'scope_total', 20), work('completed', 'completed', 10),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'english' }, targetRef: { localId: 'english' },
        effortKind: 'duration_per_unit', minutes: 8, unitCode: 'custom', unitLabel: '枚', precision: 'exact' },
      { kind: 'temporal_constraint', localId: 'day', taskRef: { localId: 'english' }, targetRef: { localId: 'english' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'tomorrow', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' }], correct, ...(invalid ? [correct] : [])]);
    const first = await executeDurableVNextTurn(env, input, dispatch);
    const before = read(first.checkpointAfter!, input);
    const resumed = structuredClone(input);
    resumed.checkpoint = first.checkpointAfter;
    resumed.input.traceRequestId = 'migration:request:2';
    resumed.input.inputStateRevision = before.vnext.state.graph.revision;
    resumed.input.userText = '訂正です、今は12枚までできています。';
    const output = await executeDurableVNextTurn(env, resumed, dispatch);
    const after = read(output.checkpointAfter!, resumed);
    expect(calls).toHaveLength(invalid ? 3 : 2);
    if (invalid) expect(after.vnext.state.graph).toEqual(before.vnext.state.graph);
    else {
      const projection = projectWeeklyPlanningVNext(after.vnext.state);
      expect(projection.owners.flatMap(owner => owner.work.map(w => ({ amount: w.amount, minutes: w.minutes }))))
        .toEqual([{ amount: 8, minutes: 64 }]);
    }
    expect(after.vnext.state.graph.temporalConstraints).toEqual(before.vnext.state.graph.temporalConstraints);
    expect(after.vnext.state.graph.effortEstimates).toEqual(before.vnext.state.graph.effortEstimates);
    expect(compareRealApiDateMeaning({ graph: after.vnext.state.graph, requestContext: resumed.input.requestContext,
      oracle: { workDate: { task: 'slides', date: '2026-08-27' } },
      taskIdsByKey: new Map([['slides', after.vnext.state.graph.tasks[0].id]]) })).toEqual([]);
    expect(output.result.draftCandidates).toEqual([]);
    expect(after.vnext.preview).toBeNull();
  });
});
