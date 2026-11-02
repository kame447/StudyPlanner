import { createWeeklyPlanningRuntimeLoader } from '../../application/weeklyPlanningRuntimeLoader';

// Only code loading is shared/retryable. Never retry a turn, provider call or persistence here.
export const loadWeeklyPlanningVNextRuntimeModule = createWeeklyPlanningRuntimeLoader(
  () => import('./weeklyPlanningVNextRuntimeModule'),
);
