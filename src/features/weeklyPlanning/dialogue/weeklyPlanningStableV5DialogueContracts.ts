import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';

export type WeeklyPlanningStableV5DialogueActionKind =
  | 'question'
  | 'status'
  | 'preview_ready';

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

export interface WeeklyPlanningStableV5DialogueSchedulableWorkQuestionIntent {
  kind: 'schedulable_work_detail';
  mode: 'existing_target_scope_progress' | 'missing_task_identity';
  targetFactId: string | null;
  requestedInformation:
    | readonly ['total_scope', 'current_progress']
    | readonly ['task_identity'];
}

export type WeeklyPlanningStableV5DialogueResolutionKind =
  | 'semantic_clarification'
  | 'planning_horizon'
  | 'planning_window_choice'
  | 'quantity_role'
  | 'effort_estimate_choice'
  | 'availability_date_scope'
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

export type WeeklyPlanningStableV5DialogueQuestionIntent =
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
  | 'unsafe_text'
  | 'ungrounded_text'
  | 'repeated_question_text';

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
      required: ['actionId', 'actionKind', 'questionCode', 'text'],
      properties: {
        actionId: stringSchema(),
        actionKind: {
          type: 'string',
          enum: ['question', 'status', 'preview_ready'],
        },
        questionCode: {
          anyOf: [stringSchema(), { type: 'null' }],
        },
        text: stringSchema(),
      },
    },
  },
};
