import type { WeeklyPlanningRepairObligation } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import type {
  GenericSchedulerInputCompilationResult,
  GenericSchedulerInputIssue,
} from './weeklyPlanningGenericSchedulerInput';
import {
  decideWeeklyPlanningStableDialogueV5,
  type WeeklyPlanningStableQuestionV5,
} from './weeklyPlanningStableDialoguePolicyV5';

export type WeeklyPlanningRepairObligationV5 = WeeklyPlanningRepairObligation;

export interface WeeklyPlanningStableRepairDecisionV5 {
  mode: 'explicit_repair' | 'pass_over' | 'continue';
  question: WeeklyPlanningStableQuestionV5 | null;
  deferredIssueIds: string[];
  reopenedIssueIds: string[];
  agenda: WeeklyPlanningRepairObligationV5[];
}

function targetSoftPreferenceConstraint(
  graph: WeeklyPlanningFactGraphV5,
  targetFactId: string | null,
): boolean {
  if (!targetFactId) return false;
  const target = graph.temporalConstraints.find((constraint) =>
    constraint.id === targetFactId
    && (graph.factLifecycles.length === 0
      || isWeeklyPlanningFactActiveV5(graph, constraint.id)));
  return Boolean(
    target
    && target.constraintLevel === 'soft'
    && (target.kind === 'preferred_window' || target.kind === 'avoid_window'),
  );
}

function semanticUncertaintyTargetFactId(
  issue: GenericSchedulerInputIssue,
): string | null {
  if (issue.domain !== 'semantic_uncertainty') return null;
  return typeof issue.details.targetFactId === 'string'
    ? issue.details.targetFactId
    : null;
}

/**
 * Pass-over is intentionally narrow. An uncertainty is deferrable only when its
 * exact target is an active soft preference. Deadlines, quantities, effort,
 * hard availability, date rules and untargeted semantic uncertainty remain
 * immediate repair obligations.
 */
export function isWeeklyPlanningDeferrableIssueV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  issue: GenericSchedulerInputIssue;
}): boolean {
  return targetSoftPreferenceConstraint(
    params.graph,
    semanticUncertaintyTargetFactId(params.issue),
  );
}

function issueFactId(issue: GenericSchedulerInputIssue): string | null {
  return typeof issue.factId === 'string' && issue.factId.trim() ? issue.factId : null;
}

function obligationFromIssue(params: {
  issue: GenericSchedulerInputIssue;
  graphRevision: number;
  turnId: string;
  status: 'open' | 'deferred';
}): WeeklyPlanningRepairObligationV5 | null {
  const factId = issueFactId(params.issue);
  if (!factId) return null;
  return {
    id: `repair:${factId}`,
    issueFactId: factId,
    targetFactId: semanticUncertaintyTargetFactId(params.issue),
    domain: params.issue.domain,
    code: params.issue.code,
    impact: 'low',
    status: params.status,
    createdRevision: params.graphRevision,
    sourceTurnId: params.turnId,
    reopenBefore: 'preview',
  };
}

function reconcilePreviousAgenda(params: {
  graph: WeeklyPlanningFactGraphV5;
  previousAgenda: readonly WeeklyPlanningRepairObligationV5[];
}): WeeklyPlanningRepairObligationV5[] {
  return params.previousAgenda.map((obligation) => {
    if (obligation.status === 'resolved' || obligation.status === 'dropped') {
      return { ...obligation };
    }
    const active = params.graph.factLifecycles.length === 0
      ? params.graph.uncertainties.some((fact) => fact.id === obligation.issueFactId)
      : isWeeklyPlanningFactActiveV5(params.graph, obligation.issueFactId);
    return active
      ? { ...obligation }
      : { ...obligation, status: 'resolved' as const };
  });
}

function upsertObligation(
  agenda: WeeklyPlanningRepairObligationV5[],
  obligation: WeeklyPlanningRepairObligationV5,
): void {
  const index = agenda.findIndex((item) => item.id === obligation.id);
  if (index < 0) {
    agenda.push(obligation);
    return;
  }
  agenda[index] = {
    ...agenda[index],
    ...obligation,
    createdRevision: agenda[index].createdRevision,
    sourceTurnId: agenda[index].sourceTurnId,
  };
}

function questionFromCompilation(
  compilation: GenericSchedulerInputCompilationResult,
): WeeklyPlanningStableQuestionV5 | null {
  const decision = decideWeeklyPlanningStableDialogueV5(compilation);
  return decision.status === 'ask_question' ? decision.question : null;
}

export function decideWeeklyPlanningStableRepairPolicyV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  compilation: GenericSchedulerInputCompilationResult;
  previousAgenda: readonly WeeklyPlanningRepairObligationV5[];
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningStableRepairDecisionV5 {
  const agenda = reconcilePreviousAgenda({
    graph: params.graph,
    previousAgenda: params.previousAgenda,
  });
  const blocking = params.compilation.issues.filter((issue) => issue.blocking);
  if (blocking.length === 0) {
    return {
      mode: 'continue',
      question: null,
      deferredIssueIds: [],
      reopenedIssueIds: [],
      agenda,
    };
  }

  const deferrable = blocking.filter((issue) =>
    isWeeklyPlanningDeferrableIssueV5({ graph: params.graph, issue }));
  const deferrableIds = deferrable
    .map(issueFactId)
    .filter((value): value is string => Boolean(value));
  const nonDeferrable = blocking.filter((issue) => !deferrable.includes(issue));

  if (deferrable.length > 0 && nonDeferrable.length > 0) {
    for (const issue of deferrable) {
      const obligation = obligationFromIssue({
        issue,
        graphRevision: params.graphRevision,
        turnId: params.turnId,
        status: 'deferred',
      });
      if (obligation) upsertObligation(agenda, obligation);
    }
    const filteredCompilation: GenericSchedulerInputCompilationResult = {
      ...params.compilation,
      issues: params.compilation.issues.filter((issue) => !deferrable.includes(issue)),
    };
    return {
      mode: 'explicit_repair',
      question: questionFromCompilation(filteredCompilation),
      deferredIssueIds: deferrableIds,
      reopenedIssueIds: [],
      agenda,
    };
  }

  if (deferrable.length > 0) {
    const selected = questionFromCompilation(params.compilation);
    const selectedFactId = selected?.factId ?? null;
    for (const issue of deferrable) {
      const factId = issueFactId(issue);
      const obligation = obligationFromIssue({
        issue,
        graphRevision: params.graphRevision,
        turnId: params.turnId,
        status: factId === selectedFactId ? 'open' : 'deferred',
      });
      if (obligation) upsertObligation(agenda, obligation);
    }
    return {
      mode: 'explicit_repair',
      question: selected,
      deferredIssueIds: deferrableIds.filter((id) => id !== selectedFactId),
      reopenedIssueIds: selectedFactId ? [selectedFactId] : [],
      agenda,
    };
  }

  return {
    mode: 'explicit_repair',
    question: questionFromCompilation(params.compilation),
    deferredIssueIds: [],
    reopenedIssueIds: [],
    agenda,
  };
}
