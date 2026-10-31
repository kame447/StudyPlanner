// Acceptance-time temporal rules belong here so transaction and provider repair
// cannot disagree. An earliest start uses startTime; latest end/deadline uses
// endTime; a named period has no clocks. Empty bounds must be rejected rather
// than silently dropping intent. Transaction.test.ts and Provider.test.ts guard
// empty bounds and addressed repairs that preserve the stated clock.
import {
  CANONICAL_RELATIVE_DATE_EXPRESSIONS,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  resolveCanonicalDateExpression,
} from '../semantic/weeklyPlanningCalendarResolver';
import type { TemporalConstraintFactV5 } from './weeklyPlanningVNextV5Boundary';
import type { VNextTurnContext } from './weeklyPlanningVNextTypes';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../semantic/weeklyPlanningResolvedDateExpressionsV5';

type Bound = Pick<TemporalConstraintFactV5, 'kind' | 'dateExpression' | 'namedTimePeriod' | 'startTime' | 'endTime'>;
type BoundField = 'dateExpression' | 'namedTimePeriod' | 'startTime' | 'endTime';

/**
 * The fields a correction of this bound must address, or [] when it is well
 * formed. A time in the wrong field names both clock fields, because moving it
 * changes both (naming only the source would let a repair drop the stated time).
 * An empty bound names every field, so a repair can restore whichever was stated.
 */
export function vnextTemporalBoundRepairFields(bound: Bound): BoundField[] {
  const fields = ['dateExpression', 'namedTimePeriod', 'startTime', 'endTime'] as const;
  if (fields.every((field) => bound[field] === null)) return [...fields];
  if (bound.kind !== 'earliest_start' && bound.kind !== 'latest_end' && bound.kind !== 'deadline') return [];
  if (bound.namedTimePeriod !== null) {
    return (['startTime', 'endTime'] as const).filter((field) => bound[field] !== null);
  }
  const misplaced = bound.kind === 'earliest_start' ? bound.endTime : bound.startTime;
  return misplaced === null ? [] : ['startTime', 'endTime'];
}

/**
 * The single acceptance rule: freeze today-relative tokens using the accepted
 * date and weekStartsOn; fix one-occurrence weekdays inside the final horizon,
 * but retain repeated filters. Add date meanings here using the V5 resolvers;
 * never infer them from source words or resolve accepted occurrences afresh.
 * Transaction.test.ts guards day-crossing stability (#918/VP02), Sunday-start
 * weeks (VP01), repeated exclusions and field errors when no weekday is in range.
 */
const ABSOLUTE_DATE_OR_RANGE = /^\d{4}-\d{2}-\d{2}(?:\/\d{4}-\d{2}-\d{2})?$/;
/** The model's date vocabulary: absolute dates or ranges and canonical tokens. Words in any language are the model's to resolve. */
const isCanonicalVNextDate = (expression: string) => ABSOLUTE_DATE_OR_RANGE.test(expression)
  || ([...CANONICAL_RELATIVE_DATE_EXPRESSIONS, ...CANONICAL_WEEKDAY_DATE_EXPRESSIONS] as readonly string[]).includes(expression);

export function fixVNextDateExpression(expression: string,
  context: Pick<VNextTurnContext, 'acceptedDate' | 'weekStartsOn' | 'planningHorizon'>,
  meaning: 'one_occurrence' | 'repeated_filter' | 'planning_window'): string | null {
  if (!isCanonicalVNextDate(expression)) return null;
  const weekday = (CANONICAL_WEEKDAY_DATE_EXPRESSIONS as readonly string[]).includes(expression);
  if (weekday && meaning === 'repeated_filter') return expression;
  const resolved = weekday && meaning === 'one_occurrence'
    // This graph view asks the existing resolver for its one-date-in-horizon
    // operation. It does not create a fact or interpret the source language.
    ? resolveWeeklyPlanningDateExpressionsV5({ graph: { temporalConstraints: [{ id: 'date',
      dateExpression: expression, kind: 'deadline', constraintLevel: 'hard' }] },
      currentDate: context.acceptedDate, weekStartsOn: context.weekStartsOn,
      planningWindow: context.planningHorizon }).facts[0]
    : resolveCanonicalDateExpression({ expression, currentDate: context.acceptedDate, weekStartsOn: context.weekStartsOn });
  if (resolved.status !== 'resolved' || !resolved.range) return null;
  return resolved.range.start === resolved.range.end ? resolved.range.start : `${resolved.range.start}/${resolved.range.end}`;
}
