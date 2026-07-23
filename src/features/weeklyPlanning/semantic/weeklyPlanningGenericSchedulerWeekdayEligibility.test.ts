import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [{
      id: 'task-study',
      category: 'study',
      title: '英単語',
      source: source('task-study'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-study',
      taskId: 'task-study',
      componentId: null,
      quantityRole: 'target',
      amount: 30,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: source('workload-study'),
      createdRevision: 1,
    }],
    recurrences: [{
      id: 'recurrence-weekdays',
      taskId: 'task-study',
      targetFactId: 'task-study',
      kind: 'weekly',
      count: null,
      days: ['wed', 'fri', 'sat', 'sun'],
      source: source('recurrence-weekdays'),
      createdRevision: 1,
    }],
    taskDateRules: [{
      id: 'exclude-saturday',
      taskId: 'task-study',
      targetFactId: 'task-study',
      kind: 'excluded_date',
      dateExpression: '2026-07-25',
      constraintLevel: 'hard',
      source: source('exclude-saturday'),
      createdRevision: 1,
    }],
  };
}

describe('generic scheduler weekday eligibility', () => {
  it('keeps a discontinuous weekday set and exact exception in scheduler input', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: {
        ownerId: 'user-1',
        currentDate: '2026-07-22',
        planningStartDate: '2026-07-20',
        planningEndDate: '2026-07-26',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(result.status).toBe('ready');
    expect(result.input?.taskDateEligibilities).toEqual([{
      taskId: 'task-study',
      allowedDates: ['2026-07-22', '2026-07-24', '2026-07-26'],
      excludedDates: ['2026-07-25'],
      sourceFactIds: ['exclude-saturday', 'recurrence-weekdays'],
    }]);
    expect(result.input?.sourceFactRefs).toEqual(expect.arrayContaining([
      'recurrence-weekdays',
      'exclude-saturday',
    ]));
  });
});
