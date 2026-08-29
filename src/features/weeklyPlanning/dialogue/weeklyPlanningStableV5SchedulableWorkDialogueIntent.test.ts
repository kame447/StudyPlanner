import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

const planningInformation = {
  tasks: [{
    id: 'task-slides',
    title: '夏合宿のスライド作成',
    category: 'study',
    createdRevision: 1,
  }],
  components: [],
  workloads: [],
  effortEstimates: [],
  temporalConstraints: [],
  taskDateRules: [],
  recurrences: [],
  uncertainties: [],
};

describe('Stable V5 schedulable-work dialogue intent', () => {
  it('does not invent a bounded unit when the existing target has no structured quantity', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'task-slides',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation,
    })).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_progress',
      targetFactId: 'task-slides',
      progressBasis: 'completion_progress_without_known_unit',
      knownUnitCode: null,
      knownUnitLabel: null,
      requestedInformation: ['current_progress'],
    });
  });

  it('does not mistake a completed-only quantity for the total bounded scope', () => {
    const completedOnly = {
      ...planningInformation,
      workloads: [{
        id: 'workload-completed-pages',
        taskId: 'task-slides',
        componentId: null,
        quantityRole: 'completed',
        amount: 5,
        unitCode: 'page',
        unitLabel: 'ページ',
      }],
    };
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: completedOnly,
      targetFactId: 'task-slides',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation: completedOnly,
    })).toEqual(expect.objectContaining({
      progressBasis: 'completion_progress_without_known_unit',
      knownUnitCode: null,
      knownUnitLabel: null,
    }));
  });

  it('uses a fixed total-scope fact as the bounded progress unit', () => {
    const boundedPlanningInformation = {
      ...planningInformation,
      workloads: [{
        id: 'workload-total-problems',
        taskId: 'task-slides',
        componentId: null,
        quantityRole: 'scope_total',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
      }],
    };
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: boundedPlanningInformation,
      targetFactId: 'task-slides',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation: boundedPlanningInformation,
    })).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_progress',
      targetFactId: 'task-slides',
      progressBasis: 'known_bounded_quantity',
      knownUnitCode: 'problem',
      knownUnitLabel: '問',
      requestedInformation: ['current_progress'],
    });
  });

  it('uses task-identity mode only when there is no existing target and the application says the task is missing', () => {
    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget: null,
      planningInformation,
      effortMeasurement: 'missing_task_identity',
    })).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'missing_task_identity',
      targetFactId: null,
      progressBasis: null,
      knownUnitCode: null,
      knownUnitLabel: null,
      requestedInformation: ['task_identity'],
    });
  });

  it('preserves the application-owned all-complete reason instead of pretending no task was supplied', () => {
    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget: null,
      planningInformation,
      effortMeasurement: 'all_requested_work_complete',
    });

    expect(intent).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'all_requested_work_complete',
      targetFactId: null,
      progressBasis: null,
      knownUnitCode: null,
      knownUnitLabel: null,
      requestedInformation: ['additional_task_or_constraint'],
    });

    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'stable-v5:complete:missing_schedulable_work',
      currentUserMessage: 'もう100%終わっています',
      recentConversation: [],
      planningInformation,
      actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      questionTarget: null,
      questionIntent: intent,
      requiredLabels: [],
      fallbackText: '指定された作業は完了済みです。',
      previewCount: 0,
    });
    const payload = JSON.parse(prompt.userPrompt) as { request: string };
    expect(payload.request).toContain('all_requested_work_complete=完了済みとして');
    expect(payload.request).toContain('同じ進捗を聞き直さず');
    expect(payload.request).toContain('追加作業/制約だけ聞く');
  });

  it('passes the open-ended progress contract to the renderer prompt', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'task-slides',
    });
    const questionIntent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation,
    });
    const input: WeeklyPlanningStableV5DialogueRenderInput = {
      actionId: 'stable-v5:request-1:missing_schedulable_work',
      currentUserMessage: '明日は夏合宿に向けてのスライド作成があります。それを終わらせたいです',
      recentConversation: [],
      planningInformation,
      actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      questionTarget,
      questionIntent,
      requiredLabels: ['夏合宿のスライド作成'],
      fallbackText: '夏合宿のスライド作成は、完成までを100%とすると今どのくらい進んでいますか？',
      previewCount: 0,
    };

    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input);
    const payload = JSON.parse(prompt.userPrompt) as {
      applicationDecision: { questionIntent: unknown };
      request: string;
    };

    expect(payload.applicationDecision.questionIntent).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_progress',
      targetFactId: 'task-slides',
      progressBasis: 'completion_progress_without_known_unit',
      knownUnitCode: null,
      knownUnitLabel: null,
      requestedInformation: ['current_progress'],
    });
    expect(payload.request).toContain('existing_target_progress=現在進捗のみ');
    expect(payload.request).toContain('別作業は聞かない');
    expect(payload.request).toContain('completion_progress_without_known_unitは具体的な単位/総量を発明せず');
    expect(payload.request).toContain('100%概算や工程を聞く');
  });
});
