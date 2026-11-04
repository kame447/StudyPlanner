import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type { VNextAddFact, VNextDeferralAllocation } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const WEEK = '2026-11-02';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: 'minute' | 'page', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount,
  unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
const slotMinutes = (start: string, end: string) =>
  Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3));

afterEach(() => { vi.unstubAllGlobals(); });

async function branch(allocation: VNextDeferralAllocation) {
  const scope: WeeklyPlanningVNextExperimentalScope = {
    ownerId: 'stage-b-defer-owner', weekStartDate: WEEK, conversationId: `stage-b-${allocation}`, notBeforeTime: '09:00',
    clock: { currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  };
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage: memory.storage });
  const approvalWrite = vi.fn();
  const planWrite = vi.fn(async () => ({ planId: 'unexpected-plan' }));
  const calendar = { plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] };
  const presentations: Array<{ actionKind: string; questionTarget: unknown; previewCount: number }> = [];
  let providerCalls = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    client: { async createChatCompletion(request) {
      providerCalls++;
      if (providerCalls === 1) return JSON.stringify({ planningIntent: 'create_plan', conversationActs: [], answer: null,
        delta: { ...EMPTY, add: [task('english', '英語'), work('english-work', 'english', 60, 'minute', '分'),
          task('math', '数学プリント'), work('math-work', 'math', 10, 'page', '枚')] } });
      expect(providerCalls).toBe(2);
      const input = JSON.parse(request.messages[1].content) as {
        openQuestions: Array<{ key: string }>; presentedQuestion: { key: string };
      };
      expect(input.openQuestions).toHaveLength(1);
      expect(input.presentedQuestion.key).toBe(input.openQuestions[0].key);
      // The actual shown question goes through native aliases and validation, never a guessed fact id.
      return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null,
        delta: { ...EMPTY, defer: [{ questionKey: input.openQuestions[0].key, allocation }] } });
    } },
    approvalLedger: { read: () => null, write: approvalWrite },
    plans: { findExistingPlanId: async () => undefined, saveBlock: planWrite },
    calendar: () => calendar, now: () => `${WEEK}T09:00:00.000Z`,
    createRenderer: () => ({ async render(input) {
      const shown = { actionKind: input.actionKind, questionTarget: input.questionTarget, previewCount: input.previewCount };
      presentations.push(structuredClone(shown));
      return { status: 'rendered', text: JSON.stringify(shown), rawResponse: '' };
    } }),
  };
  const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-1', shownRevision: null,
    userText: '今週は英語60分と数学プリント10枚を進めたい。数学の時間はまだ分かりません。予定案を作ってください。' });
  expect(first.outcome).toBe('applied');
  const before = structuredClone(local.readCheckpoint()!.vnext.state.graph);
  const english = before.tasks.find(item => item.title === '英語')!;
  const math = before.tasks.find(item => item.title === '数学プリント')!;
  const englishWork = before.workloads.find(item => item.taskId === english.id)!;
  const mathWork = before.workloads.find(item => item.taskId === math.id)!;
  expect(before.tasks).toHaveLength(2);
  expect(before.workloads).toHaveLength(2);
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(first.question).toMatchObject({ code: 'missing_effort_estimate', taskId: math.id,
    forWork: { definingFactId: mathWork.id, amount: 10, unitLabel: '枚' } });
  expect(local.readCheckpoint()!.vnext.presentedQuestion).toMatchObject({ questionKey: first.question!.key,
    graphRevision: first.graphRevision, shownText: first.reply });
  expect(local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('user_authorized');
  expect(approvalWrite).not.toHaveBeenCalled();
  expect(planWrite).not.toHaveBeenCalled();

  const second = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-2', shownRevision: first.graphRevision,
    userText: allocation === 'none' ? '数学は保留にして、今回は予定に入れないでください。'
      : '数学は所要時間が分からないまま、仮置きで予定を組んで見せてください。' });
  expect(second.outcome).toBe('applied');
  expect(second.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
  const checkpoint = local.readCheckpoint()!.vnext;
  expect(checkpoint.state.graph.tasks).toEqual(before.tasks);
  expect(checkpoint.state.graph.workloads).toEqual(before.workloads);
  expect(checkpoint.state.graph.effortEstimates).toEqual([]);
  expect(checkpoint.state.deferrals).toEqual([expect.objectContaining({ questionKey: first.question!.key, allocation })]);
  expect(checkpoint.state.draftGenerationIntent).toBe('user_authorized');
  expect(checkpoint.actualRecords ?? []).toEqual([]);
  expect(calendar.actuals).toEqual([]);
  expect(approvalWrite).not.toHaveBeenCalled();
  expect(planWrite).not.toHaveBeenCalled();
  expect(providerCalls).toBe(2);

  const projection = projectWeeklyPlanningVNext(checkpoint.state);
  const projectedMath = projection.owners.find(owner => owner.taskId === math.id)!;
  const blocks = second.preview?.blocks ?? [];
  const mathBlocks = blocks.filter(block => block.title.startsWith('数学プリント'));
  const englishBlocks = blocks.filter(block => block.title.startsWith('英語'));
  if (allocation === 'none') {
    expect(mathBlocks).toEqual([]);
    expect(projection.deferredQuestions).toContainEqual(expect.objectContaining({ key: first.question!.key, taskId: math.id }));
    // A partial preview is a product choice, not a demand to schedule unanswered work automatically.
    if (second.preview) expect(englishBlocks.map(block => slotMinutes(block.startTime, block.endTime))).toEqual([60]);
  } else {
    expect(second.preview).not.toBeNull();
    expect(mathBlocks).toHaveLength(1);
    expect(englishBlocks.map(block => slotMinutes(block.startTime, block.endTime))).toEqual([60]);
    expect(projectedMath.work).toEqual([expect.objectContaining({ amount: 10, unitLabel: '枚', minutes: 60,
      estimateBasis: 'provisional_timebox', estimateFactIds: [] })]);
    expect(mathBlocks.map(block => slotMinutes(block.startTime, block.endTime))).toEqual([60]);
  }
  const observation = {
    allocation, target: { questionKey: first.question!.key, taskId: math.id, workloadId: mathWork.id, amount: 10, unitLabel: '枚' },
    deferrals: checkpoint.state.deferrals, creationIntent: checkpoint.state.draftGenerationIntent,
    preview: second.preview === null ? null : blocks.map(({ title, label, memo, date, startTime, endTime }) => ({ title, label, memo, date, startTime, endTime })),
    unplacedOwnerKeys: second.unplacedOwnerKeys, mathWork: projectedMath.work,
    provisionalDisplay: mathBlocks.map(({ title, label, memo }) => ({ title, label, memo })),
    provisionalMarkerVisible: mathBlocks.some(block => [block.title, block.label, block.memo ?? ''].some(text => text.includes('仮置き'))),
    presentations, explicitEffortFacts: checkpoint.state.graph.effortEstimates, actuals: calendar.actuals,
    actualRecords: checkpoint.actualRecords ?? [], planWrites: planWrite.mock.calls.length, approvalWrites: approvalWrite.mock.calls.length,
  };
  console.log(JSON.stringify(observation));
  return { mathPlanned: mathBlocks.length > 0, observation };
}

it('keeps ready English work while distinguishing deferred math from an explicitly authorized provisional block, without inventing an estimate or saving', async () => {
  const outbound = vi.fn(async () => { throw new Error('No real API is permitted.'); });
  vi.stubGlobal('fetch', outbound);
  const deferred = await branch('none');
  const provisional = await branch('provisional_timebox');
  expect([deferred.mathPlanned, provisional.mathPlanned]).toEqual([false, true]);
  expect(outbound).not.toHaveBeenCalled();
});
