import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import { renderWeeklyPlanningEffortQuestionV5 } from './weeklyPlanningEffortQuestionRendererV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
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
  quantityRole: WorkloadFactV5['quantityRole'],
  amount: number,
  overrides: Partial<WorkloadFactV5> = {},
): WorkloadFactV5 {
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
): EffortEstimateFactV5 {
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
  workloads?: WorkloadFactV5[];
  estimates?: EffortEstimateFactV5[];
} = {}): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
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
  it('derives a 150-minute pace estimate and allocates 165 minutes with safety buffer', () => {
    const result = compileGenericPlanningWorkItems(graph());
    const remaining = result.items.find((item) => item.workloadFactId === 'remaining-50');

    expect(result.readiness).toBe('ready');
    expect(remaining).toMatchObject({
      baseEstimatedMinutes: 150,
      estimatedMinutes: 165,
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

  it('schedules an explicit target once when the same remaining amount is also retained as context', () => {
    const value = graph({
      workloads: [
        workload('completed-30', 'completed', 30),
        workload('remaining-50', 'remaining', 50),
        workload('target-50', 'target', 50, { periodExpression: '2026-08-17〜2026-08-23' }),
      ],
    });
    const work = compileGenericPlanningWorkItems(value);

    expect(work.readiness).toBe('ready');
    expect(work.items).toHaveLength(1);
    expect(work.items[0]).toMatchObject({
      workloadFactId: 'target-50',
      quantity: { amount: 50, unitCode: 'page' },
      baseEstimatedMinutes: 150,
      estimatedMinutes: 165,
      estimateBasis: 'observed_pace',
      sourceFactRefs: expect.arrayContaining([
        'target-50',
        'remaining-50',
        'completed-30',
        'completed-duration-90',
      ]),
    });
    expect(work.issues).toContainEqual({
      code: 'remaining_workload_skipped_for_target',
      workloadFactId: 'remaining-50',
      blocking: false,
      details: {
        targetWorkloadFactId: 'target-50',
        targetWorkloadCount: 1,
      },
    });

    const scheduler = compileGenericSchedulerInput({
      graph: value,
      context: {
        ownerId: 'owner-pace',
        currentDate: '2026-08-17',
        planningStartDate: '2026-08-17',
        planningEndDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(scheduler.status).toBe('ready');
    expect(scheduler.input?.movableWorkItems.every(
      (item) => item.workloadFactId === 'target-50',
    )).toBe(true);
    expect(scheduler.input?.movableWorkItems.reduce(
      (sum, item) => sum + item.quantity.amount,
      0,
    )).toBe(50);
    expect(scheduler.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(165);
  });

  it('asks once for completed pace when remaining context and an explicit target coexist', () => {
    const value = graph({
      workloads: [
        workload('completed-30', 'completed', 30),
        workload('remaining-50', 'remaining', 50),
        workload('target-50', 'target', 50),
      ],
      estimates: [],
    });
    const work = compileGenericPlanningWorkItems(value);
    expect(work.issues.filter((issue) => issue.code === 'missing_effort_estimate')).toEqual([{
      code: 'missing_effort_estimate',
      workloadFactId: 'target-50',
      questionTargetWorkloadFactId: 'completed-30',
      blocking: true,
      details: {
        estimateForWorkloadFactId: 'target-50',
        questionBasis: 'completed_workload_total',
      },
    }]);
  });

  it('does not suppress remaining work across components or units', () => {
    const value = graph({
      workloads: [
        workload('remaining-pages', 'remaining', 50),
        workload('target-problems', 'target', 20, {
          unitCode: 'problem',
          unitLabel: '問',
        }),
        workload('target-other-component', 'target', 10, {
          componentId: null,
        }),
      ],
      estimates: [],
    });
    const work = compileGenericPlanningWorkItems(value);
    expect(work.items.map((item) => item.workloadFactId)).toEqual([
      'remaining-pages',
      'target-problems',
      'target-other-component',
    ]);
    expect(work.issues).not.toContainEqual(expect.objectContaining({
      code: 'remaining_workload_skipped_for_target',
    }));
  });

  it('asks for the one completed workload total before asking for a direct remaining estimate', () => {
    const value = graph({ estimates: [] });
    const work = compileGenericPlanningWorkItems(value);
    expect(work.issues).toContainEqual({
      code: 'missing_effort_estimate',
      workloadFactId: 'remaining-50',
      questionTargetWorkloadFactId: 'completed-30',
      blocking: true,
      details: {
        estimateForWorkloadFactId: 'remaining-50',
        questionBasis: 'completed_workload_total',
      },
    });

    const scheduler = compileGenericSchedulerInput({
      graph: value,
      context: {
        ownerId: 'owner-pace',
        currentDate: '2026-08-17',
        planningStartDate: '2026-08-17',
        planningEndDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(scheduler.issues).toContainEqual({
      domain: 'work_item',
      code: 'missing_effort_estimate',
      blocking: true,
      factId: 'completed-30',
      details: {
        estimateForWorkloadFactId: 'remaining-50',
        questionBasis: 'completed_workload_total',
      },
    });
    expect(renderWeeklyPlanningEffortQuestionV5({
      graph: value,
      workloadFactId: 'completed-30',
    })).toBe('数学ワークについて、完了した30ページには、合計でどれくらい時間がかかりましたか？');
  });

  it('does not choose completed evidence arbitrarily when more than one candidate exists', () => {
    const value = graph({
      workloads: [
        workload('completed-30', 'completed', 30),
        workload('completed-10', 'completed', 10),
        workload('remaining-50', 'remaining', 50),
      ],
      estimates: [],
    });
    expect(compileGenericPlanningWorkItems(value).issues).toContainEqual({
      code: 'missing_effort_estimate',
      workloadFactId: 'remaining-50',
      blocking: true,
    });
  });

  it('keeps a direct remaining estimate ahead of completed-work pace and buffers it', () => {
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
      baseEstimatedMinutes: 180,
      estimatedMinutes: 210,
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
