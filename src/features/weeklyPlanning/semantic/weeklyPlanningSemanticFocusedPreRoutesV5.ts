import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
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
  createFocusedContextualAnswerDocumentV5,
  createFocusedContextualAnswerMessagesV5,
  focusedContextualAnswerEligibleV5,
  focusedContextualTargetV5,
  parseFocusedContextualAnswerDecisionV5,
  type FocusedContextualAnswerDecisionV5,
} from './weeklyPlanningFocusedContextualAnswerV5';
import type {
  WeeklyPlanningSemanticNormalizerInputV5,
  WeeklyPlanningSemanticNormalizerResultV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  semanticNormalizerByteLength,
  semanticNormalizerErrorDetails,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';

const FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS = 2;
const DUAL_TARGET_CONTEXTUAL_REPAIR_INSTRUCTION = [
  'Re-evaluate only the current user text against the typed pending-question choices.',
  'If it gives effort, return decision=effort_answer and classify effortTarget independently: question_target for questionTargetWorkload or estimate_target for estimateForWorkload.',
  'Classify effortMeasurement independently as total_duration or duration_per_unit. A clear estimate_target answer is valid even when the pending question originally asked about question_target.',
  'If completion effort is explicitly unavailable and the user explicitly asks to proceed with provisional allocation, return decision=provisional_timebox.',
  'Use fallback only for ambiguity or independent planning meaning.',
].join(' ');

const FOCUSED_CONTEXTUAL_PROVISIONAL_INSTRUCTION = [
  'The typed pending question remains the only target of this focused route.',
  'For missing_effort_estimate only, decision=provisional_timebox is allowed when the user explicitly says the completion effort is unknown/unavailable or must not become an estimate, and explicitly asks to proceed by provisionally allocating existing available capacity.',
  'provisional_timebox is scheduler permission only. It is never a total-duration fact, per-unit estimate, quantity, completion claim, uncertainty fact, workload, or new task relation.',
  'If the same turn merely repeats a priority already represented by the existing typed relations, do not expand that wording into additional binary relation endpoints.',
  'If the turn introduces genuinely new independent planning meaning not represented by the typed context, use fallback so the generic semantic route can process it.',
].join(' ');

const FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_contextual_answer_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'decision',
        'effortTarget',
        'effortMeasurement',
        'minutes',
        'precision',
        'quantityRole',
      ],
      properties: {
        decision: {
          type: 'string',
          enum: [
            'effort_answer',
            'quantity_role_answer',
            'provisional_timebox',
            'fallback',
          ],
        },
        effortTarget: {
          anyOf: [
            { type: 'string', enum: ['question_target', 'estimate_target'] },
            { type: 'null' },
          ],
        },
        effortMeasurement: {
          anyOf: [
            { type: 'string', enum: ['total_duration', 'duration_per_unit'] },
            { type: 'null' },
          ],
        },
        minutes: {
          anyOf: [
            { type: 'number', exclusiveMinimum: 0 },
            { type: 'null' },
          ],
        },
        precision: {
          anyOf: [
            { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
            { type: 'null' },
          ],
        },
        quantityRole: {
          anyOf: [
            { type: 'string', enum: ['target', 'remaining', 'completed'] },
            { type: 'null' },
          ],
        },
      },
    },
  },
};

type ProvisionalContextualDecisionV5 = {
  decision: 'provisional_timebox';
  effortTarget: null;
  effortMeasurement: null;
  minutes: null;
  precision: null;
  quantityRole: null;
};

type ExtendedContextualDecisionV5 =
  | FocusedContextualAnswerDecisionV5
  | ProvisionalContextualDecisionV5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExtendedContextualDecisionV5(raw: string): ExtendedContextualDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value) && value.decision === 'provisional_timebox') {
      if (
        value.effortTarget !== null
        || value.effortMeasurement !== null
        || value.minutes !== null
        || value.precision !== null
        || value.quantityRole !== null
      ) return null;
      return {
        decision: 'provisional_timebox',
        effortTarget: null,
        effortMeasurement: null,
        minutes: null,
        precision: null,
        quantityRole: null,
      };
    }
  } catch {
    return null;
  }
  return parseFocusedContextualAnswerDecisionV5(raw);
}

function relationContext(input: WeeklyPlanningSemanticNormalizerInputV5): string {
  const relations = input.publicStateSummary?.relations;
  if (!Array.isArray(relations)) return '[]';
  return JSON.stringify(relations.slice(0, 16));
}

function createExtendedContextualMessagesV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
) {
  return [
    {
      role: 'system' as const,
      content: `${FOCUSED_CONTEXTUAL_PROVISIONAL_INSTRUCTION} Existing typed relations: ${relationContext(input)}`,
    },
    ...createFocusedContextualAnswerMessagesV5(input),
  ];
}

function createProvisionalTimeboxDocumentV5(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
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

export async function tryFocusedContextualAnswerRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!focusedContextualAnswerEligibleV5(run.input)) return null;

  const target = focusedContextualTargetV5(run.input);
  if (!target) return null;
  const retryDualTargetInterpretation = target.questionCode === 'missing_effort_estimate'
    && target.questionBasis === 'completed_workload_total'
    && target.estimateForWorkload !== null;
  const baseMessages = createExtendedContextualMessagesV5(run.input);
  let attemptMessages = baseMessages;
  const initialRequest = {
    messages: baseMessages,
    temperature: 0,
    responseFormat: FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'focused_contextual_answer_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'route_from_machine_pending_question',
        'bind_ai_semantic_value_to_exact_pending_target',
        'apply_explicit_provisional_scheduler_permission_without_creating_effort_fact',
      ],
      requestBytes: semanticNormalizerByteLength(initialRequest),
    },
  });

  const responseLengths: number[] = [];
  const requestBytes: number[] = [];
  for (let attempt = 1; attempt <= FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS; attempt += 1) {
    const request = {
      ...initialRequest,
      messages: attemptMessages,
    };
    const requestByteLength = semanticNormalizerByteLength(request);
    requestBytes.push(requestByteLength);
    const attemptName = attempt === 1
      ? 'focused_contextual_answer'
      : 'focused_contextual_answer_retry';
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: run.input.traceRequestId,
      stage: 'semantic_provider_request',
      data: {
        attempt: attemptName,
        requestBytes: requestByteLength,
        request,
      },
    });
    try {
      const response = await run.client.createChatCompletion(request);
      responseLengths.push(response.length);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: run.input.traceRequestId,
        stage: 'semantic_provider_response',
        data: {
          attempt: attemptName,
          responseLength: response.length,
          rawResponse: response,
        },
      });
      const decision = parseExtendedContextualDecisionV5(response);
      const provisional = decision?.decision === 'provisional_timebox';
      const document = provisional
        ? target.questionCode === 'missing_effort_estimate'
          ? createProvisionalTimeboxDocumentV5()
          : null
        : decision
          ? createFocusedContextualAnswerDocumentV5({ input: run.input, decision })
          : null;
      const retrying = !document
        && retryDualTargetInterpretation
        && attempt < FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: run.input.traceRequestId,
        stage: 'semantic_focused_contextual_answer_result',
        data: {
          attempt,
          decision: decision?.decision ?? 'invalid_response',
          effortTarget: decision?.effortTarget ?? null,
          effortMeasurement: decision?.effortMeasurement ?? null,
          responseLength: response.length,
          rawResponse: response,
          documentCreated: Boolean(document),
          provisionalTimebox: provisional,
          retrying,
        },
      });
      if (!document) {
        if (retrying) {
          attemptMessages = [
            ...baseMessages,
            { role: 'user' as const, content: DUAL_TARGET_CONTEXTUAL_REPAIR_INSTRUCTION },
          ];
          continue;
        }
        return null;
      }

      const result: WeeklyPlanningSemanticNormalizerResultV5 = {
        status: 'accepted',
        document,
        ...(provisional
          ? {
              contextualDirective: {
                kind: 'provisional_timebox' as const,
                scope: 'current_missing_effort' as const,
              },
            }
          : {}),
        diagnostics: run.diagnostics({
          attemptCount: attempt,
          repairAttempted: false,
          validationErrors: [],
          providerError: null,
          requestBytes,
          responseLengths,
        }),
      };
      run.recordDecision(result, {
        route: provisional ? 'focused_contextual_provisional_timebox' : 'focused_contextual_answer',
      });
      return result;
    } catch (error) {
      const retrying = attempt < FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: run.input.traceRequestId,
        stage: 'semantic_focused_contextual_answer_error',
        severity: 'warn',
        data: {
          attempt,
          error: semanticNormalizerErrorDetails(error),
          retrying,
          fallback: retrying ? 'retry_focused_contextual_answer' : 'generic_semantic',
        },
      });
      if (!retrying) return null;
    }
  }

  return null;
}

export interface FocusedAuthorizationRouteResultV5 {
  result: WeeklyPlanningSemanticNormalizerResultV5 | null;
  decision: FocusedAuthorizationDecisionV5['decision'] | null;
}

export async function tryFocusedAuthorizationRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
): Promise<FocusedAuthorizationRouteResultV5> {
  if (!focusedAuthorizationEligibleV5(run.input)) {
    return { result: null, decision: null };
  }

  const messages = createFocusedAuthorizationMessagesV5(run.input);
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
  };
  const requestBytes = semanticNormalizerByteLength(request);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'focused_conversation_intent_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: ['route_from_machine_state', 'combine_ai_semantic_outputs'],
      requestBytes,
    },
  });

  try {
    const response = await run.client.createChatCompletion(request);
    const focusedDecision = parseFocusedAuthorizationDecisionV5(response);
    const decision = focusedDecision?.decision ?? null;
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: run.input.traceRequestId,
      stage: 'semantic_focused_authorization_result',
      data: {
        decision: decision ?? 'invalid_response',
        responseLength: response.length,
        rawResponse: response,
      },
    });
    if (decision !== 'create_plan') return { result: null, decision };

    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'accepted',
      document: createFocusedAuthorizationDocumentV5(),
      diagnostics: run.diagnostics({
        attemptCount: 1,
        repairAttempted: false,
        validationErrors: [],
        providerError: null,
        requestBytes: [requestBytes],
        responseLengths: [response.length],
      }),
    };
    run.recordDecision(result, { route: 'focused_authorization' });
    return { result, decision };
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: run.input.traceRequestId,
      stage: 'semantic_focused_authorization_error',
      severity: 'warn',
      data: {
        error: semanticNormalizerErrorDetails(error),
        fallback: 'generic_semantic',
      },
    });
    return { result: null, decision: null };
  }
}
