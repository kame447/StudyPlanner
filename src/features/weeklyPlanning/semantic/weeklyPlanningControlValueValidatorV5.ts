import { SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5 } from './weeklyPlanningSemanticTypesV5';

// Only closed payload values are shared; endpoint IDs, provenance and lifecycle
// belong to the provider/graph adapters. No scheduling policy is inferred here.
const isEnumValue = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);

export function validateWeeklyPlanningRelationValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(
    value.kind,
    ['before', 'after', 'depends_on', 'priority_over', 'sequence'] as const,
  )) {
    errors.push(`${path}.kind`);
  }
}

export function validateWeeklyPlanningSourceRequestValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.kind, SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5)) {
    errors.push(`${path}.kind`);
  }
  if (value.selector !== 'active') errors.push(`${path}.selector`);
  if (value.requestedAction !== 'use' && value.requestedAction !== 'stop_using') {
    errors.push(`${path}.requestedAction`);
  }
}
