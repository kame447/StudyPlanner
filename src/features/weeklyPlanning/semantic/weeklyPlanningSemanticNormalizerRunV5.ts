import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from './weeklyPlanningSemanticTypesV5';
import { WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerDiagnosticsV5,
  type WeeklyPlanningSemanticNormalizerInputV5,
  type WeeklyPlanningSemanticNormalizerResultV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';

export const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
export const SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS = 6400;
export const SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES = 1200;

type ChatCompletionRequest = Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];
type GenericSemanticAttempt = 'initial' | 'repair' | 'dense_completeness_retry';

export function semanticNormalizerByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function semanticNormalizerCompletionTokenBudgetV5(
  input: Pick<WeeklyPlanningSemanticNormalizerInputV5, 'userText'>,
): number {
  return textByteLength(input.userText) >= SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES
    ? SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS
    : SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS;
}

export function semanticNormalizerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Unknown Stable V5 semantic provider error.';
}

export function semanticNormalizerErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: errorWithCause.cause ?? null,
    };
  }
  return { value: error };
}

export function focusedRepairCalendarContextV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): { currentDate?: string | null; timeZone?: string | null } | null {
  const value = input.publicStateSummary?.calendarContext;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    currentDate: typeof record.currentDate === 'string' ? record.currentDate : null,
    timeZone: typeof record.timeZone === 'string' ? record.timeZone : null,
  };
}

export class WeeklyPlanningSemanticNormalizerRunV5 {
  readonly startedAt = performance.now();
  readonly requestBytes: number[] = [];
  readonly responseLengths: number[] = [];
  readonly algorithmicRepairs: string[] = [];

  constructor(
    readonly client: OpenAiCompatibleClient,
    readonly input: WeeklyPlanningSemanticNormalizerInputV5,
  ) {}

  async callGeneric(
    messages: ChatMessage[],
    attempt: GenericSemanticAttempt,
  ): Promise<string> {
    return this.callTracked({
      messages,
      temperature: 0,
      responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: semanticNormalizerCompletionTokenBudgetV5(this.input),
    }, attempt);
  }

  async callTracked(
    request: ChatCompletionRequest,
    attempt: string,
  ): Promise<string> {
    const bytes = semanticNormalizerByteLength(request);
    this.requestBytes.push(bytes);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: this.input.traceRequestId,
      stage: 'semantic_provider_request',
      data: { attempt, requestBytes: bytes, request },
    });
    try {
      const response = await this.client.createChatCompletion(request);
      this.responseLengths.push(response.length);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: this.input.traceRequestId,
        stage: 'semantic_provider_response',
        data: {
          attempt,
          responseLength: response.length,
          rawResponse: response,
        },
      });
      return response;
    } catch (error) {
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: this.input.traceRequestId,
        stage: 'semantic_provider_error',
        severity: 'error',
        data: { attempt, error: semanticNormalizerErrorDetails(error) },
      });
      throw error;
    }
  }

  addAlgorithmicRepairs(values: readonly string[]): void {
    this.algorithmicRepairs.push(...values);
  }

  diagnostics(params: {
    attemptCount: number;
    repairAttempted: boolean;
    validationErrors: string[];
    providerError: string | null;
    requestBytes?: number[];
    responseLengths?: number[];
  }): WeeklyPlanningSemanticNormalizerDiagnosticsV5 {
    return {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.name,
      normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
      attemptCount: params.attemptCount,
      repairAttempted: params.repairAttempted,
      requestBytes: params.requestBytes ?? [...this.requestBytes],
      responseLengths: params.responseLengths ?? [...this.responseLengths],
      latencyMs: Math.round(performance.now() - this.startedAt),
      validationErrors: params.validationErrors,
      algorithmicRepairs: [...new Set(this.algorithmicRepairs)],
      providerError: params.providerError,
    };
  }

  recordDecision(
    result: WeeklyPlanningSemanticNormalizerResultV5,
    options: {
      route?: string;
      severity?: 'info' | 'warn' | 'error';
      extra?: Record<string, unknown>;
    } = {},
  ): void {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: this.input.traceRequestId,
      stage: 'semantic_normalizer_decision',
      ...(options.severity ? { severity: options.severity } : {}),
      data: {
        ...result,
        ...(options.route ? { orchestrationRoute: options.route } : {}),
        ...(options.extra ?? {}),
      },
    });
  }
}
