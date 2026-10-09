import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { UncertaintyFactV5, WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  hasWeeklyPlanningSemanticUncertaintyResolutionV5,
  isKnownWeeklyPlanningUncertaintyFieldV5,
} from './weeklyPlanningSemanticUncertaintyResolutionV5';

/**
 * Deterministic end state for a blocking FREE-FORM question (Issue #488 H-release).
 *
 * The code cannot read a free-form question, so structure is not the only way it can end. The user's own
 * typed act is: a fresh `answer_pending_question` bound exactly to the presented question, while the
 * reading no longer re-declares it, releases it. A release is not a resolution: the application states
 * that the point stays unconfirmed (see the disclosure text), so it is never silent.
 *
 * Never releases: known structural fields (readiness is deterministic), an unbound/null/stale act, a
 * re-declaration, or content that never qualifies (rate, effort/session, clock budget, replayed
 * workload, task shell, deltas on other targets, plan-wide availability).
 */
export const WEEKLY_PLANNING_RELEASED_UNCERTAINTY_OPERATION_V5 = 'released-free-form-uncertainty';

type Task = WeeklyPlanningSemanticDocumentV5['tasks'][number];

function isPureExistingShell(task: Task): boolean {
  return typeof task.existingPublicId === 'string' && task.existingPublicId.length > 0
    && task.workloads.length === 0
    && task.effortEstimates.length === 0
    && task.temporalConstraints.length === 0
    && task.recurrence.length === 0
    && (task.durableContextSignals?.length ?? 0) === 0
    && (task.study?.components.length ?? 0) === 0;
}

function hasNoDeltaAnywhere(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.planningWindow === null
    && document.tasks.every(isPureExistingShell)
    && document.relations.length === 0
    && document.availabilityDeclarations.length === 0
    && document.constraintSourceRequests.length === 0
    && (document.userContextFacts?.length ?? 0) === 0
    && document.uncertainties.length === 0
    && document.corrections.length === 0
    && document.decisions.length === 0;
}

/** New, target-bound, non-effort content on U's own target (the included kinds). */
function hasQualifyingDeltaOnTarget(
  graph: WeeklyPlanningFactGraphV5,
  document: WeeklyPlanningSemanticDocumentV5,
  target: string,
): boolean {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph).temporalConstraints
    .filter((constraint) => constraint.taskId === target);
  return document.tasks
    .filter((task) => task.existingPublicId === target)
    .some((task) =>
      task.recurrence.length > 0
      || (task.durableContextSignals?.length ?? 0) > 0
      || task.temporalConstraints.some((constraint) => !active.some((existing) =>
        existing.kind === constraint.kind
        && existing.constraintLevel === constraint.constraintLevel
        && existing.dateExpression === constraint.dateExpression
        && existing.namedTimePeriod === constraint.namedTimePeriod
        && existing.startTime === constraint.startTime
        && existing.endTime === constraint.endTime)));
}

export function releasedFreeFormUncertaintyIdsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: { questionCode: string; targetFactId: string | null } | null | undefined;
  /** The existing bounded no-op retry ran (more than one semantic read) and the reading is still empty. */
  noOpRetryConfirmed: boolean;
}): string[] {
  const { graph, document, pendingQuestion } = params;
  if (!pendingQuestion || pendingQuestion.questionCode !== 'semantic_uncertainty' || !pendingQuestion.targetFactId) return [];
  const uncertainty: UncertaintyFactV5 | undefined = graph.uncertainties.find((fact) => fact.id === pendingQuestion.targetFactId);
  if (!uncertainty
    || !graph.factLifecycles.some((entry) => entry.factId === uncertainty.id && entry.status === 'active')
    || isKnownWeeklyPlanningUncertaintyFieldV5(uncertainty.field)) return [];
  const bound = (document.conversationActs ?? []).some((act) => act.kind === 'answer_pending_question'
    && typeof act.targetPublicId === 'string'
    && (act.targetPublicId === uncertainty.id || act.targetPublicId === uncertainty.targetFactId));
  if (!bound) return [];
  const target = uncertainty.targetFactId;
  const redeclared = document.uncertainties.some((current) => current.field === uncertainty.field
    && (current.targetLocalId === null || target === null
      || document.tasks.some((task) => task.localId === current.targetLocalId && task.existingPublicId === target)));
  if (redeclared) return [];
  // A structural resolution is the normal path's, not a release.
  if (hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph, document, uncertainty })) return [];
  const qualifies = target !== null && hasQualifyingDeltaOnTarget(graph, document, target);
  const noDelta = params.noOpRetryConfirmed && hasNoDeltaAnywhere(document);
  return qualifies || noDelta ? [uncertainty.id] : [];
}

/** Uncertainties released by THIS turn (typed, from the lifecycle operation keys; no re-derivation). */
export function releasedUncertaintiesOfTurnV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  operationKeyPrefix: string;
}): UncertaintyFactV5[] {
  const marker = `${params.operationKeyPrefix}:${WEEKLY_PLANNING_RELEASED_UNCERTAINTY_OPERATION_V5}:`;
  const ids = new Set(params.graph.appliedLifecycleOperationKeys
    .filter((key) => key.startsWith(marker))
    .map((key) => key.slice(marker.length)));
  return params.graph.uncertainties.filter((fact) => ids.has(fact.id));
}
