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
type Context = { activeFacts: { effortEstimates: { id: string; kind: string }[] };
  openQuestions: { key: string; code: string; options: { optionId: string }[] }[] };
type Reading = { delta?: Partial<VNextTurnDelta>; answer?: unknown };
const task: VNextAddFact = { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' };
const work = (id: string, role: 'scope_total' | 'completed' | 'remaining', amount: number, unit: 'page' | 'minute' = 'page'): VNextAddFact => ({
  kind: 'workload', localId: id, taskRef: { localId: 'math' }, componentRef: null, quantityRole: role, amount,
  unitCode: unit, unitLabel: unit === 'page' ? 'ページ' : '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const rate = (minutes: number): VNextAddFact => ({ kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'math' },
  targetRef: { localId: 'math' }, effortKind: 'duration_per_unit', minutes, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' });

function harness(steps: Array<Reading | ((context: Context) => Reading)>) {
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
    input: { userId: 'synthetic-owner', conversationId: 'identity', traceRequestId: '', inputStateRevision: 0, messages: [], userText: '',
      selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { remainingSteps: () => steps.length, async turn(userText: string) {
    input.input.traceRequestId = `identity:request:${++sequence}`;
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

describe('#978 work identity and effort conflicts through Worker', () => {
  it.each([['distinct', 125], ['keep45', 45], ['keep10', 80]] as const)(
    'does not double-count the ambiguous remaining45: explicit %s resolves to %s minutes', async (selection, minutes) => {
      let optionIndex = -1;
      const h = harness([{ delta: { add: [task, work('total', 'scope_total', 20), work('completed', 'completed', 10),
        work('minutes', 'remaining', 45, 'minute'), rate(8)] } }, context => {
        const question = context.openQuestions.find(q => q.code === 'same_or_distinct_work')!;
        return { answer: { kind: 'option', optionId: question.options[optionIndex].optionId, minutes: null, per: null } };
      }]);
      const before = await h.turn('数学プリントは全部20ページで10ページ完了、1ページ8分です。残り45分です。');
      const question = before.projection.questions.find(q => q.code === 'same_or_distinct_work')!;
      expect(question).toBeDefined();
      expect(before.output.result.draftCandidates).toEqual([]);
      expect(before.checkpoint.vnext.preview).toBeNull();
      optionIndex = question.options.findIndex(option => selection === 'distinct' ? option.optionId === 'distinct'
        : option.optionId.startsWith('keep:') && option.value === (selection === 'keep45' ? 45 : 10));
      expect(optionIndex).toBeGreaterThanOrEqual(0);
      const after = await h.turn(selection === 'distinct' ? '別の作業です。' : selection === 'keep45' ? '同じ作業なので45分の方を残してください。' : 'ページ数の方を残してください。');
      const diagnostics = JSON.stringify({ message: after.output.result.message, remainingSteps: h.remainingSteps(),
        failures: after.output.result.debugTraceEvents?.filter(event => /error|reject|failure/.test(event.stage)) });
      expect(after.projection.questions.some(q => q.code === 'same_or_distinct_work'), diagnostics).toBe(false);
      expect(after.projection.owners.flatMap(o => o.work).reduce((sum, w) => sum + (w.minutes ?? 0), 0)).toBe(minutes);
      expect(after.output.result.draftCandidates).toEqual([]);
      expect(after.checkpoint.vnext.preview).toBeNull();
      expect(h.remainingSteps()).toBe(0);
    });

  it.each(['correct_total', 'withdraw_rate'] as const)('preserves conflicting 8×5 and total60 until an explicit %s', async decision => {
    const h = harness([{ delta: { add: [task, work('remaining', 'remaining', 8), rate(5),
      { kind: 'effort_estimate', localId: 'total', taskRef: { localId: 'math' }, targetRef: { localId: 'remaining' },
        effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' }] } }, context => {
      const total = context.activeFacts.effortEstimates.find(f => f.kind === 'total_duration')!;
      const oldRate = context.activeFacts.effortEstimates.find(f => f.kind === 'duration_per_unit')!;
      return { delta: decision === 'withdraw_rate' ? { remove: [{ targetFactId: oldRate.id }] }
        : { patch: [{ kind: 'effort_estimate', localId: 'consistent', targetFactId: total.id,
          changes: { minutes: 40, effortKind: null, unitCode: null, unitLabel: null, precision: null } }] } };
    }]);
    const before = await h.turn('残り8ページは1ページ5分です。残り全体には60分かかります。');
    expect(before.projection.questions.some(q => q.code === 'effort_inconsistent')).toBe(true);
    expect(before.graph.effortEstimates.map(f => f.minutes).sort((a, b) => a - b)).toEqual([5, 60]);
    expect(before.checkpoint.vnext.preview).toBeNull();
    expect(before.output.result.draftCandidates).toEqual([]);
    const after = await h.turn(decision === 'withdraw_rate' ? '1ページ5分の見積もりは取り消してください。全体60分です。' : '全体は40分に訂正します。');
    expect(after.projection.questions.some(q => q.code === 'effort_inconsistent')).toBe(false);
    expect(after.projection.owners.flatMap(o => o.work).map(w => w.minutes)).toEqual([decision === 'withdraw_rate' ? 60 : 40]);
    expect(after.checkpoint.vnext.preview).toBeNull();
    expect(after.output.result.draftCandidates).toEqual([]);
    expect(h.remainingSteps()).toBe(0);
  });
});
