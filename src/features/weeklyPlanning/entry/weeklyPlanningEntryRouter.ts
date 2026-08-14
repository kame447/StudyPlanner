import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type ChatMessage,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';

export type WeeklyPlanningEntryRoute = 'chat' | 'weekly_planning' | 'ambiguous';

export const WEEKLY_PLANNING_ENTRY_ROUTER_MAX_COMPLETION_TOKENS = 40;

export const WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_entry_route_v1',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: {
        decision: {
          type: 'string',
          enum: ['chat', 'weekly_planning', 'ambiguous'],
        },
      },
    },
  },
};

const WEEKLY_PLANNING_ENTRY_ROUTER_SYSTEM_PROMPT = [
  'You are a focused semantic router for a Japanese planner input.',
  'Return weekly_planning when the user wants work planned or distributed across a week, multiple days, or another planning window. An explicit request for a weekly plan remains weekly_planning even when tasks or durations are missing.',
  'Return chat when the user wants one concrete plan added or edited at one date/time, or asks for non-weekly planner help. A single event on a date inside next week is chat.',
  'Return ambiguous only when the meaning genuinely does not distinguish a single-plan request from planning across a window.',
  'Interpret meaning only. Do not decide readiness, clarification, scheduling, preview, approval, or persistence.',
  'Return only the response schema.',
].join('\n');

export interface WeeklyPlanningEntryRoutingTrace {
  decision: WeeklyPlanningEntryRoute;
  requestBytes: number;
  request: {
    messages: ChatMessage[];
    temperature: 0;
    responseFormat: JsonSchemaResponseFormat;
    purpose: 'weekly_planning_interpreter';
    maxCompletionTokens: number;
  };
  responseLength: number;
  rawResponse: string;
}

export interface WeeklyPlanningEntryRoutingResult {
  decision: WeeklyPlanningEntryRoute;
  trace: WeeklyPlanningEntryRoutingTrace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function defaultEntryRouterClient(): OpenAiCompatibleClient {
  const config = getAiConfig();
  const configError = getAiConfigValidationMessage(config);
  if (config.provider === 'rules' || configError) {
    throw new Error(configError ?? '週間計画の入口判定にはAI structured output接続が必要です。');
  }
  return createOpenAiCompatibleClient(config);
}

export function createWeeklyPlanningEntryRouterMessages(userText: string): ChatMessage[] {
  return [
    { role: 'system', content: WEEKLY_PLANNING_ENTRY_ROUTER_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ currentUserText: userText }) },
  ];
}

export function parseWeeklyPlanningEntryRoute(rawResponse: string): WeeklyPlanningEntryRoute | null {
  try {
    const value = JSON.parse(rawResponse) as unknown;
    if (!isRecord(value) || Object.keys(value).length !== 1) return null;
    return value.decision === 'chat'
      || value.decision === 'weekly_planning'
      || value.decision === 'ambiguous'
      ? value.decision
      : null;
  } catch {
    return null;
  }
}

export async function routeWeeklyPlanningEntry(
  userText: string,
  client: OpenAiCompatibleClient = defaultEntryRouterClient(),
): Promise<WeeklyPlanningEntryRoutingResult> {
  const messages = createWeeklyPlanningEntryRouterMessages(userText);
  const request = {
    messages,
    temperature: 0 as const,
    responseFormat: WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT,
    purpose: 'weekly_planning_interpreter' as const,
    maxCompletionTokens: WEEKLY_PLANNING_ENTRY_ROUTER_MAX_COMPLETION_TOKENS,
  };
  const rawResponse = await client.createChatCompletion(request);
  const decision = parseWeeklyPlanningEntryRoute(rawResponse);
  if (!decision) {
    throw new Error('週間計画の入口判定がresponse schemaに適合しませんでした。');
  }
  return {
    decision,
    trace: {
      decision,
      requestBytes: byteLength(request),
      request,
      responseLength: rawResponse.length,
      rawResponse,
    },
  };
}
