import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact, VNextTurnDelta } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
type Context = { activeFacts: { workloads: { id: string }[]; effortEstimates: { id: string }[] } };
type Step = Partial<VNextTurnDelta> | ((context: Context) => Partial<VNextTurnDelta>);
const workload = (amount: number, unitCode: 'page' | 'custom', unitLabel: string): VNextAddFact => ({ kind: 'workload', localId: 'remaining',
  taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });

function harness(id: string, steps: Step[]) {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      calls++;
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request, including repair');
      const context = body.messages.map((m: { content: string }) => { try { return JSON.parse(m.content); } catch { return null; } })
        .find((value: Context | null) => value?.activeFacts);
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
        delta: { add: [], patch: [], remove: [], relate: [], defer: [], ...(typeof step === 'function' ? step(context) : step) } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: id, traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { done() { expect(calls).toBe(sequence); expect(steps).toEqual([]); }, async turn(userText: string) {
    input.input.traceRequestId = `${id}:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    expect(output.result.failure).toBeUndefined();
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { checkpoint: checkpoint.vnext, graph: checkpoint.vnext.state.graph,
      projection: projectWeeklyPlanningVNext(checkpoint.vnext.state) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// The provider readings are scripted; Japanese identity/abstention recognition is not certified here.
describe('#978 C20 omitted effort and restatement through the Worker', () => {
  it('omitted-effort-answer/1-2: keeps eight problems and the unanswered estimate without inventing time', async () => {
    const h = harness('omitted-effort-answer', [{ add: [
      { kind: 'task', localId: 'task', category: 'study', title: '数学' }, workload(8, 'custom', '問'),
    ] }, {}]);
    const before = await h.turn('数学の問題は残り8問です。');
    expect(before.graph.workloads).toMatchObject([{ quantityRole: 'remaining', amount: 8, unitCode: 'custom', unitLabel: '問' }]);
    expect(before.projection.questions).toHaveLength(1);
    expect(before.projection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8, unitLabel: '問' } });
    const after = await h.turn('その時間は今は分かりません。');
    expect(after.graph).toEqual(before.graph);
    expect(after.graph.effortEstimates).toEqual([]);
    expect(after.projection.questions).toHaveLength(1);
    expect(after.projection.questions[0].key).toBe(before.projection.questions[0].key);
    expect(after.checkpoint.presentedQuestion?.questionKey).toBe(before.projection.questions[0].key);
    expect(after.projection.owners.flatMap(owner => owner.work)).toEqual([]);
    h.done();
  });

  it('paraphrase-restatement-no-duplicate/1-2: keeps one active ten-page work and its five-minute rate', async () => {
    const h = harness('paraphrase-restatement-no-duplicate', [{ add: [
      { kind: 'task', localId: 'task', category: 'study', title: '読書' }, workload(10, 'page', 'ページ'),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'task' }, targetRef: { localId: 'remaining' },
        effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: 'ページ', precision: 'approximate' },
    ] }, context => ({ patch: [
      { kind: 'workload', localId: 'restated-amount', targetFactId: context.activeFacts.workloads[0].id, amountDelta: null,
        changes: { amount: 10, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } },
      { kind: 'effort_estimate', localId: 'restated-rate', targetFactId: context.activeFacts.effortEstimates[0].id,
        changes: { minutes: 5, effortKind: null, unitCode: null, unitLabel: null, precision: 'approximate' } },
    ] })]);
    const before = await h.turn('読書は残り10ページで、1ページ5分くらいです。');
    expect(before.projection.owners.flatMap(owner => owner.work).map(w => ({ amount: w.amount, minutes: w.minutes })))
      .toEqual([{ amount: 10, minutes: 50 }]);
    const after = await h.turn('本はあと10ページです。1ページに5分ほどかかります。');
    const active = new Set(after.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
    expect(after.graph.tasks).toEqual(before.graph.tasks);
    expect(after.graph.workloads.filter(w => active.has(w.id)))
      .toMatchObject([{ quantityRole: 'remaining', amount: 10, unitCode: 'page' }]);
    expect(after.graph.effortEstimates.filter(e => active.has(e.id)))
      .toMatchObject([{ kind: 'duration_per_unit', minutes: 5, precision: 'approximate' }]);
    expect(after.projection.owners.flatMap(owner => owner.work).map(w => ({ amount: w.amount, minutes: w.minutes })))
      .toEqual([{ amount: 10, minutes: 50 }]);
    expect(after.projection.questions).toEqual([]);
    expect(after.checkpoint.presentedQuestion).toBeNull();
    h.done();
  });
});
