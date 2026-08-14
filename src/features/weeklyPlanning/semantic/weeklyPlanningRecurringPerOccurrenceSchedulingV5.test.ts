import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function source(id: string) {
  return {
    conversationId: 'recurring-per-occurrence-conversation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: '来週は毎日2時間ずつ',
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-mock-exam',
      category: 'study',
      title: '模試対策',
      source: source('task-mock-exam'),
      createdRevision: 1,
    }],
    components: [{
      id: 'component-math',
      taskId: 'task-mock-exam',
      parentComponentId: null,
      role: 'subject',
      label: '数学',
      source: source('component-math'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-math-daily',
      taskId: 'task-mock-exam',
      componentId: 'component-math',
      quantityRole: 'target',
      amount: 2,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: true,
      periodExpression: '来週',
      source: source('workload-math-daily'),
      createdRevision: 1,
    }],
    recurrences: [{
      id: 'recurrence-math-daily',
      taskId: 'task-mock-exam',
      targetFactId: 'component-math',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-math-daily'),
      createdRevision: 1,
    }],
  };
}

describe('Stable V5 recurring per-occurrence scheduling', () => {
  it('places one complete occurrence on every day in the planning horizon', () => {
    const value = graph();
    const compiled = compileGenericSchedulerInput({
      graph: value,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-08-14',
        planningStartDate: '2026-08-17',
        planningEndDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems).toHaveLength(7);
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(compiled.input?.sourceFactRefs).toContain('recurrence-math-daily');

    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: value,
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(7);
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(scheduled.candidates.every((candidate) => candidate.durationMinutes === 120))
      .toBe(true);
    expect(scheduled.candidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    )).toBe(840);
    expect(scheduled.candidates.every((candidate) =>
      (candidate as typeof candidate & {
        stableV5Metadata?: { sourceFactRefs: string[] };
      }).stableV5Metadata?.sourceFactRefs.includes('recurrence-math-daily')))
      .toBe(true);
  });
});
