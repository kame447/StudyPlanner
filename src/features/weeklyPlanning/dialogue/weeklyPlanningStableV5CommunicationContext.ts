import { mustConveyFromOpenRoleNeedV5 } from '../application/weeklyPlanningHeldRoleConfirmationV5';
import { isWeeklyPlanningAppenderRetired, mustConveyFromCapacityShortfall } from './weeklyPlanningMustConvey';
import { isKnownWeeklyPlanningUncertaintyFieldV5 } from '../semantic/weeklyPlanningSemanticUncertaintyResolutionV5';
import type {
  WeeklyPlanningInteractionOutcome,
  WeeklyPlanningTurnCommunicationFacts,
} from '../application/weeklyPlanningInteractionOutcome';
import type { WeeklyPlanningStableQuestionV5 } from '../semantic/weeklyPlanningStableDialoguePolicyV5';
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

type WeeklyPlanningStableV5AskableQuestionCode =
  | WeeklyPlanningStableQuestionV5['code']
  | 'missing_schedulable_work'
  | 'learning_strategy_proposal'
  | 'insufficient_capacity';

/** Every question code has a purpose (compiler-checked), so a "why?" always has a typed reason. */
const PURPOSES_BY_QUESTION_CODE: Readonly<Record<
  WeeklyPlanningStableV5AskableQuestionCode,
  readonly WeeklyPlanningStableV5QuestionPurpose[]
>> = {
  // Work items
  quantity_role_unresolved: ['tell_plan_amount_from_remaining_total'],
  missing_effort_estimate: ['estimate_time_to_fit_available_time'],
  ambiguous_effort_estimate: ['choose_one_time_estimate'],
  non_integral_discrete_amount: ['count_in_whole_units'],
  invalid_actual_range: ['identify_which_work_and_how_much'],
  orphan_workload: ['link_detail_to_its_task'],
  scope_total_workload_skipped: ['tell_plan_amount_from_remaining_total'],
  completed_workload_skipped: ['tell_plan_amount_from_remaining_total'],
  remaining_workload_skipped_for_target: ['tell_plan_amount_from_remaining_total'],
  missing_schedulable_work: ['skip_already_finished_work'],
  // Meaning and planning period
  semantic_uncertainty: ['resolve_unclear_detail'],
  invalid_planning_horizon: ['set_planning_period'],
  ambiguous_planning_window: ['choose_one_planning_period'],
  invalid_planning_date_range: ['set_planning_period'],
  unresolved_hard_date_expression: ['use_dates_the_plan_can_read'],
  contradictory_hard_date_bound: ['resolve_conflicting_dates'],
  hard_date_bound_outside_planning_window: ['use_dates_the_plan_can_read'],
  // Fixed commitments
  unsupported_commitment_date_expression: ['use_dates_the_plan_can_read'],
  missing_commitment_date_scope: ['place_fixed_commitment'],
  ambiguous_commitment_recurrence: ['place_fixed_commitment'],
  invalid_commitment_weekday: ['use_dates_the_plan_can_read'],
  invalid_commitment_interval: ['place_fixed_commitment'],
  unknown_commitment_constraint_level: ['know_how_strict_a_condition_is'],
  soft_fixed_interval_not_allowed: ['know_how_strict_a_condition_is'],
  commitment_outside_planning_window: ['use_dates_the_plan_can_read'],
  // Day rules for tasks
  orphan_task_date_rule: ['link_detail_to_its_task'],
  invalid_task_date_rule_level: ['know_how_strict_a_condition_is'],
  unsupported_task_date_expression: ['use_dates_the_plan_can_read'],
  task_date_rule_outside_planning_window: ['use_dates_the_plan_can_read'],
  conflicting_task_date_rule: ['resolve_conflicting_day_rule'],
  orphan_task_recurrence: ['link_detail_to_its_task'],
  invalid_task_recurrence_weekday: ['use_dates_the_plan_can_read'],
  // Availability and daily limits
  unsupported_date_expression: ['use_dates_the_plan_can_read'],
  availability_outside_planning_window: ['use_dates_the_plan_can_read'],
  missing_availability_date_scope: ['apply_time_limits_to_right_days'],
  missing_time_bounds: ['know_exact_time_range'],
  named_time_period_unresolved: ['know_exact_time_range'],
  unknown_constraint_level: ['know_how_strict_a_condition_is'],
  invalid_weekday: ['use_dates_the_plan_can_read'],
  invalid_time_interval: ['know_exact_time_range'],
  constraint_source_unavailable: ['avoid_existing_commitments'],
  active_constraint_source_missing: ['avoid_existing_commitments'],
  constraint_source_owner_mismatch: ['avoid_existing_commitments'],
  constraint_event_owner_mismatch: ['avoid_existing_commitments'],
  invalid_constraint_event: ['avoid_existing_commitments'],
  invalid_daily_capacity_minutes: ['set_daily_study_limit'],
  invalid_daily_capacity_weekday: ['use_dates_the_plan_can_read'],
  unsupported_daily_capacity_date_expression: ['use_dates_the_plan_can_read'],
  missing_daily_capacity_date_scope: ['apply_time_limits_to_right_days'],
  // Task order and duplicates
  orphan_relation_task: ['order_tasks_correctly'],
  self_relation: ['order_tasks_correctly'],
  relation_cycle: ['order_tasks_correctly'],
  fixed_task_movable_work_suppressed: ['complete_planning_information'],
  // Application decisions
  learning_strategy_proposal: ['decide_on_study_method_suggestion'],
  insufficient_capacity: ['make_the_plan_fit_available_time'],
};

function purposesForQuestionCode(code: string): WeeklyPlanningStableV5QuestionPurpose[] {
  const purposes = (PURPOSES_BY_QUESTION_CODE as Readonly<Record<string, readonly WeeklyPlanningStableV5QuestionPurpose[] | undefined>>)[code];
  return [...(purposes ?? ['complete_planning_information'])];
}

/** The typed intent refines the code-level purpose when it carries the distinction. */
export function questionPurposesForStableV5Dialogue(params: {
  questionCode: string | null;
  questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent | null | undefined;
}): WeeklyPlanningStableV5QuestionPurpose[] {
  const intent = params.questionIntent;
  if (intent?.kind === 'schedule_request') return [intent.purpose];
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
  // A free-form open point (interaction): not an ambiguity to resolve, but a point the user may state or let go.
  if (intent?.kind === 'resolution_question'
    && intent.resolutionKind === 'semantic_clarification'
    && typeof intent.ambiguityField === 'string'
    && !isKnownWeeklyPlanningUncertaintyFieldV5(intent.ambiguityField)) {
    return ['confirm_open_point'];
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
  // A new handoff takes priority, but a closed work invitation must not silence a new consultation.
  const closedInvitationWithConsultation = params.facts?.statusReason === 'no_additional_work'
    && params.outcome?.consultationDeferred === true;
  const goal = params.facts?.statusReason === 'fixed_event_manual_entry'
    || (params.facts?.statusReason === 'no_additional_work' && !closedInvitationWithConsultation)
    ? 'report_status' : goalFor(params.outcome, params.actionKind);
  const askQuestion = params.actionKind === 'question';
  const questionPurposes = askQuestion
    ? questionPurposesForStableV5Dialogue({
        questionCode: params.questionCode,
        questionIntent: params.questionIntent,
      })
    : [];
  const laterNeeds = [...new Set(
    [
      ...(params.facts?.upcomingQuestionCodes ?? []),
      ...(params.outcome?.consultationDeferred ? params.facts?.consultation?.missingQuestionCodes ?? [] : []),
    ].flatMap(purposesForQuestionCode),
  )]
    .filter((purpose) => !questionPurposes.includes(purpose))
    .slice(0, LATER_NEEDS_LIMIT);
  const shortfallAsked = params.questionCode === 'insufficient_capacity' && params.actionKind === 'question'
    && params.facts?.capacityShortfall !== undefined && isWeeklyPlanningAppenderRetired('shortfall');
  // A declared amount waiting for its role (the question is held, not asked): the verified reply must convey it (P3 S1 / P2).
  const waitingAmounts = !askQuestion
    ? (params.facts?.planningNeeds ?? []).flatMap((need) => 'workloadFactId' in need ? [mustConveyFromOpenRoleNeedV5(need)] : [])
    : [];
  const mustConvey = [
    ...(shortfallAsked && params.facts?.capacityShortfall ? [mustConveyFromCapacityShortfall(params.facts.capacityShortfall)] : []),
    ...waitingAmounts,
  ];
  return {
    goal,
    ...(params.facts?.scheduleIntent ? { scheduleIntent: params.facts.scheduleIntent } : {}),
    questionPurposes,
    askQuestion,
    laterNeeds,
    // A consultation answered with typed evidence is the subject of the reply. Reporting the
    // unchanged preview as well turned the answer into 「今の候補のままです」 (live E on 65f178e0).
    statusReason: goal === 'report_status' && !closedInvitationWithConsultation
      && !(params.outcome?.consultationDeferred === true && params.facts?.consultation
        && params.facts.statusReason === 'preview_unchanged')
      ? params.facts?.statusReason ?? null
      : null,
    planningDetailsNotApplied: params.facts?.planningDetailsNotApplied === true,
    ...(params.facts?.possibleCompletenessOmission === true ? { possibleCompletenessOmission: true } : {}),
    ...(params.facts?.nothingRead === true ? { nothingRead: true } : {}),
    ...(params.facts?.rateUnitProjected ? { rateUnitProjected: params.facts.rateUnitProjected } : {}),
    ...(params.facts?.ignoredRate ? { ignoredRate: params.facts.ignoredRate } : {}),
    consultationDeferred: params.outcome?.consultationDeferred === true,
    ...(params.outcome?.consultationDeferred === true
      ? { consultation: params.facts?.consultation ?? null }
      : {}),
    ...(params.actionKind === 'preview_ready' && params.facts?.previewConstraintSatisfaction
      ? { previewConstraintSatisfaction: params.facts.previewConstraintSatisfaction }
      : {}),
    ...(params.actionKind === 'preview_ready' && params.facts?.allocationBreakdown
      ? { allocationBreakdown: params.facts.allocationBreakdown }
      : {}),
    ...(params.questionCode === 'insufficient_capacity' && params.actionKind === 'question' && params.facts?.capacityShortfall
      ? { capacityShortfall: params.facts.capacityShortfall } : {}),
    ...(mustConvey.length > 0 ? { mustConvey } : {}),
    ...(params.facts?.planningNeeds?.length ? { planningNeeds: params.facts.planningNeeds } : {}),
    ...(params.facts?.calendarFree?.length ? { calendarFree: params.facts.calendarFree } : {}),
    ...(params.facts?.openPointCoversConsultation && askQuestion ? { openPointCoversConsultation: true } : {}),
    ...(params.facts?.uncertaintyReleased ? { uncertaintyReleased: { quote: params.facts.uncertaintyReleased.quote, nothingRead: params.facts.uncertaintyReleased.nothingRead } } : {}),
    previewDisclosure: params.actionKind === 'preview_ready'
      ? params.facts?.previewDisclosure ?? null
      : null,
  };
}
