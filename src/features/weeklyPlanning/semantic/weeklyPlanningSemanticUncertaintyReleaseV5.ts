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
/** Same release, ended by a reply that applied nothing at all (the application says so). */
export const WEEKLY_PLANNING_RELEASED_UNCERTAINTY_NO_DELTA_OPERATION_V5 = 'released-free-form-uncertainty-no-delta';

export interface ReleasedFreeFormUncertaintyV5 {
  id: string;
  basis: 'delta' | 'no_delta';
}

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

/**
 * New, target-bound, non-effort content on U's own target (the included kinds): a temporal constraint or a
 * recurrence the active graph does not already hold for that task (typed replay identity). Durable concern
 * signals are not included: the canonicalizer commits no fact for them, so they change nothing the planner reads.
 */
function hasQualifyingDeltaOnTarget(
  graph: WeeklyPlanningFactGraphV5,
  document: WeeklyPlanningSemanticDocumentV5,
  targetTaskId: string,
): boolean {
  const view = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const constraints = view.temporalConstraints.filter((constraint) => constraint.taskId === targetTaskId);
  const recurrences = view.recurrences.filter((recurrence) => recurrence.taskId === targetTaskId);
  const dayKey = (days: readonly string[]) => [...days].sort().join(',');
  return document.tasks
    .filter((task) => task.existingPublicId === targetTaskId)
    .some((task) =>
      task.recurrence.some((recurrence) => !recurrences.some((existing) =>
        existing.kind === recurrence.kind
        && existing.count === recurrence.count
        && dayKey(existing.days) === dayKey(recurrence.days)))
      || task.temporalConstraints.some((constraint) => !constraints.some((existing) =>
        existing.kind === constraint.kind
        && existing.constraintLevel === constraint.constraintLevel
        && existing.dateExpression === constraint.dateExpression
        && existing.namedTimePeriod === constraint.namedTimePeriod
        && existing.startTime === constraint.startTime
        && existing.endTime === constraint.endTime)));
}

export function releasedFreeFormUncertaintiesV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: { questionCode: string; targetFactId: string | null } | null | undefined;
  /** The existing bounded no-op retry ran (more than one semantic read) and the reading is still empty. */
  noOpRetryConfirmed: boolean;
}): ReleasedFreeFormUncertaintyV5[] {
  const { graph, document, pendingQuestion } = params;
  if (!pendingQuestion || pendingQuestion.questionCode !== 'semantic_uncertainty' || !pendingQuestion.targetFactId) return [];
  const uncertainty: UncertaintyFactV5 | undefined = graph.uncertainties.find((fact) => fact.id === pendingQuestion.targetFactId);
  if (!uncertainty
    || !graph.factLifecycles.some((entry) => entry.factId === uncertainty.id && entry.status === 'active')
    || isKnownWeeklyPlanningUncertaintyFieldV5(uncertainty.field)) return [];
  const target = uncertainty.targetFactId;
  // A component target is answered through its task (constraints and recurrences sit on tasks).
  const targetTaskId = target === null ? null
    : graph.components.find((component) => component.id === target)?.taskId ?? target;
  const bound = (document.conversationActs ?? []).some((act) => act.kind === 'answer_pending_question'
    && typeof act.targetPublicId === 'string'
    && (act.targetPublicId === uncertainty.id || act.targetPublicId === uncertainty.targetFactId
      || (targetTaskId !== null && act.targetPublicId === targetTaskId)));
  if (!bound) return [];
  const redeclared = document.uncertainties.some((current) => current.field === uncertainty.field
    && (current.targetLocalId === null || target === null
      || document.tasks.some((task) => task.localId === current.targetLocalId && task.existingPublicId === target)));
  if (redeclared) return [];
  // A structural resolution is the normal path's, not a release.
  if (hasWeeklyPlanningSemanticUncertaintyResolutionV5({ graph, document, uncertainty })) return [];
  if (targetTaskId !== null && hasQualifyingDeltaOnTarget(graph, document, targetTaskId)) return [{ id: uncertainty.id, basis: 'delta' }];
  if (params.noOpRetryConfirmed && hasNoDeltaAnywhere(document)) return [{ id: uncertainty.id, basis: 'no_delta' }];
  return [];
}

/** Uncertainties released by THIS turn (typed, from the lifecycle operation keys; no re-derivation). */
export function releasedUncertaintiesOfTurnV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  operationKeyPrefix: string;
}): Array<{ fact: UncertaintyFactV5; basis: 'delta' | 'no_delta' }> {
  const byBasis = (operation: string, basis: 'delta' | 'no_delta') => {
    const marker = `${params.operationKeyPrefix}:${operation}:`;
    return params.graph.appliedLifecycleOperationKeys
      .filter((key) => key.startsWith(marker))
      .map((key) => ({ id: key.slice(marker.length), basis }));
  };
  const released = [
    ...byBasis(WEEKLY_PLANNING_RELEASED_UNCERTAINTY_OPERATION_V5, 'delta'),
    ...byBasis(WEEKLY_PLANNING_RELEASED_UNCERTAINTY_NO_DELTA_OPERATION_V5, 'no_delta'),
  ];
  return released.flatMap(({ id, basis }) => {
    const fact = params.graph.uncertainties.find((candidate) => candidate.id === id);
    return fact ? [{ fact, basis }] : [];
  });
}

const normalizeQuote = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();

/**
 * A reading that re-declares a free-form uncertainty an EARLIER turn released (same field, same bound target) from a quote
 * the current user text does not carry is the model recalling old history, not the user raising the point again: it is not
 * committed. When the current text carries the quote, the user re-raised it and it blocks as today. A renamed field is
 * not recognised (residual).
 */
export function dropReReleasedUncertaintiesV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  userText: string;
}): { document: WeeklyPlanningSemanticDocumentV5; dropped: number } {
  const releasedIds = new Set(params.graph.appliedLifecycleOperationKeys
    .filter((key) => key.includes(`:${WEEKLY_PLANNING_RELEASED_UNCERTAINTY_OPERATION_V5}`))
    .map((key) => key.slice(key.lastIndexOf(':') + 1)));
  if (releasedIds.size === 0 || params.document.uncertainties.length === 0) return { document: params.document, dropped: 0 };
  const released = params.graph.uncertainties.filter((fact) => releasedIds.has(fact.id));
  const text = normalizeQuote(params.userText);
  const kept = params.document.uncertainties.filter((current) => {
    if (isKnownWeeklyPlanningUncertaintyFieldV5(current.field)) return true;
    const target = params.document.tasks.find((task) => task.localId === current.targetLocalId)?.existingPublicId ?? null;
    const seen = released.some((fact) => fact.field === current.field && fact.targetFactId === target);
    return !seen || text.includes(normalizeQuote(current.sourceText));
  });
  return kept.length === params.document.uncertainties.length
    ? { document: params.document, dropped: 0 }
    : { document: { ...params.document, uncertainties: kept }, dropped: params.document.uncertainties.length - kept.length };
}
