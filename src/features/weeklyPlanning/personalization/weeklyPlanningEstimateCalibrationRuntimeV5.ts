import type {
  WeeklyPlanningEstimateCalibration,
} from './weeklyPlanningEstimateCalibration';

const calibrationByOwner = new Map<string, WeeklyPlanningEstimateCalibration>();

function normalizedOwnerId(ownerId: string): string | null {
  const value = ownerId.trim();
  return value.length > 0 ? value : null;
}

export function setWeeklyPlanningEstimateCalibrationRuntimeV5(params: {
  ownerId: string;
  calibration: WeeklyPlanningEstimateCalibration;
}): void {
  const ownerId = normalizedOwnerId(params.ownerId);
  if (!ownerId) return;
  calibrationByOwner.set(ownerId, {
    ...params.calibration,
  });
}

export function getWeeklyPlanningEstimateCalibrationRuntimeV5(
  ownerId: string,
): WeeklyPlanningEstimateCalibration | null {
  const normalized = normalizedOwnerId(ownerId);
  if (!normalized) return null;
  const value = calibrationByOwner.get(normalized);
  return value ? { ...value } : null;
}

export function clearWeeklyPlanningEstimateCalibrationRuntimeV5(
  ownerId?: string,
): void {
  if (ownerId === undefined) {
    calibrationByOwner.clear();
    return;
  }
  const normalized = normalizedOwnerId(ownerId);
  if (normalized) calibrationByOwner.delete(normalized);
}
