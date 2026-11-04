import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../../semantic/weeklyPlanningStableV5PreviewScheduler';
import { projectWeeklyPlanningProvisionalTimeboxGraphV5, resolveWeeklyPlanningProvisionalTimeboxV5 } from '../../application/weeklyPlanningStableV5ProvisionalTimebox';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

// Proposed option A's title-string contract only. A substring does not prove the marker survives
// mobile ellipsis. No approval is performed here: the saved Plan.title policy is still undecided.
const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'provisional-label-owner', weekStartDate: WEEK, conversationId: 'provisional-label', notBeforeTime: '09:00',
  clock: { currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: 'minute' | 'page', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount,
  unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
let outbound: ReturnType<typeof vi.fn>;
beforeEach(() => {
  outbound = vi.fn(async () => { throw new Error('No real API is permitted.'); });
  vi.stubGlobal('fetch', outbound);
});
afterEach(() => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

async function preview() {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage: memory.storage });
  const planWrite = vi.fn(async () => ({ planId: 'unexpected-plan' }));
  const approvalWrite = vi.fn();
  const calendar = { plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] };
  let calls = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    client: { async createChatCompletion(request) {
      if (++calls === 1) return JSON.stringify({ planningIntent: 'create_plan', conversationActs: [], answer: null,
        delta: { ...EMPTY, add: [task('english', '英語'), work('english-work', 'english', 60, 'minute', '分'),
          task('math', '数学プリント'), work('math-work', 'math', 10, 'page', '枚')] } });
      expect(calls).toBe(2);
      const input = JSON.parse(request.messages[1].content) as { openQuestions: Array<{ key: string }>; presentedQuestion: { key: string } };
      expect(input.openQuestions).toHaveLength(1);
      expect(input.presentedQuestion.key).toBe(input.openQuestions[0].key);
      return JSON.stringify({ planningIntent: 'unknown', answer: null,
        conversationActs: [{ kind: 'request_event_registration', targetRef: { localId: 'meeting' } }],
        delta: { ...EMPTY, defer: [{ questionKey: input.openQuestions[0].key, allocation: 'provisional_timebox' }], add: [
          { kind: 'task', localId: 'meeting', category: 'non_study', title: '面談' },
          { kind: 'temporal_constraint', localId: 'meeting-time', taskRef: { localId: 'meeting' }, targetRef: { localId: 'meeting' },
            constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-04', namedTimePeriod: null,
            startTime: '16:00', endTime: '17:00', precision: 'exact' },
        ] } });
    } },
    approvalLedger: { read: () => null, write: approvalWrite },
    plans: { findExistingPlanId: async () => undefined, saveBlock: planWrite },
    calendar: () => calendar, now: () => `${WEEK}T09:00:00.000Z`,
    createRenderer: () => ({ async render(input) { return { status: 'rendered', rawResponse: '',
      text: JSON.stringify({ questionCode: input.questionCode, target: input.questionTarget, previewCount: input.previewCount }) }; } }),
  };
  const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-1', shownRevision: null,
    userText: '英語60分と数学プリント10枚の予定案を作ってください。数学の所要時間は分かりません。' });
  expect(first.outcome).toBe('applied');
  const before = structuredClone(local.readCheckpoint()!.vnext.state.graph);
  const mathTask = before.tasks.find(item => item.title === '数学プリント')!;
  const mathWork = before.workloads.find(item => item.taskId === mathTask.id)!;
  expect(first.question).toMatchObject({ code: 'missing_effort_estimate', taskId: mathTask.id,
    forWork: { definingFactId: mathWork.id, amount: 10, unitLabel: '枚' } });
  const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-2', shownRevision: first.graphRevision,
    userText: '数学は時間不明のまま仮置きしてください。11月4日16時から17時の面談も予定へ登録してください。' });
  expect(result.outcome).toBe('applied');
  expect(result.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
  expect(result.preview).not.toBeNull();
  const checkpoint = local.readCheckpoint()!.vnext;
  expect(checkpoint.state.graph.workloads).toEqual(before.workloads);
  expect(checkpoint.state.graph.effortEstimates).toEqual([]);
  expect(checkpoint.actualRecords ?? []).toEqual([]);
  expect(calendar.actuals).toEqual([]);
  expect(planWrite).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();
  const math = result.preview!.blocks.find(block => block.title.startsWith('数学プリント'))!;
  const english = result.preview!.blocks.find(block => block.title.startsWith('英語'))!;
  expect(projectWeeklyPlanningVNext(checkpoint.state).owners.find(owner => owner.taskId === mathTask.id)?.work)
    .toEqual([expect.objectContaining({ amount: 10, minutes: 60, estimateBasis: 'provisional_timebox', estimateFactIds: [] })]);
  return { result, state: checkpoint.state, math, english };
}

describe('proposed VNext provisional preview label, product unchanged', () => {
  it('marks the provisional math title in both the shown preview and the promotion source', async () => {
    const { result, math } = await preview();
    expect(math).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    const candidate = result.draftCandidates!.find(item => item.stableKey === math.id)!;
    expect.soft(math.title, 'preview title carries the proposed text; visibility is a separate check').toContain('仮置き');
    expect.soft(candidate.title, 'promotion source carries the proposed text; saved Plan policy is undecided').toContain('仮置き');
  });

  it('keeps the stated English 60 minutes unmarked even though the provisional duration is also 60', async () => {
    const { result, english } = await preview();
    expect(english.title).toBe('英語 60分');
    expect(english).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(result.draftCandidates!.find(item => item.stableKey === english.id)?.title).toBe('英語 60分');
  });

  it('keeps an explicitly registered fixed hour unmarked and at its stated date and times', async () => {
    const { result } = await preview();
    const registrations = result.draftCandidates!.filter(item => item.source === 'fixed_event_registration');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ title: '面談', date: '2026-11-04', startTime: '16:00', endTime: '17:00' });
    expect(result.preview!.blocks.find(block => block.id === registrations[0].stableKey))
      .toMatchObject({ title: '面談', date: '2026-11-04', startTime: '16:00', endTime: '17:00' });
  });

  it('leaves the frozen V5 timebox projection and scheduler titles unchanged for the same graph', async () => {
    const { state } = await preview();
    const before = structuredClone(state.graph);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph);
    const context = { ownerId: scope.ownerId, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
    const initial = compileGenericSchedulerInput({ graph: active, context });
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({ directive: { kind: 'provisional_timebox', scope: 'current_missing_effort' },
      previousState: null, currentCompilation: initial, graph: active, graphRevision: state.graph.revision, turnId: 'v5-control' });
    const timeboxed = projectWeeklyPlanningProvisionalTimeboxGraphV5({ graph: active, resolution });
    const graph = { ...active, workloads: timeboxed.workloads, uncertainties: timeboxed.uncertainties };
    const compiled = compileGenericSchedulerInput({ graph, context });
    expect(compiled.status).toBe('ready');
    expect(compiled.input).not.toBeNull();
    const scheduled = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input!, graph: createWeeklyPlanningPlacementGraphViewV5(graph),
      notBefore: { date: WEEK, time: '09:00' } });
    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates.map(item => ({ title: item.title, minutes: item.durationMinutes })).sort((a, b) => a.title.localeCompare(b.title)))
      .toEqual([{ title: '数学プリント 60分', minutes: 60 }, { title: '英語 60分', minutes: 60 }].sort((a, b) => a.title.localeCompare(b.title)));
    expect(state.graph).toEqual(before);
  });
});
