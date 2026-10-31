import { useWeeklyPlanningApplication } from './useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication } from '../vnext/application/useWeeklyPlanningVNextApplication';
import { resolveLocalWeeklyPlanningConversationCore, WEEKLY_PLANNING_VNEXT_SWITCH_PARTS } from '../vnext/application/weeklyPlanningVNextCoreSwitch';

// One selection per page lifetime keeps React's hook order fixed. The explicit query choice
// changes at runtime by same-origin navigation/reload, without a second build or shared V5 writes.
// Build kind is independent: the allowance, local host and query gate local production-build E2E too.
// Keep this compile-time check ahead of every VNext reference: ordinary builds must remove
// the entire experimental runtime, not just disable its UI. LocalRuntime tests guard selection;
// the normal build's unchanged bundle-budget gate guards the shipped bytes.
const allowed = import.meta.env.VITE_ENABLE_WEEKLY_PLANNING_VNEXT === 'true';
export const useWeeklyPlanningConversationApplication = allowed && resolveLocalWeeklyPlanningConversationCore({
  allowance: import.meta.env.VITE_ENABLE_WEEKLY_PLANNING_VNEXT,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  search: typeof window === 'undefined' ? '' : window.location.search,
  readyParts: new Set(WEEKLY_PLANNING_VNEXT_SWITCH_PARTS) }).core === 'vnext'
  ? useWeeklyPlanningVNextApplication : useWeeklyPlanningApplication;
