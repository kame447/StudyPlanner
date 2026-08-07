import {
  USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1,
} from '../../userPlanningContext/userPlanningContextTypes';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  isCanonicalDateExpressionSyntax,
} from './weeklyPlanningCalendarResolver';
import {
  validateWeeklyPlanningSemanticValueV5 as validateLegacySemanticValueV5,
} from './weeklyPlanningSemanticValidatorLegacyV5';
import {
  validateWeeklyPlanningUserContextConsistencyV5,
} from './weeklyPlanningUserContextConsistencyV5';

/*
 * Semantic ownership boundary
 *
 * The legacy core retains the existing structural, range, date, reference, and
 * lifecycle checks. This wrapper changes only schema-boundary mechanics that
 * are intentionally outside the legacy graph model:
 *
 * - effort estimates may target a workload inside the same task
 * - userContextFacts are validated separately and never canonicalized into the
 *   week-scoped PlanningFactGraph
 * - one identical evidence span cannot simultaneously justify a goal-event
 *   occurrence and a work-completion deadline at the same date; distinct
 *   explicit completion evidence is required for both concepts to coexist
 *
 * The OpenAI JSON Schema requires userContextFacts on new provider responses.
 * The TypeScript/runtime wrapper accepts an omitted field only for pre-migration
 * fixtures/checkpoints and treats it as an empty delta.
 *
 * These checks never derive meaning from raw user text. The AI has already
 * selected semantic kinds; code verifies structure and consistency of those
 * structured claims.
 */
export interface WeeklyPlanningSemanticValidationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workloadIdsInTask(task: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const registerWorkloads = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const workload of value) {
      if (isRecord(workload) && typeof workload.localId === 'string' && workload.localId) {
        ids.add(workload.localId);
      }
    }
  };

  registerWorkloads(task.workloads);
  if (isRecord(task.study) && Array.isArray(task.study.components)) {
    for (const component of task.study.components) {
      if (isRecord(component)) registerWorkloads(component.workloads);
    }
  }
  return ids;
}

function isValidWorkloadEffortTargetError(
  error: string,
  value: Record<string, unknown>,
): boolean {
  const match = /^document\.tasks\[(\d+)]\.effortEstimates\[(\d+)]\.targetLocalId$/.exec(error);
  if (!match || !Array.isArray(value.tasks)) return false;

  const task = value.tasks[Number(match[1])];
  if (!isRecord(task) || !Array.isArray(task.effortEstimates)) return false;
  const estimate = task.effortEstimates[Number(match[2])];
  if (!isRecord(estimate) || typeof estimate.targetLocalId !== 'string') return false;

  return workloadIdsInTask(task).has(estimate.targetLocalId);
}

function stripSemanticExtensions(value: Record<string, unknown>): Record<string, unknown> {
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map((task) => {
        if (!isRecord(task)) return task;
        const {
          durableContextSignals: _taskSignals,
          existingPublicId: _taskExistingPublicId,
          ...taskRest
        } = task;
        if (!isRecord(taskRest.study) || !Array.isArray(taskRest.study.components)) {
          return taskRest;
        }
        const components = taskRest.study.components.map((component) => {
          if (!isRecord(component)) return component;
          const {
            durableContextSignals: _componentSignals,
            existingPublicId: _componentExistingPublicId,
            ...componentRest
          } = component;
          return componentRest;
        });
        return {
          ...taskRest,
          study: { ...taskRest.study, components },
        };
      })
    : value.tasks;
  return { ...value, tasks };
}

function collectLocalIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalIds(item, ids));
    return ids;
  }
  if (!isRecord(value)) return ids;
  if (typeof value.localId === 'string' && value.localId.trim()) ids.add(value.localId);
  Object.values(value).forEach((item) => collectLocalIds(item, ids));
  return ids;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateExistingPublicIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.tasks)) return [];
  const errors: string[] = [];
  const validateId = (id: unknown, path: string): void => {
    if (id === undefined) return;
    if (!(id === null || (typeof id === 'string' && id.trim().length > 0))) {
      errors.push(`${path}:expected-non-empty-string-or-null`);
    }
  };
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task)) return;
    validateId(task.existingPublicId, `document.tasks[${taskIndex}].existingPublicId`);
    if (!isRecord(task.study) || !Array.isArray(task.study.components)) return;
    task.study.components.forEach((component, componentIndex) => {
      if (!isRecord(component)) return;
      validateId(
        component.existingPublicId,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].existingPublicId`,
      );
    });
  });
  return errors;
}

function validateDurableContextSignals(
  value: Record<string, unknown>,
  occupiedLocalIds: Set<string>,
): string[] {
  if (!Array.isArray(value.tasks)) return [];
  const errors: string[] = [];
  const seen = new Set(occupiedLocalIds);
  const validateSignals = (signalsValue: unknown, path: string): void => {
    if (signalsValue === undefined) return;
    if (!Array.isArray(signalsValue)) {
      errors.push(`${path}:expected-array`);
      return;
    }
    signalsValue.forEach((signal, index) => {
      const signalPath = `${path}[${index}]`;
      if (!isRecord(signal)) {
        errors.push(`${signalPath}:expected-object`);
        return;
      }
      if (!hasOnlyKeys(signal, ['localId', 'kind', 'value', 'sourceText'])) {
        errors.push(`${signalPath}:unknown-key`);
      }
      if (typeof signal.localId !== 'string' || !signal.localId.trim()) {
        errors.push(`${signalPath}.localId:expected-non-empty-string`);
      } else if (seen.has(signal.localId)) {
        errors.push(`${signalPath}.localId:duplicate-local-id`);
      } else {
        seen.add(signal.localId);
      }
      if (signal.kind !== 'concern') errors.push(`${signalPath}.kind:unsupported-value`);
      if (!(signal.value === null || typeof signal.value === 'string')) {
        errors.push(`${signalPath}.value:expected-string-or-null`);
      }
      if (typeof signal.sourceText !== 'string' || !signal.sourceText.trim()) {
        errors.push(`${signalPath}.sourceText:expected-non-empty-string`);
      }
    });
  };
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task)) return;
    validateSignals(task.durableContextSignals, `document.tasks[${taskIndex}].durableContextSignals`);
    if (!isRecord(task.study) || !Array.isArray(task.study.components)) return;
    task.study.components.forEach((component, componentIndex) => {
      if (!isRecord(component)) return;
      validateSignals(
        component.durableContextSignals,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].durableContextSignals`,
      );
    });
  });
  return errors;
}

function validateUserContextFacts(
  value: unknown,
  occupiedLocalIds: Set<string>,
): string[] {
  if (!Array.isArray(value)) return ['document.userContextFacts:expected-array'];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const path = `document.userContextFacts[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path}:expected-object`);
      return;
    }
    if (!hasOnlyKeys(entry, [
      'localId',
      'kind',
      'label',
      'value',
      'dateExpression',
      'sourceText',
    ])) {
      errors.push(`${path}:unknown-key`);
    }
    if (typeof entry.localId !== 'string' || !entry.localId.trim()) {
      errors.push(`${path}.localId:expected-non-empty-string`);
    } else if (seen.has(entry.localId) || occupiedLocalIds.has(entry.localId)) {
      errors.push(`${path}.localId:duplicate-local-id`);
    } else {
      seen.add(entry.localId);
    }
    if (!(USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 as readonly unknown[]).includes(entry.kind)) {
      errors.push(`${path}.kind:unsupported-value`);
    }
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      errors.push(`${path}.label:expected-non-empty-string`);
    }
    if (!(entry.value === null || typeof entry.value === 'string')) {
      errors.push(`${path}.value:expected-string-or-null`);
    }
    if (!(entry.dateExpression === null || typeof entry.dateExpression === 'string')) {
      errors.push(`${path}.dateExpression:expected-string-or-null`);
    } else if (
      typeof entry.dateExpression === 'string'
      && !isCanonicalDateExpressionSyntax(entry.dateExpression)
    ) {
      errors.push(`${path}.dateExpression:unsupported-expression`);
    }
    if (entry.kind === 'concern' && entry.dateExpression !== null) {
      errors.push(`${path}.dateExpression:concern-must-be-null`);
    }
    if (typeof entry.sourceText !== 'string' || !entry.sourceText.trim()) {
      errors.push(`${path}.sourceText:expected-non-empty-string`);
    }
  });
  return errors;
}

export function validateWeeklyPlanningSemanticValueV5(
  value: unknown,
): WeeklyPlanningSemanticValidationResultV5 {
  if (!isRecord(value)) return validateLegacySemanticValueV5(value);

  const weeklyValue = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'userContextFacts'),
  );
  const legacyWeeklyValue = stripSemanticExtensions(weeklyValue);
  const legacy = validateLegacySemanticValueV5(legacyWeeklyValue);
  const legacyErrors = legacy.errors.filter(
    (error) => !isValidWorkloadEffortTargetError(error, legacyWeeklyValue),
  );
  const baseLocalIds = collectLocalIds(legacyWeeklyValue);
  const existingPublicIdErrors = validateExistingPublicIds(weeklyValue);
  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);
  const contextErrors = validateUserContextFacts(
    value.userContextFacts ?? [],
    collectLocalIds(weeklyValue),
  );
  const structuralErrors = [
    ...legacyErrors,
    ...existingPublicIdErrors,
    ...signalErrors,
    ...contextErrors,
  ];
  const document = structuralErrors.length === 0
    ? value as unknown as WeeklyPlanningSemanticDocumentV5
    : null;
  const consistencyErrors = document
    ? validateWeeklyPlanningUserContextConsistencyV5(document)
    : [];
  const errors = [...structuralErrors, ...consistencyErrors];
  return {
    document: errors.length === 0 ? document : null,
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
