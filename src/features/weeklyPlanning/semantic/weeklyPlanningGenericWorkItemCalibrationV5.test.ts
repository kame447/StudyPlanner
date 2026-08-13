import { describe, expect, it } from 'vitest';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { calibrateGenericPlanningWorkItemsV5 } from './weeklyPlanningGenericWorkItemCalibrationV5';

function item(params: {
  basis: GenericPlanningWorkItem['estimateBasis'];
  base: number;
  allocated: number;
}): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: 'item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: 'workload-1',
    label: '数学 20問',
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 20,
      unitCode: 'problem',
      unitLabel: '問',
      ordinalRange: { start: 1, end: 20 },
      actualRange: null,
    },
    estimatedMinutes: params.allocated,
    baseEstimatedMinutes: params.base,
    calibrationMultiplier: 1,
    roundingStepMinutes: 15,
    estimateBasis: params.basis,
    estimateSourceFactIds: ['estimate-1'],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'unknown',
    periodExpression: null,
    sourceFactRefs: ['task-1', 'workload-1', 'estimate-1'],
  };
}

describe('Stable V5 generic work-item estimate calibration', () => {
  it('reallocates inferred effort using the trusted actual-derived multiplier', () => {
    const [result] = calibrateGenericPlanningWorkItemsV5({
      items: [item({ basis: 'direct_effort', base: 200, allocated: 210 })],
      calibrationMultiplier: 1.2,
    });
    expect(result).toMatchObject({
      baseEstimatedMinutes: 200,
      calibrationMultiplier: 1.2,
      roundingStepMinutes: 15,
      estimatedMinutes: 240,
    });
  });

  it('also calibrates observed pace because it is an estimate rather than a user-fixed duration', () => {
    const [result] = calibrateGenericPlanningWorkItemsV5({
      items: [item({ basis: 'observed_pace', base: 150, allocated: 150 })],
      calibrationMultiplier: 0.8,
    });
    expect(result.estimatedMinutes).toBe(120);
  });

  it('never changes intrinsic time workloads such as “study for one hour”', () => {
    const source = item({ basis: 'intrinsic_duration', base: 60, allocated: 60 });
    const [result] = calibrateGenericPlanningWorkItemsV5({
      items: [source],
      calibrationMultiplier: 1.5,
    });
    expect(result).toMatchObject({
      estimatedMinutes: 60,
      baseEstimatedMinutes: 60,
      calibrationMultiplier: 1,
    });
  });

  it.each([undefined, null, 1, 0, -1, Number.NaN])(
    'is a no-op for unusable or neutral multiplier %s',
    (multiplier) => {
      const source = item({ basis: 'direct_effort', base: 200, allocated: 210 });
      const [result] = calibrateGenericPlanningWorkItemsV5({
        items: [source],
        calibrationMultiplier: multiplier,
      });
      expect(result).toEqual(source);
    },
  );
});
