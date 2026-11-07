import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
const workload = (task: string, role: 'target' | 'remaining', amount: number, unitCode: 'page' | 'problem', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId: `${task}-work`, taskRef: { localId: task }, componentRef: null, quantityRole: role, amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });

function harness(id: string, add: VNextAddFact[]) {
  let nativeCalls = 0; let focusedCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      if (++nativeCalls !== 1) throw new Error('unexpected extra native request, including repair');
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
        delta: { add, patch: [], remove: [], relate: [], defer: [] } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      focusedCalls++;
      content = JSON.stringify({ decision: 'effort_answer', hasAdditionalRequest: false, effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
        minutes: 15, precision: 'exact', quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: id, traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { counts: () => ({ native: nativeCalls, focused: focusedCalls }), async turn(userText: string) {
    input.input.traceRequestId = `${id}:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    expect(output.result.failure).toBeUndefined();
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    expect(checkpoint.vnext.state.draftGenerationIntent).toBe('not_requested');
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { checkpoint: checkpoint.vnext, graph: checkpoint.vnext.state.graph, projection: projectWeeklyPlanningVNext(checkpoint.vnext.state) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Scripted native/focused readings, with task titles copied verbatim from the source utterance.
describe('#978 C20 explicit remaining and per-unit answers through the Worker', () => {
  it('independent-explicit-remaining/1: estimates forty minutes without inventing a total or completed quantity', async () => {
    const h = harness('independent-explicit-remaining', [
      { kind: 'task', localId: 'report', category: 'study', title: 'レポート' }, workload('report', 'remaining', 8, 'page', 'ページ'),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'report' }, targetRef: { localId: 'report-work' },
        effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' },
    ]);
    const result = await h.turn('レポートは残り8ページです。1ページ5分です。');
    expect(result.graph.workloads).toMatchObject([{ quantityRole: 'remaining', amount: 8, unitCode: 'page' }]);
    expect(result.graph.effortEstimates).toMatchObject([{ kind: 'duration_per_unit', minutes: 5, targetFactId: result.graph.workloads[0].id }]);
    expect(result.projection.owners.flatMap(owner => owner.work).map(w => ({ amount: w.amount, minutes: w.minutes })))
      .toEqual([{ amount: 8, minutes: 40 }]);
    expect(result.projection.questions).toEqual([]);
    expect(result.checkpoint.presentedQuestion).toBeNull();
    expect(h.counts()).toEqual({ native: 1, focused: 0 });
  });

  it('d5-positive-per-unit-rate/1-2: binds the focused answer to mathematics while preserving English forty-five minutes', async () => {
    const h = harness('d5-positive-per-unit-rate', [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'task', localId: 'english', category: 'study', title: '英語' },
      workload('math', 'target', 20, 'problem', '問'), workload('english', 'target', 15, 'page', 'ページ'),
      { kind: 'effort_estimate', localId: 'english-total', taskRef: { localId: 'english' }, targetRef: { localId: 'english-work' },
        effortKind: 'total_duration', minutes: 45, unitCode: null, unitLabel: null, precision: 'exact' },
    ]);
    const before = await h.turn('今週、数学20問と英語15ページを進めたい。英語15ページは全部で45分。');
    const math = before.graph.workloads.find(w => w.unitCode === 'problem')!;
    const english = before.graph.workloads.find(w => w.unitCode === 'page')!;
    expect(before.projection.questions).toMatchObject([{ code: 'missing_effort_estimate', taskId: math.taskId,
      forWork: { amount: 20, unitCode: 'problem' } }]);
    expect(before.checkpoint.presentedQuestion).not.toBeNull();
    const after = await h.turn('1問あたり15分です');
    expect(after.graph.tasks).toEqual(before.graph.tasks);
    expect(after.graph.workloads).toEqual(before.graph.workloads);
    expect(after.graph.effortEstimates.filter(e => e.taskId === english.taskId)).toEqual(before.graph.effortEstimates);
    expect(after.graph.effortEstimates.filter(e => e.taskId === math.taskId)).toMatchObject([
      { kind: 'duration_per_unit', minutes: 15, precision: 'exact', targetFactId: math.id },
    ]);
    const work = after.projection.owners.flatMap(owner => owner.work);
    expect(work.filter(w => w.taskId === math.taskId).map(w => w.minutes)).toEqual([300]);
    expect(work.filter(w => w.taskId === english.taskId).map(w => w.minutes)).toEqual([45]);
    expect(after.projection.questions).toEqual([]);
    expect(after.checkpoint.presentedQuestion).toBeNull();
    expect(h.counts()).toEqual({ native: 1, focused: 1 });
  });
});
