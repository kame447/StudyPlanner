import { validateWeeklyPlanningCorrectionReplacementV5, validateWeeklyPlanningUncertaintyValuesV5, validateWeeklyPlanningCorrectionValuesV5, validateWeeklyPlanningDecisionValuesV5, validateWeeklyPlanningReferenceKindV5 } from './weeklyPlanningIntentValueValidatorV5';
import { validateWeeklyPlanningRelationValuesV5, validateWeeklyPlanningSourceRequestValuesV5 } from './weeklyPlanningControlValueValidatorV5';
import { validateWeeklyPlanningAvailabilityBaseValuesV5 } from './weeklyPlanningAvailabilityValueValidatorV5';
import { validateWeeklyPlanningTaskValuesV5, validateWeeklyPlanningComponentValuesV5, validateWeeklyPlanningStudyContextValuesV5, validateWeeklyPlanningPlanningWindowValuesV5 } from './weeklyPlanningFactPayloadValueValidatorV5';
import { validateWeeklyPlanningRecurrenceValuesV5 } from './weeklyPlanningRecurrenceValueValidatorV5';
import { validateWeeklyPlanningEffortValuesV5, validateWeeklyPlanningWorkloadValuesV5 } from './weeklyPlanningQuantitativeValueValidatorV5';
import { validateWeeklyPlanningTemporalValuesV5, validateWeeklyPlanningDateRuleValuesV5, validateWeeklyPlanningDateRuleWireFieldsV5 } from './weeklyPlanningTemporalValueValidatorV5';
import {
  SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export interface WeeklyPlanningSemanticValidationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
}


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
  validateWeeklyPlanningWorkloadValuesV5(value, path, errors);
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
    validateWeeklyPlanningComponentValuesV5(component, componentPath, errors);
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
  validateWeeklyPlanningReferenceKindV5(value.kind, `${path}.kind`, errors);
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
  if (isEnumValue(constraint.kind, SEMANTIC_TASK_DATE_RULE_KINDS_V5)) {
    validateWeeklyPlanningDateRuleValuesV5(constraint, path, errors);
    validateWeeklyPlanningDateRuleWireFieldsV5(constraint, path, errors);
    if (!taskId || constraint.targetLocalId !== taskId) errors.push(`${path}.targetLocalId:must-target-containing-task`);
  } else {
    validateWeeklyPlanningTemporalValuesV5(constraint, path, errors);
  }
  if (!isNonEmptyString(constraint.targetLocalId) || !taskTargets.has(constraint.targetLocalId)) {
    errors.push(`${path}.targetLocalId`);
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
    validateWeeklyPlanningAvailabilityBaseValuesV5(declaration, path, errors);
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
    validateWeeklyPlanningSourceRequestValuesV5(request, path, errors);
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
      validateWeeklyPlanningPlanningWindowValuesV5(window, 'document.planningWindow', errors);
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
      validateWeeklyPlanningTaskValuesV5(task, path, errors);
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
        validateWeeklyPlanningStudyContextValuesV5(task.study, `${path}.study`, errors);
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
          validateWeeklyPlanningEffortValuesV5(estimate, estimatePath, errors);
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
          validateWeeklyPlanningRecurrenceValuesV5(recurrence, recurrencePath, errors);
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
      validateWeeklyPlanningRelationValuesV5(relation, path, errors);
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
      validateWeeklyPlanningUncertaintyValuesV5(uncertainty, path, errors);
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
      validateWeeklyPlanningCorrectionValuesV5(correction, path, errors);
      if (validateWeeklyPlanningCorrectionReplacementV5(
        correction.operation, correction.replacementLocalId, `${path}.replacementLocalId`, errors,
      )) {
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
      validateWeeklyPlanningDecisionValuesV5(decision, path, errors);
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
