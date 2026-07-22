import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticSystemPromptV2,
  createWeeklyPlanningSemanticUserPromptV2,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import { parseWeeklyPlanningSemanticDocumentV2 } from './weeklyPlanningSemanticValidatorV2';

const SEMANTIC_NORMALIZER_V2_MAX_COMPLETION_TOKENS = 3200;

export interface WeeklyPlanningSemanticNormalizerInputV2 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticNormalizerDiagnosticsV2 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
}

export interface WeeklyPlanningSemanticNormalizerResultV2 {
  status: 'accepted' | 'rejected' | 'provider_failure';
  document: WeeklyPlanningSemanticDocumentV2 | null;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV2;
}

export interface WeeklyPlanningSemanticNormalizerV2 {
  normalize(
    input: WeeklyPlanningSemanticNormalizerInputV2,
  ): Promise<WeeklyPlanningSemanticNormalizerResultV2>;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Unknown semantic alpha2 provider error.';
}

function createBaseMessages(input: WeeklyPlanningSemanticNormalizerInputV2): ChatMessage[] {
  return [
    { role: 'system', content: createWeeklyPlanningSemanticSystemPromptV2() },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV2(input) },
  ];
}

function createRepairMessages(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
}): ChatMessage[] {
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Return the complete corrected alpha2 JSON document only. Preserve the user meaning. Do not invent external events, facts, commands, questions, readiness decisions, or schedule placements.',
        validationErrors: params.validationErrors,
      }),
    },
  ];
}

export function createWeeklyPlanningSemanticNormalizerV2(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV2 {
  return {
    async normalize(input) {
      const startedAt = performance.now();
      const requestBytes: number[] = [];
      const responseLengths: number[] = [];
      const baseMessages = createBaseMessages(input);
      const call = async (messages: ChatMessage[]): Promise<string> => {
        requestBytes.push(byteLength({
          purpose: 'weekly_planning_semantic_normalizer',
          messages,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
          maxCompletionTokens: SEMANTIC_NORMALIZER_V2_MAX_COMPLETION_TOKENS,
        }));
        const response = await client.createChatCompletion({
          messages,
          temperature: 0,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2,
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: SEMANTIC_NORMALIZER_V2_MAX_COMPLETION_TOKENS,
        });
        responseLengths.push(response.length);
        return response;
      };

      let initialResponse: string;
      try {
        initialResponse = await call(baseMessages);
      } catch (error) {
        return {
          status: 'provider_failure',
          document: null,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
            attemptCount: 1,
            repairAttempted: false,
            requestBytes,
            responseLengths,
            latencyMs: Math.round(performance.now() - startedAt),
            validationErrors: [],
            providerError: errorMessage(error),
          },
        };
      }

      const initialParse = parseWeeklyPlanningSemanticDocumentV2(initialResponse);
      if (initialParse.document) {
        return {
          status: 'accepted',
          document: initialParse.document,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
            attemptCount: 1,
            repairAttempted: false,
            requestBytes,
            responseLengths,
            latencyMs: Math.round(performance.now() - startedAt),
            validationErrors: [],
            providerError: null,
          },
        };
      }

      const repairMessages = createRepairMessages({
        baseMessages,
        invalidResponse: initialResponse,
        validationErrors: initialParse.errors,
      });

      let repairedResponse: string;
      try {
        repairedResponse = await call(repairMessages);
      } catch (error) {
        return {
          status: 'provider_failure',
          document: null,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
            attemptCount: 2,
            repairAttempted: true,
            requestBytes,
            responseLengths,
            latencyMs: Math.round(performance.now() - startedAt),
            validationErrors: initialParse.errors,
            providerError: errorMessage(error),
          },
        };
      }

      const repairedParse = parseWeeklyPlanningSemanticDocumentV2(repairedResponse);
      if (!repairedParse.document) {
        return {
          status: 'rejected',
          document: null,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
            attemptCount: 2,
            repairAttempted: true,
            requestBytes,
            responseLengths,
            latencyMs: Math.round(performance.now() - startedAt),
            validationErrors: [
              ...initialParse.errors.map((value) => `initial:${value}`),
              ...repairedParse.errors.map((value) => `repair:${value}`),
            ],
            providerError: null,
          },
        };
      }

      return {
        status: 'accepted',
        document: repairedParse.document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
          attemptCount: 2,
          repairAttempted: true,
          requestBytes,
          responseLengths,
          latencyMs: Math.round(performance.now() - startedAt),
          validationErrors: initialParse.errors,
          providerError: null,
        },
      };
    },
  };
}
