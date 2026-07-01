import { addDays } from '../../../lib/date';
import type { LifeConstraint } from '../intake/weeklyPlanningIntakeTypes';

export function isFixedSchedulingConstraint(kind: LifeConstraint['kind']): boolean {
  return kind === 'fixed_event' || kind === 'unavailable';
}

export function expandRecurringUnavailableConstraints(params: {
  constraints: LifeConstraint[];
  planningStartDate: string;
  planningDayCount: number;
}): LifeConstraint[] {
  return params.constraints.flatMap((constraint) => {
    if (constraint.kind !== 'unavailable' || constraint.date) {
      return [constraint];
    }

    return Array.from({ length: params.planningDayCount }, (_, dateIndex) => ({
      ...constraint,
      date: addDays(params.planningStartDate, dateIndex),
    }));
  });
}