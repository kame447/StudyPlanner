import type {
  ChatMessage,
  JsonSchemaResponseFormat,
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
  normalizeTaskDecompositionUncertaintiesV5,
} from './weeklyPlanningTaskDecompositionNormalizationV5';
import {
  readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5,
  validateWeeklyPlanningWorkBreakdownResponseContractV5,
} from './weeklyPlanningWorkBreakdownResponseContractV5';
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
  validateWeeklyPlanningStandaloneModifierTargetsV5,
} from './weeklyPlanningStandaloneModifierTargetV5';
import {
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;
const FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS = 80;
const FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
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
const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'You alone interpret user meaning and context; deterministic code only validates structure, safety, state consistency, scheduling, and persistence boundaries.',
  'Current SemanticDocument is a delta. publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText; when current userText does not state a planning window, planningWindow must be null. Every sourceText must be supported by current userText, not prior turns.',
  'Treat publicStateSummary.pendingQuestion as authoritative and never infer its target from assistant wording. For a pending clarification, resolve only that exact target with fresh localIds; never place public Fact IDs in targetLocalId. If unresolved, emit uncertainty. For work_breakdown return only that existingPublicId task with its current structure, not unrelated accepted state or the old uncertainty.',
  'Quantity roles: target means the amount intended for this plan; remaining means the full unfinished amount; completed means the amount already done. A stated full total is not itself remaining. When the same current-turn statement gives both a full total and a completed amount for the same work and unit, derive the unfinished difference as remaining and keep completed as completed; never label the full total as remaining. For quantity_role_unresolved, return only the minimal local task/workload answer. Never keep uncertainty for a resolved role.',
  'For semantic_uncertainty, answer only the unresolved semantic target; if ambiguity remains, keep uncertainty rather than guessing.',
  'An effortEstimate may target the exact task, component, or workload localId supported by the current answer.',
  'Use localIds for response-local references and exact existingPublicId only for accepted cross-turn entity identity. Creation authorization uses planningIntent create_plan without replaying accepted facts.',
  'Do not invent or emit application commands, scheduling/readiness/preview/save decisions, or prose.',
].join('\n');
const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive explicit dates use separate allowed_date constraints.',
  'For an explicit standard weekday used as a date constraint, encode dateExpression as exactly one of weekday:sunday, weekday:monday, weekday:tuesday, weekday:wednesday, weekday:thursday, weekday:friday, or weekday:saturday. Never encode a standard weekday as custom:<original phrase>.',
  'Any explicit recurring cadence in workload.periodExpression needs a matching recurrence; recurring explicit weekdays belong in one weekly recurrence with its stated days.',
  'Task relations use task localIds and require explicit scheduling relation meaning; workload amount/size comparisons alone are not priority/order/dependency.',
  'Clock fields require explicit user clocks. Use either namedTimePeriod or exact clock fields, not both.',
].join('\n');

interface SemanticValidationAttemptV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
  algorithmicRepairs: string[];
}

interface FocusedAuthorizationDecisionV5 {
  decision: 'create_plan' | 'fallback';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function focusedAuthorizationEligible(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): boolean {
  const summary = input.publicStateSummary;
  if (!isRecord(summary)) return false;
  if (summary.pendingQuestion !== null && summary.pendingQuestion !== undefined) return false;
  if (summary.previousCompatibilityStatus !== 'needs_scope') return false;
  return Array.isArray(summary.tasks) && summary.tasks.length > 0;
}

function parseFocusedAuthorizationDecision(
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

function focusedAuthorizationDocument(): WeeklyPlanningSemanticDocumentV5 {
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
    directives.push('Treat the response as a current-userText delta, not a full-plan snapshot. Remove every fact copied from prior turns whose sourceText is not grounded in current userText. Set an unstated planningWindow to null even if publicStateSummary contains one; remove stale collection items instead of replacing their sourceText. Keep newly stated current-turn facts. Preserve unrelated semantic fields that were already valid, including planningIntent, unless a listed validation error specifically invalidates them. Do not invent replacement sourceText.');
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
      let focusedConversationDecision: FocusedAuthorizationDecisionV5['decision'] | null = null;

      if (focusedAuthorizationEligible(input)) {
        const focusedMessages: ChatMessage[] = [
          { role: 'system', content: FOCUSED_AUTHORIZATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              currentUserText: input.userText,
              lastAssistantMessage: isRecord(input.publicStateSummary)
                && typeof input.publicStateSummary.lastAssistantMessage === 'string'
                ? input.publicStateSummary.lastAssistantMessage
                : null,
            }),
          },
        ];
        const focusedRequest = {
          messages: focusedMessages,
          temperature: 0,
          responseFormat: FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer' as const,
          maxCompletionTokens: FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
        };
        const focusedBytes = byteLength(focusedRequest);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_orchestrator_route',
          data: {
            route: 'focused_conversation_intent_candidate',
            meaningOwner: 'ai',
            deterministicResponsibilities: ['route_from_machine_state', 'combine_ai_semantic_outputs'],
            requestBytes: focusedBytes,
          },
        });
        try {
          const focusedResponse = await client.createChatCompletion(focusedRequest);
          const focusedDecision = parseFocusedAuthorizationDecision(focusedResponse);
          focusedConversationDecision = focusedDecision?.decision ?? null;
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_focused_authorization_result',
            data: {
              decision: focusedConversationDecision ?? 'invalid_response',
              responseLength: focusedResponse.length,
              rawResponse: focusedResponse,
            },
          });
          if (focusedConversationDecision === 'create_plan') {
            const result: WeeklyPlanningSemanticNormalizerResultV5 = {
              status: 'accepted',
              document: focusedAuthorizationDocument(),
              diagnostics: {
                schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
                jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.name,
                normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
                attemptCount: 1,
                repairAttempted: false,
                requestBytes: [focusedBytes],
                responseLengths: [focusedResponse.length],
                latencyMs: Math.round(performance.now() - startedAt),
                validationErrors: [],
                algorithmicRepairs: [],
                providerError: null,
              },
            };
            recordWeeklyPlanningStableV5DebugTrace({
              requestId: input.traceRequestId,
              stage: 'semantic_normalizer_decision',
              data: {
                ...result,
                orchestrationRoute: 'focused_authorization',
              },
            });
            return result;
          }
        } catch (error) {
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_focused_authorization_error',
            severity: 'warn',
            data: {
              error: errorDetails(error),
              fallback: 'generic_semantic',
            },
          });
        }
      }

      const baseMessages = createWeeklyPlanningSemanticBaseMessagesV5(input);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_normalizer_prepared',
        data: {
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          input,
          orchestrationContext: {
            focusedConversationDecision,
          },
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
          data: {
            ...result,
            orchestrationRoute: 'generic_semantic',
          },
        });
        return result;
      }

      const repairMessages = createRepairMessages({
        baseMessages,
        invalidResponse: initialResponse,
        validationErrors: initialValidation.errors,
        input,
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
        data: {
          ...result,
          orchestrationRoute: 'generic_semantic_repair',
        },
      });
      return result;
    },
  };
}
