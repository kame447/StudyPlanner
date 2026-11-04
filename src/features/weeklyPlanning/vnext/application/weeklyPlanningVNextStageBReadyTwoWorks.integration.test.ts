import { expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { VNextAddFact, VNextPlanningIntent } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';

const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'stage-b-ready-owner', weekStartDate: WEEK, conversationId: 'stage-b-ready-two-works', notBeforeTime: '09:00',
  clock: { currentDate: WEEK, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' },
};
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number): VNextAddFact => ({ kind: 'workload', localId,
  taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount, unitCode: 'minute', unitLabel: '分',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const facts = [task('english', '英語'), work('english-work', 'english', 60), task('math', '数学'), work('math-work', 'math', 40)];

it.each([
  { intent: 'create_plan' as const, text: '今週は英語60分と数学40分を進めたい。予定案を作ってください。', preview: true },
  { intent: 'discuss' as const, text: '今週は英語60分と数学40分を進めたい。', preview: false },
])('keeps both ready works and follows the $intent intent on the first turn', async ({ intent, text, preview }) => {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage: memory.storage });
  let providerCalls = 0;
  let approvalWrites = 0;
  let planWrites = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: createWeeklyPlanningVNextRuntimeInterpreter(scope, {
      choice: { policy: VNEXT_OPTION_CHOICE_POLICY, choose: async () => { throw new Error('unexpected option choice'); } },
    }),
    client: { async createChatCompletion() {
      providerCalls++;
      return JSON.stringify({ planningIntent: intent as VNextPlanningIntent, conversationActs: [], answer: null,
        delta: { add: facts, patch: [], remove: [], relate: [], defer: [] } });
    } },
    approvalLedger: { read: () => null, write: () => { approvalWrites++; } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { planWrites++; return { planId: 'unexpected' }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => `${WEEK}T00:00:00.000Z`,
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '条件を受け取りました。', rawResponse: '' }) }),
  };
  const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'turn-1', shownRevision: null, userText: text });
  expect(providerCalls).toBe(1);
  expect(result.outcome).toBe('applied');
  if (result.question) expect(result.question.optionalInvitation).toBeTruthy();
  expect(result.preview !== null).toBe(preview);
  const checkpoint = local.readCheckpoint()!.vnext;
  expect(checkpoint.state.draftGenerationIntent).toBe(preview ? 'user_authorized' : 'not_requested');
  expect(checkpoint.state.graph.tasks).toHaveLength(2);
  expect(checkpoint.state.graph.workloads).toHaveLength(2);
  for (const [title, amount] of [['英語', 60], ['数学', 40]] as const) {
    const acceptedTask = checkpoint.state.graph.tasks.find(item => item.title === title);
    expect(acceptedTask).toBeTruthy();
    const acceptedWork = checkpoint.state.graph.workloads.filter(item => item.taskId === acceptedTask!.id);
    expect(acceptedWork).toHaveLength(1);
    expect(acceptedWork[0]).toMatchObject({ amount, unitCode: 'minute' });
  }
  expect(checkpoint.state.graph.effortEstimates).toEqual([]);
  expect(checkpoint.actualRecords ?? []).toEqual([]);
  if (preview) {
    expect(result.preview!.blocks.map(block => block.title).sort()).toEqual(['数学 40分', '英語 60分'].sort());
  } else {
    expect(checkpoint.preview).toBeNull();
  }
  expect([approvalWrites, planWrites]).toEqual([0, 0]);
});
