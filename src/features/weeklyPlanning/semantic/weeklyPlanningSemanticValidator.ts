import {
  SEMANTIC_COMPONENT_ROLES,
  SEMANTIC_QUANTITY_ROLES,
  SEMANTIC_RECURRENCE_KINDS,
  SEMANTIC_STUDY_PURPOSES,
  SEMANTIC_TASK_CATEGORIES,
  SEMANTIC_TEMPORAL_CONSTRAINT_KINDS,
  SEMANTIC_WORKLOAD_UNIT_CODES,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';

export interface WeeklyPlanningSemanticValidationResult {
  document: WeeklyPlanningSemanticDocument | null;
  errors: string[];
}

const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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

function isEnumValue<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
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
    if (!expected.has(key)) {
      errors.push(`${path}.unknown-key:${key}`);
    }
  }
  for (const key of expectedKeys) {
    if (!(key in value)) {
      errors.push(`${path}.missing-key:${key}`);
    }
  }
}

function validateSourceText(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isNonEmptyString(value.sourceText)) {
    errors.push(`${path}.sourceText`);
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
  if (allIds.has(value)) {
    errors.push(`${path}:duplicate:${value}`);
    return value;
  }
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
  validateExactKeys(
    value,
    [
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
    ],
    path,
    errors,
  );
  registerLocalId(value.localId, `${path}.localId`, allIds, errors);
  if (!isEnumValue(value.quantityRole, SEMANTIC_QUANTITY_ROLES)) {
    errors.push(`${path}.quantityRole`);
  }
  if (!isFinitePositiveNumber(value.amount)) {
    errors.push(`${path}.amount`);
  }
  if (!isEnumValue(value.unitCode, SEMANTIC_WORKLOAD_UNIT_CODES)) {
    errors.push(`${path}.unitCode`);
  }
  if (!isNonEmptyString(value.unitLabel)) {
    errors.push(`${path}.unitLabel`);
  }
  if (!isNullableString(value.rangeStart)) {
    errors.push(`${path}.rangeStart`);
  }
  if (!isNullableString(value.rangeEnd)) {
    errors.push(`${path}.rangeEnd`);
  }
  if (typeof value.perOccurrence !== 'boolean') {
    errors.push(`${path}.perOccurrence`);
  }
  if (!isNullableString(value.periodExpression)) {
    errors.push(`${path}.periodExpression`);
  }
  validateSourceText(value, path, errors);
}

interface ComponentValidationResult {
  componentIds: Set<string>;
  parentById: Map<string, string | null>;
}

function validateComponents(
  value: unknown,
  path: string,
  allIds: Set<string>,
  errors: string[],
): ComponentValidationResult {
  const componentIds = new Set<string>();
  const parentById = new Map<string, string | null>();
  if (!Array.isArray(value)) {
    errors.push(`${path}:not-array`);
    return { componentIds, parentById };
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath}:not-object`);
      return;
    }
    validateExactKeys(
      item,
      ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],
      itemPath,
      errors,
    );
    const localId = registerLocalId(item.localId, `${itemPath}.localId`, allIds, errors);
    if (localId) componentIds.add(localId);
    if (!isNullableString(item.parentLocalId)) {
      errors.push(`${itemPath}.parentLocalId`);
    } else if (localId) {
      parentById.set(localId, item.parentLocalId);
    }
    if (!isEnumValue(item.role, SEMANTIC_COMPONENT_ROLES)) {
      errors.push(`${itemPath}.role`);
    }
    if (!isNonEmptyString(item.label)) {
      errors.push(`${itemPath}.label`);
    }
    if (!Array.isArray(item.workloads)) {
      errors.push(`${itemPath}.workloads`);
    } else {
      item.workloads.forEach((workload, workloadIndex) => {
        validateWorkload(workload, `${itemPath}.workloads[${workloadIndex}]`, allIds, errors);
      });
    }
    validateSourceText(item, itemPath, errors);
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

  return { componentIds, parentById };
}

function validateSemanticReference(
  value: unknown,
  path: string,
  errors: string[],
): { localId: string | null; publicId: string | null; mention: string | null } | null {
  if (!isRecord(value)) {
    errors.push(`${path}:not-object`);
    return null;
  }
  validateExactKeys(value, ['kind', 'publicId', 'localId', 'mention'], path, errors);
  const allowedKinds = [
    'planning_window',
    'task',
    'component',
    'workload',
    'effort_estimate',
    'temporal_constraint',
    'recurrence',
    'relation',
    'proposal',
  ] as const;
  if (!isEnumValue(value.kind, allowedKinds)) {
    errors.push(`${path}.kind`);
  }
  if (!isNullableString(value.publicId)) errors.push(`${path}.publicId`);
  if (!isNullableString(value.localId)) errors.push(`${path}.localId`);
  if (!isNullableString(value.mention)) errors.push(`${path}.mention`);
  const publicId = typeof value.publicId === 'string' && value.publicId.trim() ? value.publicId : null;
  const localId = typeof value.localId === 'string' && value.localId.trim() ? value.localId : null;
  const mention = typeof value.mention === 'string' && value.mention.trim() ? value.mention : null;
  if (!publicId && !localId && !mention) {
    errors.push(`${path}:empty-reference`);
  }
  return { publicId, localId, mention };
}

export function validateWeeklyPlanningSemanticValue(
  value: unknown,
): WeeklyPlanningSemanticValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { document: null, errors: ['document:not-object'] };
  }

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
    ],
    'document',
    errors,
  );

  if (value.schemaVersion !== WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION) {
    errors.push('document.schemaVersion');
  }
  if (!isEnumValue(value.planningIntent, ['create_plan', 'update_plan', 'discuss', 'unknown'] as const)) {
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
      if (!isEnumValue(window.kind, ['absolute', 'relative_day', 'relative_week', 'named_period'] as const)) {
        errors.push('document.planningWindow.kind');
      }
      if (!isNonEmptyString(window.value)) errors.push('document.planningWindow.value');
      if (!isNullableString(window.start)) errors.push('document.planningWindow.start');
      if (!isNullableString(window.end)) errors.push('document.planningWindow.end');
      if (window.kind === 'absolute' && (!isNonEmptyString(window.start) || !isNonEmptyString(window.end))) {
        errors.push('document.planningWindow:absolute-range');
      }
      if (window.kind !== 'absolute' && (window.start !== null || window.end !== null)) {
        errors.push('document.planningWindow:relative-must-remain-symbolic');
      }
      validateSourceText(window, 'document.planningWindow', errors);
    }
  }

  const taskIds = new Set<string>();
  const targetsByTask = new Map<string, Set<string>>();
  const deferredTargetChecks: Array<{ path: string; targetLocalId: unknown; taskId: string }> = [];

  if (!Array.isArray(value.tasks)) {
    errors.push('document.tasks:not-array');
  } else {
    value.tasks.forEach((item, taskIndex) => {
      const path = `document.tasks[${taskIndex}]`;
      if (!isRecord(item)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(
        item,
        [
          'localId',
          'category',
          'title',
          'study',
          'workloads',
          'effortEstimates',
          'temporalConstraints',
          'recurrence',
          'sourceText',
        ],
        path,
        errors,
      );
      const taskId = registerLocalId(item.localId, `${path}.localId`, allIds, errors);
      if (taskId) taskIds.add(taskId);
      if (!isEnumValue(item.category, SEMANTIC_TASK_CATEGORIES)) errors.push(`${path}.category`);
      if (!isNonEmptyString(item.title)) errors.push(`${path}.title`);
      validateSourceText(item, path, errors);

      let componentIds = new Set<string>();
      if (item.study === null) {
        if (item.category === 'study') errors.push(`${path}.study:required`);
      } else if (!isRecord(item.study)) {
        errors.push(`${path}.study:not-object`);
      } else {
        validateExactKeys(item.study, ['purpose', 'contextLabel', 'components'], `${path}.study`, errors);
        if (!isEnumValue(item.study.purpose, SEMANTIC_STUDY_PURPOSES)) {
          errors.push(`${path}.study.purpose`);
        }
        if (!isNullableString(item.study.contextLabel)) errors.push(`${path}.study.contextLabel`);
        componentIds = validateComponents(
          item.study.components,
          `${path}.study.components`,
          allIds,
          errors,
        ).componentIds;
        if (item.category === 'non_study') errors.push(`${path}.study:forbidden`);
      }

      const taskTargets = new Set<string>(componentIds);
      if (taskId) taskTargets.add(taskId);
      if (taskId) targetsByTask.set(taskId, taskTargets);

      if (!Array.isArray(item.workloads)) {
        errors.push(`${path}.workloads`);
      } else {
        item.workloads.forEach((workload, workloadIndex) => {
          validateWorkload(workload, `${path}.workloads[${workloadIndex}]`, allIds, errors);
        });
      }

      if (!Array.isArray(item.effortEstimates)) {
        errors.push(`${path}.effortEstimates`);
      } else {
        item.effortEstimates.forEach((estimate, estimateIndex) => {
          const estimatePath = `${path}.effortEstimates[${estimateIndex}]`;
          if (!isRecord(estimate)) {
            errors.push(`${estimatePath}:not-object`);
            return;
          }
          validateExactKeys(
            estimate,
            ['localId', 'targetLocalId', 'kind', 'minutes', 'unitCode', 'precision', 'sourceText'],
            estimatePath,
            errors,
          );
          registerLocalId(estimate.localId, `${estimatePath}.localId`, allIds, errors);
          if (!isEnumValue(estimate.kind, ['total_duration', 'duration_per_unit', 'session_duration'] as const)) {
            errors.push(`${estimatePath}.kind`);
          }
          if (!isFinitePositiveNumber(estimate.minutes)) errors.push(`${estimatePath}.minutes`);
          if (estimate.unitCode !== null && !isEnumValue(estimate.unitCode, SEMANTIC_WORKLOAD_UNIT_CODES)) {
            errors.push(`${estimatePath}.unitCode`);
          }
          if (estimate.kind === 'duration_per_unit' && estimate.unitCode === null) {
            errors.push(`${estimatePath}.unitCode:required`);
          }
          if (!isEnumValue(estimate.precision, ['exact', 'approximate', 'unspecified'] as const)) {
            errors.push(`${estimatePath}.precision`);
          }
          validateSourceText(estimate, estimatePath, errors);
          if (taskId) deferredTargetChecks.push({ path: estimatePath, targetLocalId: estimate.targetLocalId, taskId });
        });
      }

      if (!Array.isArray(item.temporalConstraints)) {
        errors.push(`${path}.temporalConstraints`);
      } else {
        item.temporalConstraints.forEach((constraint, constraintIndex) => {
          const constraintPath = `${path}.temporalConstraints[${constraintIndex}]`;
          if (!isRecord(constraint)) {
            errors.push(`${constraintPath}:not-object`);
            return;
          }
          validateExactKeys(
            constraint,
            [
              'localId',
              'targetLocalId',
              'kind',
              'dateExpression',
              'startTime',
              'endTime',
              'precision',
              'sourceText',
            ],
            constraintPath,
            errors,
          );
          registerLocalId(constraint.localId, `${constraintPath}.localId`, allIds, errors);
          if (!isEnumValue(constraint.kind, SEMANTIC_TEMPORAL_CONSTRAINT_KINDS)) {
            errors.push(`${constraintPath}.kind`);
          }
          if (!isNullableString(constraint.dateExpression)) errors.push(`${constraintPath}.dateExpression`);
          validateNullableClock(constraint.startTime, `${constraintPath}.startTime`, errors);
          validateNullableClock(constraint.endTime, `${constraintPath}.endTime`, errors);
          if (!isEnumValue(constraint.precision, ['exact', 'approximate', 'unspecified'] as const)) {
            errors.push(`${constraintPath}.precision`);
          }
          if (constraint.kind === 'earliest_start' && !isNonEmptyString(constraint.startTime)) {
            errors.push(`${constraintPath}:missing-start`);
          }
          if (constraint.kind === 'latest_end' && !isNonEmptyString(constraint.endTime)) {
            errors.push(`${constraintPath}:missing-end`);
          }
          if (constraint.kind === 'fixed_interval'
            && (!isNonEmptyString(constraint.startTime) || !isNonEmptyString(constraint.endTime))) {
            errors.push(`${constraintPath}:missing-interval`);
          }
          if (constraint.kind === 'deadline'
            && !isNonEmptyString(constraint.dateExpression)
            && !isNonEmptyString(constraint.endTime)) {
            errors.push(`${constraintPath}:missing-deadline`);
          }
          validateSourceText(constraint, constraintPath, errors);
          if (taskId) deferredTargetChecks.push({ path: constraintPath, targetLocalId: constraint.targetLocalId, taskId });
        });
      }

      if (!Array.isArray(item.recurrence)) {
        errors.push(`${path}.recurrence`);
      } else {
        item.recurrence.forEach((recurrence, recurrenceIndex) => {
          const recurrencePath = `${path}.recurrence[${recurrenceIndex}]`;
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
          if (!isEnumValue(recurrence.kind, SEMANTIC_RECURRENCE_KINDS)) {
            errors.push(`${recurrencePath}.kind`);
          }
          if (recurrence.count !== null && !isFinitePositiveNumber(recurrence.count)) {
            errors.push(`${recurrencePath}.count`);
          }
          if (recurrence.kind === 'times_per_week' && !isFinitePositiveNumber(recurrence.count)) {
            errors.push(`${recurrencePath}.count:required`);
          }
          if (!Array.isArray(recurrence.days)
            || recurrence.days.some((day) => !isNonEmptyString(day))) {
            errors.push(`${recurrencePath}.days`);
          }
          validateSourceText(recurrence, recurrencePath, errors);
          if (taskId) deferredTargetChecks.push({ path: recurrencePath, targetLocalId: recurrence.targetLocalId, taskId });
        });
      }
    });
  }

  for (const check of deferredTargetChecks) {
    if (!isNonEmptyString(check.targetLocalId)
      || !targetsByTask.get(check.taskId)?.has(check.targetLocalId)) {
      errors.push(`${check.path}.targetLocalId`);
    }
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
      validateExactKeys(relation, ['localId', 'kind', 'fromLocalId', 'toLocalId', 'sourceText'], path, errors);
      registerLocalId(relation.localId, `${path}.localId`, allIds, errors);
      if (!isEnumValue(relation.kind, ['before', 'after', 'depends_on', 'priority_over', 'sequence'] as const)) {
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

  if (!Array.isArray(value.uncertainties)) {
    errors.push('document.uncertainties:not-array');
  } else {
    value.uncertainties.forEach((uncertainty, index) => {
      const path = `document.uncertainties[${index}]`;
      if (!isRecord(uncertainty)) {
        errors.push(`${path}:not-object`);
        return;
      }
      validateExactKeys(uncertainty, ['localId', 'targetLocalId', 'field', 'reason', 'sourceText'], path, errors);
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
      validateExactKeys(
        correction,
        ['localId', 'target', 'operation', 'replacementLocalId', 'sourceText'],
        path,
        errors,
      );
      registerLocalId(correction.localId, `${path}.localId`, allIds, errors);
      const target = validateSemanticReference(correction.target, `${path}.target`, errors);
      if (target?.localId) deferredReferenceChecks.push({ path: `${path}.target.localId`, localId: target.localId });
      if (!isEnumValue(correction.operation, ['remove', 'replace', 'modify'] as const)) {
        errors.push(`${path}.operation`);
      }
      if (!isNullableString(correction.replacementLocalId)) {
        errors.push(`${path}.replacementLocalId`);
      } else if (correction.operation === 'remove' && correction.replacementLocalId !== null) {
        errors.push(`${path}.replacementLocalId:forbidden`);
      } else if (correction.operation !== 'remove' && !isNonEmptyString(correction.replacementLocalId)) {
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
      validateExactKeys(decision, ['localId', 'target', 'decision', 'sourceText'], path, errors);
      registerLocalId(decision.localId, `${path}.localId`, allIds, errors);
      const target = validateSemanticReference(decision.target, `${path}.target`, errors);
      if (target?.localId) deferredReferenceChecks.push({ path: `${path}.target.localId`, localId: target.localId });
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
    document: errors.length === 0 ? value as unknown as WeeklyPlanningSemanticDocument : null,
    errors,
  };
}

export function parseWeeklyPlanningSemanticDocument(
  content: string,
): WeeklyPlanningSemanticValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['document:invalid-json'] };
  }
  return validateWeeklyPlanningSemanticValue(value);
}
