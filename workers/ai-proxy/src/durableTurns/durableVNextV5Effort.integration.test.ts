import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
const task: VNextAddFact = { kind: 'task', localId: 'work', category: 'study', title: 'レポート' };
const workload = (localId: string, quantityRole: 'completed' | 'remaining' | 'target', amount: number,
  unitCode: 'page' | 'minute', unitLabel: string): VNextAddFact => ({ kind: 'workload', localId,
  taskRef: { localId: 'work' }, componentRef: null, quantityRole, amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });

async function turn(id: string, userText: string, add: VNextAddFact[]) {
  let nativeCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const native = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name;
    if (native && ++nativeCalls !== 1) throw new Error('unexpected semantic repair');
    const content = native ? JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
      delta: { add, patch: [], remove: [], relate: [], defer: [] } }) : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: id, traceRequestId: `${id}:1`, inputStateRevision: 0,
      messages: [], userText, selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
  const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
  if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
  expect(nativeCalls).toBe(1);
  expect(output.result.failure).toBeUndefined();
  expect(checkpoint.vnext.state.graph.revision).toBe(1);
  expect(output.result.draftCandidates).toEqual([]);
  expect(checkpoint.vnext.preview).toBeNull();
  expect(checkpoint.vnext.presentedQuestion).toBeNull();
  const projection = projectWeeklyPlanningVNext(checkpoint.vnext.state);
  expect(projection.questions).toEqual([]);
  return { graph: checkpoint.vnext.state.graph, work: projection.owners.flatMap(owner => owner.work) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#978 C20 effort meaning through the Worker (scripted semantic readings)', () => {
  it('past-progress-observed-pace/1: estimates only the remaining five pages from completed ten/80 minutes', async () => {
    const result = await turn('past-progress-observed-pace', 'レポートは10ページ終わり、そこまでに80分かかりました。残りは5ページです。', [
      task, workload('done', 'completed', 10, 'page', 'ページ'), workload('left', 'remaining', 5, 'page', 'ページ'),
      { kind: 'effort_estimate', localId: 'observed', taskRef: { localId: 'work' }, targetRef: { localId: 'done' },
        effortKind: 'total_duration', minutes: 80, unitCode: null, unitLabel: null, precision: 'exact' },
    ]);
    expect(result.graph.workloads.map(w => ({ role: w.quantityRole, amount: w.amount })))
      .toEqual([{ role: 'completed', amount: 10 }, { role: 'remaining', amount: 5 }]);
    expect(result.graph.effortEstimates).toHaveLength(1);
    expect(result.graph.effortEstimates[0]).toMatchObject({ kind: 'total_duration', minutes: 80,
      targetFactId: result.graph.workloads.find(w => w.quantityRole === 'completed')!.id });
    expect(result.work.map(w => ({ amount: w.amount, minutes: w.minutes, basis: w.estimateBasis })))
      .toEqual([{ amount: 5, minutes: 40, basis: 'observed_pace' }]);
  });

  it('timebox-only-work/1: uses the stated thirty minutes without inventing or asking for a rate', async () => {
    const result = await turn('timebox-only-work', '英語の音読を30分だけします。', [
      { ...task, title: '英語の音読' }, workload('timebox', 'target', 30, 'minute', '分'),
    ]);
    expect(result.graph.workloads).toHaveLength(1);
    expect(result.graph.effortEstimates).toEqual([]);
    expect(result.work.map(w => ({ role: w.quantityRole, amount: w.amount, unit: w.unitCode, minutes: w.minutes })))
      .toEqual([{ role: 'target', amount: 30, unit: 'minute', minutes: 30 }]);
  });
});
