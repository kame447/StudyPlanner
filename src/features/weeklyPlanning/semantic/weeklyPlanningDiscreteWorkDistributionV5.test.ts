import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { distributeGenericSchedulerWorkItemsV5, resolveGenericSchedulerWorkDistributionV5 } from './weeklyPlanningSchedulerWorkDistributionV5';
import { calibrateGenericPlanningWorkItemsV5 } from './weeklyPlanningGenericWorkItemCalibrationV5';

const WEEK_START = '2026-08-17';
const WEEK_END = '2026-08-23';

function graphForDiscreteWork(params: {
  amount: number;
  unitCode: 'problem' | 'page';
  unitLabel: string;
  minutesPerUnit: number;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  const source = {
    conversationId: 'conversation-discrete-work',
    turnId: 'turn-1',
    semanticLocalId: 'discrete-work',
    sourceText: `数学${params.amount}${params.unitLabel}`,
    origin: 'user' as const,
  };
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-math',
      category: 'study',
      title: '数学',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-math',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'target',
      amount: params.amount,
      unitCode: params.unitCode,
      unitLabel: params.unitLabel,
      rangeStart: params.rangeStart ?? null,
      rangeEnd: params.rangeEnd ?? null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'estimate-math',
      taskId: 'task-math',
      targetFactId: 'workload-math',
      kind: 'duration_per_unit',
      minutes: params.minutesPerUnit,
      unitCode: params.unitCode,
      precision: 'approximate',
      source,
      createdRevision: 1,
    }],
  };
}

function compileAndDistribute(graph: WeeklyPlanningFactGraph) {
  const compiled = compileGenericPlanningWorkItems(graph);
  const distributed = distributeGenericSchedulerWorkItemsV5({
    graph,
    items: compiled.items,
    startDate: WEEK_START,
    endDate: WEEK_END,
  });
  return { compiled, distributed };
}

describe('quantity-preserving discrete work distribution', () => {
  it('keeps the raw estimate while distributing the safety-buffered allocation', () => {
    const { compiled, distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 8,
    }));

    expect(compiled.readiness).toBe('ready');
    expect(compiled.issues).toEqual([]);
    expect(compiled.items).toHaveLength(1);
    expect(compiled.items[0]).toMatchObject({
      quantity: { amount: 40, unitCode: 'problem' },
      baseEstimatedMinutes: 320,
      estimatedMinutes: 360,
    });

    expect(distributed).toHaveLength(6);
    expect(distributed.map((item) => item.quantity.amount)).toEqual([7, 7, 7, 7, 6, 6]);
    expect(distributed.map((item) => item.estimatedMinutes)).toEqual([60, 60, 60, 60, 60, 60]);
    expect(distributed.map((item) => item.label)).toEqual([
      '数学 7問（1〜7問）',
      '数学 7問（8〜14問）',
      '数学 7問（15〜21問）',
      '数学 7問（22〜28問）',
      '数学 6問（29〜34問）',
      '数学 6問（35〜40問）',
    ]);
    expect(distributed.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(distributed.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(360);
    expect(distributed.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(new Set(distributed.map((item) => item.id)).size).toBe(6);
  });

  it('preserves an explicit numeric page range across however many buffered slices are needed', () => {
    const { distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 40,
      unitCode: 'page',
      unitLabel: 'ページ',
      minutesPerUnit: 4,
      rangeStart: '21',
      rangeEnd: '60',
    }));

    expect(distributed.map((item) => item.quantity.actualRange)).toEqual([
      { start: '21', end: '34' },
      { start: '35', end: '47' },
      { start: '48', end: '60' },
    ]);
    expect(distributed.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(distributed.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(180);
  });

  it('does not fake-split one extremely long discrete unit into repeated copies', () => {
    const { compiled, distributed } = compileAndDistribute(graphForDiscreteWork({
      amount: 1,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 320,
    }));

    expect(compiled.items).toHaveLength(1);
    expect(distributed).toHaveLength(1);
    expect(distributed[0]).toMatchObject({
      label: '数学 1問',
      baseEstimatedMinutes: 320,
      estimatedMinutes: 360,
      quantity: {
        amount: 1,
        ordinalRange: { start: 1, end: 1 },
      },
    });
  });

  it('uses the actual horizon length instead of hard-coding a weekly split count', () => {
    const graph = graphForDiscreteWork({
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      minutesPerUnit: 8,
    });
    const compiled = compileGenericPlanningWorkItems(graph);
    const distributed = distributeGenericSchedulerWorkItemsV5({
      graph,
      items: compiled.items,
      startDate: '2026-08-17',
      endDate: '2026-08-18',
    });

    expect(distributed.map((item) => item.quantity.amount)).toEqual([20, 20]);
    expect(distributed.map((item) => item.estimatedMinutes)).toEqual([180, 180]);
    expect(distributed.map((item) => item.label)).toEqual([
      '数学 20問（1〜20問）',
      '数学 20問（21〜40問）',
    ]);
  });
  it.each([512, 513])('uses actual whole-unit partitions at the internal %d generation boundary', (amount) => {
    const graph = graphForDiscreteWork({ amount, unitCode: 'problem', unitLabel: '問', minutesPerUnit: 1 });
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: 1, unitCode: 'session' });
    const before = structuredClone(graph);
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items: compileGenericPlanningWorkItems(graph).items,
      startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    if (amount === 512) {
      expect(result.status).toBe('ready'); expect(result.issues).toEqual([]);
      expect(result.items).toHaveLength(512);
      expect(result.items.every((item) => item.quantity.amount === 1 && item.estimatedMinutes === 1 && item.baseEstimatedMinutes === 1)).toBe(true);
      expect(new Set(result.items.map((item) => item.id)).size).toBe(512);
      expect(result.items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(amount);
    } else {
      expect(result).toMatchObject({ status: 'needs_resolution', items: [], issues: [{
        code: 'session_partition_unfulfillable', factId: 'cap',
        details: { reason: 'generation_limit', requiredSessionCount: 513, sessionMinuteLimit: 1 },
      }] });
    }
    expect(graph).toEqual(before);
  });

  it.each([
    { name: 'single indivisible problem', unitCode: 'problem' as const, amount: 1, pace: 31, cap: 30, reason: 'indivisible_unit_exceeds_cap' },
    { name: 'atomic mock exam', unitCode: 'mock_exam' as const, amount: 2, pace: 20, cap: 30, reason: 'indivisible_unit_exceeds_cap' },
    { name: 'unknown custom units', unitCode: 'custom' as const, amount: 2, pace: 20, cap: 30, reason: 'unsupported_quantity_partition' },
    { name: 'subminute bound', unitCode: 'problem' as const, amount: 20, pace: 3, cap: 0.5, reason: 'cap_below_clock_precision' },
  ])('refuses $name without cutting work or exposing an uncapped fallback', ({ unitCode, amount, pace, cap, reason }) => {
    const graph = graphForDiscreteWork({ amount, unitCode: 'problem', unitLabel: '個', minutesPerUnit: pace });
    graph.workloads[0].unitCode = unitCode; graph.effortEstimates[0].unitCode = unitCode;
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: cap, unitCode: 'session' });
    const before = structuredClone(graph);
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items: compileGenericPlanningWorkItems(graph).items,
      startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    expect(result).toMatchObject({ status: 'needs_resolution', items: [], issues: [{
      code: 'session_partition_unfulfillable', factId: 'cap', details: { reason, requestedSessionMinutes: cap },
    }] });
    expect(graph).toEqual(before);
  });

  it.each([30, 60])('preserves unresolved multiple scoped caps even when the second value is %d', (second) => {
    const graph = graphForDiscreteWork({ amount: 20, unitCode: 'problem', unitLabel: '問', minutesPerUnit: 3 });
    graph.effortEstimates.push(...[30, second].map((minutes, index) => ({
      ...graph.effortEstimates[0], id: `cap-${index}`, kind: 'session_duration' as const, minutes, unitCode: 'session' as const,
    })));
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items: compileGenericPlanningWorkItems(graph).items,
      startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    expect(result).toMatchObject({ status: 'needs_resolution', items: [], issues: [{
      code: 'session_partition_unfulfillable', factId: 'workload-math',
      matchingSessionDurationFactIds: ['cap-0', 'cap-1'],
      details: { reason: 'ambiguous_session_duration', matchingEstimateCount: 2, sessionDurationFactId: null, sessionDurationScopeFactId: 'workload-math' },
    }] });
  });

  it.each([
    { multiplier: 0.5, quantities: [20], durations: [30], calibrated: 30 },
    { multiplier: 1.5, quantities: [5, 5, 5, 5], durations: [25, 25, 25, 25], calibrated: 90 },
  ])('applies calibration $multiplier once while preserving uncalibrated base', ({ multiplier, quantities, durations, calibrated }) => {
    const graph = graphForDiscreteWork({ amount: 20, unitCode: 'problem', unitLabel: '問', minutesPerUnit: 3, rangeStart: '21', rangeEnd: '40' });
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: 30, unitCode: 'session' });
    const items = calibrateGenericPlanningWorkItemsV5({ items: compileGenericPlanningWorkItems(graph).items, calibrationMultiplier: multiplier });
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items, startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    expect(result.status).toBe('ready');
    expect(result.items.map((item) => item.quantity.amount)).toEqual(quantities);
    expect(result.items.map((item) => item.estimatedMinutes)).toEqual(durations);
    expect(result.items.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)).toBe(60);
    expect(result.items.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0) * multiplier, 0)).toBe(calibrated);
    result.items.forEach((item) => {
      expect(item.estimatedMinutes).toBeGreaterThanOrEqual((item.baseEstimatedMinutes ?? 0) * multiplier);
      expect(item.estimatedMinutes).toBeLessThanOrEqual(30);
      expect(item.sourceFactRefs).toContain('cap');
    });
    expect(result.items[0].quantity.actualRange?.start).toBe('21');
    expect(result.items[result.items.length - 1].quantity.actualRange?.end).toBe('40');
  });

  it('rejects contradictory compiled cost instead of silently inflating it to the cap', () => {
    const graph = graphForDiscreteWork({ amount: 2, unitCode: 'problem', unitLabel: '問', minutesPerUnit: 10 });
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: 50, unitCode: 'session' });
    const items = compileGenericPlanningWorkItems(graph).items.map((item) => ({ ...item, calibrationMultiplier: 2 }));
    const before = structuredClone(items);
    expect(items[0].baseEstimatedMinutes).toBe(20); expect(items[0].estimatedMinutes).toBe(25);
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items, startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    expect(result).toMatchObject({ status: 'needs_resolution', items: [], issues: [{
      code: 'session_partition_unfulfillable', details: { reason: 'unsafe_partition_arithmetic' },
    }] });
    expect(items).toEqual(before);
  });

  it('groups each supported whole content unit without changing its quantity or base', () => {
    for (const unitCode of ['page', 'problem', 'word', 'lesson', 'chapter', 'section', 'exam_year'] as const) {
      const graph = graphForDiscreteWork({ amount: 20, unitCode: 'problem', unitLabel: '単位', minutesPerUnit: 3 });
      graph.workloads[0].unitCode = unitCode; graph.effortEstimates[0].unitCode = unitCode;
      graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: 30, unitCode: 'session' });
      const result = resolveGenericSchedulerWorkDistributionV5({
        graph, items: compileGenericPlanningWorkItems(graph).items,
        startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
      });
      expect(result.status, unitCode).toBe('ready');
      expect(result.items.map((item) => [item.quantity.unitCode, item.quantity.amount, item.baseEstimatedMinutes, item.estimatedMinutes]), unitCode)
        .toEqual([[unitCode, 10, 30, 30], [unitCode, 10, 30, 30]]);
    }
  });

  it.each([
    { unitCode: 'problem' as const, amount: 5, pace: 3, base: 15, duration: 20 },
    { unitCode: 'mock_exam' as const, amount: 1, pace: 20, base: 20, duration: 25 },
  ])('keeps a whole $unitCode item below the cap without filling unused time', ({ unitCode, amount, pace, base, duration }) => {
    const graph = graphForDiscreteWork({ amount, unitCode: 'problem', unitLabel: '単位', minutesPerUnit: pace });
    graph.workloads[0].unitCode = unitCode; graph.effortEstimates[0].unitCode = unitCode;
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'cap', kind: 'session_duration', minutes: 30, unitCode: 'session' });
    const result = resolveGenericSchedulerWorkDistributionV5({
      graph, items: compileGenericPlanningWorkItems(graph).items,
      startDate: WEEK_START, endDate: WEEK_END, sessionDurationEstimates: graph.effortEstimates,
    });
    expect(result.status).toBe('ready'); expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ quantity: { amount, unitCode }, baseEstimatedMinutes: base, estimatedMinutes: duration, splitPolicy: 'atomic' });
    expect(result.items[0].sourceFactRefs).toContain('cap');
  });

});
