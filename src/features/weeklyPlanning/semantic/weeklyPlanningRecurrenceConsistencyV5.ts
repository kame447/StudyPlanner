import {
  SEMANTIC_RECURRENCE_KINDS_V5,
  type SemanticRecurrenceKindV5,
  type SemanticRecurrenceV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_RECURRENCE_CONSISTENCY_VERSION_V5 =
  'weekly-planning-recurrence-consistency-v5' as const;

const RECURRENCE_KINDS = new Set<string>(SEMANTIC_RECURRENCE_KINDS_V5);
const DETERMINISTICALLY_DERIVABLE_RECURRENCE_KINDS = new Set<SemanticRecurrenceKindV5>([
  'daily',
  'weekly',
  'weekdays',
  'weekends',
]);

function expectedRecurrence(periodExpression: string | null): SemanticRecurrenceKindV5 | null {
  if (!periodExpression) return null;
  const normalized = periodExpression.normalize('NFKC').trim().toLowerCase();
  if (normalized.startsWith('custom:')) return 'custom';
  return RECURRENCE_KINDS.has(normalized)
    ? normalized as SemanticRecurrenceKindV5
    : null;
}

function recurrenceCoversTarget(params: {
  recurrence: readonly SemanticRecurrenceV5[];
  taskLocalId: string;
  targetLocalId: string;
  kind: SemanticRecurrenceKindV5;
}): boolean {
  return params.recurrence.some(
    (recurrence) => (
      recurrence.targetLocalId === params.targetLocalId
      || recurrence.targetLocalId === params.taskLocalId
    ) && recurrence.kind === params.kind,
  );
}

function collectLocalIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalIds(item, ids));
    return ids;
  }
  if (typeof value !== 'object' || value === null) return ids;
  const record = value as Record<string, unknown>;
  if (typeof record.localId === 'string' && record.localId.trim()) {
    ids.add(record.localId);
  }
  Object.values(record).forEach((item) => collectLocalIds(item, ids));
  return ids;
}

function generatedRecurrenceLocalId(params: {
  targetLocalId: string;
  kind: SemanticRecurrenceKindV5;
  usedLocalIds: Set<string>;
}): string {
  const safeTarget = params.targetLocalId.replace(/[^A-Za-z0-9_-]+/g, '_');
  const base = `canonical_recurrence_${safeTarget}_${params.kind}`;
  let candidate = base;
  let suffix = 2;
  while (params.usedLocalIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  params.usedLocalIds.add(candidate);
  return candidate;
}

export interface WeeklyPlanningRecurrenceNormalizationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

/**
 * Materializes recurrence objects when the semantic workload already states the
 * same frequency explicitly through perOccurrence + periodExpression.
 *
 * This is representation canonicalization, not raw-text interpretation. Only
 * recurrence kinds whose complete semantic meaning is mechanically available
 * from the workload are inferred. times_per_week needs a count and custom needs
 * additional pattern semantics, so those remain validation errors when the AI
 * omits their explicit recurrence object.
 */
export function normalizeWeeklyPlanningRecurrenceConsistencyV5(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningRecurrenceNormalizationResultV5 {
  const repairs: string[] = [];
  const usedLocalIds = collectLocalIds(document);

  const tasks = document.tasks.map((task, taskIndex) => {
    const recurrence = [...task.recurrence];

    const ensureWorkloadRecurrence = (
      workloads: typeof task.workloads,
      targetLocalId: string,
      path: string,
    ): void => {
      workloads.forEach((workload, workloadIndex) => {
        if (!workload.perOccurrence) return;
        const expected = expectedRecurrence(workload.periodExpression);
        if (!expected || !DETERMINISTICALLY_DERIVABLE_RECURRENCE_KINDS.has(expected)) return;
        if (recurrenceCoversTarget({
          recurrence,
          taskLocalId: task.localId,
          targetLocalId,
          kind: expected,
        })) return;

        recurrence.push({
          localId: generatedRecurrenceLocalId({
            targetLocalId,
            kind: expected,
            usedLocalIds,
          }),
          targetLocalId,
          kind: expected,
          count: null,
          days: [],
          sourceText: workload.sourceText,
        });
        repairs.push(
          `recurrence-materialized-from-workload:${path}[${workloadIndex}]:${expected}:target=${targetLocalId}`,
        );
      });
    };

    ensureWorkloadRecurrence(
      task.workloads,
      task.localId,
      `document.tasks[${taskIndex}].workloads`,
    );
    for (const [componentIndex, component] of (task.study?.components ?? []).entries()) {
      ensureWorkloadRecurrence(
        component.workloads,
        component.localId,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].workloads`,
      );
    }

    return recurrence.length === task.recurrence.length
      ? task
      : { ...task, recurrence };
  });

  return {
    document: repairs.length === 0 ? document : { ...document, tasks },
    repairs,
  };
}

export function validateWeeklyPlanningRecurrenceConsistencyV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];

  for (const [taskIndex, task] of document.tasks.entries()) {
    const checkWorkloads = (
      workloads: typeof task.workloads,
      targetLocalId: string,
      path: string,
    ): void => {
      workloads.forEach((workload, workloadIndex) => {
        if (!workload.perOccurrence) return;
        const expected = expectedRecurrence(workload.periodExpression);
        if (!expected) return;
        const matching = recurrenceCoversTarget({
          recurrence: task.recurrence,
          taskLocalId: task.localId,
          targetLocalId,
          kind: expected,
        });
        if (!matching) {
          errors.push(
            `${path}[${workloadIndex}]:explicit-recurrence-missing:expected=${expected}:target=${targetLocalId}`,
          );
        }
      });
    };

    checkWorkloads(task.workloads, task.localId, `document.tasks[${taskIndex}].workloads`);
    for (const [componentIndex, component] of (task.study?.components ?? []).entries()) {
      checkWorkloads(
        component.workloads,
        component.localId,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].workloads`,
      );
    }
  }

  return errors;
}
