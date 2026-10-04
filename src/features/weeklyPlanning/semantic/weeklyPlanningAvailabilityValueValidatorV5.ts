import { SEMANTIC_AVAILABILITY_KINDS_V5, SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5, SEMANTIC_CONSTRAINT_LEVELS_V5 } from './weeklyPlanningSemanticTypesV5';
import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';
import { isWeeklyPlanningNamedTimePeriodV5 as isNamedTimePeriod, validateNullableClockV5 as validateNullableClock, validateNullableDateExpressionV5 as validateNullableDateExpression, validateNullableNamedTimePeriodV5 as validateNullableNamedTimePeriod } from './weeklyPlanningTemporalValueValidatorV5';

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isEnumValue = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);

// Absence is a distinct payload, not an ordinary positive availability window.
// capacityMinutes may be omitted in pre-extension snapshots.
export function validateWeeklyPlanningAvailabilityBaseValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.kind, SEMANTIC_AVAILABILITY_KINDS_V5)) {
    errors.push(`${path}.kind`);
  }
  validateNullableDateExpression(value.dateExpression, `${path}.dateExpression`, errors);
  validateNullableNamedTimePeriod(
    value.namedTimePeriod,
    `${path}.namedTimePeriod`,
    errors,
  );
  validateNullableClock(value.startTime, `${path}.startTime`, errors);
  validateNullableClock(value.endTime, `${path}.endTime`, errors);
  if (value.namedTimePeriod !== null
    && (value.startTime !== null || value.endTime !== null)) {
    errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
  }
  if (value.recurrenceKind !== null
    && !isEnumValue(
      value.recurrenceKind,
      SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5,
    )) {
    errors.push(`${path}.recurrenceKind`);
  }
  if (!Array.isArray(value.days)
    || value.days.some((day) => !isNonEmptyString(day))) {
    errors.push(`${path}.days`);
  }
  if (value.recurrenceKind === null
    && Array.isArray(value.days)
    && value.days.length > 0) {
    errors.push(`${path}.days:requires-recurrence`);
  }
  if (!isEnumValue(value.constraintLevel, SEMANTIC_CONSTRAINT_LEVELS_V5)) {
    errors.push(`${path}.constraintLevel`);
  }
  if ((value.kind === 'preferred' || value.kind === 'avoided')
    && value.constraintLevel === 'hard') {
    errors.push(`${path}.constraintLevel:preference-cannot-be-hard`);
  }
  if (value.kind === 'unavailable' && value.constraintLevel === 'soft') {
    errors.push(`${path}.constraintLevel:soft-unavailable-use-avoided`);
  }
  const hasScope = isNonEmptyString(value.dateExpression)
    || isNamedTimePeriod(value.namedTimePeriod)
    || isNonEmptyString(value.startTime)
    || isNonEmptyString(value.endTime)
    || value.recurrenceKind !== null
    || (Array.isArray(value.days) && value.days.length > 0);
  if (!hasScope) errors.push(`${path}:missing-time-scope`);
}

export function validateWeeklyPlanningAvailabilityCapacityValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  const capacityMinutes = value.capacityMinutes;
  if (value.kind === 'capacity') {
    if (
      typeof capacityMinutes !== 'number'
      || !Number.isFinite(capacityMinutes)
      || capacityMinutes <= 0
      || capacityMinutes > 24 * 60
    ) {
      errors.push(`${path}.capacityMinutes:expected-positive-minutes-within-day`);
    }
    if (value.namedTimePeriod !== null
      || value.startTime !== null
      || value.endTime !== null) {
      errors.push(`${path}:capacity-cannot-have-clock-window`);
    }
    if (value.constraintLevel !== 'hard') {
      errors.push(`${path}.constraintLevel:capacity-must-be-hard`);
    }
    const hasDateScope = (
      typeof value.dateExpression === 'string'
      && value.dateExpression.trim().length > 0
    ) || value.recurrenceKind !== null;
    if (!hasDateScope) errors.push(`${path}:capacity-requires-date-scope`);
    return;
  }
  if (capacityMinutes !== undefined && capacityMinutes !== null) {
    errors.push(`${path}.capacityMinutes:must-be-null-unless-capacity`);
  }
}

export function validateWeeklyPlanningAvailabilityAbsenceValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!(value.dateExpression === null || typeof value.dateExpression === 'string')) {
    errors.push(`${path}.dateExpression:expected-string-or-null`);
  } else if (
    typeof value.dateExpression === 'string'
    && !isCanonicalDateExpressionSyntax(value.dateExpression)
  ) {
    errors.push(`${path}.dateExpression:unsupported-expression`);
  }
  if (value.namedTimePeriod !== null) {
    errors.push(`${path}.namedTimePeriod:absence-has-no-positive-window`);
  }
  if (value.startTime !== null || value.endTime !== null) {
    errors.push(`${path}:absence-has-no-positive-clock-window`);
  }
  if (value.recurrenceKind !== null) {
    errors.push(`${path}.recurrenceKind:absence-has-no-positive-recurrence`);
  }
  if (!Array.isArray(value.days) || value.days.length > 0) {
    errors.push(`${path}.days:absence-has-no-positive-days`);
  }
  if (value.capacityMinutes !== undefined && value.capacityMinutes !== null) {
    errors.push(`${path}.capacityMinutes:absence-has-no-capacity`);
  }
  if (value.constraintLevel !== 'hard') {
    errors.push(`${path}.constraintLevel:absence-is-factual`);
  }
}
