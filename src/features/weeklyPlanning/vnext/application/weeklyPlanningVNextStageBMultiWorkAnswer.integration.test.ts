import { expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';

const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'stage-b-owner', weekStartDate: WEEK, conversationId: 'stage-b-multi-work', notBeforeTime: '09:00',
  clock: { currentDate: WEEK, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' },
};
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: 'minute' | 'page', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount,
  unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

it('binds the answer to the presented math question and keeps both works in the unsaved preview', async () => {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage: memory.storage });
  const dispatches: string[] = [];
  let approvalWrites = 0;
  let planWrites = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: createWeeklyPlanningVNextRuntimeInterpreter(scope, {
      choice: { policy: VNEXT_OPTION_CHOICE_POLICY, choose: async () => { throw new Error('unexpected option choice'); } },
      focusedRequestId: () => 'stage-b-focused-answer',
    }),
    client: { async createChatCompletion(request) {
      if (request.decisionContext?.purpose === 'focused_contextual_answer_v2') {
        dispatches.push('focused');
        expect(request.decisionContext.state.pendingQuestion.target).toMatchObject({
          task: { title: '数学プリント' }, workload: { amount: 10, unitCode: 'page' },
        });
        return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration',
          minutes: 40, precision: 'exact', quantityRole: null });
      }
      dispatches.push('native');
      expect(dispatches).toEqual(['native']);
      return JSON.stringify({ planningIntent: 'create_plan', conversationActs: [], answer: null,
        delta: { add: [task('english', '英語'), work('english-work', 'english', 60, 'minute', '分'),
          task('math', '数学プリント'), work('math-work', 'math', 10, 'page', '枚')], patch: [], remove: [], relate: [], defer: [] } });
    } },
    approvalLedger: { read: () => null, write: () => { approvalWrites++; } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { planWrites++; return { planId: 'unexpected' }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => `${WEEK}T00:00:00.000Z`,
    createRenderer: () => ({ async render(input) {
      return { status: 'rendered', text: input.questionCode ? '数学プリント10枚の全体には何分かかりますか？' : '英語と数学の仮案です。', rawResponse: '' };
    } }),
  };
  const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-1', shownRevision: null,
    userText: '今週は英語60分と数学プリント10枚を進めたい。予定案を作ってください。' });
  expect(first.outcome).toBe('applied');
  expect(first.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 10 } });
  expect(first.question!.effortMeasurement ?? 'total_duration').toBe('total_duration');
  expect(first.reply).toBe('数学プリント10枚の全体には何分かかりますか？');
  expect(first.preview).toBeNull();
  const checkpoint = local.readCheckpoint()!.vnext;
  expect(checkpoint.presentedQuestion).toMatchObject({ questionKey: first.question!.key, graphRevision: first.graphRevision, shownText: first.reply });
  const before = structuredClone(checkpoint.state.graph);
  const english = before.tasks.find(item => item.title === '英語')!;
  const math = before.tasks.find(item => item.title === '数学プリント')!;
  const englishWork = before.workloads.find(item => item.taskId === english.id)!;
  const mathWork = before.workloads.find(item => item.taskId === math.id)!;
  expect(before.tasks).toHaveLength(2);
  expect(before.workloads).toHaveLength(2);
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(before.effortEstimates).toEqual([]);
  expect(checkpoint.actualRecords ?? []).toEqual([]);
  expect([approvalWrites, planWrites]).toEqual([0, 0]);

  const second = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-2', shownRevision: first.graphRevision,
    userText: '数学プリント全体で40分です。' });
  expect(dispatches).toEqual(['native', 'focused']);
  expect(second.outcome).toBe('applied');
  expect(second.question).toBeNull();
  expect(second.preview).not.toBeNull();
  const after = local.readCheckpoint()!.vnext.state.graph;
  expect(after.tasks).toEqual(before.tasks);
  expect(after.workloads).toEqual(before.workloads);
  expect(after.effortEstimates).toHaveLength(1);
  expect(after.effortEstimates[0]).toMatchObject({ taskId: math.id, targetFactId: mathWork.id, kind: 'total_duration', minutes: 40 });
  expect(second.preview!.blocks.map(block => block.title).sort()).toEqual(['数学プリント 10枚', '英語 60分'].sort());
  // The existing allocation policy adds 10% and rounds 40 minutes to a 45-minute slot.
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  expect(Object.fromEntries(second.preview!.blocks.map(block => [block.title, minutes(block.endTime) - minutes(block.startTime)])))
    .toEqual({ '数学プリント 10枚': 45, '英語 60分': 60 });
  expect(local.readCheckpoint()!.vnext.actualRecords ?? []).toEqual([]);
  expect([approvalWrites, planWrites]).toEqual([0, 0]);
});
