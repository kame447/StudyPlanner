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

export interface WeeklyPlanningStableV5DialogueQuestionIntent {
  kind: 'effort_measurement';
  measurement: 'total_duration' | 'duration_per_unit' | 'session_duration';
  quantityRole: 'declared' | 'target' | 'remaining' | 'completed' | 'unknown';
  targetFactId: string;
  amount: number;
  unitCode: string | null;
  unitLabel: string | null;
}

export interface WeeklyPlanningStableV5DialogueRenderInput {
  actionId: string;
  currentUserMessage: string;
  recentConversation: WeeklyPlanningStableV5DialogueConversationTurn[];
  planningInformation: Record<string, unknown> | null;
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
  | 'ungrounded_text';

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
