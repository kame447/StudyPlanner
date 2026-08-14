import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  buildWeeklyPlanningGraphSourceMemoryV5,
} from './weeklyPlanningEpisodicMemoryV5';

export const WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5 = {
  version: 'weekly-planning-correction-targeting-contract-v5',
  targetIdentity: 'Target the exact active publicId and matching fact kind; if not unique, emit uncertainty.',
  replacementIdentity: 'Emit only the current-turn replacement; replacementLocalId is its fresh localId.',
  minimalDelta: 'Current-turn delta only; omit unrelated accepted facts.',
  multipleTargets: 'One correction per explicit target; never swap targets.',
  ambiguity: 'Ambiguous target: emit uncertainty, never guess a publicId.',
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

function hasCorrectionTargets(facts: Record<string, unknown>): boolean {
  return Object.values(facts).some(
    (value) => Array.isArray(value) && value.length > 0,
  );
}

function pendingQuestionFactId(summary: Record<string, unknown> | undefined): string | null {
  const pending = summary?.pendingQuestion;
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return null;
  const targetFactId = (pending as Record<string, unknown>).targetFactId;
  return typeof targetFactId === 'string' && targetFactId.trim()
    ? targetFactId
    : null;
}

function baseRuntimeSummary(
  summary: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!summary) return {};
  const {
    correctionContract: _staleCorrectionContract,
    episodicMemory: _staleEpisodicMemory,
    ...runtimeSummary
  } = summary;
  return runtimeSummary;
}

export function createWeeklyPlanningSemanticPublicStateSummaryV5(
  summary: Record<string, unknown> | undefined,
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> {
  const episodicMemory = buildWeeklyPlanningGraphSourceMemoryV5({
    graph,
    priorityFactId: pendingQuestionFactId(summary),
  });
  const correctionTargets = correctionTargetPublicFacts(graph);
  return {
    ...baseRuntimeSummary(summary),
    ...correctionTargets,
    graphRevision: graph.revision,
    ...(hasCorrectionTargets(correctionTargets)
      ? { correctionContract: WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5 }
      : {}),
    episodicMemory,
  };
}
