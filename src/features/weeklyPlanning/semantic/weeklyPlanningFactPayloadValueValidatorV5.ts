import { SEMANTIC_TASK_CATEGORIES_V5, SEMANTIC_COMPONENT_ROLES_V5, SEMANTIC_STUDY_PURPOSES_V5 } from './weeklyPlanningSemanticTypesV5';

// Payload rules shared by provider input and persisted facts. IDs, evidence,
// references and optional provider-only extensions remain in their adapters.
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string';
const isEnumValue = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);

export function validateWeeklyPlanningTaskValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.category, SEMANTIC_TASK_CATEGORIES_V5)) {
    errors.push(`${path}.category`);
  }
  if (!isNonEmptyString(value.title)) errors.push(`${path}.title`);
}

export function validateWeeklyPlanningComponentValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.role, SEMANTIC_COMPONENT_ROLES_V5)) {
    errors.push(`${path}.role`);
  }
  if (!isNonEmptyString(value.label)) errors.push(`${path}.label`);
}

export function validateWeeklyPlanningStudyContextValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(value.purpose, SEMANTIC_STUDY_PURPOSES_V5)) {
    errors.push(`${path}.purpose`);
  }
  if (!isNullableString(value.contextLabel)) {
    errors.push(`${path}.contextLabel`);
  }
}

export function validateWeeklyPlanningPlanningWindowValuesV5(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isEnumValue(
    value.kind,
    ['absolute', 'relative_day', 'relative_week', 'named_period'] as const,
  )) {
    errors.push(`${path}.kind`);
  }
  if (!isNonEmptyString(value.value)) errors.push(`${path}.value`);
  if (!isNullableString(value.start)) errors.push(`${path}.start`);
  if (!isNullableString(value.end)) errors.push(`${path}.end`);
  if (value.kind === 'absolute'
    && (!isNonEmptyString(value.start) || !isNonEmptyString(value.end))) {
    errors.push(`${path}:absolute-range`);
  }
  if (value.kind !== 'absolute' && (value.start !== null || value.end !== null)) {
    errors.push(`${path}:relative-must-remain-symbolic`);
  }
}
