import { SEMANTIC_QUANTITY_ROLES_V5, SEMANTIC_WORKLOAD_UNIT_CODES_V5 } from './weeklyPlanningSemanticTypesV5';

const quantityRoles = new Set<string>(SEMANTIC_QUANTITY_ROLES_V5);
const unitCodes = new Set<string>(SEMANTIC_WORKLOAD_UNIT_CODES_V5);

/** Shared value contract; each boundary validates its own IDs, keys and provenance. */
export function validateWeeklyPlanningWorkloadValuesV5(
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (typeof value.quantityRole !== 'string' || !quantityRoles.has(value.quantityRole)) {
    errors.push(`${path}.quantityRole`);
  }
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0) {
    errors.push(`${path}.amount`);
  }
  if (typeof value.unitCode !== 'string' || !unitCodes.has(value.unitCode)) {
    errors.push(`${path}.unitCode`);
  }
  if (typeof value.unitLabel !== 'string' || value.unitLabel.trim().length === 0) {
    errors.push(`${path}.unitLabel`);
  }
  for (const field of ['rangeStart', 'rangeEnd', 'periodExpression'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') errors.push(`${path}.${field}`);
  }
  if (typeof value.perOccurrence !== 'boolean') errors.push(`${path}.perOccurrence`);
}

const effortKinds = new Set(['total_duration', 'duration_per_unit', 'session_duration']);
const precisions = new Set(['exact', 'approximate', 'unspecified']);

export function validateWeeklyPlanningEffortValuesV5(
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (typeof value.kind !== 'string' || !effortKinds.has(value.kind)) errors.push(`${path}.kind`);
  if (typeof value.minutes !== 'number' || !Number.isFinite(value.minutes) || value.minutes <= 0) {
    errors.push(`${path}.minutes`);
  }
  if (value.unitCode !== null && (typeof value.unitCode !== 'string' || !unitCodes.has(value.unitCode))) {
    errors.push(`${path}.unitCode`);
  }
  if (value.kind === 'duration_per_unit' && value.unitCode === null) errors.push(`${path}.unitCode:required`);
  if (typeof value.precision !== 'string' || !precisions.has(value.precision)) errors.push(`${path}.precision`);
}
