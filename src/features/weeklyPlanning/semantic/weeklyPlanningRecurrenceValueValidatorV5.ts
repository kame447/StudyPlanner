import { SEMANTIC_RECURRENCE_KINDS_V5 } from './weeklyPlanningSemanticTypesV5';

const recurrenceKinds = new Set<string>(SEMANTIC_RECURRENCE_KINDS_V5);
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Validate recurrence values without narrowing downstream calendar expressions. */
export function validateWeeklyPlanningRecurrenceValuesV5(
  value: Record<string, unknown>, path: string, errors: string[],
): void {
  if (typeof value.kind !== 'string' || !recurrenceKinds.has(value.kind)) errors.push(`${path}.kind`);
  if (value.count !== null && !isPositiveFinite(value.count)) errors.push(`${path}.count`);
  if (value.kind === 'times_per_week' && !isPositiveFinite(value.count)) errors.push(`${path}.count:required`);
  if (!Array.isArray(value.days) || value.days.some((day) => typeof day !== 'string' || day.trim().length === 0)) {
    errors.push(`${path}.days`);
  }
}
