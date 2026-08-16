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
  it('asks for scope/progress of an existing target instead of another task', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'task-slides',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
    })).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_scope_progress',
      targetFactId: 'task-slides',
      requestedInformation: ['total_scope', 'current_progress'],
    });
  });

  it('uses task-identity mode only when there is no existing target', () => {
    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget: null,
    })).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'missing_task_identity',
      targetFactId: null,
      requestedInformation: ['task_identity'],
    });
  });

  it('passes the existing-target semantic contract to the renderer prompt', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'task-slides',
    });
    const questionIntent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
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
      fallbackText: '「夏合宿のスライド作成」について、まず全体の範囲と、今どこまで終わっているかを教えてください。分かる単位で大丈夫です。',
      previewCount: 0,
    };

    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input);
    const payload = JSON.parse(prompt.userPrompt) as {
      applicationDecision: { questionIntent: unknown };
      request: string;
    };

    expect(payload.applicationDecision.questionIntent).toEqual({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_scope_progress',
      targetFactId: 'task-slides',
      requestedInformation: ['total_scope', 'current_progress'],
    });
    expect(payload.request).toContain('existing_target_scope_progress');
    expect(payload.request).toContain('別の作業追加は聞かないでください');
  });
});
