import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'custom-recurrence-conversation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

describe('Stable V5 custom recurring per-occurrence scheduling', () => {
  it('expands a custom canonical weekday set into the same concrete occurrence dates', () => {
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 1,
      tasks: [{
        id: 'task-1',
        category: 'study' as const,
        title: '金フレ',
        source: source('task-1'),
        createdRevision: 1,
      }],
      workloads: [{
        id: 'workload-1',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'target' as const,
        amount: 1,
        unitCode: 'hour' as const,
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: true,
        periodExpression: 'custom:水金日',
        source: source('workload-1'),
        createdRevision: 1,
      }],
      recurrences: [{
        id: 'recurrence-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'custom' as const,
        count: null,
        days: ['wed', 'fri', 'sun'],
        source: source('recurrence-1'),
        createdRevision: 1,
      }],
    };

    const compiled = compileGenericSchedulerInput({
      graph,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-08-26',
        planningStartDate: '2026-08-24',
        planningEndDate: '2026-08-30',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-26',
      '2026-08-28',
      '2026-08-30',
    ]);
  });
});
