import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWeeklyPlanningEstimateCalibrationRuntimeV5,
  getWeeklyPlanningEstimateCalibrationRuntimeV5,
  setWeeklyPlanningEstimateCalibrationRuntimeV5,
} from './weeklyPlanningEstimateCalibrationRuntimeV5';

const calibration = {
  version: 'weekly-planning-estimate-calibration-v1' as const,
  multiplier: 1.2,
  observationCount: 3,
  medianRatio: 1.4,
};

afterEach(() => clearWeeklyPlanningEstimateCalibrationRuntimeV5());

describe('Stable V5 estimate calibration runtime snapshot', () => {
  it('isolates snapshots by owner', () => {
    setWeeklyPlanningEstimateCalibrationRuntimeV5({ ownerId: 'owner-a', calibration });
    expect(getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-a')).toEqual(calibration);
    expect(getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-b')).toBeNull();
  });

  it('returns a copy rather than exposing mutable registry state', () => {
    setWeeklyPlanningEstimateCalibrationRuntimeV5({ ownerId: 'owner-a', calibration });
    const first = getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-a');
    if (!first) throw new Error('missing calibration');
    first.multiplier = 1.7;
    expect(getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-a')?.multiplier).toBe(1.2);
  });

  it('clears one owner without touching another', () => {
    setWeeklyPlanningEstimateCalibrationRuntimeV5({ ownerId: 'owner-a', calibration });
    setWeeklyPlanningEstimateCalibrationRuntimeV5({
      ownerId: 'owner-b',
      calibration: { ...calibration, multiplier: 0.9 },
    });
    clearWeeklyPlanningEstimateCalibrationRuntimeV5('owner-a');
    expect(getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-a')).toBeNull();
    expect(getWeeklyPlanningEstimateCalibrationRuntimeV5('owner-b')?.multiplier).toBe(0.9);
  });
});
