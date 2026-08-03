import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  directWorkCoverageErrorsV5,
  missingDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  normalizePlanningWindowCanonicalV5,
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';
import {
  normalizeTaskBoundariesV5,
  taskBoundaryConformanceErrorsV5,
} from './weeklyPlanningTaskBoundaryContractV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const DATE_SET_NORMALIZATION_INSTRUCTION_V5 = [
  'For multiple non-consecutive explicit calendar dates that apply to one task, create one allowed_date temporal constraint per date. Do not collapse gaps into a continuous date range.',
  'For a repeating task on explicitly named weekdays, create one recurrence fact with kind weekly and a single days array using only sun, mon, tue, wed, thu, fri, sat.',
  'Expand weekday ranges before returning JSON and keep the entire weekday set in one recurrence fact.',
].join('\n');
const TEMPORAL_RELATION_BOUNDARY_INSTRUCTION_V5 = [
  'Priority and ordering statements describe task relations only. Never convert priority or list order into a temporal constraint.',
  'Use clock-bound temporal constraints only when the user explicitly provides the corresponding clock boundary.',
  'A named time period without an exact clock uses namedTimePeriod; an exact clock uses null namedTimePeriod.',
].join('\n');
const CONTEXTUAL_ANSWER_INSTRUCTION_V5 =
  'Use publicStateSummary.pendingQuestion as the authoritative target for a short answer and emit only the minimal semantic value needed to answer it. Never infer the target from assistant wording or select another public fact.';
const AUTHORIZATION_INSTRUCTION_V5 =
  'When the user only authorizes creation from accepted state, set planningIntent to create_plan without repeating accepted facts. Include only facts explicitly added or changed in the current utterance.';
const PLANNING_WINDOW_SCOPE_INSTRUCTION_V5 =
  'Treat a directly stated whole-plan range, including a short answer to a pending planning-horizon question, as planningWindow; do not promote task-specific dates.';

interface DirectPlanningWindowExpectationV5 {
  phrase: '今日' | '明日' | '明後日' | '今週' | '来週';
  kind: 'relative_day' | 'relative_week';
  value: 'today' | 'tomorrow' | 'day_after_tomorrow' | 'this_week' | 'next_week';
}

interface SemanticValidationAttemptV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
  algorithmicRepairs: string[];
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
  algorithmicRepairs?: string[];
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
  const errors = planningWindowCanonicalValueErrors(document.planningWindow);
  const expected = directPlanningWindowExpectation(input);
  if (!expected) return errors;
  if (!document.planningWindow) {
    errors.push(`document.planningWindow:direct-user-range-omitted:${expected.value}`);
    return errors;
  }
  if (
    document.planningWindow.kind !== expected.kind
    || document.planningWindow.value !== expected.value
  ) {
    errors.push(
      `document.planningWindow:direct-user-range-mismatch:expected-${expected.kind}:${expected.value}`,
    );
  }
  return errors;
}

function normalizeSemanticDocument(
  document: WeeklyPlanningSemanticDocumentV5,
): {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
} {
  const windowNormalization = normalizePlanningWindowCanonicalV5(
    document.planningWindow,
  );
  const windowNormalizedDocument = windowNormalization.window === document.planningWindow
    ? document
    : { ...document, planningWindow: windowNormalization.window };
  const boundaryNormalization = normalizeTaskBoundariesV5(windowNormalizedDocument);
  return {
    document: boundaryNormalization.document,
    repairs: [
      ...windowNormalization.repairs,
      ...boundaryNormalization.repairs,
    ],
  };
}

function semanticConformanceErrors(
  input: WeeklyPlanningSemanticNormalizerInputV5,
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return [
    ...planningWindowConformanceErrors(input, document),
    ...directWorkCoverageErrorsV5({ userText: input.userText, document }),
    ...taskBoundaryConformanceErrorsV5(document),
  ];
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
      algorithmicRepairs: [],
    };
  }

  const normalized = normalizeSemanticDocument(parsed.document);
  const conformanceErrors = semanticConformanceErrors(input, normalized.document);
  return {
    document: conformanceErrors.length === 0 ? normalized.document : null,
    parsedDocument: normalized.document,
    errors: conformanceErrors,
    algorithmicRepairs: normalized.repairs,
  };
}

export function createWeeklyPlanningSemanticBaseMessagesV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticSystemPromptV5(),
        DATE_SET_NORMALIZATION_INSTRUCTION_V5,
        TEMPORAL_RELATION_BOUNDARY_INSTRUCTION_V5,
        CONTEXTUAL_ANSWER_INSTRUCTION_V5,
        AUTHORIZATION_INSTRUCTION_V5,
        PLANNING_WINDOW_SCOPE_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV5(input) },
  ];
}

function repairDirectivesForErrors(errors: string[]): string[] {
  const directives: string[] = [];

  if (errors.some((error) => error.includes('explicit-work-evidence-omitted'))) {
    directives.push('Restore each listed missing evidence item without deleting or changing already valid items.');
  }
  if (errors.some((error) => error.includes('parent-title-collides-with-child'))) {
    directives.push('Use a genuine shared parent identity when supported; otherwise separate the independent root items into distinct top-level tasks.');
  }
  if (errors.some((error) =>
    error.includes('canonical-relative-')
    || error.includes('source-meaning-mismatch')
    || error.includes('direct-user-range-'))) {
    directives.push('Correct only the planning-window kind or value required by the source meaning and listed error.');
  }
  if (errors.some((error) =>
    error.includes(':missing-start')
    || error.includes(':missing-end')
    || error.includes(':missing-interval')
    || error.includes(':missing-deadline'))) {
    directives.push('Remove or change unsupported temporal constraints instead of inventing a missing clock or date boundary.');
  }
  if (errors.some((error) => error.includes('namedTimePeriod:cannot-combine-with-clock'))) {
    directives.push('Keep either a named time period or exact clock fields, not both.');
  }
  if (errors.some((error) =>
    error.includes('preferred-window-cannot-be-hard')
    || error.includes('soft-fixed-interval-use-preferred-window'))) {
    directives.push('Align temporal constraint kind and strength without adding new facts.');
  }
  if (directives.length === 0) {
    directives.push('Correct only the listed validation failures while preserving supported user meaning.');
  }

  return unique(directives);
}

function createRepairMessages(params: {
  input: WeeklyPlanningSemanticNormalizerInputV5;
  baseMessages: ChatMessage[];
  invalidResponse: string;
  invalidDocument: WeeklyPlanningSemanticDocumentV5 | null;
  validationErrors: string[];
}): ChatMessage[] {
  const missingEvidence = params.invalidDocument
    ? missingDirectWorkExpectationsV5({
        userText: params.input.userText,
        document: params.invalidDocument,
      })
    : [];

  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Return the complete corrected Stable V5 JSON document only. Apply only the required changes and do not invent facts or application decisions.',
        requiredChanges: repairDirectivesForErrors(params.validationErrors),
        missingEvidence,
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
      const algorithmicRepairs: string[] = [];
      const baseMessages = createWeeklyPlanningSemanticBaseMessagesV5(input);
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
        algorithmicRepairs: unique(algorithmicRepairs),
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
      algorithmicRepairs.push(...initialValidation.algorithmicRepairs);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_validation_result',
        data: {
          attempt: 'initial',
          accepted: Boolean(initialValidation.document),
          errors: initialValidation.errors,
          algorithmicRepairs: initialValidation.algorithmicRepairs,
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
        input,
        baseMessages,
        invalidResponse: initialResponse,
        invalidDocument: initialValidation.parsedDocument,
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
      algorithmicRepairs.push(...repairedValidation.algorithmicRepairs);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_validation_result',
        severity: repairedValidation.document ? 'info' : 'error',
        data: {
          attempt: 'repair',
          accepted: Boolean(repairedValidation.document),
          errors: repairedValidation.errors,
          algorithmicRepairs: repairedValidation.algorithmicRepairs,
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
