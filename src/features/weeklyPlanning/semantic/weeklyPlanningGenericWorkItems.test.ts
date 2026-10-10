import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { validateWeeklyPlanningWorkloadValuesV5 } from './weeklyPlanningQuantitativeValueValidatorV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { projectWeeklyPlanningStatedTimeBudgetGraphV5 } from './weeklyPlanningStatedTimeBudgetProjectionV5';
import { calibrateGenericPlanningWorkItemsV5 } from './weeklyPlanningGenericWorkItemCalibrationV5';

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
  it.each([
    { unitCode: 'custom', unitLabel: 'A4用紙', expected: '問題集 20A4用紙' },
    { unitCode: 'problem', unitLabel: '題', expected: '問題集 20題' },
    { unitCode: 'problem', unitLabel: '２０問', expected: '問題集 20問' },
  ] as const)('preserves custom and clean aliases, canonicalizes numeric standard labels: $unitLabel', ({ unitCode, unitLabel, expected }) => {
    const graph = createGraph();
    Object.assign(graph.workloads.find((fact) => fact.id === 'workload-problems')!, { unitCode, unitLabel });
    graph.effortEstimates.find((fact) => fact.id === 'estimate-problem')!.unitCode = unitCode;
    const before = structuredClone(graph);
    const result = compileGenericPlanningWorkItems(graph);
    expect(result.issues).toEqual([]);
    const item = result.items.find((candidate) => candidate.workloadFactId === 'workload-problems');
    expect(item).toMatchObject({ quantity: { amount: 20, unitCode, unitLabel }, baseEstimatedMinutes: 200, estimatedMinutes: 225 });
    expect(graph).toEqual(before);
    expect(item?.label).toBe(expected);
  });

  it.each([
    { name: 'clock wording echo', id: 'workload-cleaning', amount: 60, unitCode: 'minute', unitLabel: '1時間', label: '掃除 60分', base: 60, allocated: 60 },
    { name: 'clean clock unit', id: 'workload-cleaning', amount: 60, unitCode: 'minute', unitLabel: '分', label: '掃除 60分', base: 60, allocated: 60 },
    { name: 'count wording echo', id: 'workload-problems', amount: 20, unitCode: 'problem', unitLabel: '20問', label: '問題集 20問', base: 200, allocated: 225 },
    { name: 'clean count unit', id: 'workload-problems', amount: 20, unitCode: 'problem', unitLabel: '問', label: '問題集 20問', base: 200, allocated: 225 },
  ] as const)('displays the typed quantity without echoing its free unit label: $name', ({ id, amount, unitCode, unitLabel, label, base, allocated }) => {
    const graph = createGraph();
    const workload = graph.workloads.find((fact) => fact.id === id)!;
    Object.assign(workload, { amount, unitCode, unitLabel });
    const errors: string[] = [];
    validateWeeklyPlanningWorkloadValuesV5({ ...workload }, 'workload', errors);
    expect(errors).toEqual([]);
    const before = structuredClone(graph);
    const result = compileGenericPlanningWorkItems(graph);
    expect(result.issues).toEqual([]);
    const item = result.items.find((candidate) => candidate.workloadFactId === id);
    expect(item).toMatchObject({ quantity: { amount, unitCode, unitLabel },
      baseEstimatedMinutes: base, estimatedMinutes: allocated });
    expect(graph).toEqual(before);
    expect(item?.label).toBe(label);
  });

  it('treats exam_year as one ordinary workload unit and buffers inferred effort', () => {
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
      estimatedMinutes: 270,
      roundingStepMinutes: 15,
    });
    expect(item).not.toHaveProperty('field');
    expect(item).not.toHaveProperty('year');
  });

  it('calculates duration_per_unit with a safety buffer while preserving the raw estimate', () => {
    const result = compileGenericPlanningWorkItems(createGraph());
    const item = result.items.find((candidate) =>
      candidate.workloadFactId === 'workload-problems');

    expect(item).toMatchObject({
      quantity: { amount: 20, unitCode: 'problem' },
      baseEstimatedMinutes: 200,
      estimatedMinutes: 225,
      calibrationMultiplier: 1,
      roundingStepMinutes: 15,
      estimateSourceFactIds: ['estimate-problem'],
    });
  });

  it('derives explicit duration workloads directly without estimate buffering', () => {
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

  it('derives minute work from every agreeing active task total without inventing fact authority', () => {
    const task = createGraph().tasks.find((fact) => fact.id === 'task-cleaning')!;
    const canonical = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2, tasks: [task],
      effortEstimates: ['budget-a', 'budget-b', 'budget-old'].map((id) => ({
        id, taskId: task.id, targetFactId: task.id, kind: 'total_duration' as const,
        minutes: id === 'budget-old' ? 90 : 60, unitCode: null, precision: 'exact' as const,
        source: { ...task.source, semanticLocalId: id }, createdRevision: 1,
      })),
      factLifecycles: [task.id, 'budget-a', 'budget-b', 'budget-old'].map((factId) => ({
        factId, status: factId === 'budget-old' ? 'superseded' as const : 'active' as const,
        createdRevision: 1, terminalRevision: factId === 'budget-old' ? 2 : null,
        supersededByFactId: factId === 'budget-old' ? 'budget-a' : null,
      })),
    };
    const original = structuredClone(canonical);
    const projected = projectWeeklyPlanningStatedTimeBudgetGraphV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(canonical),
    );
    const result = compileGenericPlanningWorkItems(projected);
    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.items).toEqual([expect.objectContaining({
      quantity: expect.objectContaining({ amount: 60, unitCode: 'minute' }),
      estimatedMinutes: 60, baseEstimatedMinutes: 60, estimateBasis: 'intrinsic_duration',
      sourceFactRefs: [task.id, 'budget-a', 'budget-b'],
      estimateSourceFactIds: ['budget-a', 'budget-b'], estimateSourceWorkloadFactIds: [],
    })]);
    expect(calibrateGenericPlanningWorkItemsV5({ items: result.items, calibrationMultiplier: 1.5 }))
      .toEqual(result.items);
    expect(canonical).toEqual(original);
    expect(compileGenericPlanningWorkItems(projectWeeklyPlanningStatedTimeBudgetGraphV5({
      ...createWeeklyPlanningActiveSchedulerGraphViewV5(canonical),
      effortEstimates: [...createWeeklyPlanningActiveSchedulerGraphViewV5(canonical).effortEstimates].reverse(),
    })).items).toEqual(result.items);
    const unschedulableViews = [
      createWeeklyPlanningActiveSchedulerGraphViewV5({ ...canonical,
        factLifecycles: canonical.factLifecycles.map((entry) => entry.factId === task.id
          ? { ...entry, status: 'removed' as const, terminalRevision: 2 } : entry),
      }),
      { ...createWeeklyPlanningActiveSchedulerGraphViewV5(canonical),
        effortEstimates: createWeeklyPlanningActiveSchedulerGraphViewV5(canonical).effortEstimates
          .map((budget) => budget.id === 'budget-b' ? { ...budget, minutes: 90 } : budget),
      },
      { ...createWeeklyPlanningActiveSchedulerGraphViewV5(canonical), temporalConstraints: [{
        id: 'fixed-clock', taskId: task.id, targetFactId: task.id, kind: 'fixed_interval' as const,
        constraintLevel: 'hard' as const, dateExpression: '2026-07-27', namedTimePeriod: null,
        startTime: '18:00', endTime: '19:00', precision: 'exact' as const,
        source: task.source, createdRevision: 1,
      }] },
    ];
    for (const view of unschedulableViews) {
      expect(projectWeeklyPlanningStatedTimeBudgetGraphV5(view).workloads).toEqual([]);
    }

    // Each malformed derivation must fail closed, never relabel or drop its roots.
    const invalidViews = [
      { ...projected, derivedWorkloadSources: [] },
      { ...projected, revision: projected.revision + 1 },
      { ...projected, workloads: projected.workloads.map(({ derivationKind: _kind, ...workload }) => workload) },
      { ...projected, derivedWorkloadSources: [...projected.derivedWorkloadSources!, ...projected.derivedWorkloadSources!] },
      { ...projected, derivedWorkloadSources: projected.derivedWorkloadSources!.map((origin) =>
        ({ ...origin, effortEstimateFactIds: ['budget-a', 'budget-old'] })) },
      { ...projected, derivedWorkloadSources: projected.derivedWorkloadSources!.map((origin) =>
        ({ ...origin, taskId: 'different-task' })) },
    ];
    for (const invalid of invalidViews) {
      const rejected = compileGenericPlanningWorkItems(invalid);
      expect(rejected.items).toEqual([]);
      expect(rejected.issues).toEqual([expect.objectContaining({
        code: 'invalid_derived_workload_source', blocking: true,
      })]);
    }
  });

});
