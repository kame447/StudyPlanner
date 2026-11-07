import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { compileGenericSchedulerInput } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;

function harness(id: string, steps: VNextAddFact[][]) {
  let nativeCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const native = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name;
    let content: string;
    if (native) {
      nativeCalls++;
      const add = steps.shift();
      if (!add) throw new Error('unexpected semantic request, including repair');
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
        delta: { add, patch: [], remove: [], relate: [], defer: [] } });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: id, traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { done() { expect(nativeCalls).toBe(sequence); expect(steps).toEqual([]); }, async turn(userText: string) {
    input.input.traceRequestId = `${id}:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    expect(output.result.failure).toBeUndefined();
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(checkpoint.vnext.state.graph),
      context: { ownerId: input.input.userId, currentDate: '2026-11-02', planningStartDate: '2026-11-02',
        planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } });
    if (!compilation.input) throw new Error(`Scheduler input unavailable: ${compilation.status}`);
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { checkpoint: checkpoint.vnext, state: checkpoint.vnext.state, scheduler: compilation.input,
      work: projectWeeklyPlanningVNext(checkpoint.vnext.state).owners.flatMap(owner => owner.work) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Scripted accepted readings: no assertion that the live model recognizes a Japanese refusal/yes.
describe('#978 C20 busy information and registration authority through the Worker', () => {
  it('fixed-event-registration-negated/1: retains a non-study fixed commitment without registration authority', async () => {
    const h = harness('fixed-event-registration-negated', [[
      { kind: 'task', localId: 'seminar', category: 'non_study', title: 'ゼミ' },
      { kind: 'temporal_constraint', localId: 'seminar-time', taskRef: { localId: 'seminar' }, targetRef: { localId: 'seminar' },
        constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
        startTime: '16:00', endTime: '17:30', precision: 'exact' },
    ]]);
    const result = await h.turn('11月3日16時から17時半までゼミがありますが、予定表には入れなくていいです。');
    expect(result.state.graph.tasks).toMatchObject([{ category: 'non_study' }]);
    expect(result.state.graph.workloads).toEqual([]);
    expect(result.state.graph.effortEstimates).toEqual([]);
    expect(result.scheduler.movableWorkItems).toEqual([]);
    expect(result.scheduler.fixedTaskReservations).toMatchObject([{ taskId: result.state.graph.tasks[0].id,
      start: { date: '2026-11-03', time: '16:00' }, end: { date: '2026-11-03', time: '17:30' }, constraintLevel: 'hard' }]);
    expect(result.state.draftGenerationIntent).toBe('not_requested');
    h.done();
  });

  it('fixed-event-yes-without-registration-offer/1-2: retains twenty-minute study work when busy information includes yes', async () => {
    const h = harness('fixed-event-yes-without-registration-offer', [[
      { kind: 'task', localId: 'reading', category: 'study', title: '英語の音読' },
      { kind: 'workload', localId: 'reading-time', taskRef: { localId: 'reading' }, componentRef: null, quantityRole: 'target', amount: 20,
        unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ], [{ kind: 'availability_declaration', localId: 'busy', availabilityKind: 'unavailable', dateExpression: '2026-11-03',
      namedTimePeriod: null, startTime: '16:00', endTime: '17:30', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' }]]);
    const before = await h.turn('英語の音読を20分したいです。');
    expect(before.work.map(w => ({ amount: w.amount, minutes: w.minutes }))).toEqual([{ amount: 20, minutes: 20 }]);
    const after = await h.turn('11月3日16時から17時半までゼミがあります。うん、お願い。');
    expect(after.state.graph.tasks).toEqual(before.state.graph.tasks);
    expect(after.state.graph.workloads).toEqual(before.state.graph.workloads);
    expect(after.state.graph.effortEstimates).toEqual([]);
    expect(after.work.map(w => ({ amount: w.amount, minutes: w.minutes }))).toEqual([{ amount: 20, minutes: 20 }]);
    expect(after.scheduler.fixedTaskReservations).toEqual([]);
    expect(after.scheduler.availabilityWindows).toContainEqual(expect.objectContaining({ kind: 'unavailable', constraintLevel: 'hard',
      start: { date: '2026-11-03', time: '16:00' }, end: { date: '2026-11-03', time: '17:30' } }));
    expect(after.state.draftGenerationIntent).toBe('not_requested');
    expect(after.checkpoint.presentedQuestion).toBeNull();
    h.done();
  });
});
