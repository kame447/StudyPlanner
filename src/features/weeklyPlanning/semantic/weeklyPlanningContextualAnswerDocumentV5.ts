import {
  SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskCategoryV5,
  type SemanticWorkloadUnitCodeV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  groundedDurationMinutesFromUserTextV5,
  groundedQuantityRoleFromUserTextV5,
  hasWeeklyPlanningContextualScopeChangeCueV5,
} from './weeklyPlanningContextualAnswerGroundingV5';
import {
  isWeeklyPlanningContextualQuestionCodeV5,
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';

export interface GroundedContextualAnswerDocumentResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

interface PublicTaskV5 {
  publicId: string;
  category: SemanticTaskCategoryV5;
  title: string;
}

interface PublicWorkloadV5 {
  publicId: string;
  taskPublicId: string;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function taskCategory(value: unknown): SemanticTaskCategoryV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_TASK_CATEGORIES_V5 as readonly string[]).includes(value)
    ? value as SemanticTaskCategoryV5
    : null;
}

function workloadUnit(value: unknown): SemanticWorkloadUnitCodeV5 | null {
  return typeof value === 'string'
    && (SEMANTIC_WORKLOAD_UNIT_CODES_V5 as readonly string[]).includes(value)
    ? value as SemanticWorkloadUnitCodeV5
    : null;
}

function readPublicTask(
  publicStateSummary: Record<string, unknown>,
  publicId: string,
): PublicTaskV5 | null {
  const value = records(publicStateSummary.tasks)
    .find((candidate) => candidate.publicId === publicId);
  if (!value) return null;
  const category = taskCategory(value.category);
  if (category === null || typeof value.title !== 'string' || !value.title.trim()) {
    return null;
  }
  return { publicId, category, title: value.title.trim() };
}

function readTargetWorkload(
  publicStateSummary: Record<string, unknown>,
  publicId: string,
): PublicWorkloadV5 | null {
  const value = records(publicStateSummary.workloads)
    .find((candidate) => candidate.publicId === publicId);
  if (!value) return null;
  const unitCode = workloadUnit(value.unitCode);
  if (
    typeof value.taskPublicId !== 'string'
    || !value.taskPublicId
    || typeof value.amount !== 'number'
    || !Number.isFinite(value.amount)
    || value.amount <= 0
    || unitCode === null
    || typeof value.unitLabel !== 'string'
    || !value.unitLabel.trim()
  ) {
    return null;
  }
  return {
    publicId,
    taskPublicId: value.taskPublicId,
    amount: value.amount,
    unitCode,
    unitLabel: value.unitLabel.trim(),
  };
}

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function taskShell(task: PublicTaskV5, sourceText: string) {
  return {
    localId: 'contextual-task',
    category: task.category,
    title: task.title,
    study: task.category === 'study'
      ? {
          purpose: 'unknown' as const,
          contextLabel: null,
          components: [],
        }
      : null,
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText,
  };
}

function targetDurationMinutes(workload: PublicWorkloadV5): number | null {
  if (workload.unitCode === 'hour') return workload.amount * 60;
  if (workload.unitCode === 'minute') return workload.amount;
  return null;
}

function explicitDurationMatchesTarget(
  userText: string,
  workload: PublicWorkloadV5,
): boolean {
  const durations = groundedDurationMinutesFromUserTextV5(userText);
  if (durations.length === 0) return true;
  const expected = targetDurationMinutes(workload);
  return expected !== null
    && durations.length === 1
    && Math.round(expected) === durations[0];
}

function effortPrecision(userText: string): 'exact' | 'approximate' {
  const normalized = userText.normalize('NFKC').replace(/\s+/g, '');
  return /(?:約|およそ|だいたい|くらい|ぐらい|ほど)/.test(normalized)
    ? 'approximate'
    : 'exact';
}

export function createGroundedContextualAnswerDocumentV5(params: {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}): GroundedContextualAnswerDocumentResultV5 | null {
  const summary = params.publicStateSummary;
  const pendingQuestion = readWeeklyPlanningPendingQuestionV5(summary);
  const userText = params.userText.trim();
  if (
    !summary
    || !pendingQuestion
    || !isWeeklyPlanningContextualQuestionCodeV5(pendingQuestion.questionCode)
    || typeof pendingQuestion.targetFactId !== 'string'
    || !pendingQuestion.targetFactId
    || typeof summary.graphRevision !== 'number'
    || summary.graphRevision !== pendingQuestion.graphRevision
    || userText.length === 0
    || userText.length > 40
    || hasWeeklyPlanningContextualScopeChangeCueV5(userText)
  ) {
    return null;
  }

  const workload = readTargetWorkload(summary, pendingQuestion.targetFactId);
  if (!workload) return null;
  const task = readPublicTask(summary, workload.taskPublicId);
  if (!task) return null;

  if (pendingQuestion.questionCode === 'quantity_role_unresolved') {
    const role = groundedQuantityRoleFromUserTextV5(userText);
    if (role === null || !explicitDurationMatchesTarget(userText, workload)) return null;
    const document = emptyDocument();
    const contextualTask = taskShell(task, userText);
    contextualTask.workloads.push({
      localId: 'contextual-workload',
      quantityRole: role,
      amount: workload.amount,
      unitCode: workload.unitCode,
      unitLabel: workload.unitLabel,
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: userText,
    });
    document.tasks.push(contextualTask);
    return {
      document,
      repairs: [
        `contextual-answer-grounded-from-machine-question:${pendingQuestion.questionCode}`,
      ],
    };
  }

  const durations = groundedDurationMinutesFromUserTextV5(userText);
  if (durations.length !== 1) return null;
  const document = emptyDocument();
  const contextualTask = taskShell(task, userText);
  contextualTask.effortEstimates.push({
    localId: 'contextual-effort',
    targetLocalId: contextualTask.localId,
    kind: 'total_duration',
    minutes: durations[0],
    unitCode: null,
    precision: effortPrecision(userText),
    sourceText: userText,
  });
  document.tasks.push(contextualTask);
  return {
    document,
    repairs: [
      `contextual-answer-grounded-from-machine-question:${pendingQuestion.questionCode}`,
    ],
  };
}
