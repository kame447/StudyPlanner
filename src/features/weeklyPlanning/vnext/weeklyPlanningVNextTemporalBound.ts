// One rule for where the clock time of a bound belongs: an earliest start is a
// start time; a latest end or a deadline is an end time; a named period is not
// also given clock times. The Stable V5 scheduler applies the same rule to hard
// bounds when it compiles (#881 run 40999309402: a stated "締切は明日の13時" was
// accepted as deadline startTime=13:00 and only then failed as an invalid
// interval). VNext applies it when a bound is stated, so the transaction rejects
// the field and the provider's field-local repair can move it.
import type { TemporalConstraintFactV5 } from './weeklyPlanningVNextV5Boundary';

type Bound = Pick<TemporalConstraintFactV5, 'kind' | 'namedTimePeriod' | 'startTime' | 'endTime'>;

/** The misplaced clock field of a bound, or null when the bound is well formed. */
export function misplacedVNextTemporalBoundField(bound: Bound): 'startTime' | 'endTime' | null {
  if (bound.kind !== 'earliest_start' && bound.kind !== 'latest_end' && bound.kind !== 'deadline') return null;
  if (bound.namedTimePeriod !== null) return bound.startTime !== null ? 'startTime' : bound.endTime !== null ? 'endTime' : null;
  if (bound.kind === 'earliest_start') return bound.endTime !== null ? 'endTime' : null;
  return bound.startTime !== null ? 'startTime' : null;
}
