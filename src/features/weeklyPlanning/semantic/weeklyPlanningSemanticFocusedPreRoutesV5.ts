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
  FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
  createFocusedContextualAnswerDocumentV5,
  createFocusedContextualAnswerMessagesV5,
  focusedContextualAnswerEligibleV5,
  focusedContextualTargetV5,
  parseFocusedContextualAnswerDecisionV5,
} from './weeklyPlanningFocusedContextualAnswerV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  semanticNormalizerByteLength,
  semanticNormalizerErrorDetails,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';

const FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS = 2;

export async function tryFocusedContextualAnswerRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!focusedContextualAnswerEligibleV5(run.input)) return null;

  const target = focusedContextualTargetV5(run.input);
  if (!target) return null;
  const retryDualTargetInterpretation = target.questionCode === 'missing_effort_estimate'
    && target.questionBasis === 'completed_workload_total'
    && target.estimateForWorkload !== null;
  const messages = createFocusedContextualAnswerMessagesV5(run.input);
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
  };
  const requestBytes = semanticNormalizerByteLength(request);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'focused_contextual_answer_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'route_from_machine_pending_question',
        'bind_ai_semantic_value_to_exact_pending_target',
      ],
      requestBytes,
    },
  });

  const responseLengths: number[] = [];
  for (let attempt = 1; attempt <= FOCUSED_CONTEXTUAL_ANSWER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await run.client.createChatCompletion(request);
      responseLengths.push(response.length);
      const decision = parseFocusedContextualAnswerDecisionV5(response);
      const document = decision
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
          responseLength: response.length,
          rawResponse: response,
          documentCreated: Boolean(document),
          retrying,
        },
      });
      if (!document) {
        if (retrying) continue;
        return null;
      }

      const result: WeeklyPlanningSemanticNormalizerResultV5 = {
        status: 'accepted',
        document,
        diagnostics: run.diagnostics({
          attemptCount: attempt,
          repairAttempted: false,
          validationErrors: [],
          providerError: null,
          requestBytes: Array.from({ length: attempt }, () => requestBytes),
          responseLengths,
        }),
      };
      run.recordDecision(result, { route: 'focused_contextual_answer' });
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
