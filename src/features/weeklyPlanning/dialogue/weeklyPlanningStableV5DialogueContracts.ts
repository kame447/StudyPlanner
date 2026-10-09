import type { WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';
import type { WeeklyPlanningScheduleCommunicationIntent } from '../application/weeklyPlanningFixedEventOnlyInteraction';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import type { WeeklyPlanningConsultationCommunication } from '../application/weeklyPlanningConsultationCommunication';
import type { WeeklyPlanningCapacityShortfall } from '../application/weeklyPlanningCapacityShortfall';
import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';
import type { WeeklyPlanningAllocationBreakdown } from '../semantic/weeklyPlanningAllocationBreakdown';
import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import type {
  WeeklyPlanningPreviewOmittedWork,
  WeeklyPlanningTurnStatusReason,
} from '../application/weeklyPlanningInteractionOutcome';

export type WeeklyPlanningStableV5DialogueActionKind =
  | 'question'
  | 'status'
  | 'preview_ready';

/**
 * What this reply has to accomplish, decided by the application from typed acts, the
 * interaction outcome and machine state (interaction architecture). The renderer chooses
 * the words; it never decides the goal and never infers it from the raw user message.
 */
export type WeeklyPlanningStableV5CommunicationGoal =
  /** Ordinary turn: ask the typed question (acknowledging what was just taken in). */
  | 'ask_question'
  /** Ordinary turn without a question: report the typed status reason. */
  | 'report_status'
  /** A new draft schedule is ready for review. */
  | 'present_preview'
  /** The user asked why/what about the question just asked: answer that first, then ask it. */
  | 'explain_question'
  /** The user moved to another topic: respond to it; the held question is not asked. */
  | 'acknowledge_aside'
  /** The user returned to a topic: continue with its question. */
  | 'resume_question'
  /** This message could not be used as it is (nothing from it was taken in): clarify. */
  | 'clarify_turn';

/**
 * Machine-owned reason codes: WHY the planner needs the information a question asks for.
 * They carry no prose; the renderer explains the reason in natural words.
 */
export const WEEKLY_PLANNING_STABLE_V5_QUESTION_PURPOSES = [
  'estimate_time_to_fit_available_time',
  'set_session_length',
  'skip_already_finished_work',
  'choose_scope_for_this_plan',
  'identify_work_to_schedule',
  'confirm_existing_schedule',
  'register_event',
  'clarify_schedule_request',
  'find_more_work_or_constraints',
  'identify_which_work_and_how_much',
  'resolve_unclear_detail',
  'confirm_open_point',
  'set_planning_period',
  'choose_one_planning_period',
  'tell_plan_amount_from_remaining_total',
  'choose_one_time_estimate',
  'apply_time_limits_to_right_days',
  'know_exact_time_range',
  'place_fixed_commitment',
  'resolve_conflicting_day_rule',
  'avoid_existing_commitments',
  'order_tasks_correctly',
  'decide_on_study_method_suggestion',
  'make_the_plan_fit_available_time',
  'count_in_whole_units',
  'link_detail_to_its_task',
  'use_dates_the_plan_can_read',
  'know_how_strict_a_condition_is',
  'set_daily_study_limit',
  'resolve_conflicting_dates',
  'complete_planning_information',
] as const;

export type WeeklyPlanningStableV5QuestionPurpose =
  typeof WEEKLY_PLANNING_STABLE_V5_QUESTION_PURPOSES[number];

/**
 * Typed communication context of one reply (interaction architecture only). Deterministic
 * code decides WHAT has to be communicated; the renderer decides HOW to say it.
 */
export interface WeeklyPlanningStableV5CommunicationContext {
  /** Semantic recovery kept the existing preview; ask for the intended edit, not a rephrase. */
  retainedPreviewUnchanged?: boolean;
  /** A proposed-days trial does not match the current preview; it needs explicit adoption. */
  alternativeRequiresAdoption?: boolean;
  /** An audit-reported omission could not be taken in; the application states it beside the reply. */
  possibleCompletenessOmission?: boolean;
  scheduleIntent?: WeeklyPlanningScheduleCommunicationIntent;
  goal: WeeklyPlanningStableV5CommunicationGoal;
  /** Why the planner needs what the asked/explained question requests (empty without one). */
  questionPurposes: WeeklyPlanningStableV5QuestionPurpose[];
  /** The reply asks the typed question (once, with its requested information intact). */
  askQuestion: boolean;
  /** Purposes of other open questions that come later; context for explanations only. */
  laterNeeds: WeeklyPlanningStableV5QuestionPurpose[];
  /** Why a status reply is given (report_status only). */
  statusReason: WeeklyPlanningTurnStatusReason | null;
  /** Planning details in this message could not be taken in; nothing from them was applied. */
  planningDetailsNotApplied: boolean;
  /** Full advice/adoption runtime is deferred; bounded planning advice uses consultation. */
  consultationDeferred: boolean;
  consultation?: WeeklyPlanningConsultationCommunication | null;
  previewConstraintSatisfaction?: WeeklyPlanningPreviewConstraintSatisfaction[];
  allocationBreakdown?: WeeklyPlanningAllocationBreakdown | null;
  /** Work left out of the new draft because the free time ran out (must be disclosed). */
  previewDisclosure: { omittedWork: WeeklyPlanningPreviewOmittedWork[] } | null;
  /** Work that did not fit (the capacity question only); the application states the figures beside the reply. */
  capacityShortfall?: WeeklyPlanningCapacityShortfall;
  /** P2: typed facts the reply must convey; the application verifies the reply against them (retired appenders only). */
  mustConvey?: WeeklyPlanningMustConveyEntry[];
  /** A free-form point was released by the user's answer; the application states it (quote included) beside the reply. */
  /** The presented question already invites the user's condition for the consulted task. */
  openPointCoversConsultation?: boolean;
  uncertaintyReleased?: { quote: string | null; nothingRead: boolean };
  /** The final reading was entirely empty; the application states it once beside the reply. */
  nothingRead?: boolean;
  /** x8: the typed rate facts; the application states each beside the reply, the renderer never words them. */
  rateUnitProjected?: { quote: string; minutes: number; unitLabel: string };
  ignoredRate?: { quote: string; unit: string };
}

export interface WeeklyPlanningStableV5DialogueConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WeeklyPlanningStableV5DialogueQuestionTarget {
  collection: string;
  fact: Record<string, unknown>;
}

export interface WeeklyPlanningStableV5DialogueEffortQuestionIntent {
  kind: 'effort_measurement';
  measurement: 'total_duration' | 'duration_per_unit' | 'session_duration';
  quantityRole: 'declared' | 'target' | 'remaining' | 'completed' | 'unknown';
  targetFactId: string;
  amount: number;
  unitCode: string | null;
  unitLabel: string | null;
}

export type WeeklyPlanningStableV5ProgressBasis =
  | 'known_bounded_quantity'
  | 'known_registered_material_progress'
  | 'completion_progress_without_known_unit';

export interface WeeklyPlanningStableV5DialogueSchedulableWorkQuestionIntent {
  kind: 'schedulable_work_detail';
  mode:
    | 'existing_target_progress'
    | 'registered_material_target_scope'
    | 'missing_task_identity'
    | 'all_requested_work_complete';
  targetFactId: string | null;
  progressBasis: WeeklyPlanningStableV5ProgressBasis | null;
  knownUnitCode: string | null;
  knownUnitLabel: string | null;
  knownTotalUnits?: number | null;
  knownCurrentUnits?: number | null;
  knownRemainingUnits?: number | null;
  requestedInformation:
    | readonly ['current_progress']
    | readonly ['plan_target_scope']
    | readonly ['task_identity']
    | readonly ['additional_task_or_constraint'];
}

export type WeeklyPlanningStableV5DialogueResolutionKind =
  | 'semantic_clarification'
  | 'planning_horizon'
  | 'planning_window_choice'
  | 'quantity_role'
  | 'effort_estimate_choice'
  | 'availability_date_scope'
  | 'temporal_date_scope'
  | 'time_bounds'
  | 'named_time_period_bounds'
  | 'commitment_date_scope'
  | 'commitment_time_bounds'
  | 'task_date_rule_conflict'
  | 'constraint_source_choice'
  | 'task_relation_reference'
  | 'task_relation_self_reference';

export type WeeklyPlanningStableV5DialogueRequestedInformation =
  | 'clarify_ambiguous_meaning'
  | 'planning_period'
  | 'single_planning_window'
  | 'quantity_role'
  | 'choose_effort_estimate'
  | 'availability_date_scope'
  | 'applicable_start_or_deadline_date'
  | 'start_and_end_time'
  | 'named_time_period_start_and_end'
  | 'commitment_date'
  | 'commitment_start_and_end_time'
  | 'allowed_or_excluded_date_rule'
  | 'constraint_source'
  | 'identify_relation_endpoints'
  | 'distinct_relation_endpoints';

export type WeeklyPlanningStableV5DialogueResolutionChoice =
  | 'plan_target_amount'
  | 'remaining_total_amount'
  | 'allowed_date'
  | 'excluded_date'
  | 'timetable'
  | 'existing_plans'
  | 'calendar';

export interface WeeklyPlanningStableV5DialogueResolutionQuestionIntent {
  kind: 'resolution_question';
  resolutionKind: WeeklyPlanningStableV5DialogueResolutionKind;
  targetFactId: string | null;
  requestedInformation: readonly WeeklyPlanningStableV5DialogueRequestedInformation[];
  allowedChoices: readonly WeeklyPlanningStableV5DialogueResolutionChoice[];
  knownAmount: number | null;
  knownUnitLabel: string | null;
  ambiguityField: string | null;
  ambiguityReason: string | null;
}

export interface WeeklyPlanningStableV5DialogueSpacedPracticeProposalIntent {
  kind: 'learning_strategy_proposal';
  proposalKind: 'spaced_memory_practice';
  targetFactId: string;
  suggestedSessionDurationMinutes: {
    min: number;
    max: number;
  };
  spacingInterval: 'not_yet_selected';
  rationale: 'distributed_retrieval_supports_retention';
  decisionRequested: 'accept_or_reject';
}

export interface WeeklyPlanningStableV5DialoguePaceCalibrationProposalIntent {
  kind: 'learning_strategy_proposal';
  proposalKind: 'calibrate_memory_pace';
  targetFactId: string;
  suggestedSessionDurationMinutes: {
    min: number;
    max: number;
  };
  selectedSessionDurationMinutes: number;
  sessionDurationMinutes: number;
  measurementPlan: {
    observation: 'progress_during_single_session';
    objective: 'measure_personal_pace';
    futureUse: 'personalize_future_session_planning';
  };
  decisionRequested: 'accept_or_reject';
}

export interface WeeklyPlanningStableV5DialogueMixedAcquisitionReviewProposalIntent {
  kind: 'learning_strategy_proposal';
  proposalKind: 'mixed_acquisition_review';
  targetFactId: string;
  capacityReason: 'insufficient_capacity';
  acquisitionMode: 'longer_sessions';
  reviewMode: 'short_distributed_sessions';
  reviewSessionDurationMinutes: {
    min: number;
    max: number;
  };
  decisionRequested: 'accept_or_reject';
}

export type WeeklyPlanningStableV5DialogueLearningStrategyProposalIntent =
  | WeeklyPlanningStableV5DialogueSpacedPracticeProposalIntent
  | WeeklyPlanningStableV5DialoguePaceCalibrationProposalIntent
  | WeeklyPlanningStableV5DialogueMixedAcquisitionReviewProposalIntent;

export interface WeeklyPlanningStableV5DialogueScheduleQuestionIntent {
  kind: 'schedule_request';
  purpose: Exclude<WeeklyPlanningScheduleCommunicationIntent, 'identify_study_work'>;
  requestedInformation: readonly ['schedule_request'];
}

export type WeeklyPlanningStableV5DialogueQuestionIntent =
  | WeeklyPlanningStableV5DialogueScheduleQuestionIntent
  | WeeklyPlanningStableV5DialogueEffortQuestionIntent
  | WeeklyPlanningStableV5DialogueSchedulableWorkQuestionIntent
  | WeeklyPlanningStableV5DialogueResolutionQuestionIntent
  | WeeklyPlanningStableV5DialogueLearningStrategyProposalIntent;

export interface WeeklyPlanningStableV5DialogueGroundingFact {
  factId: string;
  kind:
    | 'planning_window'
    | 'task'
    | 'component'
    | 'workload'
    | 'effort_estimate'
    | 'temporal_constraint'
    | 'task_date_rule'
    | 'recurrence'
    | 'relation'
    | 'availability_declaration'
    | 'constraint_source_request';
  sourceText: string;
  data: Record<string, unknown>;
}

export interface WeeklyPlanningStableV5DialogueCurrentTurnGrounding {
  mode: 'none' | 'recommended' | 'required_before_resume';
  acceptedFacts: WeeklyPlanningStableV5DialogueGroundingFact[];
}

export interface WeeklyPlanningStableV5DialogueRenderInput {
  actionId: string;
  currentUserMessage: string;
  recentConversation: WeeklyPlanningStableV5DialogueConversationTurn[];
  planningInformation: Record<string, unknown> | null;
  currentTurnGrounding?: WeeklyPlanningStableV5DialogueCurrentTurnGrounding | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  questionTarget?: WeeklyPlanningStableV5DialogueQuestionTarget | null;
  questionIntent?: WeeklyPlanningStableV5DialogueQuestionIntent | null;
  previewPromotionControlLabel?: string | null;
  /**
   * Interaction architecture: the typed communication context of this reply. Absent in the
   * legacy architecture, whose (pre-#488) prompt lets the renderer read the raw user message.
   */
  communication?: WeeklyPlanningStableV5CommunicationContext | null;
  /**
   * Conversation architecture of the turn. Legacy (pre-#488) prompts carry neither the typed
   * communication context nor its instructions. Omitted = current default.
   */
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
  requiredLabels: string[];
  fallbackText: string;
  previewCount: number;
}

export type WeeklyPlanningStableV5DialogueFallbackReason =
  | 'provider_error'
  | 'invalid_json'
  | 'invalid_shape'
  | 'action_mismatch'
  | 'action_contract_mismatch'
  /** Interaction presentation claims contradict application-owned evidence; repair once. */
  | 'unverified_preview_constraint_claim'
  | 'unchecked_consultation_feasibility'
  /** A what-if answer invited promoting a different, unadopted current preview. */
  | 'unadopted_alternative_promotion'
  | 'grounding_contract_mismatch'
  | 'unsafe_text'
  | 'ungrounded_text'
  | 'repeated_question_text'
  /** Interaction architecture: the text exposes internal system/process vocabulary. */
  | 'internal_process_text'
  /** The turn's dispatch pool refused the call (exhausted, or the provider just failed). */
  | 'dispatch_refused'
  /**
   * Interaction architecture: the reply had to ask the question (askQuestion=true) but
   * contains no question, so the question would be recorded as presented without being asked.
   */
  | 'missing_question'
  /**
   * Interaction architecture: a reply that comes with no new preview claims that candidates
   * were made or changed (the renderer never sees the existing preview's contents).
   */
  | 'preview_claim_without_preview'
  /** P2: the reply failed verification against the typed mustConvey facts after the one regeneration (technical stop). */
  | 'verification_failed'
  /** P2: the verification itself could not be completed (dispatch refused, provider error, malformed verdict): technical stop, never a pass. */
  | 'verification_unavailable';

export type WeeklyPlanningStableV5DialogueRenderResult =
  | {
      status: 'rendered';
      text: string;
      rawResponse: string;
    }
  | {
      status: 'fallback';
      reason: WeeklyPlanningStableV5DialogueFallbackReason;
      rawResponse: string | null;
    };

export interface WeeklyPlanningStableV5DialogueRenderer {
  render(
    input: WeeklyPlanningStableV5DialogueRenderInput,
  ): Promise<WeeklyPlanningStableV5DialogueRenderResult>;
}

type JsonSchemaObject = Record<string, unknown>;

function stringSchema(): JsonSchemaObject {
  return { type: 'string' };
}

export const WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_stable_v5_dialogue_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'actionId',
        'actionKind',
        'questionCode',
        'groundingAcknowledgement',
        'text',
      ],
      properties: {
        actionId: stringSchema(),
        actionKind: {
          type: 'string',
          enum: ['question', 'status', 'preview_ready'],
        },
        questionCode: {
          anyOf: [stringSchema(), { type: 'null' }],
        },
        groundingAcknowledgement: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['factIds', 'text'],
              properties: {
                factIds: {
                  type: 'array',
                  minItems: 1,
                  items: stringSchema(),
                },
                text: {
                  type: 'string',
                  minLength: 1,
                },
              },
            },
            { type: 'null' },
          ],
        },
        text: stringSchema(),
      },
    },
  },
};

/** Consultation-only presentation metadata; never an authority for planning or persistence. */
export const WEEKLY_PLANNING_CONSULTATION_DIALOGUE_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
  json_schema: {
    ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema,
    schema: {
      ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema,
      required: ['actionId', 'actionKind', 'questionCode', 'groundingAcknowledgement', 'text', 'feasibilityClaim'],
      properties: {
        ...(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema.properties as JsonSchemaObject),
        feasibilityClaim: { type: 'string', enum: ['none', 'fits', 'does_not_fit'] },
      },
    },
  },
};
