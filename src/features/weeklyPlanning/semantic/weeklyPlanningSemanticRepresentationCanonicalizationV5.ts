import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  normalizePlanningWindowCanonicalV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  normalizeWeeklyPlanningTemporalClockEncodingV5,
} from './weeklyPlanningTemporalClockEncodingV5';
import {
  normalizeWeeklyPlanningWeekdayEncodingV5,
} from './weeklyPlanningWeekdayEncodingV5';

export interface WeeklyPlanningSemanticRepresentationCanonicalizationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

export function canonicalizeWeeklyPlanningSemanticRepresentationV5(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticRepresentationCanonicalizationResultV5 {
  const planningWindow = normalizePlanningWindowCanonicalV5(document.planningWindow);
  const withPlanningWindow = planningWindow.window === document.planningWindow
    ? document
    : { ...document, planningWindow: planningWindow.window };
  const weekday = normalizeWeeklyPlanningWeekdayEncodingV5(withPlanningWindow);
  const temporalClock = normalizeWeeklyPlanningTemporalClockEncodingV5(weekday.document);

  return {
    document: temporalClock.document,
    repairs: [
      ...planningWindow.repairs,
      ...weekday.repairs,
      ...temporalClock.repairs,
    ],
  };
}
