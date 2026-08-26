import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import { resolveWeeklyPlanningTaskCommitments } from './weeklyPlanningTaskCommitmentResolver';

function source(id: string) {
  return {
    conversationId: 'commitment-recurrence-validation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

describe('weekly planning commitment recurrence validation', () => {
  it('does not partially schedule a recurrence containing an invalid weekday token', () => {
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV2(),
      revision: 1,
      temporalConstraints: [{
        id: 'constraint-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'fixed_interval' as const,
        constraintLevel: 'hard' as const,
        dateExpression: null,
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '19:00',
        precision: 'exact' as const,
        source: source('constraint-1'),
        createdRevision: 1,
      }],
      recurrences: [{
        id: 'recurrence-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'custom' as const,
        count: null,
        days: ['wed', '水曜'],
        source: source('recurrence-1'),
        createdRevision: 1,
      }],
    };

    const result = resolveWeeklyPlanningTaskCommitments({
      graph,
      context: {
        currentDate: '2026-08-26',
        planningStartDate: '2026-08-24',
        planningEndDate: '2026-08-30',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.reservations).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'invalid_commitment_weekday',
      temporalConstraintFactId: 'constraint-1',
      taskId: 'task-1',
      blocking: true,
      details: { day: '水曜' },
    });
  });
});
