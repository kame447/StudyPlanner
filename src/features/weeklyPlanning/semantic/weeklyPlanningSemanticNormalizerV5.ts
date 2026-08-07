import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  normalizeContainingTaskComponentParentV5,
} from './weeklyPlanningComponentParentNormalizationV5';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningCopiedUserContextNormalizationV5';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningDuplicateWorkloadNormalizationV5';
import {
  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,
} from './weeklyPlanningExistingEntityBindingV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticEvidenceV5,
} from './weeklyPlanningSemanticEvidenceV5';
import {
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'You alone interpret user meaning and context; code only validates/applies JSON.',
  'Treat publicStateSummary.pendingQuestion as authoritative; never infer its target from assistant wording.',
  'For short answers, return only facts needed for that target. Every sourceText must be supported by current userText, not prior turns.',
  'Current SemanticDocument is a delta: publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText.',
  'If current userText does not state/change the plan-wide period, planningWindow must be null even when accepted state has one.',
  'Roles: target means the amount intended for this plan; remaining means the full unfinished amount; completed means the amount already done. For quantity_role_unresolved, a resolved answer emits one minimal task/workload with fresh localIds, target amount/unit, and selected role. Never keep uncertainty for a resolved role or use public Fact IDs in targetLocalId; unresolved emits no workload.',
  'For semantic_uncertainty, return only its resolving semantic delta; if still unresolved, emit uncertainty.',
  'existingPublicId is an exact reference to an accepted publicStateSummary task/component, never a localId. Use it for cross-turn continuation and null for new entities.',
  'An effortEstimate may target the exact task, component, or workload localId it describes.',
  'For creation authorization, use planningIntent create_plan without repeating accepted facts.',
  'Do not invent. Return Stable V5 JSON only; no commands, scheduling, readiness, preview, save decisions, or prose.',
].join('\n');
const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive explicit dates use one allowed_date constraint per date; never merge them into a range.',
  'Explicit repeating weekdays use one weekly recurrence with all stated days.',
  'Any explicit recurring cadence represented in workload.periodExpression must also be represented by a matching recurrence; periodExpression never substitutes for recurrence.',
  'Priority and ordering are task relations, not clock constraints.',
  'Use clock fields only for boundaries explicitly supplied by the user.',
  'Named periods use namedTimePeriod; exact clocks use null namedTimePeriod.',
].join('\n');

interface SemanticValidationAttemptV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
  algorithmicRepairs: string[];
}

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

function validateSemanticResponse(
  rawResponse: string,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): SemanticValidationAttemptV5 {
  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({
    rawResponse,
    userText: input.userText,
    publicStateSummary: input.publicStateSummary,
  });
  const componentParentNormalization = normalizeContainingTaskComponentParentV5(
    copiedContextNormalization.rawResponse,
  );
  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(
    componentParentNormalization.rawResponse,
  );
  const algorithmicRepairs = [
    ...copiedContextNormalization.repairs,
    ...componentParentNormalization.repairs,
    ...workloadNormalization.repairs,
  ];
  const parsed = parseWeeklyPlanningSemanticDocumentV5(workloadNormalization.rawResponse);
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: null,
      errors: parsed.errors,
      algorithmicRepairs,
    };
  }

  const errors = [
    ...planningWindowCanonicalValueErrors(parsed.document.planningWindow),
    ...validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5({
      document: parsed.document,
      publicStateSummary: input.publicStateSummary,
    }),
    ...validateWeeklyPlanningRecurrenceConsistencyV5(parsed.document),
    ...validateWeeklyPlanningSemanticEvidenceV5({
      document: parsed.document,
      input,
    }),
  ];
  return {
    document: errors.length === 0 ? parsed.document : null,
    parsedDocument: parsed.document,
    errors,
    algorithmicRepairs,
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
        AI_OWNERSHIP_INSTRUCTION_V5,
        TEMPORAL_STRUCTURE_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV5(input) },
  ];
}

function repairDirectivesForErrors(errors: string[]): string[] {
  const directives: string[] = [];
  if (errors.some((error) => error.includes('canonical-relative-'))) {
    directives.push('Use one allowed canonical relative-day or relative-week value that matches the original utterance and conversation context.');
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
  if (errors.some((error) => error.includes('targetLocalId'))) {
    directives.push('targetLocalId must name a localId declared in the same returned JSON. Never copy a publicStateSummary publicId into targetLocalId. If a pending quantity-role answer selects target, remaining, or completed, remove the uncertainty and emit one minimal local task and workload; pendingQuestion binds the existing public target.');
  }
  if (errors.some((error) => error.includes('existing-task-binding-required') || error.includes('existing-component-binding-required') || error.includes('unknown-active-task') || error.includes('unknown-active-component') || error.includes('component-task-binding-mismatch'))) {
    directives.push('For each continued accepted task/component, set existingPublicId to the exact candidate publicId from publicStateSummary. Keep existingPublicId null only for genuinely new entities. Never duplicate an accepted entity just to add current-turn facts.');
  }
  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {
    directives.push('When a per-occurrence workload explicitly represents daily, weekdays, or weekends repetition, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');
  }
  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {
    directives.push('Treat the response as a current-userText delta, not a full-plan snapshot. Remove every fact copied from prior turns whose sourceText is not grounded in current userText. Set an unstated planningWindow to null even if publicStateSummary contains one; remove stale collection items instead of replacing their sourceText. Keep newly stated current-turn facts. Do not invent replacement sourceText.');
  }
  if (errors.some((error) => error.includes('unknown-key') || error.includes('missing-key'))) {
    directives.push('Return exactly the required Stable V5 schema keys with no unknown keys.');
  }
  if (directives.length === 0) {
    directives.push('Correct only the listed schema, type, range, reference, or structural validation failures while preserving the meaning you derived from the original context.');
  }
  return unique(directives);
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
        instruction: 'Return the complete corrected Stable V5 JSON document only. Complete means all required JSON Schema top-level keys are present; it does not mean restating the accepted plan. The document must remain a delta for current userText. Do not invent facts or application decisions.',
        requiredChanges: repairDirectivesForErrors(params.validationErrors),
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
