import { expect, it } from 'vitest';
import { validateWeeklyPreviewApproval } from '../../planning/weeklyPlanningApproval';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';

const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'stage-b-preview-owner', weekStartDate: WEEK, conversationId: 'stage-b-preview-change', notBeforeTime: '09:00',
  clock: { currentDate: WEEK, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' },
};
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: 'minute' | 'page', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount,
  unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

it('replaces an unapproved two-work preview after a correction to math only', async () => {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage: memory.storage });
  const dispatches: string[] = [];
  let approvalWrites = 0;
  let planWrites = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: createWeeklyPlanningVNextRuntimeInterpreter(scope, {
      choice: { policy: VNEXT_OPTION_CHOICE_POLICY, choose: async () => { throw new Error('unexpected option choice'); } },
      focusedRequestId: () => 'stage-b-preview-focused-answer',
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
      const context = JSON.parse(request.messages[1].content) as { activeFacts: { effortEstimates?: { id: string; minutes: number }[] } };
      dispatches.push('native');
      if (dispatches.length === 1) return JSON.stringify({ planningIntent: 'create_plan', conversationActs: [], answer: null,
        delta: { add: [task('english', '英語'), work('english-work', 'english', 60, 'minute', '分'),
          task('math', '数学プリント'), work('math-work', 'math', 10, 'page', '枚')], patch: [], remove: [], relate: [], defer: [] } });
      expect(dispatches).toEqual(['native', 'focused', 'native']);
      const estimate = context.activeFacts.effortEstimates?.find(item => item.minutes === 40);
      expect(estimate).toBeDefined();
      return JSON.stringify({ planningIntent: 'update_plan', conversationActs: [], answer: null,
        delta: { add: [], remove: [], relate: [], defer: [], patch: [{ kind: 'effort_estimate', localId: 'correct-math',
          targetFactId: estimate!.id, changes: { minutes: 50, effortKind: null, unitCode: null, unitLabel: null, precision: null } }] } });
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
  expect(first.preview).toBeNull();
  const second = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-2', shownRevision: first.graphRevision,
    userText: '数学プリント全体で40分です。' });
  expect(second.outcome).toBe('applied');
  expect(second.preview).not.toBeNull();
  const oldPreview = structuredClone(second.preview!);
  expect(oldPreview.blocks.map(block => block.title).sort()).toEqual(['数学プリント 10枚', '英語 60分'].sort());
  const before = structuredClone(local.readCheckpoint()!.vnext);
  expect(before.preview).toEqual(oldPreview);
  const guard = (blocks: typeof oldPreview.blocks, revision: number) => validateWeeklyPreviewApproval({
    blocks, currentStateRevision: revision, userId: scope.ownerId, proposalRecords: [],
    runtimeSnapshot: { conversationId: scope.conversationId, stateRevision: revision, proposalRecords: [] },
  });
  expect(guard(oldPreview.blocks, before.state.graph.revision)).toMatchObject({ allowed: true });
  const english = before.state.graph.tasks.find(item => item.title === '英語')!;
  const englishWork = before.state.graph.workloads.find(item => item.taskId === english.id)!;
  const math = before.state.graph.tasks.find(item => item.title === '数学プリント')!;
  const mathWork = before.state.graph.workloads.find(item => item.taskId === math.id)!;
  const oldEstimate = before.state.graph.effortEstimates.find(item => item.taskId === math.id)!;
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(oldEstimate).toMatchObject({ targetFactId: mathWork.id, kind: 'total_duration', minutes: 40 });
  expect([approvalWrites, planWrites]).toEqual([0, 0]);

  const corrected = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-3', shownRevision: second.graphRevision,
    userText: '数学プリントは40分ではなく全体で50分に訂正します。' });
  expect(dispatches).toEqual(['native', 'focused', 'native']);
  expect(corrected.outcome, JSON.stringify(corrected.interpretation)).toBe('applied');
  const after = local.readCheckpoint()!.vnext;
  expect(after.state.graph.tasks).toEqual(before.state.graph.tasks);
  expect(after.state.graph.workloads).toEqual(before.state.graph.workloads);
  expect(after.state.graph.revision).toBeGreaterThan(oldPreview.graphRevision);
  const oldLife = after.state.graph.factLifecycles.find(item => item.factId === oldEstimate.id)!;
  expect(oldLife.status).toBe('superseded');
  const newEstimate = after.state.graph.effortEstimates.find(item => item.id === oldLife.supersededByFactId)!;
  expect(newEstimate).toMatchObject({ taskId: math.id, targetFactId: mathWork.id, kind: 'total_duration', minutes: 50 });
  expect(after.state.graph.factLifecycles.find(item => item.factId === newEstimate.id)).toMatchObject({ status: 'active' });
  expect(guard(oldPreview.blocks, after.state.graph.revision))
    .toMatchObject({ allowed: false, attempt: { kind: 'stale_preview_approval_attempt' } });
  expect(after.preview).not.toEqual(oldPreview);
  expect(corrected.question).toBeNull();
  expect(corrected.preview).not.toBeNull();
  expect(after.preview).toEqual(corrected.preview);
  expect(corrected.preview!.graphRevision).toBe(after.state.graph.revision);
  expect(guard(corrected.preview!.blocks, after.state.graph.revision)).toMatchObject({ allowed: true });
  expect(corrected.preview!.blocks.map(block => block.title).sort()).toEqual(['数学プリント 10枚', '英語 60分'].sort());
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  expect(Object.fromEntries(corrected.preview!.blocks.map(block => [block.title, minutes(block.endTime) - minutes(block.startTime)])))
    .toEqual({ '数学プリント 10枚': 55, '英語 60分': 60 });
  expect([approvalWrites, planWrites]).toEqual([0, 0]);
});
