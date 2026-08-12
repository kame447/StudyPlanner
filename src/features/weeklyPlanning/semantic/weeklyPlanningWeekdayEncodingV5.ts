import {
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

const CANONICAL_WEEKDAYS = new Set<string>(CANONICAL_WEEKDAY_DATE_EXPRESSIONS);

function dayErrors(params: {
  ownerPath: string;
  localId: string;
  days: readonly string[];
}): string[] {
  return params.days.flatMap((day) =>
    CANONICAL_WEEKDAYS.has(day)
      ? []
      : [`${params.ownerPath}[${params.localId}].days:canonical-weekday-required:${day}`]);
}

export function validateWeeklyPlanningWeekdayEncodingV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return [
    ...document.availabilityDeclarations.flatMap((declaration) => dayErrors({
      ownerPath: 'availabilityDeclarations',
      localId: declaration.localId,
      days: declaration.days,
    })),
    ...document.tasks.flatMap((task) =>
      task.recurrence.flatMap((recurrence) => dayErrors({
        ownerPath: 'recurrence',
        localId: recurrence.localId,
        days: recurrence.days,
      }))),
  ];
}
