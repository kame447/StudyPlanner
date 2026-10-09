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
  createFocusedTemporalScopeRepairDecisionContextV5,
  createFocusedTemporalScopeRepairMessagesV5,
  parseFocusedTemporalScopeRepairDecisionV5,
  readFocusedTemporalScopeRepairCandidateV5,
} from './weeklyPlanningFocusedTemporalScopeRepairV5';
import {
  FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_USER_CONTEXT_DATE_REPAIR_RESPONSE_FORMAT_V5,
  applyFocusedUserContextDateRepairV5,
  createFocusedUserContextDateRepairMessagesV5,
  parseFocusedUserContextDateRepairDecisionV5,
  readFocusedUserContextDateRepairCandidateV5,
} from './weeklyPlanningFocusedUserContextDateRepairV5';
import {
  FOCUSED_REPLACEMENT_FACT_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_REPLACEMENT_FACT_REPAIR_RESPONSE_FORMAT_V5,
  applyFocusedReplacementFactRepairV5,
  createFocusedReplacementFactRepairMessagesV5,
  markFocusedReplacementRecoveredV5,
  parseFocusedReplacementFactRepairDecisionV5,
  readFocusedReplacementFactRepairCandidatesV5,
} from './weeklyPlanningFocusedReplacementFactRepairV5';
import { measureInteractionEvidenceCoverageEligibilityV5, tryWeeklyPlanningDenseTurnCompletenessRetryV5 } from './weeklyPlanningSemanticDenseTurnCompletenessV5';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  focusedRepairCalendarContextV5,
  semanticNormalizerByteLength,
  semanticNormalizerErrorMessage,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { markWeeklyPlanningSemanticRepairConsumedV5, weeklyPlanningSemanticRepairConsumedV5 } from './weeklyPlanningSemanticRepairLedgerV5';

type SemanticValidationResultV5 = ReturnType<typeof validateWeeklyPlanningSemanticResponseV5>;

function validationState(run: WeeklyPlanningSemanticNormalizerRunV5) {
  return {
    currentUserText: run.input.userText,
    supplementalContext: run.input.supplementalContext,
    selectedStarterTarget: run.input.selectedStarterTarget,
    recentConversation: run.input.recentConversation,
    publicStateSummary: run.input.publicStateSummary,
    committedGraph: run.input.committedGraph,
    conversationArchitecture: run.input.conversationArchitecture,
  };
}

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

async function tryFocusedUserContextDateRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const candidate = readFocusedUserContextDateRepairCandidateV5({
    document: params.initialValidation.parsedDocument,
    validationErrors: params.initialValidation.errors,
  });
  if (!candidate || !params.initialValidation.parsedDocument) return null;

  const messages = createFocusedUserContextDateRepairMessagesV5({
    candidate,
    calendarContext: focusedRepairCalendarContextV5(params.run.input),
  });
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_USER_CONTEXT_DATE_REPAIR_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    severity: 'warn',
    data: {
      route: 'focused_user_context_date_repair_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'route_from_exact_validation_path',
        'merge_only_user_context_date_expression',
        'preserve_all_other_semantic_fields',
        'revalidate_complete_document',
      ],
      initialValidationErrors: params.initialValidation.errors,
      requestBytes: semanticNormalizerByteLength(request),
    },
  });

  let response: string;
  try {
    markWeeklyPlanningSemanticRepairConsumedV5(params.run);
    response = await params.run.callTracked(request, 'focused_user_context_date_repair');
  } catch (error) {
    return providerFailureResult(params.run, params.initialValidation.errors, error);
  }

  const decision = parseFocusedUserContextDateRepairDecisionV5(response);
  const mergedDocument = decision
    ? applyFocusedUserContextDateRepairV5({
        document: params.initialValidation.parsedDocument,
        candidate,
        decision,
      })
    : null;
  if (!decision || !mergedDocument) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      'repair:focused-user-context-date:invalid-response',
    ]);
  }

  const validation = validateWeeklyPlanningSemanticResponseV5(
    JSON.stringify(mergedDocument),
    validationState(params.run),
  );
  params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: validation.document ? 'info' : 'error',
    data: {
      attempt: 'focused_user_context_date_repair',
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
  params.run.recordDecision(result, { route: 'focused_user_context_date_repair' });
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
    markWeeklyPlanningSemanticRepairConsumedV5(params.run);
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
    validationState(params.run),
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
  const graphRevision = params.run.input.publicStateSummary?.graphRevision;
  const decisionContext = createFocusedTemporalScopeRepairDecisionContextV5({
    candidate,
    requestId: params.run.input.traceRequestId,
    inputRevision: Number.isSafeInteger(graphRevision) && Number(graphRevision) >= 0
      ? Number(graphRevision)
      : 0,
  });
  const request = {
    ...(decisionContext ? { decisionContext } : {}),
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
    markWeeklyPlanningSemanticRepairConsumedV5(params.run);
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
    validationState(params.run),
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

/**
 * x9b: the focused recovery of dangling workload replacement ids (live round 5 C T2). It consumes the turn's single repair in
 * place of the generic one. The recovered document then goes through the same evidence-coverage audit as any accepted reading
 * (the deadline 「金曜日までに」 the readings dropped can still be recovered), and a recovered document whose coverage stays
 * eligible after that audit is DISCLOSED as possibly incomplete: a disclosure only, never a gate and never a change of meaning.
 */
async function tryFocusedReplacementFactRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs) return null;
  const candidates = readFocusedReplacementFactRepairCandidatesV5({
    rawResponse: params.initialResponse, validationErrors: params.initialValidation.errors, committedGraph: params.run.input.committedGraph,
  });
  if (!candidates) return null;

  const messages = createFocusedReplacementFactRepairMessagesV5({ userText: params.run.input.userText, candidates });
  const request = {
    messages,
    temperature: 0,
    responseFormat: FOCUSED_REPLACEMENT_FACT_REPAIR_RESPONSE_FORMAT_V5,
    purpose: 'weekly_planning_semantic_normalizer' as const,
    maxCompletionTokens: FOCUSED_REPLACEMENT_FACT_REPAIR_MAX_COMPLETION_TOKENS,
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    severity: 'warn',
    data: {
      route: 'focused_replacement_fact_repair_candidate',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'route_from_exact_dangling_replacement_errors',
        'merge_only_the_named_replacement_workloads',
        'revalidate_complete_document',
      ],
      initialValidationErrors: params.initialValidation.errors,
      requestBytes: semanticNormalizerByteLength(request),
    },
  });

  let response: string;
  try {
    markWeeklyPlanningSemanticRepairConsumedV5(params.run);
    response = await params.run.callTracked(request, 'focused_replacement_fact_repair');
  } catch (error) {
    return providerFailureResult(params.run, params.initialValidation.errors, error);
  }
  const decision = parseFocusedReplacementFactRepairDecisionV5(response);
  const merged = decision ? applyFocusedReplacementFactRepairV5({ rawResponse: params.initialResponse, candidates, decision }) : null;
  if (!merged) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      'repair:focused-replacement-fact:invalid-response',
    ]);
  }
  const validation = validateWeeklyPlanningSemanticResponseV5(merged, validationState(params.run));
  params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: validation.document ? 'info' : 'error',
    data: {
      attempt: 'focused_replacement_fact_repair', accepted: Boolean(validation.document), errors: validation.errors,
      algorithmicRepairs: validation.algorithmicRepairs, parsedDocument: validation.parsedDocument,
    },
  });
  if (!validation.document) {
    return rejectedResult(params.run, [
      ...params.initialValidation.errors.map((value) => `initial:${value}`),
      ...validation.errors.map((value) => `repair:${value}`),
    ]);
  }

  const recovered = validation.document;
  const accepted: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: recovered,
    diagnostics: params.run.diagnostics({
      attemptCount: 2, repairAttempted: true, validationErrors: params.initialValidation.errors, providerError: null,
    }),
  };
  params.run.recordDecision(accepted, { route: 'focused_replacement_fact_repair' });
  // The same evidence-coverage audit as any accepted reading: the turn's uncovered part (live: the deadline) may still be recovered.
  const audited = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({
    run: params.run,
    baseMessages: createWeeklyPlanningSemanticBaseMessagesV5(params.run.input),
    initialResponse: JSON.stringify(recovered),
    initialDocument: recovered,
    semanticRepairConsumed: () => weeklyPlanningSemanticRepairConsumedV5(params.run),
  });
  const outcome = audited ?? accepted;
  if (outcome.status !== 'accepted' || !outcome.document) return outcome;
  markFocusedReplacementRecoveredV5(outcome);
  if (outcome.completenessAbstention) return outcome;
  // Safeguard (disclosure only): the audit finished (complete, or nothing could be taken in) and the FINAL document of a recovered
  // turn still leaves a typed uncovered span in the user's text.
  const { evidenceCoverageEligibility } = measureInteractionEvidenceCoverageEligibilityV5({
    run: params.run, document: outcome.document, initialResponse: JSON.stringify(outcome.document),
  });
  if (!evidenceCoverageEligibility?.eligible) return outcome;
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_evidence_coverage_abstained',
    data: { route: evidenceCoverageEligibility.route, reason: 'recovered_text_not_covered', step: 'audit' },
  });
  return { ...outcome, completenessAbstention: { reason: 'recovered_text_not_covered' } };
}

export async function tryFocusedSemanticRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (weeklyPlanningSemanticRepairConsumedV5(params.run)) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'rejected', document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: params.run.responseLengths.length, repairAttempted: true,
        validationErrors: params.initialValidation.errors, providerError: null,
      }),
    };
    params.run.recordDecision(result, { route: 'focused_material_fallthrough_repair_limit', severity: 'error' });
    return result;
  }
  const userContextDateResult = await tryFocusedUserContextDateRepairRouteV5({
    run: params.run,
    initialValidation: params.initialValidation,
  });
  if (userContextDateResult) return userContextDateResult;

  const planningWindowResult = await tryFocusedPlanningWindowRepairRouteV5({
    run: params.run,
    initialValidation: params.initialValidation,
  });
  if (planningWindowResult) return planningWindowResult;

  const replacementFactResult = await tryFocusedReplacementFactRepairRouteV5(params);
  if (replacementFactResult) return replacementFactResult;

  return tryFocusedTemporalScopeRepairRouteV5(params);
}
