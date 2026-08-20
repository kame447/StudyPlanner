import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputContext,
} from './weeklyPlanningGenericSchedulerInput';

const source = {
  conversationId: 'conversation-scope-total',
  turnId: 'turn-1',
  semanticLocalId: 'scope-total',
  sourceText: '課題は全部40問です',
  origin: 'user' as const,
};

function context(): GenericSchedulerInputContext {
  return {
    ownerId: 'user-scope-total',
    currentDate: '2026-08-17',
    planningStartDate: '2026-08-17',
    planningEndDate: '2026-08-17',
    timeZone: 'Asia/Tokyo',
    namedTimePeriods: {},
  };
}

function graph(params: { includeCompleted: boolean }): WeeklyPlanningFactGraphV5 {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...base,
    revision: 2,
    tasks: [{
      id: 'task-homework',
      category: 'study',
      title: '数学の課題',
      source,
      createdRevision: 1,
    }],
    workloads: [
      {
        id: 'scope-total-40',
        taskId: 'task-homework',
        componentId: null,
        quantityRole: 'scope_total',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source,
        createdRevision: 2,
      },
      ...(params.includeCompleted
        ? [{
            id: 'completed-10',
            taskId: 'task-homework',
            componentId: null,
            quantityRole: 'completed' as const,
            amount: 10,
            unitCode: 'problem' as const,
            unitLabel: '問',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            source: { ...source, semanticLocalId: 'completed', sourceText: '10問終わっています' },
            createdRevision: 2,
          }]
        : []),
    ],
  };
}

describe('Stable V5 scope-total scheduler boundary', () => {
  it('does not treat a fixed total scope as schedulable work', () => {
    const result = compileGenericSchedulerInput({
      graph: graph({ includeCompleted: false }),
      context: context(),
    });

    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: 'work_item',
        code: 'scope_total_workload_skipped',
        blocking: false,
      }),
    ]));
  });

  it('does not mistake total plus completed progress for a runnable work item', () => {
    const result = compileGenericSchedulerInput({
      graph: graph({ includeCompleted: true }),
      context: context(),
    });

    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scope_total_workload_skipped', blocking: false }),
      expect.objectContaining({ code: 'completed_workload_skipped', blocking: false }),
    ]));
  });
});
