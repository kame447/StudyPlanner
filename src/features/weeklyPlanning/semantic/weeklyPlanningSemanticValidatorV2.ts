import {
  SEMANTIC_AVAILABILITY_KINDS,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS,
  SEMANTIC_CONSTRAINT_LEVELS,
  SEMANTIC_CONSTRAINT_SOURCE_KINDS,
  SEMANTIC_NAMED_TIME_PERIODS,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
  type SemanticNamedTimePeriod,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
} from './weeklyPlanningSemanticDocument';
import { validateWeeklyPlanningSemanticValue } from './weeklyPlanningSemanticValidator';
import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';

export interface WeeklyPlanningSemanticValidationResultV2 {
  document: WeeklyPlanningSemanticDocumentV2 | null;
  errors: string[];
}

const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CUSTOM_NAMED_TIME_PERIOD_PATTERN = /^custom:.+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isNamedTimePeriod(value: unknown): value is SemanticNamedTimePeriod {
  return (
    isEnumValue(value, SEMANTIC_NAMED_TIME_PERIODS)
    || (typeof value === 'string' && CUSTOM_NAMED_TIME_PERIOD_PATTERN.test(value))
  );
}

function validateExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
  errors: string[],
): void {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${path}.unknown-key:${key}`);
  }
  for (const key of expectedKeys) {
    if (!(key in value)) errors.push(`${path}.missing-key:${key}`);
  }
}

function validateNullableClock(value: unknown, path: string, errors: string[]): void {
  if (!isNullableString(value)) {
    errors.push(path);
    return;
  }
  if (typeof value === 'string' && value.length > 0 && !CLOCK_TIME_PATTERN.test(value)) {
    errors.push(`${path}:clock-format`);
  }
}

function validateNullableDateExpression(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isNullableString(value)) {
    errors.push(path);
    return;
  }
  if (typeof value === 'string' && !isCanonicalDateExpressionSyntax(value)) {
    errors.push(`${path}:canonical-expression`);
  }
}

function validateNullableNamedTimePeriod(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (value !== null && !isNamedTimePeriod(value)) {
    errors.push(path);
  }
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectToAlpha1(value: Record<string, unknown>): unknown {
  const projected = cloneValue(value);
  projected.schemaVersion = WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION;
  delete projected.availabilityDeclarations;
  delete projected.constraintSourceRequests;

  if (Array.isArray(projected.tasks)) {
    for (const task of projected.tasks) {
      if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) continue;
      for (const constraint of task.temporalConstraints) {
        if (!isRecord(constraint)) continue;
        delete constraint.constraintLevel;
        delete constraint.namedTimePeriod;
      }
    }
  }

  return projected;
}

function collectBaseLocalIds(document: WeeklyPlanningSemanticDocumentV2): Set<string> {
  const ids = new Set<string>();
  if (document.planningWindow) ids.add(document.planningWindow.localId);
  for (const task of document.tasks) {
    ids.add(task.localId);
    for (const workload of task.workloads) ids.add(workload.localId);
    for (const component of task.study?.components ?? []) {
      ids.add(component.localId);
      for (const workload of component.workloads) ids.add(workload.localId);
    }
    for (const estimate of task.effortEstimates) ids.add(estimate.localId);
    for (const constraint of task.temporalConstraints) ids.add(constraint.localId);
    for (const recurrence of task.recurrence) ids.add(recurrence.localId);
  }
  for (const relation of document.relations) ids.add(relation.localId);
  for (const uncertainty of document.uncertainties) ids.add(uncertainty.localId);
  for (const correction of document.corrections) ids.add(correction.localId);
  for (const decision of document.decisions) ids.add(decision.localId);
  return ids;
}

function registerAdditionalLocalId(
  value: unknown,
  path: string,
  ids: Set<string>,
  errors: string[],
): void {
  if (!isNonEmptyString(value)) {
    errors.push(path);
    return;
  }
  if (ids.has(value)) {
    errors.push(`${path}:duplicate:${value}`);
    return;
  }
  ids.add(value);
}

function validateTemporalConstraints(
  value: Record<string, unknown>,
  errors: string[],
): void {
  if (!Array.isArray(value.tasks)) return;
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return;
    task.temporalConstraints.forEach((constraint, constraintIndex) => {
      const path = `document.tasks[${taskIndex}].temporalConstraints[${constraintIndex}]`;
      if (!isRecord(constraint)) return;
      if (!isEnumValue(constraint.constraintLevel, SEMANTIC_CONSTRAINT_LEVELS)) {
        errors.push(`${path}.constraintLevel`);
      }
      validateNullableDateExpression(
        constraint.dateExpression,
        `${path}.dateExpression`,
        errors,
      );
      validateNullableNamedTimePeriod(
        constraint.namedTimePeriod,
        `${path}.namedTimePeriod`,
        errors,
      );
      if (
        constraint.namedTimePeriod !== null
        && (constraint.startTime !== null || constraint.endTime !== null)
      ) {
        errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
      }
      if (constraint.kind === 'preferred_window' && constraint.constraintLevel === 'hard') {
        errors.push(`${path}.constraintLevel:preferred-window-cannot-be-hard`);
      }
      if (constraint.kind === 'fixed_interval' && constraint.constraintLevel === 'soft') {
        errors.push(`${path}.constraintLevel:soft-fixed-interval-use-preferred-window`);
      }
    });
  });
}

function validateAvailabilityDeclarations(
  declarations: unknown,
  ids: Set<string>,
  errors: string[],
): void {
  if (!Array.isArray(declarations)) {
    errors.push('document.availabilityDeclarations:not-array');
    return;
  }

  declarations.forEach((declaration, index) => {
    const path = `document.availabilityDeclarations[${index}]`;
    if (!isRecord(declaration)) {
      errors.push(`${path}:not-object`);
      return;
    }
    validateExactKeys(
      declaration,
      [
        'localId',
        'kind',
        'dateExpression',
        'namedTimePeriod',
        'startTime',
        'endTime',
        'recurrenceKind',
        'days',
        'constraintLevel',
        'sourceText',
      ],
      path,
      errors,
    );
    registerAdditionalLocalId(declaration.localId, `${path}.localId`, ids, errors);
    if (!isEnumValue(declaration.kind, SEMANTIC_AVAILABILITY_KINDS)) {
      errors.push(`${path}.kind`);
    }
    validateNullableDateExpression(
      declaration.dateExpression,
      `${path}.dateExpression`,
      errors,
    );
    validateNullableNamedTimePeriod(
      declaration.namedTimePeriod,
      `${path}.namedTimePeriod`,
      errors,
    );
    validateNullableClock(declaration.startTime, `${path}.startTime`, errors);
    validateNullableClock(declaration.endTime, `${path}.endTime`, errors);
    if (
      declaration.namedTimePeriod !== null
      && (declaration.startTime !== null || declaration.endTime !== null)
    ) {
      errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
    }
    if (
      declaration.recurrenceKind !== null
      && !isEnumValue(
        declaration.recurrenceKind,
        SEMANTIC_AVAILABILITY_RECURRENCE_KINDS,
      )
    ) {
      errors.push(`${path}.recurrenceKind`);
    }
    if (
      !Array.isArray(declaration.days)
      || declaration.days.some((day) => !isNonEmptyString(day))
    ) {
      errors.push(`${path}.days`);
    }
    if (
      declaration.recurrenceKind === null
      && Array.isArray(declaration.days)
      && declaration.days.length > 0
    ) {
      errors.push(`${path}.days:requires-recurrence`);
    }
    if (!isEnumValue(declaration.constraintLevel, SEMANTIC_CONSTRAINT_LEVELS)) {
      errors.push(`${path}.constraintLevel`);
    }
    if (
      (declaration.kind === 'preferred' || declaration.kind === 'avoided')
      && declaration.constraintLevel === 'hard'
    ) {
      errors.push(`${path}.constraintLevel:preference-cannot-be-hard`);
    }
    if (declaration.kind === 'unavailable' && declaration.constraintLevel === 'soft') {
      errors.push(`${path}.constraintLevel:soft-unavailable-use-avoided`);
    }
    if (!isNonEmptyString(declaration.sourceText)) {
      errors.push(`${path}.sourceText`);
    }

    const hasScope = isNonEmptyString(declaration.dateExpression)
      || isNamedTimePeriod(declaration.namedTimePeriod)
      || isNonEmptyString(declaration.startTime)
      || isNonEmptyString(declaration.endTime)
      || declaration.recurrenceKind !== null
      || (Array.isArray(declaration.days) && declaration.days.length > 0);
    if (!hasScope) errors.push(`${path}:missing-time-scope`);
  });
}

function validateConstraintSourceRequests(
  requests: unknown,
  ids: Set<string>,
  errors: string[],
): void {
  if (!Array.isArray(requests)) {
    errors.push('document.constraintSourceRequests:not-array');
    return;
  }

  requests.forEach((request, index) => {
    const path = `document.constraintSourceRequests[${index}]`;
    if (!isRecord(request)) {
      errors.push(`${path}:not-object`);
      return;
    }
    validateExactKeys(
      request,
      ['localId', 'kind', 'selector', 'requestedAction', 'sourceText'],
      path,
      errors,
    );
    registerAdditionalLocalId(request.localId, `${path}.localId`, ids, errors);
    if (!isEnumValue(request.kind, SEMANTIC_CONSTRAINT_SOURCE_KINDS)) {
      errors.push(`${path}.kind`);
    }
    if (request.selector !== 'active') errors.push(`${path}.selector`);
    if (request.requestedAction !== 'use' && request.requestedAction !== 'stop_using') {
      errors.push(`${path}.requestedAction`);
    }
    if (!isNonEmptyString(request.sourceText)) errors.push(`${path}.sourceText`);
  });
}

export function validateWeeklyPlanningSemanticValueV2(
  value: unknown,
): WeeklyPlanningSemanticValidationResultV2 {
  if (!isRecord(value)) {
    return { document: null, errors: ['document:not-object'] };
  }

  const errors: string[] = [];
  validateExactKeys(
    value,
    [
      'schemaVersion',
      'planningIntent',
      'planningWindow',
      'tasks',
      'relations',
      'uncertainties',
      'corrections',
      'decisions',
      'availabilityDeclarations',
      'constraintSourceRequests',
    ],
    'document',
    errors,
  );
  if (value.schemaVersion !== WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2) {
    errors.push('document.schemaVersion');
  }

  const baseValidation = validateWeeklyPlanningSemanticValue(projectToAlpha1(value));
  errors.push(...baseValidation.errors.map((error) => `base:${error}`));
  validateTemporalConstraints(value, errors);

  if (baseValidation.document) {
    const documentForIds = value as unknown as WeeklyPlanningSemanticDocumentV2;
    const ids = collectBaseLocalIds(documentForIds);
    validateAvailabilityDeclarations(value.availabilityDeclarations, ids, errors);
    validateConstraintSourceRequests(value.constraintSourceRequests, ids, errors);
  } else {
    validateAvailabilityDeclarations(value.availabilityDeclarations, new Set(), errors);
    validateConstraintSourceRequests(value.constraintSourceRequests, new Set(), errors);
  }

  return {
    document: errors.length === 0
      ? value as unknown as WeeklyPlanningSemanticDocumentV2
      : null,
    errors,
  };
}

export function parseWeeklyPlanningSemanticDocumentV2(
  content: string,
): WeeklyPlanningSemanticValidationResultV2 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['document:invalid-json'] };
  }
  return validateWeeklyPlanningSemanticValueV2(value);
}
