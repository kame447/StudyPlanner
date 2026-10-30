// One rule for where the clock time of a bound belongs: an earliest start is a
// start time; a latest end or a deadline is an end time; a named period is not
// also given clock times. The Stable V5 scheduler applies the same rule to hard
// bounds when it compiles (#881 run 40999309402: a stated "締切は明日の13時" was
// accepted as deadline startTime=13:00 and only then failed as an invalid
// interval). VNext applies it when a bound is stated, so the transaction rejects
// the bound where the provider's field-local repair can correct it.
import {
  CANONICAL_RELATIVE_DATE_EXPRESSIONS,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  resolveCanonicalDateExpression,
} from '../semantic/weeklyPlanningCalendarResolver';
import type { TemporalConstraintFactV5 } from './weeklyPlanningVNextV5Boundary';

type Bound = Pick<TemporalConstraintFactV5, 'kind' | 'namedTimePeriod' | 'startTime' | 'endTime'>;
type ClockField = 'startTime' | 'endTime';

/**
 * The clock fields a correction of this bound must address, or [] when it is
 * well formed. A time in the wrong field names both fields, because moving it
 * changes both (naming only the source would let a repair drop the stated time).
 */
export function vnextTemporalBoundRepairFields(bound: Bound): ClockField[] {
  if (bound.kind !== 'earliest_start' && bound.kind !== 'latest_end' && bound.kind !== 'deadline') return [];
  if (bound.namedTimePeriod !== null) {
    return (['startTime', 'endTime'] as const).filter((field) => bound[field] !== null);
  }
  const misplaced = bound.kind === 'earliest_start' ? bound.endTime : bound.startTime;
  return misplaced === null ? [] : ['startTime', 'endTime'];
}

/**
 * A date as stored: the model reads "明日" as a symbolic `tomorrow`; code fixes it to
 * the absolute date of the turn that stated it, so it never moves on a later day
 * (#918, design §18). Absolute dates pass through; null when it is not in the canonical
 * vocabulary (no word is interpreted here) or cannot be resolved.
 */
const ABSOLUTE_DATE_OR_RANGE = /^\d{4}-\d{2}-\d{2}(?:\/\d{4}-\d{2}-\d{2})?$/;
/** The model's date vocabulary: absolute dates or ranges and canonical tokens. Words in any language are the model's to resolve. */
const isCanonicalVNextDate = (expression: string) => ABSOLUTE_DATE_OR_RANGE.test(expression)
  || ([...CANONICAL_RELATIVE_DATE_EXPRESSIONS, ...CANONICAL_WEEKDAY_DATE_EXPRESSIONS] as readonly string[]).includes(expression);

export function fixVNextDateExpression(expression: string, acceptedDate: string): string | null {
  if (!isCanonicalVNextDate(expression)) return null;
  const resolved = resolveCanonicalDateExpression({ expression, currentDate: acceptedDate });
  if (resolved.status !== 'resolved' || !resolved.range) return null;
  return resolved.range.start === resolved.range.end ? resolved.range.start : `${resolved.range.start}/${resolved.range.end}`;
}
