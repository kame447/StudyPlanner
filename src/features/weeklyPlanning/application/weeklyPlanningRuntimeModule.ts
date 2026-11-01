import { createWeeklyPlanningRuntimeLoader } from './weeklyPlanningRuntimeLoader';
export { WeeklyPlanningRuntimeModuleError, createWeeklyPlanningRuntimeLoader } from './weeklyPlanningRuntimeLoader';

// Only code loading is shared/retryable. Never retry execution, OCR, or provider calls here.
export const loadWeeklyPlanningRuntimeModule = createWeeklyPlanningRuntimeLoader(
  () => import('./weeklyPlanningStableV5InstrumentedRuntimeExecutor'),
);
