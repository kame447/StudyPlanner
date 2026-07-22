import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(semanticLocalId: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText,
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [
      {
        id: 'task-fixed-study',
        category: 'study',
        title: '数学の演習',
        source: source('task-fixed-study', '数学を20時から21時まで進める'),
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-fixed-study',
        taskId: 'task-fixed-study',
        componentId: null,
        quantityRole: 'target',
        amount: 10,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-fixed-study', '10問'),
        createdRevision: 1,
      },
    ],
    temporalConstraints: [
      {
        id: 'constraint-fixed-study',
        taskId: 'task-fixed-study',
        targetFactId: 'task-fixed-study',
        kind: 'fixed_interval',
        dateExpression: 'today',
        namedTimePeriod: null,
        startTime: '20:00',
        endTime: '21:00',
        precision: 'exact',
        constraintLevel: 'hard',
        source: source('constraint-fixed-study', '今日20時から21時まで'),
        createdRevision: 1,
      },
    ],
  };
}

describe('generic scheduler input fixed-task deduplication', () => {
  it('does not require a movable-work estimate for a fixed task', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: {
        ownerId: 'user-1',
        currentDate: '2026-07-22',
        planningStartDate: '2026-07-22',
        planningEndDate: '2026-07-22',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(result.status).toBe('ready');
    expect(result.input?.movableWorkItems).toEqual([]);
    expect(result.input?.fixedTaskReservations).toHaveLength(1);
    expect(result.issues).not.toContainEqual(expect.objectContaining({
      domain: 'work_item',
      code: 'missing_effort_estimate',
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      domain: 'deduplication',
      code: 'fixed_task_movable_work_suppressed',
      factId: 'workload-fixed-study',
    }));
  });
});
