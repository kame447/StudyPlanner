import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
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
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  focusedRepairCalendarContextV5,
  semanticNormalizerByteLength,
  semanticNormalizerErrorMessage,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

type SemanticValidationResultV5 = ReturnType<typeof validateWeeklyPlanningSemanticResponseV5>;

function rejectedResult(
  run: WeeklyPlanningSemanticNormalizerRunV5,
  validationErrors: string[],
): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'rejected',
    document: null,
    diagnostics: run.diagnostics({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors,
      providerError: null,
    }),
  };
  run.recordDecision(result, { severity: 'error' });
  return result;
}

function providerFailureResult(
  run: WeeklyPlanningSemanticNormalizerRunV5,
  initialErrors: string[],
  error: unknown,
): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'provider_failure',
    document: null,
    diagnostics: run.diagnostics({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: initialErrors,
      providerError: semanticNormalizerErrorMessage(error),
    }),
  };
  run.recordDecision(result, { severity: 'error' });
  return result;
}

async function tryFocusedPlanningWindowRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const parsedDocument = params.initialValidation.parsedDocument;
  if (!parsedDocument) return null;

  const repairInput = {
    userText: params.run.input.userText,
    invalidDocument: parsedDocument,
    validationErrors: params.initialValidation.errors,
    calendarContext: focusedRepairCalendarContextV5(params.run.input),
  };
  if (!focusedPlanningWindowRepairEligibleV5(repairInput)) return null;

  const messages = createFocusedPlanningWindowRepairMessagesV5(repairInput);
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
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
      initialValidationErrors: params.initialValidation.errors,
      requestBytes: semanticNormalizerByteLength(request),
    },
  });

  let response: string;
  try {
    response = await params.run.callTracked(request, 'focused_planning_window_repair');
  } catch (error) {
    return providerFailureResult(params.run, params.initialValidation.errors, error);
  }

  const decision = parseFocusedPlanningWindowRepairDecisionV5(response);
  if (!decision) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      'repair:focused-planning-window:invalid-response',
    ]);
  }

  const mergedDocument = applyFocusedPlanningWindowRepairV5({
    document: parsedDocument,
    decision,
  });
  const validation = validateWeeklyPlanningSemanticResponseV5(
    JSON.stringify(mergedDocument),
    params.run.input,
  );
  params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: validation.document ? 'info' : 'error',
    data: {
      attempt: 'focused_planning_window_repair',
      accepted: Boolean(validation.document),
      errors: validation.errors,
      algorithmicRepairs: validation.algorithmicRepairs,
      parsedDocument: validation.parsedDocument,
    },
  });

  if (!validation.document) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      ...validation.errors.map((value) => `repair:${value}`),
    ]);
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: validation.document,
    diagnostics: params.run.diagnostics({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: params.initialValidation.errors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'focused_planning_window_repair' });
  return result;
}

async function tryFocusedTemporalScopeRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const candidate = readFocusedTemporalScopeRepairCandidateV5({
    rawResponse: params.initialResponse,
    validationErrors: params.initialValidation.errors,
  });
  if (!candidate) return null;

  const messages = createFocusedTemporalScopeRepairMessagesV5(candidate);
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
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
      initialValidationErrors: params.initialValidation.errors,
      requestBytes: semanticNormalizerByteLength(request),
    },
  });

  let response: string;
  try {
    response = await params.run.callTracked(request, 'focused_temporal_scope_repair');
  } catch (error) {
    return providerFailureResult(params.run, params.initialValidation.errors, error);
  }

  const decision = parseFocusedTemporalScopeRepairDecisionV5(response);
  const patchedResponse = decision
    ? applyFocusedTemporalScopeRepairV5({
        rawResponse: params.initialResponse,
        candidate,
        decision,
      })
    : null;
  if (!decision || !patchedResponse) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      'repair:focused-temporal-scope:invalid-response',
    ]);
  }

  const validation = validateWeeklyPlanningSemanticResponseV5(
    patchedResponse,
    params.run.input,
  );
  params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: validation.document ? 'info' : 'error',
    data: {
      attempt: 'focused_temporal_scope_repair',
      accepted: Boolean(validation.document),
      decision: decision.decision,
      errors: validation.errors,
      algorithmicRepairs: validation.algorithmicRepairs,
      parsedDocument: validation.parsedDocument,
    },
  });

  if (!validation.document) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      ...validation.errors.map((value) => `repair:${value}`),
    ]);
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: validation.document,
    diagnostics: params.run.diagnostics({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: params.initialValidation.errors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'focused_temporal_scope_repair',
    extra: { focusedTemporalScopeDecision: decision.decision },
  });
  return result;
}

export async function tryFocusedSemanticRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const planningWindowResult = await tryFocusedPlanningWindowRepairRouteV5({
    run: params.run,
    initialValidation: params.initialValidation,
  });
  if (planningWindowResult) return planningWindowResult;

  return tryFocusedTemporalScopeRepairRouteV5(params);
}
