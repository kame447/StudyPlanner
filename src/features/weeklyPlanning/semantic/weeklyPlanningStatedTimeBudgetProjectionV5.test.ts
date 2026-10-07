import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningGenericSchedulerGraphView } from './weeklyPlanningGenericSchedulerInput';
import { projectWeeklyPlanningStatedTimeBudgetGraphV5 } from './weeklyPlanningStatedTimeBudgetProjectionV5';

type Graph = WeeklyPlanningGenericSchedulerGraphView;

const source = { sourceText: '合計2時間', semanticLocalId: 'e', turnId: 'turn-1' } as never;

function graph(overrides: Partial<Record<keyof Graph, unknown[]>> = {}): Graph {
  return {
    revision: 3,
    planningWindows: [],
    tasks: [{ id: 'task', title: '卒研', source, createdRevision: 1 }],
    components: [],
    workloads: [],
    effortEstimates: [estimate('estimate', 120)],
    temporalConstraints: [],
    taskDateRules: [],
    recurrences: [],
    relations: [],
    uncertainties: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    ...overrides,
  } as unknown as Graph;
}

function estimate(id: string, minutes: number, overrides: Record<string, unknown> = {}) {
  return {
    id, taskId: 'task', targetFactId: 'task', kind: 'total_duration', minutes, unitCode: null,
    precision: 'approximate', source, createdRevision: 2, ...overrides,
  };
}

describe('stated time budget projection', () => {
  it('projects the accepted total as the task time target, with the estimate as its evidence', () => {
    const projected = projectWeeklyPlanningStatedTimeBudgetGraphV5(graph());
    expect(projected.workloads).toEqual([expect.objectContaining({
      taskId: 'task', componentId: null, quantityRole: 'target', amount: 120, unitCode: 'minute', source,
    })]);
  });

  it.each([
    ['any workload of the task exists (content quantity wins)', graph({
      workloads: [{ id: 'wl', taskId: 'task', componentId: 'c', quantityRole: 'completed', amount: 5, unitCode: 'section' }],
    })],
    ['the totals contradict each other', graph({ effortEstimates: [estimate('a', 120), estimate('b', 90)] })],
    ['the estimate is about a component, not the task', graph({ effortEstimates: [estimate('a', 120, { targetFactId: 'c' })] })],
    ['the estimate is a session length', graph({ effortEstimates: [estimate('a', 60, { kind: 'session_duration' })] })],
    ['the estimate is not positive', graph({ effortEstimates: [estimate('a', 0)] })],
    ['the task is a hard fixed interval', graph({
      temporalConstraints: [{ id: 'fx', taskId: 'task', targetFactId: 'task', kind: 'fixed_interval', constraintLevel: 'hard' }],
    })],
    ['no budget was stated', graph({ effortEstimates: [] })],
  ])('adds nothing when %s', (_label, input) => {
    expect(projectWeeklyPlanningStatedTimeBudgetGraphV5(input)).toBe(input);
  });

  it('accepts a restated identical total once', () => {
    const projected = projectWeeklyPlanningStatedTimeBudgetGraphV5(graph({
      effortEstimates: [estimate('b', 120), estimate('a', 120)],
    }));
    expect(projected.workloads.map((workload) => workload.amount)).toEqual([120]);
  });
});
