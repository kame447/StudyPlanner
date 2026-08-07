import type { ChatMessage } from '../../../lib/ai/client';
import type { OpenAiCompatibleClient } from '../../../lib/ai/client';
import { recordWeeklyPlanningStableV5DebugTrace } from '../debug/weeklyPlanningStableV5DebugTrace';
import {
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';
import {
  type WeeklyPlanningSemanticNormalizerDiagnosticsV5,
  type WeeklyPlanningSemanticNormalizerInputV5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerTypesV5';
import {
  normalizeContainingTaskComponentParentV5,
} from './weeklyPlanningSemanticComponentParentV5';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningSemanticCopiedContextV5';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningSemanticDuplicateWorkloadV5';
import {
  normalizeTaskDecompositionUncertaintiesV5,
} from './weeklyPlanningSemanticTaskDecompositionV5';
import {
  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,
} from './weeklyPlanningExistingEntityBindingV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
import {
  validateWeeklyPlanningWorkBreakdownResponseContractV5,
  readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5,
} from './weeklyPlanningWorkBreakdownResponseV5';
import {
  validateWeeklyPlanningSemanticEvidenceV5,
} from './weeklyPlanningSemanticEvidenceV5';
import {
  validateWeeklyPlanningStandaloneModifierTargetsV5,
} from './weeklyPlanningStandaloneModifierTargetV5';
import {
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'AI alone interprets meaning; publicStateSummary.pendingQuestion is authoritative.',
  'Return a minimal delta grounded in current userText; accepted state/recentConversation are context only, and every sourceText must come from current userText.',
  'For a pending clarification, resolve only its exact target; if unresolved, emit uncertainty. For work_breakdown return only that existingPublicId task with its current structure, not unrelated accepted state or the old uncertainty.',
  'Quantity roles: target=planned amount, remaining=unfinished amount, completed=done amount. A resolved quantity-role answer returns only the needed local task/workload delta.',
  'Use localIds for references inside the response and exact existingPublicId only for accepted cross-turn task/component identity.',
  'Creation authorization uses planningIntent create_plan without replaying accepted facts.',
  'Do not invent or emit application commands, scheduling/readiness/preview/save decisions, or prose.',
].join('\n');
const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive explicit dates use separate allowed_date constraints.',
  'Any explicit recurring cadence in workload.periodExpression needs a matching recurrence; explicit weekdays belong in one weekly recurrence with its stated days.',
  'Task relations use task localIds and require explicit scheduling relation meaning; workload amount/size comparisons alone are not priority/order/dependency.',
  'Clock fields require explicit user clocks. Use either namedTimePeriod or exact clock fields, not both.',
].join('\n');

interface SemanticValidationAttemptV5 {
  document: ReturnType<typeof parseWeeklyPlanningSemanticDocumentV5>['document'];
  parsedDocument: ReturnType<typeof parseWeeklyPlanningSemanticDocumentV5>['document'];
  errors: string[];
  algorithmicRepairs: string[];
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
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
  const decompositionNormalization = normalizeTaskDecompositionUncertaintiesV5(rawResponse);
  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({
    rawResponse: decompositionNormalization.rawResponse,
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
    ...decompositionNormalization.repairs,
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
    ...validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: parsed.document,
      userText: input.userText,
      publicStateSummary: input.publicStateSummary,
    }),
    ...validateWeeklyPlanningSemanticEvidenceV5({
      document: parsed.document,
      input,
    }),
    ...validateWeeklyPlanningStandaloneModifierTargetsV5({
      document: parsed.document,
      userText: input.userText,
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

function repairDirectivesForErrors(
  errors: string[],
  input: WeeklyPlanningSemanticNormalizerInputV5,
): string[] {
  const directives: string[] = [];
  const pendingWorkBreakdownTarget =
    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(input.publicStateSummary);
  if (pendingWorkBreakdownTarget) {
    directives.push(`This turn answers the pending work_breakdown uncertainty for exact target ${pendingWorkBreakdownTarget}. Return exactly one task, bind it with existingPublicId to that target, and use current-userText evidence on that task. Put newly identified study constituents on that target task and mark it decomposed. Do not emit extra top-level tasks, prior planning state, old uncertainty, user context, or task relations in this focused resolution delta.`);
  }
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
    directives.push('When a per-occurrence workload explicitly represents a recurring cadence, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');
  }
  if (errors.some((error) => error.includes('work-breakdown-'))) {
    directives.push('This turn answers the pending work_breakdown uncertainty. Return only the exact target task identified by the pending uncertainty targetPublicId, using that ID as existingPublicId. Represent only the current user answer on that task. Do not copy the accepted planning window, unrelated accepted tasks, stored user context, or the old uncertainty. If constituents are identified, use decompositionStatus decomposed and encode them on the target task; if the user clarifies one schedulable unit, use atomic; use needs_breakdown only when the current answer itself remains insufficient.');
  }
  if (errors.some((error) => error.includes('document.relations') && (error.includes('fromLocalId') || error.includes('toLocalId')))) {
    directives.push('Task relations may reference task localIds only. Do not convert a comparison of workload size or amount into priority/order/dependency unless the user explicitly stated that scheduling relation.');
  }
  if (errors.some((error) => error.includes('ambiguous-standalone-modifier-target'))) {
    directives.push('A standalone modifier after multiple listed candidate tasks/components has no unique target. Preserve every otherwise-valid current-turn fact from the invalid response, including its planningWindow and listed tasks/components, but remove the guessed modifier attachment only. Emit exactly one uncertainty for that modifier with targetLocalId exactly "document", field exactly "modifier_target", and the modifier excerpt as sourceText. Never use null or the string "null" for targetLocalId, and do not choose a candidate by order or proximity.');
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
  input: WeeklyPlanningSemanticNormalizerInputV5;
}): ChatMessage[] {
  const repairInstruction: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      instruction: 'Return the complete corrected Stable V5 JSON document only. Complete means all required JSON Schema top-level keys are present; it does not mean restating the accepted plan. The document must remain a delta for current userText. Do not invent facts or application decisions.',
      requiredChanges: repairDirectivesForErrors(params.validationErrors, params.input),
      validationErrors: params.validationErrors,
    }),
  };
  const freshContextualRepair = Boolean(
    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(params.input.publicStateSummary),
  );
  if (freshContextualRepair) {
    return [...params.baseMessages, repairInstruction];
  }
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
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

      try {
        const initialResponse = await call(baseMessages, 'initial');
        const initial = validateSemanticResponse(initialResponse, input);
        algorithmicRepairs.push(...initial.algorithmicRepairs);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_validation_result',
          data: {
            attempt: 'initial',
            accepted: initial.document !== null,
            errors: initial.errors,
            parsedDocument: initial.parsedDocument,
          },
        });
        if (initial.document) {
          return {
            status: 'accepted',
            document: initial.document,
            diagnostics: diagnostics({
              attemptCount: 1,
              repairAttempted: false,
              validationErrors: [],
              providerError: null,
            }),
          };
        }

        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_repair_prepared',
          severity: 'warn',
          data: {
            invalidResponse: initialResponse,
            validationErrors: initial.errors,
          },
        });
        const repairResponse = await call(
          createRepairMessages({
            baseMessages,
            invalidResponse: initialResponse,
            validationErrors: initial.errors,
            input,
          }),
          'repair',
        );
        const repaired = validateSemanticResponse(repairResponse, input);
        algorithmicRepairs.push(...repaired.algorithmicRepairs);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_validation_result',
          severity: repaired.document ? 'debug' : 'error',
          data: {
            attempt: 'repair',
            accepted: repaired.document !== null,
            errors: repaired.errors,
            parsedDocument: repaired.parsedDocument,
          },
        });
        if (repaired.document) {
          return {
            status: 'accepted',
            document: repaired.document,
            diagnostics: diagnostics({
              attemptCount: 2,
              repairAttempted: true,
              validationErrors: initial.errors.map((error) => `initial:${error}`),
              providerError: null,
            }),
          };
        }

        return {
          status: 'rejected',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: [
              ...initial.errors.map((error) => `initial:${error}`),
              ...repaired.errors.map((error) => `repair:${error}`),
            ],
            providerError: null,
          }),
        };
      } catch (error) {
        return {
          status: 'rejected',
          document: null,
          diagnostics: diagnostics({
            attemptCount: requestBytes.length,
            repairAttempted: requestBytes.length > 1,
            validationErrors: [],
            providerError: JSON.stringify(errorDetails(error)),
          }),
        };
      }
    },
  };
}
