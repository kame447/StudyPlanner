import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

const source = {
  conversationId: 'conversation-calibration-integration',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: '数学20問、1問10分',
  origin: 'user' as const,
};

function graph(): WeeklyPlanningFactGraphV5 {
  const value = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...value,
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
      amount: 20,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
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
      minutes: 10,
      unitCode: 'problem',
      precision: 'approximate',
      source,
      createdRevision: 1,
    }],
  };
}

const context = {
  ownerId: 'owner-calibration',
  currentDate: '2026-08-12',
  planningStartDate: '2026-08-17',
  planningEndDate: '2026-08-23',
  timeZone: 'Asia/Tokyo',
};

describe('actual-backed calibration → scheduler input integration', () => {
  it('applies an explicit turn-scoped multiplier before the common safety margin', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context,
      estimateCalibrationMultiplier: 1.2,
    });
    expect(result.status).toBe('ready');
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(270);
    expect(result.input?.movableWorkItems.every(
      (item) => item.calibrationMultiplier === 1.2,
    )).toBe(true);
  });

  it('does not inherit calibration when the current turn supplies none', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: { ...context, ownerId: 'owner-b' },
    });
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(225);
    expect(result.input?.movableWorkItems.every(
      (item) => item.calibrationMultiplier === 1,
    )).toBe(true);
  });
});
