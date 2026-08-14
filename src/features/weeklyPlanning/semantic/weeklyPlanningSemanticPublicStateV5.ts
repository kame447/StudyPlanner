import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  buildWeeklyPlanningGraphSourceMemoryV5,
  type WeeklyPlanningEpisodicMemoryV5,
} from './weeklyPlanningEpisodicMemoryV5';

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

function compactEpisodicEvidence(
  memory: WeeklyPlanningEpisodicMemoryV5,
): Record<string, unknown> {
  return {
    version: memory.version,
    items: memory.items.map((item) => ({
      factIds: item.factIds,
      sourceExcerpts: item.sourceExcerpts,
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
  return {
    ...baseRuntimeSummary(summary),
    ...correctionTargetPublicFacts(graph),
    graphRevision: graph.revision,
    episodicMemory: compactEpisodicEvidence(episodicMemory),
  };
}
