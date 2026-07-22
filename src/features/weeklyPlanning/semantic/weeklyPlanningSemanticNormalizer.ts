import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticSystemPrompt,
  createWeeklyPlanningSemanticUserPrompt,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import { parseWeeklyPlanningSemanticDocument } from './weeklyPlanningSemanticValidator';

const SEMANTIC_NORMALIZER_MAX_COMPLETION_TOKENS = 2400;

export interface WeeklyPlanningSemanticNormalizerInput {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticNormalizerDiagnostics {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
}

export interface WeeklyPlanningSemanticNormalizerResult {
  status: 'accepted' | 'rejected' | 'provider_failure';
  document: WeeklyPlanningSemanticDocument | null;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnostics;
}

export interface WeeklyPlanningSemanticNormalizer {
  normalize(
    input: WeeklyPlanningSemanticNormalizerInput,
  ): Promise<WeeklyPlanningSemanticNormalizerResult>;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Unknown semantic normalizer provider error.';
}

function createBaseMessages(input: WeeklyPlanningSemanticNormalizerInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: createWeeklyPlanningSemanticSystemPrompt(),
    },
    {
      role: 'user',
      content: createWeeklyPlanningSemanticUserPrompt(input),
    },
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
        instruction: 'Return the complete corrected JSON document only. Preserve the user meaning. Do not add facts, commands, questions, readiness decisions, or schedule placements.',
        validationErrors: params.validationErrors,
      }),
    },
  ];
}

export function createWeeklyPlanningSemanticNormalizer(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizer {
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
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
          maxCompletionTokens: SEMANTIC_NORMALIZER_MAX_COMPLETION_TOKENS,
        }));
        const response = await client.createChatCompletion({
          messages,
          temperature: 0,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: SEMANTIC_NORMALIZER_MAX_COMPLETION_TOKENS,
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
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
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

      const initialParse = parseWeeklyPlanningSemanticDocument(initialResponse);
      if (initialParse.document) {
        return {
          status: 'accepted',
          document: initialParse.document,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
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
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
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

      const repairedParse = parseWeeklyPlanningSemanticDocument(repairedResponse);
      if (!repairedParse.document) {
        return {
          status: 'rejected',
          document: null,
          diagnostics: {
            schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
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
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
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
