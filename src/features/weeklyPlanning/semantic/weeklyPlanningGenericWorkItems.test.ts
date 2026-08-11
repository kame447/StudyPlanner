import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';

function createGraph(): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  return {
    ...graph,
    revision: 1,
    tasks: [
      {
        id: 'task-exam',
        category: 'study',
        title: '大学院入試の過去問',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'task-exam',
          sourceText: '院試の過去問',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'task-bookkeeping',
        category: 'study',
        title: '簿記の問題集',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'task-bookkeeping',
          sourceText: '簿記の問題集',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'task-cleaning',
        category: 'non_study',
        title: '掃除',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'task-cleaning',
          sourceText: '掃除を1時間',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    components: [
      {
        id: 'component-os',
        taskId: 'task-exam',
        parentComponentId: null,
        role: 'field',
        label: 'OSとネットワーク',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'component-os',
          sourceText: 'OSとネットワーク',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'component-book',
        taskId: 'task-bookkeeping',
        parentComponentId: null,
        role: 'material',
        label: '問題集',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'component-book',
          sourceText: '問題集',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-exam-years',
        taskId: 'task-exam',
        componentId: 'component-os',
        quantityRole: 'target',
        amount: 2,
        unitCode: 'exam_year',
        unitLabel: '年分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'workload-exam-years',
          sourceText: '2年分',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'workload-problems',
        taskId: 'task-bookkeeping',
        componentId: 'component-book',
        quantityRole: 'target',
        amount: 20,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'workload-problems',
          sourceText: '20問',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'workload-cleaning',
        taskId: 'task-cleaning',
        componentId: null,
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'workload-cleaning',
          sourceText: '掃除を1時間',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    effortEstimates: [
      {
        id: 'estimate-exam-year',
        taskId: 'task-exam',
        targetFactId: 'component-os',
        kind: 'duration_per_unit',
        minutes: 120,
        unitCode: 'exam_year',
        precision: 'approximate',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'estimate-exam-year',
          sourceText: '1年分2時間',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'estimate-problem',
        taskId: 'task-bookkeeping',
        targetFactId: 'component-book',
        kind: 'duration_per_unit',
        minutes: 10,
        unitCode: 'problem',
        precision: 'approximate',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'estimate-problem',
          sourceText: '1問10分',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
  };
}

describe('generic weekly planning work item compiler', () => {
  it('treats exam_year as one ordinary workload unit', () => {
    const result = compileGenericPlanningWorkItems(createGraph());
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-exam-years');

    expect(item).toMatchObject({
      taskId: 'task-exam',
      componentId: 'component-os',
      quantity: {
        amount: 2,
        unitCode: 'exam_year',
        ordinalRange: { start: 1, end: 2 },
        actualRange: null,
      },
      baseEstimatedMinutes: 240,
      estimatedMinutes: 240,
      roundingStepMinutes: 15,
    });
    expect(item).not.toHaveProperty('field');
    expect(item).not.toHaveProperty('year');
  });

  it('calculates duration_per_unit without confusing base estimate and calendar allocation', () => {
    const result = compileGenericPlanningWorkItems(createGraph());
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-problems');

    expect(item).toMatchObject({
      quantity: { amount: 20, unitCode: 'problem' },
      baseEstimatedMinutes: 200,
      estimatedMinutes: 210,
      calibrationMultiplier: 1,
      roundingStepMinutes: 15,
      estimateSourceFactIds: ['estimate-problem'],
    });
  });

  it('derives duration directly from time workloads', () => {
    const result = compileGenericPlanningWorkItems(createGraph());
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-cleaning');

    expect(item).toMatchObject({
      quantity: { amount: 1, unitCode: 'hour' },
      baseEstimatedMinutes: 60,
      estimatedMinutes: 60,
      calibrationMultiplier: 1,
      roundingStepMinutes: 5,
      splitPolicy: 'splittable',
    });
  });

  it('does not invent an estimate when no evidence exists', () => {
    const graph = createGraph();
    graph.effortEstimates = graph.effortEstimates.filter((fact) =>
      fact.id !== 'estimate-exam-year');

    const result = compileGenericPlanningWorkItems(graph);
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-exam-years');

    expect(item?.estimatedMinutes).toBeNull();
    expect(item?.baseEstimatedMinutes).toBeNull();
    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toContainEqual({
      code: 'missing_effort_estimate',
      workloadFactId: 'workload-exam-years',
      blocking: true,
    });
  });

  it('keeps declared quantity but blocks scheduling until its role is resolved', () => {
    const graph = createGraph();
    graph.workloads[0].quantityRole = 'declared';

    const result = compileGenericPlanningWorkItems(graph);
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-exam-years');

    expect(item).toMatchObject({
      quantityRole: 'declared',
      actionability: 'needs_resolution',
    });
    expect(result.issues).toContainEqual({
      code: 'quantity_role_unresolved',
      workloadFactId: 'workload-exam-years',
      blocking: true,
      details: { quantityRole: 'declared' },
    });
  });

  it('preserves explicit actual ranges separately from ordinal count', () => {
    const graph = createGraph();
    graph.workloads[0].amount = 3;
    graph.workloads[0].rangeStart = '2023';
    graph.workloads[0].rangeEnd = '2025';

    const result = compileGenericPlanningWorkItems(graph);
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-exam-years');

    expect(item?.quantity).toMatchObject({
      amount: 3,
      ordinalRange: { start: 1, end: 3 },
      actualRange: { start: '2023', end: '2025' },
    });
  });

  it('skips completed workload without blocking remaining items', () => {
    const graph = createGraph();
    graph.workloads[1].quantityRole = 'completed';

    const result = compileGenericPlanningWorkItems(graph);

    expect(result.items.some((item) => item.workloadFactId === 'workload-problems'))
      .toBe(false);
    expect(result.issues).toContainEqual({
      code: 'completed_workload_skipped',
      workloadFactId: 'workload-problems',
      blocking: false,
    });
  });

  it('rejects fractional discrete units instead of silently rounding', () => {
    const graph = createGraph();
    graph.workloads[1].amount = 2.5;

    const result = compileGenericPlanningWorkItems(graph);

    expect(result.issues).toContainEqual({
      code: 'non_integral_discrete_amount',
      workloadFactId: 'workload-problems',
      blocking: true,
      details: { amount: 2.5, unitCode: 'problem' },
    });
  });

  it('returns deterministic work item IDs', () => {
    const first = compileGenericPlanningWorkItems(createGraph());
    const second = compileGenericPlanningWorkItems(createGraph());

    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
  });
});
