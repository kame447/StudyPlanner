import type {
  WeeklyPlanningInteractionOutcome,
  WeeklyPlanningTurnCommunicationFacts,
} from '../application/weeklyPlanningInteractionOutcome';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5CommunicationGoal,
  WeeklyPlanningStableV5DialogueActionKind,
  WeeklyPlanningStableV5DialogueQuestionIntent,
  WeeklyPlanningStableV5QuestionPurpose,
} from './weeklyPlanningStableV5DialogueContracts';

/**
 * Deterministic WHAT of a reply in the interaction architecture (Issue #488).
 *
 * Everything here is derived from machine state and typed results only: the interaction
 * outcome (itself decided from typed conversation acts), the typed question intent and the
 * application's communication facts. Nothing reads the user's raw words, and nothing here is
 * prose: the renderer turns these codes into natural Japanese, and the emergency fallback is
 * owned separately (`weeklyPlanningInteractionFallbackText.ts`).
 */

const LATER_NEEDS_LIMIT = 3;

const PURPOSES_BY_QUESTION_CODE: Readonly<Record<string, readonly WeeklyPlanningStableV5QuestionPurpose[]>> = {
  missing_effort_estimate: ['estimate_time_to_fit_available_time'],
  ambiguous_effort_estimate: ['choose_one_time_estimate'],
  missing_schedulable_work: ['skip_already_finished_work'],
  semantic_uncertainty: ['resolve_unclear_detail'],
  invalid_planning_horizon: ['set_planning_period'],
  ambiguous_planning_window: ['choose_one_planning_period'],
  quantity_role_unresolved: ['tell_plan_amount_from_remaining_total'],
  missing_availability_date_scope: ['apply_time_limits_to_right_days'],
  missing_time_bounds: ['know_exact_time_range'],
  invalid_time_interval: ['know_exact_time_range'],
  named_time_period_unresolved: ['know_exact_time_range'],
  missing_commitment_date_scope: ['place_fixed_commitment'],
  invalid_commitment_interval: ['place_fixed_commitment'],
  conflicting_task_date_rule: ['resolve_conflicting_day_rule'],
  constraint_source_unavailable: ['avoid_existing_commitments'],
  active_constraint_source_missing: ['avoid_existing_commitments'],
  orphan_relation_task: ['order_tasks_correctly'],
  self_relation: ['order_tasks_correctly'],
  learning_strategy_proposal: ['decide_on_study_method_suggestion'],
  insufficient_capacity: ['make_the_plan_fit_available_time'],
};

function purposesForQuestionCode(code: string): WeeklyPlanningStableV5QuestionPurpose[] {
  return [...(PURPOSES_BY_QUESTION_CODE[code] ?? ['complete_planning_information'])];
}

/** The typed intent refines the code-level purpose when it carries the distinction. */
export function questionPurposesForStableV5Dialogue(params: {
  questionCode: string | null;
  questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent | null | undefined;
}): WeeklyPlanningStableV5QuestionPurpose[] {
  const intent = params.questionIntent;
  if (intent?.kind === 'effort_measurement') {
    return intent.measurement === 'session_duration'
      ? ['set_session_length']
      : ['estimate_time_to_fit_available_time'];
  }
  if (intent?.kind === 'schedulable_work_detail') {
    switch (intent.mode) {
      case 'registered_material_target_scope': return ['choose_scope_for_this_plan'];
      case 'missing_task_identity': return ['identify_work_to_schedule'];
      case 'all_requested_work_complete': return ['find_more_work_or_constraints'];
      default: return ['skip_already_finished_work'];
    }
  }
  if (intent?.kind === 'resolution_question'
    && intent.resolutionKind === 'semantic_clarification'
    && intent.ambiguityField === 'work_breakdown') {
    return ['identify_which_work_and_how_much'];
  }
  if (intent?.kind === 'learning_strategy_proposal') return ['decide_on_study_method_suggestion'];
  return params.questionCode ? purposesForQuestionCode(params.questionCode) : [];
}

function goalFor(
  outcome: WeeklyPlanningInteractionOutcome | undefined,
  actionKind: WeeklyPlanningStableV5DialogueActionKind,
): WeeklyPlanningStableV5CommunicationGoal {
  switch (outcome?.kind) {
    case 'explain_pending_question': return 'explain_question';
    case 'aside': return 'acknowledge_aside';
    case 'resume_pending_question': return 'resume_question';
    case 'recover': return 'clarify_turn';
    default:
      return actionKind === 'question'
        ? 'ask_question'
        : actionKind === 'preview_ready'
          ? 'present_preview'
          : 'report_status';
  }
}

export function communicationContextForStableV5Dialogue(params: {
  outcome: WeeklyPlanningInteractionOutcome | undefined;
  facts: WeeklyPlanningTurnCommunicationFacts | undefined;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent | null | undefined;
}): WeeklyPlanningStableV5CommunicationContext {
  const goal = goalFor(params.outcome, params.actionKind);
  const askQuestion = params.actionKind === 'question';
  const questionPurposes = askQuestion
    ? questionPurposesForStableV5Dialogue({
        questionCode: params.questionCode,
        questionIntent: params.questionIntent,
      })
    : [];
  const laterNeeds = [...new Set(
    (params.facts?.upcomingQuestionCodes ?? []).flatMap(purposesForQuestionCode),
  )]
    .filter((purpose) => !questionPurposes.includes(purpose))
    .slice(0, LATER_NEEDS_LIMIT);
  return {
    goal,
    questionPurposes,
    askQuestion,
    laterNeeds,
    statusReason: goal === 'report_status' ? params.facts?.statusReason ?? null : null,
    planningDetailsNotApplied: params.facts?.planningDetailsNotApplied === true,
    consultationDeferred: params.outcome?.consultationDeferred === true,
    previewDisclosure: params.actionKind === 'preview_ready'
      ? params.facts?.previewDisclosure ?? null
      : null,
  };
}
