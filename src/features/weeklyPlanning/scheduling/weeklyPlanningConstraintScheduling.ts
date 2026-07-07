import { addDays } from '../../../lib/date';
import type { LifeConstraint } from '../intake/weeklyPlanningIntakeTypes';

export function isFixedSchedulingConstraint(kind: LifeConstraint['kind']): boolean {
  return kind === 'fixed_event' || kind === 'unavailable';
}

function hasSchedulableTime(constraint: LifeConstraint): boolean {
  if (constraint.start && constraint.end) {
    return true;
  }

  if (constraint.start) {
    return true;
  }

  if (constraint.end && constraint.durationMinutes) {
    return true;
  }

  return constraint.kind === 'meal' && Boolean(constraint.end);
}

function shouldExpandAcrossPlanningDays(constraint: LifeConstraint): boolean {
  if (constraint.date) {
    return false;
  }

  if (constraint.kind === 'unavailable') {
    return true;
  }

  return (
    (constraint.kind === 'meal' || constraint.kind === 'bath' || constraint.kind === 'sleep') &&
    hasSchedulableTime(constraint)
  );
}

export function expandRecurringUnavailableConstraints(params: {
  constraints: LifeConstraint[];
  planningStartDate: string;
  planningDayCount: number;
}): LifeConstraint[] {
  return params.constraints.flatMap((constraint) => {
    if (!shouldExpandAcrossPlanningDays(constraint)) {
      return [constraint];
    }

    return Array.from({ length: params.planningDayCount }, (_, dateIndex) => ({
      ...constraint,
      date: addDays(params.planningStartDate, dateIndex),
    }));
  });
}
