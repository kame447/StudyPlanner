import {
  SEMANTIC_TASK_DATE_RULE_KINDS,
  type SemanticTaskDateRuleKind,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import {
  parseWeeklyPlanningSemanticDocumentV2 as parseBaseDocument,
  validateWeeklyPlanningSemanticValueV2 as validateBaseValue,
  type WeeklyPlanningSemanticValidationResultV2,
} from './weeklyPlanningSemanticValidatorV2';
import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDateRuleKind(value: unknown): value is SemanticTaskDateRuleKind {
  return typeof value === 'string'
    && (SEMANTIC_TASK_DATE_RULE_KINDS as readonly string[]).includes(value);
}

function projectWithoutDateRules(value: unknown): unknown {
  const projected = cloneValue(value);
  if (!isRecord(projected) || !Array.isArray(projected.tasks)) return projected;
  for (const task of projected.tasks) {
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) continue;
    task.temporalConstraints = task.temporalConstraints.filter((constraint) =>
      !isRecord(constraint) || !isDateRuleKind(constraint.kind));
  }
  return projected;
}

function collectLocalIds(value: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const add = (candidate: unknown): void => {
    if (typeof candidate === 'string' && candidate.trim()) ids.push(candidate);
  };

  if (isRecord(value.planningWindow)) add(value.planningWindow.localId);
  if (Array.isArray(value.tasks)) {
    for (const task of value.tasks) {
      if (!isRecord(task)) continue;
      add(task.localId);
      if (Array.isArray(task.workloads)) {
        for (const workload of task.workloads) if (isRecord(workload)) add(workload.localId);
      }
      if (isRecord(task.study) && Array.isArray(task.study.components)) {
        for (const component of task.study.components) {
          if (!isRecord(component)) continue;
          add(component.localId);
          if (Array.isArray(component.workloads)) {
            for (const workload of component.workloads) {
              if (isRecord(workload)) add(workload.localId);
            }
          }
        }
      }
      if (Array.isArray(task.effortEstimates)) {
        for (const estimate of task.effortEstimates) if (isRecord(estimate)) add(estimate.localId);
      }
      if (Array.isArray(task.temporalConstraints)) {
        for (const constraint of task.temporalConstraints) if (isRecord(constraint)) add(constraint.localId);
      }
      if (Array.isArray(task.recurrence)) {
        for (const recurrence of task.recurrence) if (isRecord(recurrence)) add(recurrence.localId);
      }
    }
  }
  for (const key of [
    'relations',
    'uncertainties',
    'corrections',
    'decisions',
    'availabilityDeclarations',
    'constraintSourceRequests',
  ] as const) {
    const entries = value[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) if (isRecord(entry)) add(entry.localId);
  }
  return ids;
}

function validateDateRules(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const ids = collectLocalIds(value);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`document.localId:duplicate:${id}`);
    seen.add(id);
  }

  if (!Array.isArray(value.tasks)) return errors;
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return;
    task.temporalConstraints.forEach((constraint, constraintIndex) => {
      if (!isRecord(constraint) || !isDateRuleKind(constraint.kind)) return;
      const path = `document.tasks[${taskIndex}].temporalConstraints[${constraintIndex}]`;
      if (constraint.targetLocalId !== task.localId) {
        errors.push(`${path}.targetLocalId:must-target-containing-task`);
      }
      if (
        typeof constraint.dateExpression !== 'string'
        || !constraint.dateExpression.trim()
        || !isCanonicalDateExpressionSyntax(constraint.dateExpression)
      ) {
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
      if (!['exact', 'approximate', 'unspecified'].includes(String(constraint.precision))) {
        errors.push(`${path}.precision`);
      }
      if (typeof constraint.sourceText !== 'string' || !constraint.sourceText.trim()) {
        errors.push(`${path}.sourceText`);
      }
    });
  });
  return errors;
}

export function validateWeeklyPlanningSemanticValueV2WithDateRules(
  value: unknown,
): WeeklyPlanningSemanticValidationResultV2 {
  const base = validateBaseValue(projectWithoutDateRules(value));
  if (!isRecord(value)) return base;
  const errors = [...base.errors, ...validateDateRules(value)];
  return {
    document: errors.length === 0
      ? value as unknown as WeeklyPlanningSemanticDocumentV2
      : null,
    errors,
  };
}

export function parseWeeklyPlanningSemanticDocumentV2WithDateRules(
  content: string,
): WeeklyPlanningSemanticValidationResultV2 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['document:invalid-json'] };
  }
  return validateWeeklyPlanningSemanticValueV2WithDateRules(value);
}

export { parseBaseDocument };
