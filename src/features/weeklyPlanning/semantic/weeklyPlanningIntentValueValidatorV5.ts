// Shared intent payload values. Reference identifiers and their resolution stay
// in the provider/graph adapters; saved graphs additionally support availability
// targets produced by the existing availability-correction compatibility layer.
const REFERENCE_KINDS = ['planning_window', 'task', 'component', 'workload', 'effort_estimate', 'temporal_constraint', 'recurrence', 'relation', 'proposal'] as const;
const isEnumValue = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function validateWeeklyPlanningReferenceKindV5(value: unknown, path: string, errors: string[]): void {
  if (!isEnumValue(value, REFERENCE_KINDS)) errors.push(path);
}

export function validateWeeklyPlanningCanonicalReferenceKindV5(value: unknown, path: string, errors: string[]): void {
  if (value !== 'availability_declaration') validateWeeklyPlanningReferenceKindV5(value, path, errors);
}

export function validateWeeklyPlanningUncertaintyValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isNonEmptyString(value.field)) errors.push(`${path}.field`);
  if (!isNonEmptyString(value.reason)) errors.push(`${path}.reason`);
}

export function validateWeeklyPlanningCorrectionValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.operation, ['remove', 'replace', 'modify'])) errors.push(`${path}.operation`);
}

export function validateWeeklyPlanningDecisionValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.decision, ['accept', 'reject', 'modify'])) errors.push(`${path}.decision`);
}

// True means a well-formed replacement identifier still needs adapter-level
// reference resolution. Null is valid only for remove.
export function validateWeeklyPlanningCorrectionReplacementV5(
  operation: unknown, replacement: unknown, path: string, errors: string[],
): replacement is string {
  if (!(replacement === null || typeof replacement === 'string')) errors.push(path);
  else if (operation === 'remove' && replacement !== null) errors.push(`${path}:forbidden`);
  else if (operation !== 'remove' && !isNonEmptyString(replacement)) errors.push(`${path}:required`);
  else return typeof replacement === 'string';
  return false;
}
