import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function reviewRound(candidate: unknown): 1 | 2 | undefined {
  return (candidate as { stableV5Metadata?: { reviewRound?: 1 | 2 } })
    .stableV5Metadata?.reviewRound;
}

describe('Stable V5 vocabulary review date collision', () => {
  it('keeps review rounds for one learning batch on different calendar dates after fallback', () => {
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 1,
      tasks: [{
        id: 'task-1',
        category: 'study' as const,
        title: '英単語',
        source: {
          conversationId: 'conversation-review-collision',
          turnId: 'turn-1',
          semanticLocalId: 'task-1',
          sourceText: '英単語を覚える',
          origin: 'user' as const,
        },
        createdRevision: 1,
      }],
    };
    const item: GenericPlanningWorkItem = {
      version: 'weekly-planning-generic-work-item-v1',
      id: 'word-item-1',
      taskId: 'task-1',
      componentId: null,
      workloadFactId: 'workload-vocabulary',
      label: '英単語 80語',
      quantityRole: 'target',
      actionability: 'actionable',
      quantity: {
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        ordinalRange: { start: 1, end: 80 },
        actualRange: null,
      },
      estimatedMinutes: 30,
      baseEstimatedMinutes: 30,
      calibrationMultiplier: 1,
      roundingStepMinutes: 5,
      estimateBasis: 'direct_effort',
      estimateSourceFactIds: ['effort-1'],
      estimateSourceWorkloadFactIds: [],
      splitPolicy: 'atomic',
      periodExpression: null,
      sourceFactRefs: ['task-1', 'workload-vocabulary', 'effort-1'],
    };
    const input: GenericSchedulerInput = {
      version: 'weekly-planning-generic-scheduler-input-v2',
      graphRevision: 1,
      ownerId: 'owner-review-collision',
      horizon: {
        startDate: '2026-08-17',
        endDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
        planningWindowFactIds: [],
      },
      movableWorkItems: [item],
      fixedTaskReservations: [],
      taskDateEligibilities: [],
      availabilityWindows: ['2026-08-18', '2026-08-19'].map((date, index) => ({
        id: `blocked-${index}`,
        kind: 'unavailable' as const,
        start: { date, time: '09:00' },
        end: { date, time: '22:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard' as const,
        sourceKind: 'user_declaration' as const,
        sourceRef: `blocked-source-${index}`,
        ownerId: 'owner-review-collision',
        graphRevision: 1,
      })),
      sourceSelections: [],
      relations: [],
      sourceFactRefs: ['task-1'],
    };

    const result = scheduleWeeklyPlanningStableV5Preview({ input, graph });

    expect(result.status).toBe('ready');
    const firstReview = result.candidates.find((candidate) => reviewRound(candidate) === 1);
    const secondReview = result.candidates.find((candidate) => reviewRound(candidate) === 2);
    expect(firstReview?.date).toBe('2026-08-20');
    expect(secondReview?.date).toBe('2026-08-21');
    expect(firstReview?.date).not.toBe(secondReview?.date);
  });
});
