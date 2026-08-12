import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  clearWeeklyPlanningEstimateCalibrationRuntimeV5,
  setWeeklyPlanningEstimateCalibrationRuntimeV5,
} from '../personalization/weeklyPlanningEstimateCalibrationRuntimeV5';

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

afterEach(() => clearWeeklyPlanningEstimateCalibrationRuntimeV5());

describe('actual-backed calibration → scheduler input integration', () => {
  it('uses the owner-scoped multiplier before page/problem weekly distribution', () => {
    setWeeklyPlanningEstimateCalibrationRuntimeV5({
      ownerId: context.ownerId,
      calibration: {
        version: 'weekly-planning-estimate-calibration-v1',
        multiplier: 1.2,
        observationCount: 4,
        medianRatio: 1.5,
      },
    });
    const result = compileGenericSchedulerInput({ graph: graph(), context });
    expect(result.status).toBe('ready');
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(240);
    expect(result.input?.movableWorkItems.every(
      (item) => item.calibrationMultiplier === 1.2,
    )).toBe(true);
  });

  it('never leaks one owner calibration into another owner scheduler input', () => {
    setWeeklyPlanningEstimateCalibrationRuntimeV5({
      ownerId: 'owner-a',
      calibration: {
        version: 'weekly-planning-estimate-calibration-v1',
        multiplier: 1.5,
        observationCount: 2,
        medianRatio: 1.7,
      },
    });
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: { ...context, ownerId: 'owner-b' },
    });
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(210);
  });
});
