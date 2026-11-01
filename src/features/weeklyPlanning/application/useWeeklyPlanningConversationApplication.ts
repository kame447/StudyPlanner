import { useWeeklyPlanningApplication } from './useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication } from '../vnext/application/useWeeklyPlanningVNextApplication';
import { resolveWeeklyPlanningConversationCore } from '../vnext/application/weeklyPlanningVNextCoreSwitch';

// Choose once per page lifetime to keep React's hook order fixed. The compile-time env check
// removes the V5 application hook from ordinary builds; the host gate confines comparison
// builds to local development hosts. LocalRuntime integration tests cover both boundaries.
export const useWeeklyPlanningConversationApplication = import.meta.env.VITE_WEEKLY_PLANNING_CORE === 'stable_v5'
  && resolveWeeklyPlanningConversationCore({
    configuredCore: import.meta.env.VITE_WEEKLY_PLANNING_CORE,
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  }) === 'stable_v5'
  ? useWeeklyPlanningApplication : useWeeklyPlanningVNextApplication;
