import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { compareRealApiDateMeaning } from '../../../../src/features/weeklyPlanning/evals/vnextRealApiDateOracle';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact, VNextTurnDelta } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
type Context = { activeFacts: { workloads: { id: string; quantityRole: string }[]; planningWindows: { id: string }[] } };
type Step = Partial<VNextTurnDelta> | ((context: Context) => Partial<VNextTurnDelta>);
const task: VNextAddFact = { kind: 'task', localId: 'math', title: '数学プリント', category: 'study' };
const work = (id: string, role: 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({ kind: 'workload',
  localId: id, taskRef: { localId: 'math' }, componentRef: null, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const clock = (date: string) => createWeeklyPlanningTurnRequestContext({ startedAtIso: `${date}T00:00:00Z`, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
function harness(steps: Step[]) {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      calls++;
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request');
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
    input: { userId: 'synthetic-owner', conversationId: 'continuity', traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [], requestContext: clock('2026-11-02') } };
  let sequence = 0;
  return { calls: () => calls, remainingSteps: () => steps.length, async turn(userText: string, date = '2026-11-02') {
    input.input.traceRequestId = `continuity:request:${++sequence}`;
    input.input.userText = userText;
    input.input.selectedDate = date;
    input.input.requestContext = clock(date);
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    const activeIds = new Set(checkpoint.vnext.state.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
    return { output, checkpoint, graph: checkpoint.vnext.state.graph,
      workloads: checkpoint.vnext.state.graph.workloads.filter(f => activeIds.has(f.id)),
      projection: projectWeeklyPlanningVNext(checkpoint.vnext.state) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#978 independent stated facts and window corrections through Worker', () => {
  it.each([false, true])('preserves stated R7 through C12 and never resurrects it after withdrawal (hasTotal=%s)', async hasTotal => {
    const h = harness([{ add: [task, ...(hasTotal ? [work('total', 'scope_total', 20)] : []),
      work('completed', 'completed', hasTotal ? 13 : 10), work('remaining', 'remaining', 7),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'math' }, targetRef: { localId: 'math' },
        effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' }] },
    context => ({ patch: [{ kind: 'workload', localId: 'c12',
      targetFactId: context.activeFacts.workloads.find(f => f.quantityRole === 'completed')!.id, amountDelta: null,
      changes: { amount: 12, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] }),
    context => ({ remove: [{ targetFactId: context.activeFacts.workloads.find(f => f.quantityRole === 'remaining')!.id }] }), {}]);
    await h.turn(hasTotal ? '数学プリントは全部20ページ、13ページ完了、残り7ページで1ページ5分です。' : '数学プリントは10ページ完了、残り7ページで1ページ5分です。');
    const corrected = await h.turn('完了は12ページに訂正します。残り7ページはそのまま残してください。');
    expect(corrected.workloads.filter(f => f.quantityRole === 'remaining').map(f => f.amount)).toEqual([7]);
    expect(corrected.workloads.filter(f => f.quantityRole === 'scope_total').map(f => f.amount)).toEqual(hasTotal ? [20] : []);
    expect(corrected.projection.questions.some(q => q.code === 'remaining_inconsistent')).toBe(hasTotal);
    expect(corrected.output.result.draftCandidates).toEqual([]);
    await h.turn('残り7ページという発言だけを取り消してください。');
    const resumed = await h.turn('ほかは変更しません。', '2026-11-03');
    expect(resumed.workloads.filter(f => f.quantityRole === 'remaining')).toEqual([]);
    expect(resumed.workloads.filter(f => f.quantityRole === 'scope_total').map(f => f.amount)).toEqual(hasTotal ? [20] : []);
    expect(resumed.workloads.filter(f => f.quantityRole === 'completed').map(f => f.amount)).toEqual([12]);
    expect(resumed.projection.owners.flatMap(o => o.work).map(w => w.amount)).toEqual(hasTotal ? [8] : []);
    expect(resumed.checkpoint.vnext.preview).toBeNull();
    expect(resumed.output.result.draftCandidates).toEqual([]);
    expect(h.remainingSteps()).toBe(0);
  });

  it.each([false, true])('corrects tomorrow→today while keeping the required work question; invalid reference is atomic (invalid=%s)', async invalid => {
    const change = (context: Context): Partial<VNextTurnDelta> => ({ patch: [{ kind: 'planning_window', localId: 'today',
      targetFactId: invalid ? 'unknown-window' : context.activeFacts.planningWindows[0].id,
      changes: { windowKind: null, value: 'today', start: null, end: null } }] });
    const h = harness([{ add: [task, { kind: 'planning_window', localId: 'window', windowKind: 'relative_day', value: 'tomorrow', start: null, end: null }] },
      change, ...(invalid ? [change] : []), {}]);
    const before = await h.turn('明日の数学プリントの予定を立てたいです。');
    const corrected = await h.turn('明日ではなく今日です。');
    const expected = invalid ? '2026-11-03' : '2026-11-02';
    if (invalid) expect(corrected.graph).toEqual(before.graph);
    expect(corrected.projection.questions.some(q => q.code === 'missing_schedulable_work')).toBe(true);
    expect(corrected.graph.tasks).toEqual(before.graph.tasks);
    expect(corrected.graph.workloads).toEqual([]);
    const resumed = await h.turn('作業量はまだ決めていません。', '2026-11-03');
    expect(compareRealApiDateMeaning({ graph: resumed.graph, requestContext: clock('2026-11-03'),
      oracle: { planningWindow: { startDate: expected, endDate: expected } } })).toEqual([]);
    expect(resumed.checkpoint.vnext.preview).toBeNull();
    expect(resumed.output.result.draftCandidates).toEqual([]);
    expect(h.calls()).toBe(invalid ? 4 : 3);
    expect(h.remainingSteps()).toBe(0);
  });
});
