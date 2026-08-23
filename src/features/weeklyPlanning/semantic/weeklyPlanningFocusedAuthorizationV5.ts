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
  'Return create_plan only when the current utterance purely authorizes creating the draft/preview from already-collected conditions.',
  'If it adds, changes, removes, corrects, qualifies, discusses, or ambiguously refers to any planning fact, return fallback.',
].join('\n');

export interface FocusedAuthorizationDecisionV5 {
  decision: 'create_plan' | 'fallback';
}

export interface FocusedAuthorizationInputV5 {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'decision')) return null;
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
