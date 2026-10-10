import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5 } from './weeklyPlanningSchedulerWorkDistributionV5';

const source = {
  conversationId: 'conversation-session-distribution',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: '3時間',
  origin: 'user' as const,
};

function graphWithHours(params: {
  hours: number;
  purpose?: 'research' | 'self_study';
}): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '作業',
      source,
      createdRevision: 1,
    }],
    studyContexts: params.purpose
      ? [{
          id: 'context-1',
          taskId: 'task-1',
          purpose: params.purpose,
          contextLabel: null,
          source,
          createdRevision: 1,
        }]
      : [],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: params.hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
  };
}

function distribute(graph: WeeklyPlanningFactGraph, preferredSessionMinutes?: number) {
  const work = compileGenericPlanningWorkItems(graph);
  return distributeGenericSchedulerWorkItemsV5({
    graph,
    items: work.items,
    startDate: '2026-08-17',
    endDate: '2026-08-23',
    preferredSessionMinutes,
  });
}

describe('Stable V5 execution-policy work distribution', () => {
  it('splits three neutral hours into two 90-minute quantity-preserving sessions', () => {
    const result = distribute(graphWithHours({ hours: 3 }));
    expect(result.map((item) => item.estimatedMinutes)).toEqual([90, 90]);
    expect(result.map((item) => item.quantity.amount)).toEqual([1.5, 1.5]);
    expect(result.map((item) => item.label)).toEqual([
      '作業 1.5時間（1/2）',
      '作業 1.5時間（2/2）',
    ]);
    expect(result.every((item) => item.splitPolicy === 'atomic')).toBe(true);
  });

  it('uses structured research purpose to keep longer deep-work sessions', () => {
    const result = distribute(graphWithHours({ hours: 3.5, purpose: 'research' }));
    expect(result.map((item) => item.estimatedMinutes)).toEqual([105, 105]);
  });

  it('honors a bounded personalized session target without changing total work', () => {
    const result = distribute(graphWithHours({ hours: 2.5 }), 75);
    expect(result.map((item) => item.estimatedMinutes)).toEqual([75, 75]);
    expect(result.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(150);
    expect(result.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(2.5);
  });
  it('floors an accepted fractional cap without changing another task or the total time quantity', () => {
    const original = graphWithHours({ hours: 1 });
    const canonical: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
      tasks: [original.tasks[0], { ...original.tasks[0], id: 'other-task' }]
        .map((task) => ({ ...task, source: { ...task.source, semanticLocalId: task.id, sourceText: '作業を1時間' } })),
      workloads: [original.workloads[0], { ...original.workloads[0], id: 'other-workload', taskId: 'other-task' }]
        .map((workload) => ({ ...workload, source: { ...workload.source, semanticLocalId: workload.id, sourceText: '1時間' } })),
      effortEstimates: [{ id: 'fractional-cap', taskId: 'task-1', targetFactId: 'task-1', kind: 'session_duration',
        minutes: 29.6, unitCode: 'session', precision: 'exact',
        source: { ...source, semanticLocalId: 'fractional-cap', sourceText: '1回29.6分以内' }, createdRevision: 1 }],
    };
    canonical.factLifecycles = [...canonical.tasks, ...canonical.workloads, ...canonical.effortEstimates]
      .map((fact) => ({ factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
    expect(validateWeeklyPlanningFactGraphValueV5(canonical).errors).toEqual([]);
    const before = structuredClone(canonical);
    // Enter via the current compiler, not a future distribution API argument.
    const result = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(canonical), context: {
      ownerId: 'owner', currentDate: '2026-08-17', planningStartDate: '2026-08-17', planningEndDate: '2026-08-17', timeZone: 'Asia/Tokyo',
    } });
    expect(result.status).toBe('ready');
    const items = result.input!.movableWorkItems.filter((item) => item.taskId === 'task-1');
    expect(items.map((item) => item.estimatedMinutes)).toEqual([29, 29, 2]);
    expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBeCloseTo(1);
    expect(items.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)).toBeCloseTo(60);
    expect(items.every((item) => (item.estimatedMinutes ?? Infinity) <= 29.6 && item.sourceFactRefs.includes('fractional-cap'))).toBe(true);
    const unrelated = result.input!.movableWorkItems.filter((item) => item.taskId === 'other-task');
    expect(unrelated.map((item) => item.estimatedMinutes)).toEqual([60]);
    expect(unrelated[0].quantity.amount).toBe(1);
    expect(unrelated[0].sourceFactRefs).not.toContain('fractional-cap');
    expect(canonical).toEqual(before);
  });

  it.each([
    { total: 30, durations: [30] },
    { total: 120, durations: [60, 60] },
    { total: 125, durations: [60, 60, 15] },
  ])('preserves explicit time quantity $total and its existing rounded allocation', ({ total, durations }) => {
    const original = graphWithHours({ hours: 1 });
    const canonical: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
      tasks: original.tasks, workloads: [{ ...original.workloads[0], amount: total, unitCode: 'minute', unitLabel: '分' }],
      effortEstimates: [{ id: 'cap', taskId: 'task-1', targetFactId: 'task-1', kind: 'session_duration',
        minutes: 60, unitCode: 'session', precision: 'exact', source: { ...source, semanticLocalId: 'cap', sourceText: '1回60分以内' }, createdRevision: 1 }],
    };
    canonical.factLifecycles = [...canonical.tasks, ...canonical.workloads, ...canonical.effortEstimates]
      .map((fact) => ({ factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
    expect(validateWeeklyPlanningFactGraphValueV5(canonical).errors).toEqual([]);
    const before = structuredClone(canonical);
    const result = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(canonical), context: {
      ownerId: 'owner', currentDate: '2026-08-17', planningStartDate: '2026-08-17', planningEndDate: '2026-08-23', timeZone: 'Asia/Tokyo',
    } });
    expect(result.status).toBe('ready');
    const items = result.input!.movableWorkItems;
    expect(items.map((item) => item.estimatedMinutes)).toEqual(durations);
    expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBeCloseTo(total);
    expect(items.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)).toBeCloseTo(total);
    expect(items.every((item) => item.sourceFactRefs.includes('cap') && (item.estimatedMinutes ?? Infinity) <= 60)).toBe(true);
    expect(canonical).toEqual(before);
  });

  it.each([
    { target: 'task-1', cap: 60, lower: [] as string[] },
    { target: 'component-1', cap: 30, lower: ['task-cap'] },
    { target: 'workload-1', cap: 20, lower: ['task-cap', 'component-cap'] },
  ])('uses active exact $target cap scope without superseded higher-scope leakage', ({ target, cap, lower }) => {
    const original = graphWithHours({ hours: 1 });
    const canonical: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2, tasks: original.tasks,
      components: [{ id: 'component-1', taskId: 'task-1', parentComponentId: null, role: 'material', label: '教材', source, createdRevision: 1 }],
      workloads: [{ ...original.workloads[0], componentId: 'component-1' }],
      effortEstimates: [
        ...lower.map((id) => ({ id, taskId: 'task-1', targetFactId: id === 'task-cap' ? 'task-1' : 'component-1',
          kind: 'session_duration' as const, minutes: id === 'task-cap' ? 60 : 30, unitCode: 'session' as const,
          precision: 'exact' as const, source, createdRevision: 1 })),
        { id: 'old-cap', taskId: 'task-1', targetFactId: 'workload-1', kind: 'session_duration', minutes: 1,
          unitCode: 'session', precision: 'exact', source, createdRevision: 1 },
        { id: 'selected-cap', taskId: 'task-1', targetFactId: target, kind: 'session_duration', minutes: cap,
          unitCode: 'session', precision: 'exact', source, createdRevision: 2 },
      ],
    };
    canonical.factLifecycles = [...canonical.tasks, ...canonical.components, ...canonical.workloads, ...canonical.effortEstimates]
      .map((fact) => ({ factId: fact.id, createdRevision: fact.createdRevision,
        status: fact.id === 'old-cap' ? 'superseded' : 'active',
        terminalRevision: fact.id === 'old-cap' ? 2 : null, supersededByFactId: fact.id === 'old-cap' ? 'selected-cap' : null }));
    expect(validateWeeklyPlanningFactGraphValueV5(canonical).errors).toEqual([]);
    const before = structuredClone(canonical);
    const result = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(canonical), context: {
      ownerId: 'owner', currentDate: '2026-08-17', planningStartDate: '2026-08-17', planningEndDate: '2026-08-23', timeZone: 'Asia/Tokyo',
    } });
    expect(result.status).toBe('ready');
    expect(result.input!.movableWorkItems.map((item) => item.estimatedMinutes)).toEqual(Array(60 / cap).fill(cap));
    for (const item of result.input!.movableWorkItems) {
      expect(item.sourceFactRefs).toContain('selected-cap');
      for (const ignored of ['old-cap', ...lower]) expect(item.sourceFactRefs).not.toContain(ignored);
    }
    expect(canonical).toEqual(before);
  });

  it('preserves unsplit time policy for the existing placement owner to place smaller sessions', () => {
    const original = graphWithHours({ hours: 3 });
    const canonical: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1, tasks: original.tasks, workloads: original.workloads,
      effortEstimates: [{ id: 'cap', taskId: 'task-1', targetFactId: 'task-1', kind: 'session_duration',
        minutes: 240, unitCode: 'session', precision: 'exact', source, createdRevision: 1 }],
      availabilityDeclarations: ['09:00', '11:00', '13:00'].map((startTime, index) => ({
        id: `available-${index}`, kind: 'available', dateExpression: '2026-08-17', namedTimePeriod: null,
        startTime, endTime: ['10:00', '12:00', '14:00'][index], recurrenceKind: null, days: [],
        constraintLevel: 'hard', resolutionStatus: 'unresolved', source, createdRevision: 1,
      })),
    };
    canonical.factLifecycles = [...canonical.tasks, ...canonical.workloads, ...canonical.effortEstimates, ...canonical.availabilityDeclarations]
      .map((fact) => ({ factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
    expect(validateWeeklyPlanningFactGraphValueV5(canonical).errors).toEqual([]);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(canonical);
    const compiled = compileGenericSchedulerInput({ graph: active, context: {
      ownerId: 'owner', currentDate: '2026-08-17', planningStartDate: '2026-08-17', planningEndDate: '2026-08-17', timeZone: 'Asia/Tokyo',
    } });
    expect(compiled.status).toBe('ready');
    expect(compiled.input!.movableWorkItems).toEqual([expect.objectContaining({ estimatedMinutes: 180, splitPolicy: 'splittable' })]);
    const result = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input!, graph: createWeeklyPlanningPlacementGraphViewV5(active), breakMinutes: 0 });
    expect(result.status).toBe('ready'); expect(result.unscheduledWorkItemIds).toEqual([]);
    expect(result.candidates.map((candidate) => [candidate.startTime, candidate.endTime, candidate.durationMinutes]))
      .toEqual([['09:00', '10:00', 60], ['11:00', '12:00', 60], ['13:00', '14:00', 60]]);
  });

});
