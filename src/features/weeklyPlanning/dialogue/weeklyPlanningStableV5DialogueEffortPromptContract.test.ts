import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:missing_effort_estimate',
    currentUserMessage: 'うん、それで',
    recentConversation: [],
    planningInformation: null,
    actionKind: 'question',
    questionCode: 'missing_effort_estimate',
    questionTarget: {
      collection: 'workloads',
      fact: {
        id: 'workload-1',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        quantityRole: 'target',
      },
    },
    questionIntent: {
      kind: 'effort_measurement',
      measurement: 'duration_per_unit',
      quantityRole: 'target',
      targetFactId: 'workload-1',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
    },
    requiredLabels: ['数学の問題'],
    fallbackText: '1問あたりどれくらい時間がかかりますか？',
    previewCount: 0,
  };
}

describe('Stable V5 dialogue effort prompt contract', () => {
  it('tells Luna not to change the requested effort measurement', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as {
      applicationDecision: { questionIntent: { measurement: string; unitLabel: string } };
      request: string;
    };

    expect(payload.applicationDecision.questionIntent).toMatchObject({
      measurement: 'duration_per_unit',
      unitLabel: '問',
    });
    expect(payload.request).toContain('measurementを変えないでください');
    expect(payload.request).toContain('duration_per_unit=1単位あたり');
    expect(payload.request).toContain('session_duration=1回');
    expect(payload.request).toContain('total_duration=全体');
  });
});
