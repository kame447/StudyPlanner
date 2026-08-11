import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type EffortEstimateFact,
  type WeeklyPlanningFactGraph,
  type WorkloadFact,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';

const SOURCE = {
  conversationId: 'conversation-pace',
  turnId: 'conversation-pace:request:1',
  semanticLocalId: 'local',
  sourceText: '数学のワーク',
  origin: 'user' as const,
};

function workload(
  id: string,
  quantityRole: WorkloadFact['quantityRole'],
  amount: number,
  overrides: Partial<WorkloadFact> = {},
): WorkloadFact {
  return {
    id,
    taskId: 'task-math',
    componentId: 'component-book',
    quantityRole,
    amount,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: { ...SOURCE, semanticLocalId: id, sourceText: `${amount}ページ` },
    createdRevision: 1,
    ...overrides,
  };
}

function totalDuration(
  id: string,
  targetFactId: string,
  minutes: number,
): EffortEstimateFact {
  return {
    id,
    taskId: 'task-math',
    targetFactId,
    kind: 'total_duration',
    minutes,
    unitCode: null,
    precision: 'approximate',
    source: { ...SOURCE, semanticLocalId: id, sourceText: `${minutes}分かかった` },
    createdRevision: 1,
  };
}

function graph(params: {
  workloads?: WorkloadFact[];
  estimates?: EffortEstimateFact[];
} = {}): WeeklyPlanningFactGraph {
  return {
    ...createEmptyWeeklyPlanningFactGraph(),
    revision: 1,
    tasks: [{
      id: 'task-math',
      category: 'study',
      title: '数学ワーク',
      source: { ...SOURCE, semanticLocalId: 'task-math' },
      createdRevision: 1,
    }],
    components: [{
      id: 'component-book',
      taskId: 'task-math',
      parentComponentId: null,
      role: 'material',
      label: '数学ワーク',
      source: { ...SOURCE, semanticLocalId: 'component-book' },
      createdRevision: 1,
    }],
    workloads: params.workloads ?? [
      workload('completed-30', 'completed', 30),
      workload('remaining-50', 'remaining', 50),
    ],
    effortEstimates: params.estimates ?? [
      totalDuration('completed-duration-90', 'completed-30', 90),
    ],
  };
}

describe('generic work item observed pace estimation', () => {
  it('derives 150 minutes for remaining 50 pages from 30 pages completed in 90 minutes', () => {
    const result = compileGenericPlanningWorkItems(graph());
    const remaining = result.items.find((item) => item.workloadFactId === 'remaining-50');

    expect(result.readiness).toBe('ready');
    expect(remaining).toMatchObject({
      estimatedMinutes: 150,
      estimateBasis: 'observed_pace',
      estimateSourceFactIds: ['completed-duration-90'],
      estimateSourceWorkloadFactIds: ['completed-30'],
      sourceFactRefs: expect.arrayContaining([
        'remaining-50',
        'completed-30',
        'completed-duration-90',
      ]),
    });
  });

  it('keeps a direct remaining estimate ahead of completed-work pace', () => {
    const value = graph({
      estimates: [
        totalDuration('completed-duration-90', 'completed-30', 90),
        totalDuration('remaining-direct-180', 'remaining-50', 180),
      ],
    });
    const remaining = compileGenericPlanningWorkItems(value).items.find(
      (item) => item.workloadFactId === 'remaining-50',
    );

    expect(remaining).toMatchObject({
      estimatedMinutes: 180,
      estimateBasis: 'direct_effort',
      estimateSourceFactIds: ['remaining-direct-180'],
      estimateSourceWorkloadFactIds: [],
    });
  });

  it('does not transfer pace across components or units', () => {
    const componentMismatch = graph({
      workloads: [
        workload('completed-30', 'completed', 30, { componentId: null }),
        workload('remaining-50', 'remaining', 50),
      ],
    });
    const unitMismatch = graph({
      workloads: [
        workload('completed-30', 'completed', 30, {
          unitCode: 'problem',
          unitLabel: '問',
        }),
        workload('remaining-50', 'remaining', 50),
      ],
    });

    for (const value of [componentMismatch, unitMismatch]) {
      const result = compileGenericPlanningWorkItems(value);
      const remaining = result.items.find((item) => item.workloadFactId === 'remaining-50');
      expect(remaining?.estimatedMinutes).toBeNull();
      expect(result.issues).toContainEqual({
        code: 'missing_effort_estimate',
        workloadFactId: 'remaining-50',
        blocking: true,
      });
    }
  });

  it('blocks instead of choosing arbitrarily when multiple completed pace observations apply', () => {
    const value = graph({
      workloads: [
        workload('completed-30', 'completed', 30),
        workload('completed-10', 'completed', 10),
        workload('remaining-50', 'remaining', 50),
      ],
      estimates: [
        totalDuration('completed-duration-90', 'completed-30', 90),
        totalDuration('completed-duration-20', 'completed-10', 20),
      ],
    });
    const result = compileGenericPlanningWorkItems(value);
    const remaining = result.items.find((item) => item.workloadFactId === 'remaining-50');

    expect(remaining?.estimatedMinutes).toBeNull();
    expect(remaining?.estimateSourceWorkloadFactIds).toEqual([
      'completed-30',
      'completed-10',
    ]);
    expect(result.issues).toContainEqual({
      code: 'ambiguous_effort_estimate',
      workloadFactId: 'remaining-50',
      blocking: true,
      details: { matchingEstimateCount: 2 },
    });
  });
});
