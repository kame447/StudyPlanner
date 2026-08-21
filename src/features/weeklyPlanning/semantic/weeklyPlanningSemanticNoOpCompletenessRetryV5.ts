import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS,
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
  createFocusedTaskTemporalSideContributionDocumentV5,
  createFocusedTaskTemporalSideContributionMessagesV5,
  focusedTaskTemporalSideContributionEligibleV5,
  parseFocusedTaskTemporalSideContributionDecisionV5,
} from './weeklyPlanningFocusedTaskTemporalSideContributionV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
  semanticNormalizerErrorDetails,
  semanticNormalizerErrorMessage,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

function completenessRetryInstruction(params: {
  userText: string;
  final: boolean;
}): string {
  const exactUserText = JSON.stringify(params.userText);
  if (!params.final) {
    return [
      'The prior response is schema-valid but contains no new semantic content while a machine pending question exists.',
      `The exact current userText to interpret is ${exactUserText}.`,
      'Re-read that exact current userText independently and return the complete semantic document again.',
      'An existing-entity shell and its sourceText are context/binding only, not semantic content; encode each supported current-turn proposition in its typed field.',
      'Task-specific timing belongs in temporalConstraints, plan-wide availability in availabilityDeclarations, workload state in workloads, effort in effortEstimates, and task ordering in relations.',
      'A task-scoped completion-by date or time is a deadline temporalConstraint on that task; when the task already exists, use a minimal existingPublicId task shell plus the new constraint.',
      'Include every supported explicit current-turn fact, including side contributions unrelated to the pending question. Do not invent facts.',
      'If the exact current userText states any supported timing, workload, effort, relation, availability, correction, or decision proposition, a no-op document is not a valid retry result.',
      'Return equivalent no-op meaning only if the exact current userText genuinely contains no supported new fact.',
    ].join(' ');
  }
  return [
    'The completeness retry still produced no typed semantic content.',
    `The exact current userText to interpret is ${exactUserText}.`,
    'Perform one final independent completeness pass from that exact current userText and typed context; do not copy or preserve the prior empty semantic wrapper.',
    'Encode every supported current-turn proposition in the corresponding typed field, even when it does not answer the pending question.',
    'Task-scoped completion-by date/time must be represented as a deadline temporalConstraint on the referenced task; existing entity shells, titles, and sourceText alone do not count as semantic content.',
    'If the exact current userText states any supported timing, workload, effort, relation, availability, correction, or decision proposition, a no-op document is not a valid retry result.',
    'Return equivalent no-op meaning only if the exact current userText genuinely contains no supported new fact.',
  ].join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMachinePendingQuestion(summary: Record<string, unknown> | undefined): boolean {
  if (!summary || !isRecord(summary.pendingQuestion)) return false;
  return typeof summary.pendingQuestion.questionCode === 'string';
}

function hasTaskSemanticPayload(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.tasks.some((task) => {
    if (!task.existingPublicId) return true;
    if (
      task.workloads.length > 0
      || task.effortEstimates.length > 0
      || task.temporalConstraints.length > 0
      || task.recurrence.length > 0
      || (task.durableContextSignals?.length ?? 0) > 0
    ) return true;

    return (task.study?.components ?? []).some((component) =>
      !component.existingPublicId
      || component.workloads.length > 0
      || (component.durableContextSignals?.length ?? 0) > 0);
  });
}

function rejectedPriorNoOpResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  document: WeeklyPlanningSemanticDocumentV5;
  attemptCount: number;
  repairAttempted: boolean;
  validationErrors: string[];
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'rejected',
    document: null,
    diagnostics: params.run.diagnostics({
      attemptCount: params.attemptCount,
      repairAttempted: params.repairAttempted,
      validationErrors: [
        ...params.validationErrors,
        'completeness_retry:semantic_noop_after_retries',
      ],
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'schema_valid_noop_completeness_retry_rejected',
    severity: 'error',
    extra: { rejectedSchemaValidDocument: params.document },
  });
  return result;
}

function providerFailureDuringCompletenessRetry(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  attemptCount: number;
  repairAttempted: boolean;
  validationErrors: string[];
  error: unknown;
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'provider_failure',
    document: null,
    diagnostics: params.run.diagnostics({
      attemptCount: params.attemptCount,
      repairAttempted: params.repairAttempted,
      validationErrors: params.validationErrors,
      providerError: semanticNormalizerErrorMessage(params.error),
    }),
  };
  params.run.recordDecision(result, {
    route: 'schema_valid_noop_completeness_retry_provider_failure',
    severity: 'error',
  });
  return result;
}

export function isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): boolean {
  if (!hasMachinePendingQuestion(params.publicStateSummary)) return false;
  const document = params.document;
  if (
    document.planningWindow
    || document.relations.length > 0
    || document.availabilityDeclarations.length > 0
    || document.constraintSourceRequests.length > 0
    || (document.userContextFacts?.length ?? 0) > 0
    || document.uncertainties.length > 0
    || document.corrections.length > 0
    || document.decisions.length > 0
  ) return false;
  return !hasTaskSemanticPayload(document);
}

async function tryFocusedTaskTemporalSideContributionV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  attemptCountBeforeRetry: number;
  repairAttempted: boolean;
  validationErrors: string[];
}): Promise<{
  attempted: boolean;
  result: WeeklyPlanningSemanticNormalizerResultV5 | null;
}> {
  const publicStateSummary = params.run.input.publicStateSummary;
  if (!focusedTaskTemporalSideContributionEligibleV5({ publicStateSummary })) {
    return { attempted: false, result: null };
  }

  const messages = createFocusedTaskTemporalSideContributionMessagesV5({
    userText: params.run.input.userText,
    publicStateSummary,
  });
  if (messages.length === 0) return { attempted: false, result: null };

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'schema_valid_noop_focused_task_temporal_side_contribution',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'detect_schema_valid_semantic_noop_under_machine_pending_question',
        'bind_typed_temporal_side_contribution_to_verified_existing_task',
      ],
    },
  });

  let response: string;
  try {
    response = await params.run.callTracked({
      messages,
      temperature: 0,
      responseFormat: FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS,
    }, 'focused_task_temporal_side_contribution');
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_focused_task_temporal_side_contribution_result',
      severity: 'warn',
      data: {
        accepted: false,
        fallback: 'generic_completeness_retry',
        error: semanticNormalizerErrorDetails(error),
      },
    });
    return { attempted: true, result: null };
  }

  const decision = parseFocusedTaskTemporalSideContributionDecisionV5(response);
  const document = decision
    ? createFocusedTaskTemporalSideContributionDocumentV5({
        userText: params.run.input.userText,
        publicStateSummary,
        decision,
      })
    : null;
  const validation = document
    ? validateWeeklyPlanningSemanticResponseV5(
        JSON.stringify(document),
        { publicStateSummary },
      )
    : null;
  if (validation) params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);

  const acceptedDocument = validation?.document ?? null;
  const accepted = acceptedDocument !== null
    && !isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: acceptedDocument,
      publicStateSummary,
    });

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_focused_task_temporal_side_contribution_result',
    severity: accepted ? 'info' : 'debug',
    data: {
      accepted,
      decision,
      validationErrors: validation?.errors ?? [],
      parsedDocument: validation?.parsedDocument ?? null,
      fallback: accepted ? null : 'generic_completeness_retry',
    },
  });

  if (!accepted || !acceptedDocument) return { attempted: true, result: null };

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: acceptedDocument,
    diagnostics: params.run.diagnostics({
      attemptCount: params.attemptCountBeforeRetry + 1,
      repairAttempted: params.repairAttempted,
      validationErrors: params.validationErrors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'schema_valid_noop_focused_task_temporal_side_contribution',
  });
  return { attempted: true, result };
}

export async function tryWeeklyPlanningSemanticNoOpCompletenessRetryV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialResponse: string;
  initialDocument: WeeklyPlanningSemanticDocumentV5;
  attemptCountBeforeRetry?: number;
  repairAttempted?: boolean;
  validationErrors?: string[];
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
    document: params.initialDocument,
    publicStateSummary: params.run.input.publicStateSummary,
  })) return null;

  const attemptCountBeforeRetry = params.attemptCountBeforeRetry ?? 1;
  const repairAttempted = params.repairAttempted ?? false;
  const validationErrors = params.validationErrors ?? [];

  const focusedTemporal = await tryFocusedTaskTemporalSideContributionV5({
    run: params.run,
    attemptCountBeforeRetry,
    repairAttempted,
    validationErrors,
  });
  if (focusedTemporal.result) return focusedTemporal.result;

  const focusedAttemptOffset = focusedTemporal.attempted ? 1 : 0;
  let previousResponse = params.initialResponse;

  for (let retryIndex = 0; retryIndex < 2; retryIndex += 1) {
    const isFinalRetry = retryIndex === 1;
    const instruction = completenessRetryInstruction({
      userText: params.run.input.userText,
      final: isFinalRetry,
    });
    const attempt = isFinalRetry
      ? 'completeness_retry_final'
      : 'completeness_retry';
    const attemptCount = attemptCountBeforeRetry + focusedAttemptOffset + retryIndex + 1;
    const messages: ChatMessage[] = isFinalRetry
      ? [
          ...params.baseMessages,
          { role: 'user', content: instruction },
        ]
      : [
          ...params.baseMessages,
          { role: 'assistant', content: previousResponse },
          { role: 'user', content: instruction },
        ];

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_orchestrator_route',
      data: {
        route: isFinalRetry
          ? 'schema_valid_noop_completeness_retry_final'
          : 'schema_valid_noop_completeness_retry',
        meaningOwner: 'ai',
        deterministicResponsibilities: [
          'detect_schema_valid_semantic_noop_under_machine_pending_question',
          'recheck_completeness_retry_before_accepting_semantic_noop',
        ],
        attemptCountBeforeRetry: attemptCount - 1,
        repairAttempted,
        finalRetryUsesFreshSemanticContext: isFinalRetry,
      },
    });

    let response: string;
    try {
      response = await params.run.callTracked({
        messages,
        temperature: 0,
        responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
        purpose: 'weekly_planning_semantic_normalizer',
        maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
      }, attempt);
    } catch (error) {
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: params.run.input.traceRequestId,
        stage: 'semantic_noop_completeness_retry_result',
        severity: 'warn',
        data: {
          retryIndex: retryIndex + 1,
          accepted: false,
          fallback: 'provider_failure',
          error: semanticNormalizerErrorDetails(error),
        },
      });
      return providerFailureDuringCompletenessRetry({
        run: params.run,
        attemptCount,
        repairAttempted,
        validationErrors,
        error,
      });
    }

    const validation = validateWeeklyPlanningSemanticResponseV5(
      response,
      { publicStateSummary: params.run.input.publicStateSummary },
    );
    params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
    const stillNoOp = validation.document
      ? isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
          document: validation.document,
          publicStateSummary: params.run.input.publicStateSummary,
        })
      : false;
    const shouldRetryAgain = retryIndex === 0 && (!validation.document || stillNoOp);

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_noop_completeness_retry_result',
      severity: validation.document && !stillNoOp ? 'info' : 'warn',
      data: {
        retryIndex: retryIndex + 1,
        accepted: Boolean(validation.document) && !stillNoOp,
        stillNoOp,
        errors: validation.errors,
        parsedDocument: validation.parsedDocument,
        retryAgain: shouldRetryAgain,
        fallback: retryIndex === 1 && (!validation.document || stillNoOp)
          ? 'rejected_schema_valid_noop'
          : null,
      },
    });

    if (validation.document && !stillNoOp) {
      const result: WeeklyPlanningSemanticNormalizerResultV5 = {
        status: 'accepted',
        document: validation.document,
        diagnostics: params.run.diagnostics({
          attemptCount,
          repairAttempted,
          validationErrors,
          providerError: null,
        }),
      };
      params.run.recordDecision(result, {
        route: isFinalRetry
          ? 'schema_valid_noop_completeness_retry_final'
          : 'schema_valid_noop_completeness_retry',
      });
      return result;
    }

    if (!shouldRetryAgain) {
      return rejectedPriorNoOpResult({
        run: params.run,
        document: params.initialDocument,
        attemptCount,
        repairAttempted,
        validationErrors,
      });
    }
    previousResponse = response;
  }

  return rejectedPriorNoOpResult({
    run: params.run,
    document: params.initialDocument,
    attemptCount: attemptCountBeforeRetry + focusedAttemptOffset + 2,
    repairAttempted,
    validationErrors,
  });
}
