import { addDays } from '../../../lib/date';
import { startOfWeeklyPlanningWeek } from '../personalization/weeklyPlanningWeek';
import type {
  PendingPlanningRangeClarification,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';

export function nextWeekScope(
  context: WeeklyPlanningIntakeContext,
): Extract<PendingPlanningRangeClarification['scope'], { kind: 'next_week' }> {
  const nextWeekStart = addDays(
    startOfWeeklyPlanningWeek(context.selectedDate, context.weekStartsOn),
    7,
  );
  return {
    kind: 'next_week',
    label: '来週',
    windowStartDate: nextWeekStart,
    windowEndDate: addDays(nextWeekStart, 6),
  };
}
