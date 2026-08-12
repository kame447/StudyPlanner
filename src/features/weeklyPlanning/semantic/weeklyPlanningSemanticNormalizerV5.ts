import type {
  ChatMessage,
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticProviderResponseFormatV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';
import {
  FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
  FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
  createFocusedAuthorizationDocumentV5,
  createFocusedAuthorizationMessagesV5,
  focusedAuthorizationEligibleV5,
  parseFocusedAuthorizationDecisionV5,
  type FocusedAuthorizationDecisionV5,
} from './weeklyPlanningFocusedAuthorizationV5';
import {
  FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
  FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
  createFocusedContextualAnswerDocumentV5,
  createFocusedContextualAnswerMessagesV5,
  focusedContextualAnswerEligibleV5,
  parseFocusedContextualAnswerDecisionV5,
} from './weeklyPlanningFocusedContextualAnswerV5';
import {
  FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
  applyFocusedPlanningWindowRepairV5,
  createFocusedPlanningWindowRepairMessagesV5,
  focusedPlanningWindowRepairEligibleV5,
  parseFocusedPlanningWindowRepairDecisionV5,
} from './weeklyPlanningFocusedPlanningWindowRepairV5';
import {
  FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
  applyFocusedTemporalScopeRepairV5,
  createFocusedTemporalScopeRepairMessagesV5,
  parseFocusedTemporalScopeRepairDecisionV5,
  readFocusedTemporalScopeRepairCandidateV5,
} from './weeklyPlanningFocusedTemporalScopeRepairV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';
import {
  validateWeeklyPlanningSemanticRepairPreservationV5,
} from './weeklyPlanningSemanticRepairPreservationV5';
export {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

const SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS = 3200;

export interface WeeklyPlanningSemanticNormalizerInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  traceRequestId?: string;
}

export interface WeeklyPlanningSemanticNormalizerDiagnosticsV5 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5;
  jsonSchemaName: string;
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

function focusedRepairCalendarContext(
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

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const startedAt = performance.now();
      const requestBytes: number[] = [];
      const responseLengths: number[] = [];
      const algorithmicRepairs: string[] = [];

      if (focusedContextualAnswerEligibleV5(input)) {
        const focusedMessages = createFocusedContextualAnswerMessagesV5(input);
        const focusedRequest = {
          messages: focusedMessages,
          temperature: 0,
          responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer' as const,
          maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
        };
        const focusedBytes = byteLength(focusedRequest);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_orchestrator_route',
          data: {
            route: 'focused_contextual_answer_candidate',
            meaningOwner: 'ai',
            deterministicResponsibilities: [
              'route_from_machine_pending_question',
              'bind_ai_semantic_value_to_exact_pending_target',
            ],
            requestBytes: focusedBytes,
          },
        });
        try {
          const focusedResponse = await client.createChatCompletion(focusedRequest);
          const focusedDecision = parseFocusedContextualAnswerDecisionV5(focusedResponse);
          const focusedDocument = focusedDecision
            ? createFocusedContextualAnswerDocumentV5({ input, decision: focusedDecision })
            : null;
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_focused_contextual_answer_result',
            data: {
              decision: focusedDecision?.decision ?? 'invalid_response',
              responseLength: focusedResponse.length,
              rawResponse: focusedResponse,
              documentCreated: Boolean(focusedDocument),
            },
          });
          if (focusedDocument) {
            const result: WeeklyPlanningSemanticNormalizerResultV5 = {
              status: 'accepted',
              document: focusedDocument,
              diagnostics: {
                schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
                jsonSchemaName:
                  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.name,
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
                orchestrationRoute: 'focused_contextual_answer',
              },
            });
            return result;
          }
        } catch (error) {
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_focused_contextual_answer_error',
            severity: 'warn',
            data: {
              error: errorDetails(error),
              fallback: 'generic_semantic',
            },
          });
        }
      }

      let focusedConversationDecision: FocusedAuthorizationDecisionV5['decision'] | null = null;

      if (focusedAuthorizationEligibleV5(input)) {
        const focusedMessages = createFocusedAuthorizationMessagesV5(input);
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
          const focusedDecision = parseFocusedAuthorizationDecisionV5(focusedResponse);
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
              document: createFocusedAuthorizationDocumentV5(),
              diagnostics: {
                schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
                jsonSchemaName:
                  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.name,
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
            responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
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
          responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
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
        jsonSchemaName: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.name,
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

      const initialValidation = validateWeeklyPlanningSemanticResponseV5(initialResponse, input);
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

      if (initialValidation.parsedDocument) {
        const focusedRepairInput = {
          userText: input.userText,
          invalidDocument: initialValidation.parsedDocument,
          validationErrors: initialValidation.errors,
          calendarContext: focusedRepairCalendarContext(input),
        };
        if (focusedPlanningWindowRepairEligibleV5(focusedRepairInput)) {
          const focusedMessages = createFocusedPlanningWindowRepairMessagesV5(
            focusedRepairInput,
          );
          const focusedRequest = {
            messages: focusedMessages,
            temperature: 0,
            responseFormat: FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
            purpose: 'weekly_planning_semantic_normalizer' as const,
            maxCompletionTokens: FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
          };
          const focusedBytes = byteLength(focusedRequest);
          requestBytes.push(focusedBytes);
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_orchestrator_route',
            severity: 'warn',
            data: {
              route: 'focused_planning_window_repair_candidate',
              meaningOwner: 'ai',
              deterministicResponsibilities: [
                'route_from_validation_scope',
                'merge_only_planning_window_representation_fields',
                'revalidate_complete_document',
              ],
              initialValidationErrors: initialValidation.errors,
              requestBytes: focusedBytes,
            },
          });

          let focusedResponse: string;
          try {
            recordWeeklyPlanningStableV5DebugTrace({
              requestId: input.traceRequestId,
              stage: 'semantic_provider_request',
              data: {
                attempt: 'focused_planning_window_repair',
                requestBytes: focusedBytes,
                request: focusedRequest,
              },
            });
            focusedResponse = await client.createChatCompletion(focusedRequest);
            responseLengths.push(focusedResponse.length);
            recordWeeklyPlanningStableV5DebugTrace({
              requestId: input.traceRequestId,
              stage: 'semantic_provider_response',
              data: {
                attempt: 'focused_planning_window_repair',
                responseLength: focusedResponse.length,
                rawResponse: focusedResponse,
              },
            });
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

          const focusedDecision = parseFocusedPlanningWindowRepairDecisionV5(
            focusedResponse,
          );
          if (!focusedDecision) {
            const result: WeeklyPlanningSemanticNormalizerResultV5 = {
              status: 'rejected',
              document: null,
              diagnostics: diagnostics({
                attemptCount: 2,
                repairAttempted: true,
                validationErrors: [
                  ...initialValidation.errors.map((value) => `initial:${value}`),
                  'repair:focused-planning-window:invalid-response',
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

          const focusedMergedDocument = applyFocusedPlanningWindowRepairV5({
            document: initialValidation.parsedDocument,
            decision: focusedDecision,
          });
          const focusedValidation = validateWeeklyPlanningSemanticResponseV5(
            JSON.stringify(focusedMergedDocument),
            input,
          );
          algorithmicRepairs.push(...focusedValidation.algorithmicRepairs);
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_validation_result',
            severity: focusedValidation.document ? 'info' : 'error',
            data: {
              attempt: 'focused_planning_window_repair',
              accepted: Boolean(focusedValidation.document),
              errors: focusedValidation.errors,
              algorithmicRepairs: focusedValidation.algorithmicRepairs,
              parsedDocument: focusedValidation.parsedDocument,
            },
          });

          if (!focusedValidation.document) {
            const result: WeeklyPlanningSemanticNormalizerResultV5 = {
              status: 'rejected',
              document: null,
              diagnostics: diagnostics({
                attemptCount: 2,
                repairAttempted: true,
                validationErrors: [
                  ...initialValidation.errors.map((value) => `initial:${value}`),
                  ...focusedValidation.errors.map((value) => `repair:${value}`),
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
            document: focusedValidation.document,
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
              orchestrationRoute: 'focused_planning_window_repair',
            },
          });
          return result;
        }
      }

      const temporalScopeCandidate = readFocusedTemporalScopeRepairCandidateV5({
        rawResponse: initialResponse,
        validationErrors: initialValidation.errors,
      });
      if (temporalScopeCandidate) {
        const focusedMessages = createFocusedTemporalScopeRepairMessagesV5(
          temporalScopeCandidate,
        );
        const focusedRequest = {
          messages: focusedMessages,
          temperature: 0,
          responseFormat: FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
          purpose: 'weekly_planning_semantic_normalizer' as const,
          maxCompletionTokens: FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
        };
        const focusedBytes = byteLength(focusedRequest);
        requestBytes.push(focusedBytes);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_orchestrator_route',
          severity: 'warn',
          data: {
            route: 'focused_temporal_scope_repair_candidate',
            meaningOwner: 'ai',
            deterministicResponsibilities: [
              'route_from_exact_validation_path',
              'preserve_interpreted_date_and_clock',
              'move_only_the_invalid_temporal_fact_or_emit_uncertainty',
              'revalidate_complete_document',
            ],
            initialValidationErrors: initialValidation.errors,
            requestBytes: focusedBytes,
          },
        });

        let focusedResponse: string;
        try {
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_provider_request',
            data: {
              attempt: 'focused_temporal_scope_repair',
              requestBytes: focusedBytes,
              request: focusedRequest,
            },
          });
          focusedResponse = await client.createChatCompletion(focusedRequest);
          responseLengths.push(focusedResponse.length);
          recordWeeklyPlanningStableV5DebugTrace({
            requestId: input.traceRequestId,
            stage: 'semantic_provider_response',
            data: {
              attempt: 'focused_temporal_scope_repair',
              responseLength: focusedResponse.length,
              rawResponse: focusedResponse,
            },
          });
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

        const focusedDecision = parseFocusedTemporalScopeRepairDecisionV5(
          focusedResponse,
        );
        const focusedPatchedResponse = focusedDecision
          ? applyFocusedTemporalScopeRepairV5({
              rawResponse: initialResponse,
              candidate: temporalScopeCandidate,
              decision: focusedDecision,
            })
          : null;
        if (!focusedDecision || !focusedPatchedResponse) {
          const result: WeeklyPlanningSemanticNormalizerResultV5 = {
            status: 'rejected',
            document: null,
            diagnostics: diagnostics({
              attemptCount: 2,
              repairAttempted: true,
              validationErrors: [
                ...initialValidation.errors.map((value) => `initial:${value}`),
                'repair:focused-temporal-scope:invalid-response',
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

        const focusedValidation = validateWeeklyPlanningSemanticResponseV5(
          focusedPatchedResponse,
          input,
        );
        algorithmicRepairs.push(...focusedValidation.algorithmicRepairs);
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.traceRequestId,
          stage: 'semantic_validation_result',
          severity: focusedValidation.document ? 'info' : 'error',
          data: {
            attempt: 'focused_temporal_scope_repair',
            accepted: Boolean(focusedValidation.document),
            decision: focusedDecision.decision,
            errors: focusedValidation.errors,
            algorithmicRepairs: focusedValidation.algorithmicRepairs,
            parsedDocument: focusedValidation.parsedDocument,
          },
        });

        if (!focusedValidation.document) {
          const result: WeeklyPlanningSemanticNormalizerResultV5 = {
            status: 'rejected',
            document: null,
            diagnostics: diagnostics({
              attemptCount: 2,
              repairAttempted: true,
              validationErrors: [
                ...initialValidation.errors.map((value) => `initial:${value}`),
                ...focusedValidation.errors.map((value) => `repair:${value}`),
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
          document: focusedValidation.document,
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
            orchestrationRoute: 'focused_temporal_scope_repair',
            focusedTemporalScopeDecision: focusedDecision.decision,
          },
        });
        return result;
      }

      const repairMessages = createWeeklyPlanningSemanticRepairMessagesV5({
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

      const repairedValidation = validateWeeklyPlanningSemanticResponseV5(repairedResponse, input);
      algorithmicRepairs.push(...repairedValidation.algorithmicRepairs);
      const repairPreservationErrors =
        validateWeeklyPlanningSemanticRepairPreservationV5({
          initialDocument: initialValidation.parsedDocument,
          repairedDocument: repairedValidation.document,
          initialErrors: initialValidation.errors,
        });
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_validation_result',
        severity: repairedValidation.document && repairPreservationErrors.length === 0
          ? 'info'
          : 'error',
        data: {
          attempt: 'repair',
          accepted: Boolean(repairedValidation.document) && repairPreservationErrors.length === 0,
          errors: [
            ...repairedValidation.errors,
            ...repairPreservationErrors,
          ],
          algorithmicRepairs: repairedValidation.algorithmicRepairs,
          parsedDocument: repairedValidation.parsedDocument,
        },
      });
      if (!repairedValidation.document || repairPreservationErrors.length > 0) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'rejected',
          document: null,
          diagnostics: diagnostics({
            attemptCount: 2,
            repairAttempted: true,
            validationErrors: [
              ...initialValidation.errors.map((value) => `initial:${value}`),
              ...repairedValidation.errors.map((value) => `repair:${value}`),
              ...repairPreservationErrors.map((value) => `repair:${value}`),
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
