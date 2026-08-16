import type { Actual, Plan } from '../../../types/domain';
import {
  collectWeeklyPlanningMemoryPaceObservationsV5,
  deriveWeeklyPlanningMemoryPaceEstimateV5,
  type WeeklyPlanningMemoryPaceEstimateV5,
} from './weeklyPlanningMemoryPaceObservationsV5';

const runtimeProfiles = new Map<string, Map<string, WeeklyPlanningMemoryPaceEstimateV5>>();

export function setWeeklyPlanningMemoryPaceRuntimeV5(params: {
  ownerId: string;
  plans: readonly Plan[];
  actuals: readonly Actual[];
}): void {
  const ownerId = params.ownerId.trim();
  if (!ownerId) return;
  const unitCodes = new Set(
    collectWeeklyPlanningMemoryPaceObservationsV5({
      plans: params.plans,
      actuals: params.actuals,
    }).map((observation) => observation.unitCode),
  );
  const profile = new Map<string, WeeklyPlanningMemoryPaceEstimateV5>();
  unitCodes.forEach((unitCode) => {
    const estimate = deriveWeeklyPlanningMemoryPaceEstimateV5({
      plans: params.plans,
      actuals: params.actuals,
      unitCode,
    });
    if (
      estimate.observationCount > 0
      && estimate.medianMinutesPerUnit !== null
      && Number.isFinite(estimate.medianMinutesPerUnit)
      && estimate.medianMinutesPerUnit > 0
    ) {
      profile.set(unitCode, estimate);
    }
  });
  runtimeProfiles.set(ownerId, profile);
}

export function getWeeklyPlanningMemoryPaceRuntimeV5(
  ownerId: string,
  unitCode: string,
): WeeklyPlanningMemoryPaceEstimateV5 | null {
  return runtimeProfiles.get(ownerId.trim())?.get(unitCode) ?? null;
}

export function clearWeeklyPlanningMemoryPaceRuntimeV5(ownerId: string): void {
  runtimeProfiles.delete(ownerId.trim());
}
