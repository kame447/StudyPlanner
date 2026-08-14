import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
  createWeeklyPlanningStableV5DialogueStateSummary,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-2:quantity_role_unresolved',
    currentUserMessage: 'どういうこと？',
    recentConversation: [
      { role: 'user', content: '院試は2分野それぞれ3時間やりたい' },
      {
        role: 'assistant',
        content: '第2分野の3時間は、今週進める量ですか、それとも残りの全体量ですか？',
      },
    ],
    planningInformation: {
      revision: 4,
      planningWindows: [{
        kind: 'relative_week',
        value: '来週',
        start: '2026-08-03',
        end: '2026-08-09',
      }],
      tasks: [{ id: 'task-1', category: 'study', title: '院試' }],
      components: [{
        id: 'component-1',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'field',
        label: '第2分野',
      }],
      workloads: [{
        taskId: 'task-1',
        componentId: 'component-1',
        quantityRole: 'unknown',
        amount: 3,
        unitCode: 'hour',
        unitLabel: '時間',
      }],
      uncertainties: [{
        targetFactId: 'workload-1',
        field: 'quantityRole',
        reason: '今回進める量か残っている全体量か不明',
      }],
      availabilityDeclarations: [{
        kind: 'available',
        dateExpression: '来週',
        namedTimePeriod: 'evening',
        startTime: null,
        endTime: null,
        recurrenceKind: null,
        days: [],
        constraintLevel: 'soft',
        resolutionStatus: 'unresolved',
      }],
      constraintSourceRequests: [{
        kind: 'calendar',
        selector: 'active',
        requestedAction: 'use',
        resolutionStatus: 'unresolved',
      }],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試', '第2分野'],
    fallbackText: '第2分野の3時間は、今回進めたい量ですか、それとも残っている全体量ですか？',
    previewCount: 0,
  };
}

describe('Stable V5 dialogue state summary', () => {
  it('separates durable decided facts from unresolved items', () => {
    const summary = createWeeklyPlanningStableV5DialogueStateSummary(input());

    expect(summary).toMatchObject({
      decidedFacts: {
        revision: 4,
        planningWindows: expect.any(Array),
        tasks: [{ id: 'task-1', category: 'study', title: '院試' }],
        components: expect.any(Array),
        workloads: [],
        availabilityDeclarations: [],
        constraintSourceRequests: [],
      },
      undecidedItems: expect.any(Array),
    });
    expect(summary).not.toHaveProperty('currentQuestion');
    expect(summary.decidedFacts).not.toHaveProperty('uncertainties');
    expect(summary.undecidedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetFactId: 'workload-1',
        field: 'quantityRole',
      }),
      expect.objectContaining({
        kind: 'workload_field',
        componentId: 'component-1',
        field: 'quantityRole',
        knownAmount: 3,
        knownUnitLabel: '時間',
      }),
      expect.objectContaining({
        sourceCollection: 'availabilityDeclarations',
        kind: 'available',
        resolutionStatus: 'unresolved',
      }),
      expect.objectContaining({
        sourceCollection: 'constraintSourceRequests',
        kind: 'calendar',
        resolutionStatus: 'unresolved',
      }),
    ]));
  });

  it('embeds state once and keeps question context in applicationDecision', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as Record<string, unknown>;

    expect(payload).not.toHaveProperty('planningInformation');
    expect(payload).toMatchObject({
      currentUserMessage: 'どういうこと？',
      recentConversation: expect.any(Array),
      planningStateSummary: {
        decidedFacts: expect.any(Object),
        undecidedItems: expect.any(Array),
      },
      applicationDecision: {
        questionCode: 'quantity_role_unresolved',
        relevantLabels: ['院試', '第2分野'],
      },
    });
    expect(
      (payload.planningStateSummary as Record<string, unknown>),
    ).not.toHaveProperty('currentQuestion');
    expect(prompt.userPrompt).toContain(
      'decidedFactsは確定情報、undecidedItemsは未確定情報です',
    );
  });
});
