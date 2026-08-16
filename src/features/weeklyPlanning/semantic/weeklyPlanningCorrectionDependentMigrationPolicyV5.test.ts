import { describe, expect, it } from 'vitest';
import {
  activeWeeklyPlanningWorkloadDependentsV5,
  decideWeeklyPlanningWorkloadDependentMigrationV5,
} from './weeklyPlanningCorrectionDependentMigrationPolicyV5';
import {
  applyWeeklyPlanningCorrectionTransactionV5,
} from './weeklyPlanningCorrectionTransactionV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

const source = {
  conversationId: 'conversation-policy',
  turnId: 'turn-1',
  semanticLocalId: 'source',
  sourceText: '英単語220語を金曜まで',
  origin: 'user' as const,
};

function baseGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 3,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [
      {
        id: 'workload-old',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'target',
        amount: 220,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source,
        createdRevision: 1,
      },
      {
        id: 'workload-new',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'target',
        amount: 180,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: { ...source, turnId: 'turn-3', semanticLocalId: 'workload-new' },
        createdRevision: 3,
      },
    ],
    correctionIntents: [{
      id: 'correction-1',
      target: {
        kind: 'workload',
        publicId: 'workload-old',
        factId: 'workload-old',
        mention: '220語',
      },
      operation: 'replace',
      replacementFactId: 'workload-new',
      source: { ...source, turnId: 'turn-3', semanticLocalId: 'correction-1' },
      createdRevision: 3,
    }],
    factLifecycles: [
      ['task-1', 1],
      ['workload-old', 1],
      ['workload-new', 3],
      ['correction-1', 3],
    ].map(([factId, createdRevision]) => ({
      factId: String(factId),
      status: 'active' as const,
      createdRevision: Number(createdRevision),
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

describe('Stable V5 correction dependent migration policy', () => {
  it('carries compatible per-unit effort and invalidates total-duration effort', () => {
    const graph = baseGraph();
    graph.effortEstimates = [
      {
        id: 'effort-per-unit',
        taskId: 'task-1',
        targetFactId: 'workload-old',
        kind: 'duration_per_unit',
        minutes: 5,
        unitCode: 'word',
        precision: 'approximate',
        source,
        createdRevision: 2,
      },
      {
        id: 'effort-total',
        taskId: 'task-1',
        targetFactId: 'workload-old',
        kind: 'total_duration',
        minutes: 120,
        unitCode: null,
        precision: 'approximate',
        source,
        createdRevision: 2,
      },
    ];
    graph.factLifecycles.push(
      {
        factId: 'effort-per-unit',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'effort-total',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
    );

    const dependents = activeWeeklyPlanningWorkloadDependentsV5({
      graph,
      workloadFactId: 'workload-old',
    });
    const target = graph.workloads[0];
    const replacement = graph.workloads[1];

    expect(dependents).toEqual([
      { kind: 'effort_estimate', factId: 'effort-per-unit' },
      { kind: 'effort_estimate', factId: 'effort-total' },
    ]);
    expect(decideWeeklyPlanningWorkloadDependentMigrationV5({
      graph,
      dependent: dependents[0],
      target,
      replacement,
    }).action).toBe('carry');
    expect(decideWeeklyPlanningWorkloadDependentMigrationV5({
      graph,
      dependent: dependents[1],
      target,
      replacement,
    }).action).toBe('invalidate');
  });

  it('fails closed for dependent fact kinds without an approved rebind rule', () => {
    const graph = baseGraph();
    graph.temporalConstraints = [{
      id: 'deadline-1',
      taskId: 'task-1',
      targetFactId: 'workload-old',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: '2026-08-21',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'exact',
      source,
      createdRevision: 2,
    }];
    graph.factLifecycles.push({
      factId: 'deadline-1',
      status: 'active',
      createdRevision: 2,
      terminalRevision: null,
      supersededByFactId: null,
    });

    const dependents = activeWeeklyPlanningWorkloadDependentsV5({
      graph,
      workloadFactId: 'workload-old',
    });
    expect(dependents).toEqual([
      { kind: 'temporal_constraint', factId: 'deadline-1' },
    ]);
    expect(decideWeeklyPlanningWorkloadDependentMigrationV5({
      graph,
      dependent: dependents[0],
      target: graph.workloads[0],
      replacement: graph.workloads[1],
    })).toEqual({
      action: 'reject',
      reason: 'temporal-constraint-rebinding-needs-explicit-semantic-policy',
    });

    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph,
      expectedRevision: 3,
      correctionIntentFactId: 'correction-1',
      operationKey: 'replace-with-dependent-deadline',
    });
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(result.errors).toEqual([
      'workload-dependent-migration-rejected:temporal_constraint:deadline-1:temporal-constraint-rebinding-needs-explicit-semantic-policy',
    ]);
  });

  it('requires an explicit policy decision for recurrence and uncertainty dependencies too', () => {
    const graph = baseGraph();
    graph.recurrences = [{
      id: 'recurrence-1',
      taskId: 'task-1',
      targetFactId: 'workload-old',
      kind: 'daily',
      count: null,
      days: [],
      source,
      createdRevision: 2,
    }];
    graph.uncertainties = [{
      id: 'uncertainty-1',
      targetFactId: 'workload-old',
      field: 'amount',
      reason: 'approximate',
      source,
      createdRevision: 2,
    }];
    graph.factLifecycles.push(
      {
        factId: 'recurrence-1',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'uncertainty-1',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
    );

    expect(activeWeeklyPlanningWorkloadDependentsV5({
      graph,
      workloadFactId: 'workload-old',
    })).toEqual([
      { kind: 'recurrence', factId: 'recurrence-1' },
      { kind: 'uncertainty', factId: 'uncertainty-1' },
    ]);
  });
});
