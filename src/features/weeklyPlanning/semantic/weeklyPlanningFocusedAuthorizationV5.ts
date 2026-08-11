import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS = 80;

export const FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_authorization_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: {
        decision: {
          type: 'string',
          enum: ['create_plan', 'fallback'],
        },
      },
    },
  },
};

const FOCUSED_AUTHORIZATION_SYSTEM_PROMPT = [
  'You are a focused semantic interpreter for one planning-conversation decision.',
  'Meaning interpretation is your responsibility. Deterministic code will only route this request and combine your structured decision with other AI-derived semantic facts.',
  'Return create_plan only when the current user utterance purely authorizes creating the draft/preview from conditions that are already collected.',
  'Return fallback for any utterance that adds, changes, removes, corrects, or qualifies planning facts, as well as ordinary discussion or ambiguous intent.',
  'Do not decide readiness, scheduling, placement, persistence, or wording. Return only the schema.',
].join('\n');

export interface FocusedAuthorizationDecisionV5 {
  decision: 'create_plan' | 'fallback';
}

export interface FocusedAuthorizationInputV5 {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function focusedAuthorizationEligibleV5(
  input: FocusedAuthorizationInputV5,
): boolean {
  const summary = input.publicStateSummary;
  if (!isRecord(summary)) return false;
  if (summary.pendingQuestion !== null && summary.pendingQuestion !== undefined) return false;
  if (summary.previousCompatibilityStatus !== 'needs_scope') return false;
  return Array.isArray(summary.tasks) && summary.tasks.length > 0;
}

export function createFocusedAuthorizationMessagesV5(
  input: FocusedAuthorizationInputV5,
): ChatMessage[] {
  const summary = input.publicStateSummary;
  return [
    { role: 'system', content: FOCUSED_AUTHORIZATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: input.userText,
        lastAssistantMessage: isRecord(summary)
          && typeof summary.lastAssistantMessage === 'string'
          ? summary.lastAssistantMessage
          : null,
      }),
    },
  ];
}

export function parseFocusedAuthorizationDecisionV5(
  raw: string,
): FocusedAuthorizationDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    const decision = value.decision;
    if (decision !== 'create_plan' && decision !== 'fallback') return null;
    return { decision };
  } catch {
    return null;
  }
}

export function createFocusedAuthorizationDocumentV5(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}
