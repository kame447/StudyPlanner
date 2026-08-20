import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import {
  parseWeeklyPlanningStableV5DialogueRendererResponse,
} from './weeklyPlanningStableV5DialogueValidation';

describe('Stable V5 dialogue metadata when no current-turn grounding is required', () => {
  it('ignores redundant ACK metadata and still validates the visible grounded text', () => {
    const input: WeeklyPlanningStableV5DialogueRenderInput = {
      actionId: 'issue156:all:missing_effort_estimate',
      currentUserMessage: '続けて',
      recentConversation: [],
      planningInformation: {
        workloads: [{
          id: 'workload-1',
          quantityRole: 'completed',
          amount: 8,
          unitLabel: 'ページ',
        }],
      },
      currentTurnGrounding: {
        mode: 'none',
        acceptedFacts: [],
      },
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      questionIntent: {
        kind: 'effort_measurement',
        measurement: 'total_duration',
        quantityRole: 'completed',
        targetFactId: 'workload-1',
        amount: 8,
        unitCode: null,
        unitLabel: 'ページ',
      },
      requiredLabels: [],
      fallbackText: '8ページ全体にかかった時間はどのくらいですか？',
      previewCount: 0,
    };
    const text = '8ページ終わっているんですね。8ページ全体にかかった時間はどのくらいですか？';
    const raw = JSON.stringify({
      actionId: input.actionId,
      actionKind: input.actionKind,
      questionCode: input.questionCode,
      groundingAcknowledgement: {
        factIds: ['workload-1'],
        text: '8ページ終わっているんですね。',
      },
      text,
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, input)).toMatchObject({
      status: 'rendered',
      text,
    });
  });
});
