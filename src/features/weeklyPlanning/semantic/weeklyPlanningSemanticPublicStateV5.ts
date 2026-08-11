import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  buildWeeklyPlanningGraphSourceMemoryV5,
} from './weeklyPlanningEpisodicMemoryV5';

export const WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5 = {
  version: 'weekly-planning-correction-targeting-contract-v5',
  targetIdentity: 'For an explicit correction of an accepted public fact, set correction.target.publicId to the exact publicId from publicStateSummary and set correction.target.kind to the matching fact kind.',
  replacementIdentity: 'Create only the replacement fact stated by the user in the current semantic document and set correction.replacementLocalId to that fact localId.',
  minimalDelta: 'Do not copy unrelated accepted facts from publicStateSummary. Include only facts newly stated or changed in the current utterance.',
  multipleTargets: 'For multiple explicit corrections, emit one correction per exact target and do not exchange targets between tasks.',
  ambiguity: 'When the corrected target cannot be identified uniquely from publicStateSummary, do not guess a publicId. Emit an uncertainty describing the unresolved correction target.',
} as const;

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function correctionTargetPublicFacts(
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> {
  const activeIds = activeFactIds(graph);
  return {
    planningWindows: graph.planningWindows
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        kind: fact.kind,
        value: fact.value,
        start: fact.start,
        end: fact.end,
      })),
    tasks: graph.tasks
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        category: fact.category,
        title: fact.title,
      })),
    components: graph.components
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        parentComponentPublicId: fact.parentComponentId,
        role: fact.role,
        label: fact.label,
      })),
    workloads: graph.workloads
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        componentPublicId: fact.componentId,
        quantityRole: fact.quantityRole,
        amount: fact.amount,
        unitCode: fact.unitCode,
        unitLabel: fact.unitLabel,
      })),
    effortEstimates: graph.effortEstimates
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        minutes: fact.minutes,
        unitCode: fact.unitCode,
        precision: fact.precision,
      })),
    temporalConstraints: graph.temporalConstraints
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        constraintLevel: fact.constraintLevel,
        dateExpression: fact.dateExpression,
        namedTimePeriod: fact.namedTimePeriod,
        startTime: fact.startTime,
        endTime: fact.endTime,
      })),
    recurrences: graph.recurrences
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        count: fact.count,
        days: fact.days,
      })),
  };
}

function pendingQuestionFactId(summary: Record<string, unknown> | undefined): string | null {
  const pending = summary?.pendingQuestion;
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return null;
  const targetFactId = (pending as Record<string, unknown>).targetFactId;
  return typeof targetFactId === 'string' && targetFactId.trim()
    ? targetFactId
    : null;
}

export function createWeeklyPlanningSemanticPublicStateSummaryV5(
  summary: Record<string, unknown> | undefined,
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> {
  const episodicMemory = buildWeeklyPlanningGraphSourceMemoryV5({
    graph,
    priorityFactId: pendingQuestionFactId(summary),
  });
  return {
    ...(summary ?? {}),
    ...correctionTargetPublicFacts(graph),
    graphRevision: graph.revision,
    correctionContract: WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5,
    episodicMemory,
  };
}
