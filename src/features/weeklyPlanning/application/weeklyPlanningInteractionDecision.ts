import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import type { SemanticConversationActV5 } from '../semantic/weeklyPlanningConversationActsV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  listWeeklyPlanningStableBlockingQuestionsV5,
  type WeeklyPlanningStableQuestionV5,
} from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningInteractionOutcome } from './weeklyPlanningInteractionOutcome';
import {
  withStableV5EffortMeasurement,
  type WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';

/**
 * Interaction layer: decides what kind of conversational turn this was from typed
 * semantic acts and machine state only. It never reads raw user text, and no decision
 * here changes authorization, readiness, the Fact Graph, preview, approval or save.
 *
 * Phase 1 (before routing) may redirect which open question the turn presents when the
 * user named a topic. Phase 2 (after routing) classifies the produced result.
 */
export interface WeeklyPlanningInteractionPlan {
  /** A different open question to present than the policy's top one (named topic). */
  dialogueQuestionOverride: WeeklyPlanningStableQuestionV5 | null;
  /** The act named an existing active topic (validated against the graph at use time). */
  targetResolved: boolean;
  /** The named topic has an open, non-deferred machine question (presented explicitly). */
  targetQuestionOpen: boolean;
  readonly acts: {
    ask: boolean;
    shift: boolean;
    resume: boolean;
    consultation: boolean;
  };
}

function activeTargetIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  const active = new Set(
    graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId),
  );
  return new Set([
    ...graph.tasks.filter((fact) => active.has(fact.id)).map((fact) => fact.id),
    ...graph.components.filter((fact) => active.has(fact.id)).map((fact) => fact.id),
  ]);
}

/** Resolves the typed target of the topic acts to an existing active task/component id. */
function resolvedTargetId(
  acts: readonly SemanticConversationActV5[],
  kinds: readonly SemanticConversationActV5['kind'][],
  graph: WeeklyPlanningFactGraphV5,
): string | null {
  const known = activeTargetIds(graph);
  const act = acts.find((entry) =>
    kinds.includes(entry.kind) && entry.targetPublicId !== null && known.has(entry.targetPublicId));
  return act?.targetPublicId ?? null;
}

function questionConcernsTarget(
  graph: WeeklyPlanningFactGraphV5,
  question: WeeklyPlanningStableQuestionV5,
  targetId: string,
): boolean {
  if (question.factId === targetId) return true;
  if (question.details.taskId === targetId || question.details.targetFactId === targetId) return true;
  const workload = question.factId
    ? graph.workloads.find((fact) => fact.id === question.factId)
    : undefined;
  if (workload) return workload.taskId === targetId || workload.componentId === targetId;
  const uncertainty = question.factId
    ? graph.uncertainties.find((fact) => fact.id === question.factId)
    : undefined;
  return uncertainty?.targetFactId === targetId;
}

export function planWeeklyPlanningInteraction(params: {
  acts: readonly SemanticConversationActV5[] | undefined;
  graph: WeeklyPlanningFactGraphV5;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
}): WeeklyPlanningInteractionPlan {
  const acts = params.acts ?? [];
  const flags = {
    ask: acts.some((act) => act.kind === 'ask_about_pending_question'),
    shift: acts.some((act) => act.kind === 'topic_shift'),
    resume: acts.some((act) => act.kind === 'resume_topic'),
    consultation: acts.some((act) => act.kind === 'consultation_request'),
  };
  const { dialogue, compilation } = params.evaluation;
  let override: WeeklyPlanningStableQuestionV5 | null = null;
  let targetQuestionOpen = false;
  // The repair policy owns what may be asked now: issues it deferred this turn are never
  // pulled forward by naming their topic.
  const deferred = new Set(params.evaluation.repairDecision.deferredIssueIds);
  const targetId = flags.resume || flags.shift
    ? resolvedTargetId(acts, ['resume_topic', 'topic_shift'], params.graph)
    : null;
  if (targetId && dialogue.status === 'ask_question') {
    const targeted = listWeeklyPlanningStableBlockingQuestionsV5(compilation)
      .find((question) =>
        !(question.factId !== null && deferred.has(question.factId))
        && questionConcernsTarget(params.graph, question, targetId));
    if (targeted) {
      targetQuestionOpen = true;
      const withMeasurement = withStableV5EffortMeasurement({
        graph: params.evaluation.activeGraph,
        question: targeted,
      });
      const sameAsTop = withMeasurement.code === dialogue.question.code
        && withMeasurement.factId === dialogue.question.factId;
      if (!sameAsTop) override = withMeasurement;
    }
  }
  return {
    dialogueQuestionOverride: override,
    targetResolved: targetId !== null,
    targetQuestionOpen,
    acts: flags,
  };
}

function sameQuestion(
  previous: WeeklyPlanningQuestionContext | undefined,
  next: WeeklyPlanningQuestionContext | undefined,
): boolean {
  return Boolean(previous && next
    && previous.targetSlot === next.targetSlot
    && previous.topicId === next.topicId
    && previous.actionId === next.actionId);
}

/**
 * Classifies the routed result. A result that carries a preview is an ordinary turn:
 * conversation acts never suppress a preview and never create one.
 */
export function classifyWeeklyPlanningInteraction(params: {
  plan: WeeklyPlanningInteractionPlan;
  output: WeeklyPlanningTurnExecutionResult;
  previousQuestion: WeeklyPlanningQuestionContext | undefined;
  presentation: WeeklyPlanningQuestionPresentationFreshness;
}): WeeklyPlanningInteractionOutcome {
  const { acts } = params.plan;
  const consultationDeferred = acts.consultation;
  const hasQuestion = Boolean(params.output.state.lastQuestionContext);
  const hasPreview = params.output.draftCandidates.length > 0
    || params.output.preserveExistingPreview === true;
  const apply: WeeklyPlanningInteractionOutcome = { kind: 'apply', consultationDeferred };
  if (hasPreview) return apply;

  // "Resume" is only truthful when the presented question belongs to the named topic (or
  // no topic was named); a resolved topic without an open question is an ordinary turn.
  const resumes = (acts.resume && (!params.plan.targetResolved || params.plan.targetQuestionOpen))
    || (acts.shift && params.plan.targetQuestionOpen);
  if (resumes) {
    return hasQuestion
      ? { kind: 'resume_pending_question', consultationDeferred }
      : apply;
  }
  if (acts.resume) return apply;
  if (acts.ask) {
    return params.presentation.status === 'fresh'
      && hasQuestion
      && sameQuestion(params.previousQuestion, params.output.state.lastQuestionContext)
      ? { kind: 'explain_pending_question', consultationDeferred }
      : apply;
  }
  if (acts.shift) return { kind: 'aside', consultationDeferred };
  return apply;
}

/**
 * Codes of the other open blocking questions, in policy order, without the one presented
 * now and without issues the repair policy deferred this turn. The renderer may use them
 * to say what will be needed later (e.g. "how long it takes" after "which material");
 * they never change which question is asked.
 */
export function upcomingQuestionCodesForInteraction(params: {
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  presented: { code: string; factId: string | null } | null;
}): string[] {
  const deferred = new Set(params.evaluation.repairDecision.deferredIssueIds);
  const codes = listWeeklyPlanningStableBlockingQuestionsV5(params.evaluation.compilation)
    .filter((question) => !(question.factId !== null && deferred.has(question.factId)))
    .filter((question) => !(params.presented
      && question.code === params.presented.code
      && question.factId === params.presented.factId))
    .map((question) => question.code);
  return [...new Set(codes)];
}
