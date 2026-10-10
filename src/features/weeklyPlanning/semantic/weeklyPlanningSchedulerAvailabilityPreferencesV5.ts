import type { AvailabilityWindowFact } from './weeklyPlanningAvailabilityResolver';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { WeeklyPlanningSchedulerPreferredPlacementV5 } from './weeklyPlanningResolvedTemporalConstraintsV5';

function clockMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/** Project already resolved plan-wide intervals to work targets; no new date or workload interpretation. */
export function materializeWeeklyPlanningAvailabilityPreferencesV5(params: {
  windows: readonly AvailabilityWindowFact[];
  items: readonly GenericPlanningWorkItem[];
  dates: readonly string[];
}): WeeklyPlanningSchedulerPreferredPlacementV5[] {
  const targets = new Map<string, { taskId: string; targetFactId: string }>();
  for (const item of params.items) {
    const targetFactId = item.componentId ?? item.taskId;
    targets.set(targetFactId, { taskId: item.taskId, targetFactId });
  }
  return params.windows.filter((window) => window.kind === 'preferred'
    || (window.kind === 'available' && window.constraintLevel === 'soft')).flatMap((window) =>
    params.dates.flatMap((date) => {
      if (date < window.start.date || date > window.end.date) return [];
      const startMinute = date === window.start.date ? clockMinutes(window.start.time) : 0;
      const endMinute = date === window.end.date ? clockMinutes(window.end.time) : 1440;
      if (endMinute <= startMinute) return [];
      return [...targets.values()].map((target) => ({
        ...target, dates: [date], window: { startMinute, endMinute }, sourceFactId: window.sourceRef,
      }));
    }));
}
