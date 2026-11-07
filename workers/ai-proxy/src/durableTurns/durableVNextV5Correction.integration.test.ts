import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact, VNextPatch, VNextTurnDelta } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
type Context = { activeFacts: { tasks: { id: string }[]; workloads: { id: string }[]; effortEstimates: { id: string }[] } };
type Step = string | Partial<VNextTurnDelta> | ((context: Context) => Partial<VNextTurnDelta>);
const seed: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
  { kind: 'workload', localId: 'remaining', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'remaining', amount: 7,
    unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'effort_estimate', localId: 'total', taskRef: { localId: 'math' }, targetRef: { localId: 'remaining' },
    effortKind: 'total_duration', minutes: 45, unitCode: null, unitLabel: null, precision: 'exact' },
];
function harness(steps: Step[]) {
  let nativeCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      nativeCalls++;
      const step = steps.shift();
      if (step === undefined) throw new Error('unexpected semantic request');
      const context = body.messages.map((m: { content: string }) => { try { return JSON.parse(m.content); } catch { return null; } })
        .find((value: Context | null) => value?.activeFacts);
      content = typeof step === 'string' ? step : JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
        delta: { add: [], patch: [], remove: [], relate: [], defer: [], ...(typeof step === 'function' ? step(context) : step) } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-08-24', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: 'corrections', traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-08-26', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-08-26T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { nativeCalls: () => nativeCalls, remainingSteps: () => steps.length, async turn(userText: string) {
    input.input.traceRequestId = `corrections:request:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { output, checkpoint, graph: checkpoint.vnext.state.graph,
      work: projectWeeklyPlanningVNext(checkpoint.vnext.state).owners.flatMap(o => o.work) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#978 correction and schema recovery through the Worker', () => {
  it.each([false, true])('binds explicit remaining8 + total60 to the final amount in either clause order (reverse=%s)', async reverse => {
    const correction = (context: Context): Partial<VNextTurnDelta> => {
      const patch: VNextPatch[] = [{ kind: 'workload', localId: 'r8', targetFactId: context.activeFacts.workloads[0].id,
        amountDelta: null, changes: { amount: 8, quantityRole: null, unitCode: null, unitLabel: null,
          rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } },
      { kind: 'effort_estimate', localId: 'e60', targetFactId: context.activeFacts.effortEstimates[0].id,
        changes: { minutes: 60, effortKind: null, unitCode: null, unitLabel: null, precision: null } }];
      return { patch: reverse ? patch.reverse() : patch };
    };
    const h = harness([{ add: seed }, correction]);
    await h.turn('数学プリントは残り7枚、全部で45分かかります。');
    const result = await h.turn(reverse ? '全体で60分です。残りは8枚に訂正します。' : '残りは8枚に訂正します。全体で60分です。');
    expect(result.work.map(w => ({ amount: w.amount, minutes: w.minutes }))).toEqual([{ amount: 8, minutes: 60 }]);
    expect(result.graph.effortEstimates[result.graph.effortEstimates.length - 1].workBinding?.boundAmount).toBe(8);
    expect(result.output.result.draftCandidates).toEqual([]);
    expect(result.checkpoint.vnext.preview).toBeNull();
    expect(h.nativeCalls()).toBe(2);
    expect(h.remainingSteps()).toBe(0);
  });

  it.each([false, true])('retains independent work after malformed schema; a repaired or next turn keeps tomorrow13:00 (repair=%s)', async repair => {
    const deadline = (context: Context): Partial<VNextTurnDelta> => ({ add: [{ kind: 'temporal_constraint', localId: 'deadline',
      taskRef: { factId: context.activeFacts.tasks[0].id }, targetRef: { factId: context.activeFacts.tasks[0].id },
      constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'tomorrow', namedTimePeriod: null,
      startTime: null, endTime: '13:00', precision: 'exact' }] });
    const h = harness([{ add: seed }, '{}', ...(repair ? [deadline] : ['{}', deadline])]);
    const before = await h.turn('数学プリントは残り7枚、全部で45分かかります。');
    let result = await h.turn('締切は明日の13時です。');
    if (!repair) {
      expect(result.graph).toEqual(before.graph);
      expect(result.checkpoint.vnext.preview).toBeNull();
      expect(h.nativeCalls()).toBe(3); // initial + one bounded repair, not an unbounded retry
      result = await h.turn('締切は明日の13時です。');
    }
    expect(result.graph.workloads).toEqual(before.graph.workloads);
    expect(result.graph.effortEstimates).toEqual(before.graph.effortEstimates);
    expect(result.graph.temporalConstraints).toHaveLength(1);
    expect(result.graph.temporalConstraints[0]).toMatchObject({ kind: 'deadline', constraintLevel: 'hard',
      dateExpression: '2026-08-27', startTime: null, endTime: '13:00' });
    expect(result.work.map(w => ({ amount: w.amount, minutes: w.minutes }))).toEqual([{ amount: 7, minutes: 45 }]);
    expect(result.output.result.draftCandidates).toEqual([]);
    expect(result.checkpoint.vnext.preview).toBeNull();
    expect(h.nativeCalls()).toBe(repair ? 3 : 4);
    expect(h.remainingSteps()).toBe(0);
  });
});
