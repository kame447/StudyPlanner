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
 *
 * These checks never derive meaning from labels/sourceText. The AI has already
 * selected the semantic kind and targets; code verifies only structure,
 * supported values, local-ID isolation, and date-expression syntax.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 * - docs/ai/tasks/20260807-weekly-planning-goal-event-date-vs-work-deadline.md
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

  const hasUserContextFacts = Object.prototype.hasOwnProperty.call(value, 'userContextFacts');
  const weeklyValue = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'userContextFacts'),
  );
  const legacy = validateLegacySemanticValueV5(weeklyValue);
  const legacyErrors = legacy.errors.filter(
    (error) => !isValidWorkloadEffortTargetError(error, weeklyValue),
  );
  const contextErrors = hasUserContextFacts
    ? validateUserContextFacts(value.userContextFacts, collectLocalIds(weeklyValue))
    : ['document.userContextFacts:missing-key'];
  const errors = [...legacyErrors, ...contextErrors];
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
