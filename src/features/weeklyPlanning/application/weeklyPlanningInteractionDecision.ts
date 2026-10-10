import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
import type { SemanticConversationActV5 } from '../semantic/weeklyPlanningConversationActsV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  listWeeklyPlanningStableBlockingQuestionsV5,
  type WeeklyPlanningStableQuestionV5,
} from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import type { WeeklyPlanningTurnExecutionResult, WeeklyPlanningInteractionOutcome } from '../weeklyPlanningTurnExecutionTypes';
import {
  withEffortMeasurement,
  type WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';

/**
 * Interaction layer: decides what kind of conversational turn this was from typed
 * semantic acts and machine state only. It never reads raw user text, and no decision
 * here changes authorization, readiness, the Fact Graph, preview, approval or save.
 *
 * Phase 1 (before routing) may redirect which open question the turn presents: the one of a
 * topic the user named, or the one the user asked about. Phase 2 (after routing) classifies
 * the produced result.
 */
export interface WeeklyPlanningInteractionPlan {
  /** A different open question to present than the policy's top one (named topic / asked about). */
  dialogueQuestionOverride: WeeklyPlanningStableQuestionV5 | null;
  /** Resume-act targets only; a separate topic shift cannot validate a rejected resume. */
  resumeTargetStatus: 'not_named' | 'active' | 'unavailable';
  /** The exact open, non-deferred compiler question selected for the named topic.
   * Turn-local evidence only; the router may still select a higher-priority question. */
  targetQuestion: WeeklyPlanningStableQuestionV5 | null;
  readonly acts: {
    ask: boolean;
    shift: boolean;
    resume: boolean;
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
    kinds.includes(entry.kind) && entry.targetResolution !== 'unresolved'
    && entry.targetPublicId !== null && known.has(entry.targetPublicId));
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

/** The still-open, askable machine question that the presented question context names. */
function openQuestionFor(params: {
  context: WeeklyPlanningQuestionContext;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  deferred: ReadonlySet<string>;
}): WeeklyPlanningStableQuestionV5 | null {
  return listWeeklyPlanningStableBlockingQuestionsV5(params.evaluation.compilation)
    .map((question) => withEffortMeasurement({ graph: params.evaluation.activeGraph, question }))
    .find((question) => presentsSelectedTargetQuestion(question, params.context)
      && !(question.factId !== null && params.deferred.has(question.factId))) ?? null;
}

export function planWeeklyPlanningInteraction(params: {
  acts: readonly SemanticConversationActV5[] | undefined;
  graph: WeeklyPlanningFactGraphV5;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  /** The question context the user was looking at, only when its presentation is fresh. */
  explainedQuestion?: WeeklyPlanningQuestionContext | null;
}): WeeklyPlanningInteractionPlan {
  const acts = params.acts ?? [];
  const flags = {
    ask: acts.some((act) => act.kind === 'ask_about_pending_question'),
    shift: acts.some((act) => act.kind === 'topic_shift'),
    resume: acts.some((act) => act.kind === 'resume_topic'),
  };
  const { dialogue, compilation } = params.evaluation;
  let override: WeeklyPlanningStableQuestionV5 | null = null;
  let targetQuestion: WeeklyPlanningStableQuestionV5 | null = null;
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
      const withMeasurement = withEffortMeasurement({
        graph: params.evaluation.activeGraph,
        question: targeted,
      });
      targetQuestion = withMeasurement;
      const sameAsTop = withMeasurement.code === dialogue.question.code
        && withMeasurement.factId === dialogue.question.factId;
      if (!sameAsTop) override = withMeasurement;
    }
  }
  // An explanation request is about the question on screen. While that question is still open
  // and askable, it stays the presented one, even when other details of the same turn changed
  // which question would come first (a mixed turn keeps both parts: the details are taken in,
  // and the question the user asked about is explained and asked again).
  if (flags.ask && !targetId && params.explainedQuestion && dialogue.status === 'ask_question') {
    const explained = openQuestionFor({
      context: params.explainedQuestion,
      evaluation: params.evaluation,
      deferred,
    });
    if (explained) {
      const withMeasurement = explained;
      const sameAsTop = withMeasurement.code === dialogue.question.code
        && withMeasurement.factId === dialogue.question.factId;
      if (!sameAsTop) override = withMeasurement;
    }
  }
  const resumeActs = acts.filter((act) => act.kind === 'resume_topic');
  const resumeTargetStatus = resolvedTargetId(resumeActs, ['resume_topic'], params.graph)
    ? 'active'
    : resumeActs.some((act) => act.targetPublicId === null && act.targetResolution !== 'unresolved')
      ? 'not_named' : flags.resume ? 'unavailable' : 'not_named';
  return {
    dialogueQuestionOverride: override,
    resumeTargetStatus,
    targetQuestion,
    acts: flags,
  };
}

type RoutedQuestionIdentity = Pick<WeeklyPlanningQuestionContext,
  'topicId' | 'intent' | 'estimateForWorkloadFactId' | 'questionBasis' | 'actionId'> & {
  code: string | null;
};

function routedQuestionIdentity(context: WeeklyPlanningQuestionContext): RoutedQuestionIdentity {
  return { code: decodeWeeklyPlanningStableV5QuestionSlot(context.targetSlot),
    topicId: context.topicId, intent: context.intent,
    estimateForWorkloadFactId: context.estimateForWorkloadFactId,
    questionBasis: context.questionBasis, actionId: context.actionId };
}

/** Finite question fields already projected by the router; labels and presentation are not identity. */
function sameQuestionIdentity(left: RoutedQuestionIdentity, right: RoutedQuestionIdentity): boolean {
  return left.code !== null && left.code === right.code
    && (left.topicId ?? null) === (right.topicId ?? null)
    && left.intent === right.intent
    && (left.estimateForWorkloadFactId ?? null) === (right.estimateForWorkloadFactId ?? null)
    && (left.questionBasis ?? null) === (right.questionBasis ?? null)
    && (left.actionId ?? null) === (right.actionId ?? null);
}

function sameQuestion(
  previous: WeeklyPlanningQuestionContext | undefined,
  next: WeeklyPlanningQuestionContext | undefined,
): boolean {
  return Boolean(previous && next
    && sameQuestionIdentity(routedQuestionIdentity(previous), routedQuestionIdentity(next)));
}

function presentsSelectedTargetQuestion(
  selected: WeeklyPlanningStableQuestionV5 | null,
  actual: WeeklyPlanningQuestionContext | undefined,
): boolean {
  if (!selected || !actual) return false;
  const estimateTarget = selected.details.estimateForWorkloadFactId;
  return sameQuestionIdentity({
    code: selected.code,
    topicId: selected.factId ?? undefined,
    intent: selected.effortMeasurement ?? selected.code,
    estimateForWorkloadFactId: typeof estimateTarget === 'string' && estimateTarget.length > 0
      ? estimateTarget : undefined,
    questionBasis: selected.details.questionBasis === 'completed_workload_total'
      ? 'completed_workload_total' : undefined,
    actionId: undefined,
  }, routedQuestionIdentity(actual));
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
  const hasQuestion = Boolean(params.output.state.lastQuestionContext);
  const hasPreview = params.output.draftCandidates.length > 0
    || params.output.preserveExistingPreview === true;
  const apply: WeeklyPlanningInteractionOutcome = { kind: 'apply' };
  if (hasPreview) return apply;

  // "Resume" is only truthful when the presented question belongs to the named topic (or
  // no topic was named); a resolved topic without an open question is an ordinary turn.
  const presentsNamedQuestion = presentsSelectedTargetQuestion(
    params.plan.targetQuestion, params.output.state.lastQuestionContext,
  );
  const resumes = (acts.resume && (params.plan.resumeTargetStatus === 'not_named'
      || (params.plan.resumeTargetStatus === 'active' && presentsNamedQuestion)))
    || (acts.shift && presentsNamedQuestion);
  if (resumes) {
    return hasQuestion
      ? { kind: 'resume_pending_question' }
      : apply;
  }
  // A higher-priority route (for example an existing strategy proposal) won. Keep its
  // ordinary presentation rather than claiming to resume, or hiding it as an aside.
  if (params.plan.targetQuestion && !presentsNamedQuestion) return apply;
  // A separate valid topic shift may present its own question above. Otherwise an
  // unavailable named resume holds the old question without presenting or binding it.
  if (acts.resume) return params.plan.resumeTargetStatus === 'unavailable' && hasQuestion
    ? { kind: 'aside' } : apply;
  if (acts.ask) {
    return params.presentation.status === 'fresh'
      && hasQuestion
      && sameQuestion(params.previousQuestion, params.output.state.lastQuestionContext)
      ? { kind: 'explain_pending_question' }
      : apply;
  }
  if (acts.shift) {
    return { kind: 'aside' };
  }
  return apply;
}
