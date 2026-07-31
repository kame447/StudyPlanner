import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const DATE_SET_NORMALIZATION_INSTRUCTION_V5 = [
  'For multiple non-consecutive explicit calendar dates that apply to one task, create one allowed_date temporal constraint per date. Do not collapse gaps into a continuous date range.',
  'For a repeating task on explicitly named weekdays, create one recurrence fact with kind weekly and a single days array using only sun, mon, tue, wed, thu, fri, sat.',
  'Expand weekday ranges before returning JSON. For example, 水曜と金曜から日曜 becomes days [wed, fri, sat, sun]. Keep the entire weekday set in one recurrence fact rather than splitting it into multiple recurrence facts.',
].join('\n');
const TEMPORAL_RELATION_BOUNDARY_INSTRUCTION_V5 = [
  'Priority and ordering statements describe task relations only. Represent them with priority_over, before, after, or sequence relations as appropriate. Never convert priority or list order into a temporal constraint.',
  'Use earliest_start or latest_end only when the user explicitly provides the corresponding clock boundary. Never invent a clock time from priority, task order, a named time period, or a default schedule.',
  'For a named time period without an exact clock, use preferred_window when it is a task preference and leave startTime and endTime null. When an exact clock is present, namedTimePeriod must be null.',
].join('\n');
const CONTEXTUAL_ANSWER_INSTRUCTION_V5 = [
  'Use publicStateSummary.pendingQuestion as the authoritative machine-readable description of the immediately preceding application question. Do not infer the question identity or target from the assistant wording.',
  'When pendingQuestion.questionCode is missing_effort_estimate and the user answers only a duration such as 3時間です, return exactly one minimal task containing exactly one effortEstimate with that duration in minutes. The application core binds the structured value to pendingQuestion.targetFactId.',
  'When pendingQuestion.questionCode is quantity_role_unresolved and the user answers whether the quantity is the current target, remaining total, or completed amount, return exactly one minimal task containing exactly one workload with quantityRole target, remaining, or completed. Preserve the amount and unit visible in publicStateSummary when the short answer does not restate them.',
  'Do not select a different public fact. Do not emit application commands or state mutations. Emit only the meaning of the short answer in the Stable V5 schema.',
].join('\n');
const AUTHORIZATION_INSTRUCTION_V5 = [
  'When the user only authorizes creation from the already accepted public state, for example この条件で予定を作って or それで仮予定を作って, set planningIntent to create_plan and return empty arrays for tasks, relations, availabilityDeclarations, constraintSourceRequests, uncertainties, corrections, and decisions unless the same utterance explicitly adds or changes a fact.',
  'Do not copy accepted tasks or constraints from publicStateSummary into a creation-authorization response. publicStateSummary is context, not a request to re-emit existing facts.',
  'When the user provides new planning facts and requests creation in the same utterance, set planningIntent to create_plan and include only those newly stated facts.',
].join('\n');
const DIRECT_PLANNING_WINDOW_INSTRUCTION_V5 = [
  'Do not omit a whole-plan planningWindow that the current user states directly.',
  'For 今日, 明日, 明後日, 今週, and 来週 used as the requested plan range, preserve the symbolic values today, tomorrow, day_after_tomorrow, this_week, and next_week.',
  'A short answer such as 明日 is a whole-plan planningWindow when publicStateSummary.pendingQuestion.questionCode asks for the planning horizon. Do not infer this from the assistant wording.',
  'Do not promote a date that only modifies one task, availability declaration, deadline, or exclusion into the whole-plan planningWindow.',
].join('\n');

interface DirectPlanningWindowExpectationV5 {
  phrase: '今日' | '明日' | '明後日' | '今週' | '来週';
  kind: 'relative_day' | 'relative_week';
  value: 'today' | 'tomorrow' | 'day_after_tomorrow' | 'this_week' | 'next_week';
}

interface SemanticValidationAttemptV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
}

const DIRECT_PLANNING_WINDOWS_V5: readonly DirectPlanningWindowExpectationV5[] = [
  { phrase: '明後日', kind: 'relative_day', value: 'day_after_tomorrow' },
  { phrase: '明日', kind: 'relative_day', value: 'tomorrow' },
  { phrase: '今日', kind: 'relative_day', value: 'today' },
  { phrase: '来週', kind: 'relative_week', value: 'next_week' },
  { phrase: '今週', kind: 'relative_week', value: 'this_week' },
];

export interface WeeklyPlanningSemanticNormalizerInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  traceRequestId?: string;
}

export interface WeeklyPlanningSemanticNormalizerDiagnosticsV5 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5;
  jsonSchemaName: typeof WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name;
  normalizerVersion: typeof WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
}

export interface WeeklyPlanningSemanticNormalizerResultV5 {
  status: 'accepted' | 'rejected' | 'provider_failure';
  document: WeeklyPlanningSemanticDocumentV5 | null;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV5;
}

export interface WeeklyPlanningSemanticNormalizerV5 {
  normalize(
    input: WeeklyPlanningSemanticNormalizerInputV5,
  ): Promise<WeeklyPlanningSemanticNormalizerResultV5>;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Unknown Stable V5 semantic provider error.';
}

function errorDetails(error: unknown): Record<string, unknown> {
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

function pendingQuestionAsksForPlanningWindow(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): boolean {
  const code = readWeeklyPlanningPendingQuestionV5(
    input.publicStateSummary,
  )?.questionCode;
  return code === 'invalid_planning_horizon'
    || code === 'ambiguous_planning_window'
    || code === 'planning_period';
}

function isWholePlanRangeExpression(
  input: WeeklyPlanningSemanticNormalizerInputV5,
  expectation: DirectPlanningWindowExpectationV5,
): boolean {
  const text = input.userText.replace(/\s+/g, '');
  if (!text.includes(expectation.phrase)) return false;

  const phrase = expectation.phrase;
  const rangeBeforePlan = new RegExp(
    `${phrase}(?:だけ|一日|1日)?(?:の)?(?:予定|計画|スケジュール)`,
  );
  const planBeforeRange = new RegExp(
    `(?:予定|計画|スケジュール)(?:の期間|の範囲|は|を)?[^。！？!?]{0,8}${phrase}`,
  );
  const shortAnswer = new RegExp(
    `^${phrase}(?:だけ|一日|1日)?(?:の予定)?(?:です|で|にします|にしたい)?[。.!！?？]*$`,
  );

  return rangeBeforePlan.test(text)
    || planBeforeRange.test(text)
    || (shortAnswer.test(text) && pendingQuestionAsksForPlanningWindow(input));
}

function directPlanningWindowExpectation(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): DirectPlanningWindowExpectationV5 | null {
  const matches = DIRECT_PLANNING_WINDOWS_V5.filter(
    (expectation) => isWholePlanRangeExpression(input, expectation),
  );
  return matches.length === 1 ? matches[0] : null;
}

function planningWindowConformanceErrors(
  input: WeeklyPlanningSemanticNormalizerInputV5,
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const expected = directPlanningWindowExpectation(input);
  if (!expected) return [];
  if (!document.planningWindow) {
    return [`document.planningWindow:direct-user-range-omitted:${expected.value}`];
  }
  if (
    document.planningWindow.kind !== expected.kind
    || document.planningWindow.value !== expected.value
  ) {
    return [
      `document.planningWindow:direct-user-range-mismatch:expected-${expected.kind}:${expected.value}`,
    ];
  }
  return [];
}

function validateSemanticResponse(
  rawResponse: string,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): SemanticValidationAttemptV5 {
  const parsed = parseWeeklyPlanningSemanticDocumentV5(rawResponse);
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: null,
      errors: parsed.errors,
    };
  }
  const conformanceErrors = planningWindowConformanceErrors(input, parsed.document);
  return {
    document: conformanceErrors.length === 0 ? parsed.document : null,
    parsedDocument: parsed.document,
    errors: conformanceErrors,
  };
}

function createBaseMessages(input: WeeklyPlanningSemanticNormalizerInputV5): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticSystemPromptV5(),
        DATE_SET_NORMALIZATION_INSTRUCTION_V5,
        TEMPORAL_RELATION_BOUNDARY_INSTRUCTION_V5,
        CONTEXTUAL_ANSWER_INSTRUCTION_V5,
        AUTHORIZATION_INSTRUCTION_V5,
        DIRECT_PLANNING_WINDOW_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV5(input) },
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
        instruction: 'Return the complete corrected Stable V5 JSON document only. Preserve the user meaning. Do not invent external events, facts, commands, questions, readiness decisions, preview decisions, schedule placements, approval decisions, or save decisions.',
        repairRules: [
          'Never invent a clock time that is not explicitly supported by the user text or recent conversation.',
          'If missing-start or missing-end is reported and the source text has no explicit clock boundary, remove the unsupported earliest_start or latest_end constraint, or replace it with a semantically supported constraint kind. Do not add a guessed clock.',
          'Priority and ordering language must remain task relations. Do not repair a priority relation by adding temporal constraints.',
          'A namedTimePeriod cannot coexist with startTime or endTime. Preserve a named period with null clock fields and preferred_window when the user expressed a preference; preserve an explicit clock by setting namedTimePeriod to null.',
          'When direct-user-range-omitted or direct-user-range-mismatch is reported, restore the explicitly stated whole-plan planningWindow. Use relative_day/tomorrow for 明日 and preserve other symbolic day or week values exactly as instructed.',
          'Make the smallest correction needed to satisfy validation while preserving only facts supported by the user.',
        ],
        validationErrors: params.validationErrors,
      }),
    },
  ];
}

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const startedAt = performance.now();
      const requestBytes: number[] = [];
      const responseLengths: number[] = [];
      const baseMessages = createBaseMessages(input);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_normalizer_prepared',
        data: {
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          input,
          request: {
            purpose: 'weekly_planning_semantic_normalizer',
            messages: baseMessages,
            temperature: 0,
            responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
            maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
          },
        },
      });

      const call = async (
        messages: ChatMessage[],
        attempt: 'initial' | 'repair',
      ): Promise<string> => {
        const request = {
          messages,
          temperature: 0,
          responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer' as const,
          maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
        };
        const bytes = byteLength(request);
        requestBytes.push(bytes);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_provider_request',
          data: { attempt, requestBytes: bytes, request },
        });
        try {
          const response = await client.createChatCompletion(request);
          responseLengths.push(response.length);
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
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
            requestId: input.traceRequestId,
            stage: 'semantic_provider_error',
            severity: 'error',
            data: { attempt, error: errorDetails(error) },
          });
          throw error;
        }
      };

      const diagnostics = (params: {
        attemptCount: number;
        repairAttempted: boolean;
        validationErrors: string[];
        providerError: string | null;
      }): WeeklyPlanningSemanticNormalizerDiagnosticsV5 => ({
        schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
        jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
        normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
        attemptCount: params.attemptCount,
        repairAttempted: params.repairAttempted,
        requestBytes,
        responseLengths,
        latencyMs: Math.round(performance.now() - startedAt),
        validationErrors: params.validationErrors,
        providerError: params.providerError,
      });

      let initialResponse: string;
      try {
        initialResponse = await call(baseMessages, 'initial');
      } catch (error) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'provider_failure',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: errorMessage(error),
          }),
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_normalizer_decision',
          severity: 'error',
          data: result,
        });
        return result;
      }

      const initialValidation = validateSemanticResponse(initialResponse, input);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_validation_result',
        data: {
          attempt: 'initial',
          accepted: Boolean(initialValidation.document),
          errors: initialValidation.errors,
          parsedDocument: initialValidation.parsedDocument,
        },
      });
      if (initialValidation.document) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'accepted',
          document: initialValidation.document,
          diagnostics: diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: null,
          }),
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_normalizer_decision',
          data: result,
        });
        return result;
      }

      const repairMessages = createRepairMessages({
        baseMessages,
        invalidResponse: initialResponse,
        validationErrors: initialValidation.errors,
      });
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_repair_prepared',
        severity: 'warn',
        data: {
          invalidResponse: initialResponse,
          validationErrors: initialValidation.errors,
          repairMessages,
        },
      });

      let repairedResponse: string;
      try {
        repairedResponse = await call(repairMessages, 'repair');
      } catch (error) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'provider_failure',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: initialValidation.errors,
            providerError: errorMessage(error),
          }),
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_normalizer_decision',
          severity: 'error',
          data: result,
        });
        return result;
      }

      const repairedValidation = validateSemanticResponse(repairedResponse, input);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_validation_result',
        severity: repairedValidation.document ? 'info' : 'error',
        data: {
          attempt: 'repair',
          accepted: Boolean(repairedValidation.document),
          errors: repairedValidation.errors,
          parsedDocument: repairedValidation.parsedDocument,
        },
      });
      if (!repairedValidation.document) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'rejected',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: [
              ...initialValidation.errors.map((value) => `initial:${value}`),
              ...repairedValidation.errors.map((value) => `repair:${value}`),
            ],
            providerError: null,
          }),
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_normalizer_decision',
          severity: 'error',
          data: result,
        });
        return result;
      }

      const result: WeeklyPlanningSemanticNormalizerResultV5 = {
        status: 'accepted',
        document: repairedValidation.document,
        diagnostics: diagnostics({
          attemptCount: 2,
          repairAttempted: true,
          validationErrors: initialValidation.errors,
          providerError: null,
        }),
      };
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_normalizer_decision',
        data: result,
      });
      return result;
    },
  };
}
