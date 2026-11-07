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
type Context = { activeFacts: { workloads: { id: string; taskId: string; unitCode: string }[];
  effortEstimates: { id: string; taskId: string }[] } };
type Reading = { delta?: Partial<VNextTurnDelta>; answer?: unknown };
const workload = (id: string, taskId: string, amount: number, unitCode: 'page' | 'problem', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId: id, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target',
  amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const seed: VNextAddFact[] = [
  { kind: 'task', localId: 'math', title: '数学', category: 'study' },
  { kind: 'task', localId: 'english', title: '英語', category: 'study' },
  workload('math-work', 'math', 20, 'problem', '問'), workload('english-work', 'english', 15, 'page', 'ページ'),
  { kind: 'effort_estimate', localId: 'english-total', taskRef: { localId: 'english' }, targetRef: { localId: 'english-work' },
    effortKind: 'total_duration', minutes: 45, unitCode: null, unitLabel: null, precision: 'exact' },
];
function harness(second: (context: Context) => Reading) {
  const steps: Array<Reading | ((context: Context) => Reading)> = [{ delta: { add: seed } }, second];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request');
      const context = body.messages.map((m: { content: string }) => { try { return JSON.parse(m.content); } catch { return null; } })
        .find((value: Context | null) => value?.activeFacts);
      const reading = typeof step === 'function' ? step(context) : step;
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: reading.answer ?? null,
        delta: { add: [], patch: [], remove: [], relate: [], defer: [], ...reading.delta } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: 'd5', traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { remainingSteps: () => steps.length, async turn(userText: string) {
    input.input.traceRequestId = `d5:request:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { output, checkpoint, graph: checkpoint.vnext.state.graph, projection: projectWeeklyPlanningVNext(checkpoint.vnext.state) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// These are conditional typed-reading contracts. The scripts prove the real Worker
// path, not that a live model will select this meaning for every Japanese phrasing.
describe('#978 D5 boundary on the current VNext Worker', () => {
  it.each([
    { id: 'pages-only', text: '15ページ', mathMinutes: null, englishMinutes: 45 },
    { id: 'other-task', text: '英語は15分', mathMinutes: null, englishMinutes: 15 },
    { id: 'whole-work', text: '全部で15分', mathMinutes: 15, englishMinutes: 45 },
    { id: 'approximate-rate', text: '15分くらい', mathMinutes: 300, englishMinutes: 45 },
    { id: 'compound', text: '15分。あと英語の締切を金曜にして', mathMinutes: 300, englishMinutes: 45 },
  ])('$id preserves the independent work and never turns the answer into save permission', async ({ id, text, mathMinutes, englishMinutes }) => {
    const h = harness(context => {
      const math = context.activeFacts.workloads.find(w => w.unitCode === 'problem')!;
      const english = context.activeFacts.workloads.find(w => w.unitCode === 'page')!;
      if (id === 'pages-only') return {};
      if (id === 'other-task') return { delta: { patch: [{ kind: 'effort_estimate', localId: 'english15',
        targetFactId: context.activeFacts.effortEstimates.find(f => f.taskId === english.taskId)!.id,
        changes: { minutes: 15, effortKind: null, unitCode: null, unitLabel: null, precision: null } }] } };
      if (id === 'whole-work') return { answer: { kind: 'estimate_minutes', optionId: null, minutes: 15, per: 'whole_work' } };
      if (id === 'approximate-rate') return { delta: { add: [{ kind: 'effort_estimate', localId: 'approx15',
        taskRef: { factId: math.taskId }, targetRef: { factId: math.id }, effortKind: 'duration_per_unit',
        minutes: 15, unitCode: 'problem', unitLabel: '問', precision: 'approximate' }] } };
      return { answer: { kind: 'estimate_minutes', optionId: null, minutes: 15, per: 'unit' }, delta: { add: [{
        kind: 'temporal_constraint', localId: 'english-deadline', taskRef: { factId: english.taskId }, targetRef: { factId: english.taskId },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-06', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' }] } };
    });
    const before = await h.turn('数学20問と英語15ページを進めたい。英語15ページは全部で45分です。');
    const mathId = before.graph.tasks[0].id;
    const englishId = before.graph.tasks[1].id;
    expect(before.projection.questions.some(q => q.code === 'missing_effort_estimate' && q.taskId === mathId)).toBe(true);
    const after = await h.turn(text);
    const work = after.projection.owners.flatMap(owner => owner.work);
    // A blocked amount stays in the graph and question, outside schedulable work.
    expect(work.filter(w => w.taskId === mathId).map(w => w.minutes)).toEqual(mathMinutes === null ? [] : [mathMinutes]);
    expect(work.filter(w => w.taskId === englishId).map(w => w.minutes)).toEqual([englishMinutes]);
    expect(after.graph.workloads).toEqual(before.graph.workloads);
    expect(after.graph.tasks).toEqual(before.graph.tasks);
    expect(after.projection.questions.some(q => q.code === 'missing_effort_estimate' && q.taskId === mathId)).toBe(mathMinutes === null);
    if (id === 'compound') {
      expect(after.graph.temporalConstraints).toHaveLength(1);
      expect(after.graph.temporalConstraints[0]).toMatchObject({ taskId: englishId, kind: 'deadline', dateExpression: '2026-11-06' });
    }
    if (id === 'approximate-rate') expect(after.graph.effortEstimates.some(f => f.taskId === mathId && f.minutes === 15
      && f.kind === 'duration_per_unit' && f.precision === 'approximate')).toBe(true);
    expect(after.checkpoint.vnext.preview).toBeNull();
    expect(after.output.result.draftCandidates).toEqual([]);
    expect(h.remainingSteps()).toBe(0);
  });
});
