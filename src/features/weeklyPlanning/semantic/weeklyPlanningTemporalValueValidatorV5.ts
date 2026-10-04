import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';
import { SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_NAMED_TIME_PERIODS_V5, type SemanticNamedTimePeriodV5 } from './weeklyPlanningSemanticTypesV5';

const temporalKinds = new Set<string>(SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5);
const dateRuleKinds = new Set<string>(SEMANTIC_TASK_DATE_RULE_KINDS_V5);
const levels = new Set<string>(SEMANTIC_CONSTRAINT_LEVELS_V5);
const periods = new Set<string>(SEMANTIC_NAMED_TIME_PERIODS_V5);
const precisions = new Set(['exact', 'approximate', 'unspecified']);
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const customPeriodPattern = /^custom:.+$/;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function isWeeklyPlanningNamedTimePeriodV5(value: unknown): value is SemanticNamedTimePeriodV5 {
  return typeof value === 'string' && (periods.has(value) || customPeriodPattern.test(value));
}
export function validateNullableClockV5(value: unknown, path: string, errors: string[]): void {
  if (value !== null && typeof value !== 'string') { errors.push(path); return; }
  if (typeof value === 'string' && value.length > 0 && !clockPattern.test(value)) errors.push(`${path}:clock-format`);
}
export function validateNullableDateExpressionV5(value: unknown, path: string, errors: string[]): void {
  if (value !== null && typeof value !== 'string') { errors.push(path); return; }
  if (typeof value === 'string' && !isCanonicalDateExpressionSyntax(value)) errors.push(`${path}:canonical-expression`);
}
export function validateNullableNamedTimePeriodV5(value: unknown, path: string, errors: string[]): void {
  if (value !== null && !isWeeklyPlanningNamedTimePeriodV5(value)) errors.push(path);
}
function validateScope(value: Record<string, unknown>, kinds: ReadonlySet<string>, path: string, errors: string[]): void {
  if (typeof value.kind !== 'string' || !kinds.has(value.kind)) errors.push(`${path}.kind`);
  if (typeof value.constraintLevel !== 'string' || !levels.has(value.constraintLevel)) errors.push(`${path}.constraintLevel`);
  validateNullableDateExpressionV5(value.dateExpression, `${path}.dateExpression`, errors);
}
function validateClockFields(value: Record<string, unknown>, path: string, errors: string[]): void {
  validateNullableNamedTimePeriodV5(value.namedTimePeriod, `${path}.namedTimePeriod`, errors);
  validateNullableClockV5(value.startTime, `${path}.startTime`, errors);
  validateNullableClockV5(value.endTime, `${path}.endTime`, errors);
  if (typeof value.precision !== 'string' || !precisions.has(value.precision)) errors.push(`${path}.precision`);
  if (value.namedTimePeriod !== null && (value.startTime !== null || value.endTime !== null)) {
    errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
  }
}

/** Six temporal kinds share the provider and persisted-graph value contract. */
export function validateWeeklyPlanningTemporalValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  validateScope(value, temporalKinds, path, errors);
  validateClockFields(value, path, errors);
  if (value.kind === 'earliest_start' && !nonempty(value.dateExpression) && !nonempty(value.startTime)) errors.push(`${path}:missing-start`);
  if (value.kind === 'latest_end' && !nonempty(value.dateExpression) && !nonempty(value.endTime)) errors.push(`${path}:missing-end`);
  if (value.kind === 'fixed_interval' && (!nonempty(value.startTime) || !nonempty(value.endTime))) errors.push(`${path}:missing-interval`);
  if (value.kind === 'deadline' && !nonempty(value.dateExpression) && !nonempty(value.endTime)) errors.push(`${path}:missing-deadline`);
  if (value.kind === 'preferred_window' && value.constraintLevel === 'hard') errors.push(`${path}.constraintLevel:preferred-window-cannot-be-hard`);
  if (value.kind === 'fixed_interval' && value.constraintLevel === 'soft') errors.push(`${path}.constraintLevel:soft-fixed-interval-use-preferred-window`);
}

/** Saved date rules deliberately omit clocks, named period, and precision. */
export function validateWeeklyPlanningDateRuleValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  validateScope(value, dateRuleKinds, path, errors);
  if (!nonempty(value.dateExpression) || !isCanonicalDateExpressionSyntax(value.dateExpression)) errors.push(`${path}.dateExpression:canonical-expression-required`);
  if (value.constraintLevel !== 'hard') errors.push(`${path}.constraintLevel:date-rule-must-be-hard`);
}

/** These extra date-rule fields exist only on the provider wire representation. */
export function validateWeeklyPlanningDateRuleWireFieldsV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  validateClockFields(value, path, errors);
  if (value.namedTimePeriod !== null) errors.push(`${path}.namedTimePeriod:must-be-null-for-date-rule`);
  if (value.startTime !== null || value.endTime !== null) errors.push(`${path}:date-rule-cannot-have-clock`);
}
