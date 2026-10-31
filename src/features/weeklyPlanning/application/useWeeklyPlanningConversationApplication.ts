import { useWeeklyPlanningApplication } from './useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication } from '../vnext/application/useWeeklyPlanningVNextApplication';
import { resolveLocalWeeklyPlanningConversationCore, WEEKLY_PLANNING_VNEXT_SWITCH_PARTS } from '../vnext/application/weeklyPlanningVNextCoreSwitch';

// One selection per page lifetime keeps React's hook order fixed. The explicit query choice
// changes at runtime by same-origin navigation/reload, without a second build or shared V5 writes.
// Build kind is independent: the allowance, local host and query gate local production-build E2E too.
const choice = resolveLocalWeeklyPlanningConversationCore({
  allowance: import.meta.env.VITE_ENABLE_WEEKLY_PLANNING_VNEXT,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  search: typeof window === 'undefined' ? '' : window.location.search,
  readyParts: new Set(WEEKLY_PLANNING_VNEXT_SWITCH_PARTS) });
export const useWeeklyPlanningConversationApplication = choice.core === 'vnext'
  ? useWeeklyPlanningVNextApplication : useWeeklyPlanningApplication;
