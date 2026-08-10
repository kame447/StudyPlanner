import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';
import {
  SEMANTIC_AVAILABILITY_KINDS_V5,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5,
  SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5,
  SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5,
  SEMANTIC_NAMED_TIME_PERIODS_V5,
  SEMANTIC_QUANTITY_ROLES_V5,
  SEMANTIC_RECURRENCE_KINDS_V5,
  SEMANTIC_STUDY_PURPOSES_V5,
  SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticNamedTimePeriodV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export interface WeeklyPlanningSemanticValidationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
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

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isNamedTimePeriod(value: unknown): value is SemanticNamedTimePeriodV5 {
  return isEnumValue(value, SEMANTIC_NAMED_TIME_PERIODS_V5)
    || (typeof value === 'string' && CUSTOM_NAMED_TIME_PERIOD_PATTERN.test(value));
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

function validateSourceText(
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (!isNonEmptyString(value.sourceText)) errors.push(`${path}.sourceText`);
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
  if (value !== null && !isNamedTimePeriod(value)) errors.push(path);
}

function registerLocalId(
  value: unknown,
  path: string,
  allIds: Set<string>,
  errors: string[],
): string | null {
  if (!isNonEmptyString(value)) {
    errors.push(path);
    return null;
  }
  if (allIds.has(value)) errors.push(`${path}:duplicate:${value}`);
  allIds.add(value);
  return value;
}

function validateWorkload(
  value: unknown,
  path: string,
  allIds: Set<string>,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path}:not-object`);
    return;
  }
  validateExactKeys(value, [
    'localId',
    'quantityRole',
    'amount',
    'unitCode',
    'unitLabel',
    'rangeStart',
    'rangeEnd',
    'perOccurrence',
    'periodExpression',
    'sourceText',
  ], path, errors);
  registerLocalId(value.localId, `${path}.localId`, allIds, errors);
  if (!isEnumValue(value.quantityRole, SEMANTIC_QUANTITY_ROLES_V5)) {
    errors.push(`${path}.quantityRole`);
  }
  if (!isFinitePositiveNumber(value.amount)) errors.push(`${path}.amount`);
  if (!isEnumValue(value.unitCode, SEMANTIC_WORKLOAD_UNIT_CODES_V5)) {
    errors.push(`${path}.unitCode`);
  }
  if (!isNonEmptyString(value.unitLabel)) errors.push(`${path}.unitLabel`);
  if (!isNullableString(value.rangeStart)) errors.push(`${path}.rangeStart`);
  if (!isNullableString(value.rangeEnd)) errors.push(`${path}.rangeEnd`);
  if (typeof value.perOccurrence !== 'boolean') errors.push(`${path}.perOccurrence`);
  if (!isNullableString(value.periodExpression)) errors.push(`${path}.periodExpression`);
  validateSourceText(value, path, errors);
}

function validateComponents(
  value: unknown,
  path: string,
  allIds: Set<string>,
  errors: string[],
): Set<string> {
  const componentIds = new Set<string>();
  const parentById = new Map<string, string | null>();
  if (!Array.isArray(value)) {
    errors.push(`${path}:not-array`);
    return componentIds;
  }

  value.forEach((component, index) => {
    const componentPath = `${path}[${index}]`;
    if (!isRecord(component)) {
      errors.push(`${componentPath}:not-object`);
      return;
    }
    validateExactKeys(
      component,
      ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],
      componentPath,
      errors,
    );
    const localId = registerLocalId(
      component.localId,
      `${componentPath}.localId`,
      allIds,
      errors,
    );
    if (localId) componentIds.add(localId);
    if (!isNullableString(component.parentLocalId)) {
      errors.push(`${componentPath}.parentLocalId`);
    } else if (localId) {
      parentById.set(localId, component.parentLocalId);
    }
    if (!isEnumValue(component.role, SEMANTIC_COMPONENT_ROLES_V5)) {
      errors.push(`${componentPath}.role`);
    }
    if (!isNonEmptyString(component.label)) errors.push(`${componentPath}.label`);
    if (!Array.isArray(component.workloads)) {
      errors.push(`${componentPath}.workloads`);
    } else {
      component.workloads.forEach((workload, workloadIndex) => {
        validateWorkload(
          workload,
          `${componentPath}.workloads[${workloadIndex}]`,
          allIds,
          errors,
        );
      });
    }
    validateSourceText(component, componentPath, errors);
  });

  for (const [componentId, parentId] of parentById) {
    if (parentId !== null && !componentIds.has(parentId)) {
      errors.push(`${path}.parent-ref:${componentId}:${parentId}`);
    }
  }
  for (const componentId of componentIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = componentId;
    while (current) {
      if (visited.has(current)) {
        errors.push(`${path}.parent-cycle:${componentId}`);
        break;
      }
      visited.add(current);
      current = parentById.get(current);
    }
  }

  return componentIds;
}

function validateSemanticReference(
  value: unknown,
  path: string,
  errors: string[],
): string | null {
  if (!isRecord(value)) {
    errors.push(`${path}:not-object`);
    return null;
  }
  validateExactKeys(value, ['kind', 'publicId', 'localId', 'mention'], path, errors);
  if (!isEnumValue(value.kind, [
    'planning_window',
    'task',
    'component',
    'workload',
    'effort_estimate',
    'temporal_constraint',
    'recurrence',
    'relation',
    'proposal',
  ] as const)) {
    errors.push(`${path}.kind`);
  }
  if (!isNullableString(value.publicId)) errors.push(`${path}.publicId`);
  if (!isNullableString(value.localId)) errors.push(`${path}.localId`);
  if (!isNullableString(value.mention)) errors.push(`${path}.mention`);
  const publicId = isNonEmptyString(value.publicId) ? value.publicId : null;
  const localId = isNonEmptyString(value.localId) ? value.localId : null;
  const mention = isNonEmptyString(value.mention) ? value.mention : null;
  if (!publicId && !localId && !mention) errors.push(`${path}:empty-reference`);
  return localId;
}

function validateTemporalConstraint(
  constraint: Record<string, unknown>,
  path: string,
  taskId: string | null,
  taskTargets: Set<string>,
  allIds: Set<string>,
  errors: string[],
): void {
  validateExactKeys(constraint, [
    'localId',
    'targetLocalId',
    'kind',
    'constraintLevel',
    'dateExpression',
    'namedTimePeriod',
    'startTime',
    'endTime',
    'precision',
    'sourceText',
  ], path, errors);
  registerLocalId(constraint.localId, `${path}.localId`, allIds, errors);
  if (!isEnumValue(constraint.kind, SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5)) {
    errors.push(`${path}.kind`);
  }
  if (!isEnumValue(constraint.constraintLevel, SEMANTIC_CONSTRAINT_LEVELS_V5)) {
    errors.push(`${path}.constraintLevel`);
  }
  validateNullableDateExpression(constraint.dateExpression, `${path}.dateExpression`, errors);
  validateNullableNamedTimePeriod(
    constraint.namedTimePeriod,
    `${path}.namedTimePeriod`,
    errors,
  );
  validateNullableClock(constraint.startTime, `${path}.startTime`, errors);
  validateNullableClock(constraint.endTime, `${path}.endTime`, errors);
  if (!isEnumValue(constraint.precision, ['exact', 'approximate', 'unspecified'] as const)) {
    errors.push(`${path}.precision`);
  }
  if (!isNonEmptyString(constraint.targetLocalId)
    || !taskTargets.has(constraint.targetLocalId)) {
    errors.push(`${path}.targetLocalId`);
  }
  if (constraint.namedTimePeriod !== null
    && (constraint.startTime !== null || constraint.endTime !== null)) {
    errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
  }

  const isDateRule = isEnumValue(constraint.kind, SEMANTIC_TASK_DATE_RULE_KINDS_V5);
  if (isDateRule) {
    if (!taskId || constraint.targetLocalId !== taskId) {
      errors.push(`${path}.targetLocalId:must-target-containing-task`);
    }
    if (!isNonEmptyString(constraint.dateExpression)
      || !isCanonicalDateExpressionSyntax(constraint.dateExpression)) {
      errors.push(`${path}.dateExpression:canonical-expression-required`);
    }
    if (constraint.namedTimePeriod !== null) {
      errors.push(`${path}.namedTimePeriod:must-be-null-for-date-rule`);
    }
    if (constraint.startTime !== null || constraint.endTime !== null) {
      errors.push(`${path}:date-rule-cannot-have-clock`);
    }
    if (constraint.constraintLevel !== 'hard') {
      errors.push(`${path}.constraintLevel:date-rule-must-be-hard`);
    }
  } else {
    if (constraint.kind === 'earliest_start' && !isNonEmptyString(constraint.startTime)) {
      errors.push(`${path}:missing-start`);
    }
    if (constraint.kind === 'latest_end' && !isNonEmptyString(constraint.endTime)) {
      errors.push(`${path}:missing-end`);
    }
    if (constraint.kind === 'fixed_interval'
      && (!isNonEmptyString(constraint.startTime) || !isNonEmptyString(constraint.endTime))) {
      errors.push(`${path}:missing-interval`);
    }
    if (constraint.kind === 'deadline'
      && !isNonEmptyString(constraint.dateExpression)
      && !isNonEmptyString(constraint.endTime)) {
      errors.push(`${path}:missing-deadline`);
    }
    if (constraint.kind === 'preferred_window' && constraint.constraintLevel === 'hard') {
      errors.push(`${path}.constraintLevel:preferred-window-cannot-be-hard`);
    }
    if (constraint.kind === 'fixed_interval' && constraint.constraintLevel === 'soft') {
      errors.push(`${path}.constraintLevel:soft-fixed-interval-use-preferred-window`);
    }
  }
  validateSourceText(constraint, path, errors);
}

function validateAvailabilityDeclarations(
  value: unknown,
  allIds: Set<string>,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push('document.availabilityDeclarations:not-array');
    return;
  }
  value.forEach((declaration, index) => {
    const path = `document.availabilityDeclarations[${index}]`;
    if (!isRecord(declaration)) {
      errors.push(`${path}:not-object`);
      return;
    }
    validateExactKeys(declaration, [
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
    ], path, errors);
    registerLocalId(declaration.localId, `${path}.localId`, allIds, errors);
    if (!isEnumValue(declaration.kind, SEMANTIC_AVAILABILITY_KINDS_V5)) {
      errors.push(`${path}.kind`);
    }
    validateNullableDateExpression(declaration.dateExpression, `${path}.dateExpression`, errors);
    validateNullableNamedTimePeriod(
      declaration.namedTimePeriod,
      `${path}.namedTimePeriod`,
      errors,
    );
    validateNullableClock(declaration.startTime, `${path}.startTime`, errors);
    validateNullableClock(declaration.endTime, `${path}.endTime`, errors);
    if (declaration.namedTimePeriod !== null
      && (declaration.startTime !== null || declaration.endTime !== null)) {
      errors.push(`${path}.namedTimePeriod:cannot-combine-with-clock`);
    }
    if (declaration.recurrenceKind !== null
      && !isEnumValue(
        declaration.recurrenceKind,
        SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5,
      )) {
      errors.push(`${path}.recurrenceKind`);
    }
    if (!Array.isArray(declaration.days)
      || declaration.days.some((day) => !isNonEmptyString(day))) {
      errors.push(`${path}.days`);
    }
    if (declaration.recurrenceKind === null
      && Array.isArray(declaration.days)
      && declaration.days.length > 0) {
      errors.push(`${path}.days:requires-recurrence`);
    }
    if (!isEnumValue(declaration.constraintLevel, SEMANTIC_CONSTRAINT_LEVELS_V5)) {
      errors.push(`${path}.constraintLevel`);
    }
    if ((declaration.kind === 'preferred' || declaration.kind === 'avoided')
      && declaration.constraintLevel === 'hard') {
      errors.push(`${path}.constraintLevel:preference-cannot-be-hard`);
    }
    if (declaration.kind === 'unavailable' && declaration.constraintLevel === 'soft') {
      errors.push(`${path}.constraintLevel:soft-unavailable-use-avoided`);
    }
    const hasScope = isNonEmptyString(declaration.dateExpression)
      || isNamedTimePeriod(declaration.namedTimePeriod)
      || isNonEmptyString(declaration.startTime)
      || isNonEmptyString(declaration.endTime)
      || declaration.recurrenceKind !== null
      || (Array.isArray(declaration.days) && declaration.days.length > 0);
    if (!hasScope) errors.push(`${path}:missing-time-scope`);
    validateSourceText(declaration, path, errors);
  });
}

function validateConstraintSourceRequests(
  value: unknown,
  allIds: Set<string>,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push('document.constraintSourceRequests:not-array');
    return;
  }
  value.forEach((request, index) => {
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
    registerLocalId(request.localId, `${path}.localId`, allIds, errors);
    if (!isEnumValue(request.kind, SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5)) {
      errors.push(`${path}.kind`);
    }
    if (request.selector !== 'active') errors.push(`${path}.selector`);
    if (request.requestedAction !== 'use' && request.requestedAction !== 'stop_using') {
      errors.push(`${path}.requestedAction`);
    }
    validateSourceText(request, path, errors);
  });
}

export function validateWeeklyPlanningSemanticValueV5(
  value: unknown,
): WeeklyPlanningSemanticValidationResultV5 {
  if (!isRecord(value)) return { document: null, errors: ['document:not-object'] };
  const errors: string[] = [];
  validateExactKeys(value, [
    'schemaVersion',
    'planningIntent',
    'planningWindow',
    'tasks',
    'relations',
    'availabilityDeclarations',
    'constraintSourceRequests',
    'uncertainties',
    'corrections',
    'decisions',
  ], 'document', errors);
  if (value.schemaVersion !== WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5) {
    errors.push('document.schemaVersion');
  }
  if (!isEnumValue(
    value.planningIntent,
    ['create_plan', 'update_plan', 'discuss', 'unknown'] as const,
  )) {
    errors.push('document.planningIntent');
  }

  const allIds = new Set<string>();
  let planningWindowId: string | null = null;
  if (value.planningWindow !== null) {
    if (!isRecord(value.planningWindow)) {
      errors.push('document.planningWindow:not-object');
    } else {
      const window = value.planningWindow;
      validateExactKeys(
        window,
        ['localId', 'kind', 'value', 'start', 'end', 'sourceText'],
        'document.planningWindow',
        errors,
      );
      planningWindowId = registerLocalId(
        window.localId,
        'document.planningWindow.localId',
        allIds,
        errors,
      );
      if (!isEnumValue(
        window.kind,
        ['absolute', 'relative_day', 'relative_week', 'named_period'] as const,
      )) {
        errors.push('document.planningWindow.kind');
      }
      if (!isNonEmptyString(window.value)) errors.push('document.planningWindow.value');
      if (!isNullableString(window.start)) errors.push('document.planningWindow.start');
      if (!isNullableString(window.end)) errors.push('document.planningWindow.end');
      if (window.kind === 'absolute'
        && (!isNonEmptyString(window.start) || !isNonEmptyString(window.end))) {
        errors.push('document.planningWindow:absolute-range');
      }
      if (window.kind !== 'absolute' && (window.start !== null || window.end !== null)) {
        errors.push('document.planningWindow:relative-must-remain-symbolic');
      }
      validateSourceText(window, 'document.planningWindow', errors);
    }
  }

  const taskIds = new Set<string>();
  if (!Array.isArray(value.tasks)) {
    errors.push('document.tasks:not-array');
  } else {
    value.tasks.forEach((task, taskIndex) => {
      const path = `document.tasks[${taskIndex}]`;
      if (!isRecord(task)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(task, [
        'localId',
        'category',
        'title',
        'study',
        'workloads',
        'effortEstimates',
        'temporalConstraints',
        'recurrence',
        'sourceText',
      ], path, errors);
      const taskId = registerLocalId(task.localId, `${path}.localId`, allIds, errors);
      if (taskId) taskIds.add(taskId);
      if (!isEnumValue(task.category, SEMANTIC_TASK_CATEGORIES_V5)) {
        errors.push(`${path}.category`);
      }
      if (!isNonEmptyString(task.title)) errors.push(`${path}.title`);
      validateSourceText(task, path, errors);

      let componentIds = new Set<string>();
      if (task.study === null) {
        if (task.category === 'study') errors.push(`${path}.study:required`);
      } else if (!isRecord(task.study)) {
        errors.push(`${path}.study:not-object`);
      } else {
        validateExactKeys(
          task.study,
          ['purpose', 'contextLabel', 'components'],
          `${path}.study`,
          errors,
        );
        if (!isEnumValue(task.study.purpose, SEMANTIC_STUDY_PURPOSES_V5)) {
          errors.push(`${path}.study.purpose`);
        }
        if (!isNullableString(task.study.contextLabel)) {
          errors.push(`${path}.study.contextLabel`);
        }
        componentIds = validateComponents(
          task.study.components,
          `${path}.study.components`,
          allIds,
          errors,
        );
        if (task.category === 'non_study') errors.push(`${path}.study:must-be-null`);
      }

      const taskTargets = new Set(componentIds);
      if (taskId) taskTargets.add(taskId);

      if (!Array.isArray(task.workloads)) {
        errors.push(`${path}.workloads`);
      } else {
        task.workloads.forEach((workload, index) => {
          validateWorkload(workload, `${path}.workloads[${index}]`, allIds, errors);
        });
      }

      if (!Array.isArray(task.effortEstimates)) {
        errors.push(`${path}.effortEstimates`);
      } else {
        task.effortEstimates.forEach((estimate, index) => {
          const estimatePath = `${path}.effortEstimates[${index}]`;
          if (!isRecord(estimate)) {
            errors.push(`${estimatePath}:not-object`);
            return;
          }
          validateExactKeys(estimate, [
            'localId',
            'targetLocalId',
            'kind',
            'minutes',
            'unitCode',
            'precision',
            'sourceText',
          ], estimatePath, errors);
          registerLocalId(estimate.localId, `${estimatePath}.localId`, allIds, errors);
          if (!isNonEmptyString(estimate.targetLocalId)
            || !taskTargets.has(estimate.targetLocalId)) {
            errors.push(`${estimatePath}.targetLocalId`);
          }
          if (!isEnumValue(
            estimate.kind,
            ['total_duration', 'duration_per_unit', 'session_duration'] as const,
          )) {
            errors.push(`${estimatePath}.kind`);
          }
          if (!isFinitePositiveNumber(estimate.minutes)) errors.push(`${estimatePath}.minutes`);
          if (estimate.unitCode !== null
            && !isEnumValue(estimate.unitCode, SEMANTIC_WORKLOAD_UNIT_CODES_V5)) {
            errors.push(`${estimatePath}.unitCode`);
          }
          if (estimate.kind === 'duration_per_unit' && estimate.unitCode === null) {
            errors.push(`${estimatePath}.unitCode:required`);
          }
          if (!isEnumValue(
            estimate.precision,
            ['exact', 'approximate', 'unspecified'] as const,
          )) {
            errors.push(`${estimatePath}.precision`);
          }
          validateSourceText(estimate, estimatePath, errors);
        });
      }

      if (!Array.isArray(task.temporalConstraints)) {
        errors.push(`${path}.temporalConstraints`);
      } else {
        task.temporalConstraints.forEach((constraint, index) => {
          const constraintPath = `${path}.temporalConstraints[${index}]`;
          if (!isRecord(constraint)) {
            errors.push(`${constraintPath}:not-object`);
            return;
          }
          validateTemporalConstraint(
            constraint,
            constraintPath,
            taskId,
            taskTargets,
            allIds,
            errors,
          );
        });
      }

      if (!Array.isArray(task.recurrence)) {
        errors.push(`${path}.recurrence`);
      } else {
        task.recurrence.forEach((recurrence, index) => {
          const recurrencePath = `${path}.recurrence[${index}]`;
          if (!isRecord(recurrence)) {
            errors.push(`${recurrencePath}:not-object`);
            return;
          }
          validateExactKeys(
            recurrence,
            ['localId', 'targetLocalId', 'kind', 'count', 'days', 'sourceText'],
            recurrencePath,
            errors,
          );
          registerLocalId(recurrence.localId, `${recurrencePath}.localId`, allIds, errors);
          if (!isNonEmptyString(recurrence.targetLocalId)
            || !taskTargets.has(recurrence.targetLocalId)) {
            errors.push(`${recurrencePath}.targetLocalId`);
          }
          if (!isEnumValue(recurrence.kind, SEMANTIC_RECURRENCE_KINDS_V5)) {
            errors.push(`${recurrencePath}.kind`);
          }
          if (recurrence.count !== null && !isFinitePositiveNumber(recurrence.count)) {
            errors.push(`${recurrencePath}.count`);
          }
          if (recurrence.kind === 'times_per_week'
            && !isFinitePositiveNumber(recurrence.count)) {
            errors.push(`${recurrencePath}.count:required`);
          }
          if (!Array.isArray(recurrence.days)
            || recurrence.days.some((day) => !isNonEmptyString(day))) {
            errors.push(`${recurrencePath}.days`);
          }
          validateSourceText(recurrence, recurrencePath, errors);
        });
      }
    });
  }

  if (!Array.isArray(value.relations)) {
    errors.push('document.relations:not-array');
  } else {
    value.relations.forEach((relation, index) => {
      const path = `document.relations[${index}]`;
      if (!isRecord(relation)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(
        relation,
        ['localId', 'kind', 'fromLocalId', 'toLocalId', 'sourceText'],
        path,
        errors,
      );
      registerLocalId(relation.localId, `${path}.localId`, allIds, errors);
      if (!isEnumValue(
        relation.kind,
        ['before', 'after', 'depends_on', 'priority_over', 'sequence'] as const,
      )) {
        errors.push(`${path}.kind`);
      }
      if (!isNonEmptyString(relation.fromLocalId) || !taskIds.has(relation.fromLocalId)) {
        errors.push(`${path}.fromLocalId`);
      }
      if (!isNonEmptyString(relation.toLocalId) || !taskIds.has(relation.toLocalId)) {
        errors.push(`${path}.toLocalId`);
      }
      if (relation.fromLocalId === relation.toLocalId) errors.push(`${path}:self-relation`);
      validateSourceText(relation, path, errors);
    });
  }

  validateAvailabilityDeclarations(value.availabilityDeclarations, allIds, errors);
  validateConstraintSourceRequests(value.constraintSourceRequests, allIds, errors);

  if (!Array.isArray(value.uncertainties)) {
    errors.push('document.uncertainties:not-array');
  } else {
    value.uncertainties.forEach((uncertainty, index) => {
      const path = `document.uncertainties[${index}]`;
      if (!isRecord(uncertainty)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(
        uncertainty,
        ['localId', 'targetLocalId', 'field', 'reason', 'sourceText'],
        path,
        errors,
      );
      registerLocalId(uncertainty.localId, `${path}.localId`, allIds, errors);
      if (!isNonEmptyString(uncertainty.targetLocalId)
        || (uncertainty.targetLocalId !== 'document'
          && uncertainty.targetLocalId !== planningWindowId
          && !allIds.has(uncertainty.targetLocalId))) {
        errors.push(`${path}.targetLocalId`);
      }
      if (!isNonEmptyString(uncertainty.field)) errors.push(`${path}.field`);
      if (!isNonEmptyString(uncertainty.reason)) errors.push(`${path}.reason`);
      validateSourceText(uncertainty, path, errors);
    });
  }

  const deferredReferenceChecks: Array<{ path: string; localId: string | null }> = [];
  if (!Array.isArray(value.corrections)) {
    errors.push('document.corrections:not-array');
  } else {
    value.corrections.forEach((correction, index) => {
      const path = `document.corrections[${index}]`;
      if (!isRecord(correction)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(correction, [
        'localId',
        'target',
        'operation',
        'replacementLocalId',
        'sourceText',
      ], path, errors);
      registerLocalId(correction.localId, `${path}.localId`, allIds, errors);
      deferredReferenceChecks.push({
        path: `${path}.target.localId`,
        localId: validateSemanticReference(correction.target, `${path}.target`, errors),
      });
      if (!isEnumValue(correction.operation, ['remove', 'replace', 'modify'] as const)) {
        errors.push(`${path}.operation`);
      }
      if (!isNullableString(correction.replacementLocalId)) {
        errors.push(`${path}.replacementLocalId`);
      } else if (correction.operation === 'remove' && correction.replacementLocalId !== null) {
        errors.push(`${path}.replacementLocalId:forbidden`);
      } else if (correction.operation !== 'remove'
        && !isNonEmptyString(correction.replacementLocalId)) {
        errors.push(`${path}.replacementLocalId:required`);
      } else if (typeof correction.replacementLocalId === 'string') {
        deferredReferenceChecks.push({
          path: `${path}.replacementLocalId`,
          localId: correction.replacementLocalId,
        });
      }
      validateSourceText(correction, path, errors);
    });
  }

  if (!Array.isArray(value.decisions)) {
    errors.push('document.decisions:not-array');
  } else {
    value.decisions.forEach((decision, index) => {
      const path = `document.decisions[${index}]`;
      if (!isRecord(decision)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(
        decision,
        ['localId', 'target', 'decision', 'sourceText'],
        path,
        errors,
      );
      registerLocalId(decision.localId, `${path}.localId`, allIds, errors);
      deferredReferenceChecks.push({
        path: `${path}.target.localId`,
        localId: validateSemanticReference(decision.target, `${path}.target`, errors),
      });
      if (!isEnumValue(decision.decision, ['accept', 'reject', 'modify'] as const)) {
        errors.push(`${path}.decision`);
      }
      validateSourceText(decision, path, errors);
    });
  }

  for (const check of deferredReferenceChecks) {
    if (check.localId && !allIds.has(check.localId)) {
      errors.push(`${check.path}:unknown:${check.localId}`);
    }
  }

  return {
    document: errors.length === 0
      ? value as unknown as WeeklyPlanningSemanticDocumentV5
      : null,
    errors,
  };
}

export function parseWeeklyPlanningSemanticDocumentV5(
  content: string,
): WeeklyPlanningSemanticValidationResultV5 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['document:invalid-json'] };
  }
  return validateWeeklyPlanningSemanticValueV5(value);
}
