import { isWeeklyPlanningTurnDispatchBudgetExceeded } from '../application/weeklyPlanningTurnDispatchBudget';
import { hasSelfSufficientConversationActV5 } from './weeklyPlanningConversationActsV5';
import { weeklyPlanningMaterialIdentityAnswersV5 } from './weeklyPlanningMaterialIdentityAnswerV5';
import {
  conversationArchitecturePolicy,
  type WeeklyPlanningConversationArchitecture,
} from '../weeklyPlanningConversationArchitecture';
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
import { semanticProviderResponseFormatV5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

const acceptedNoOpRetryResponses = new WeakMap<WeeklyPlanningSemanticNormalizerResultV5, string>();

/** Transient provider bytes for replay; the validated document remains the floor. */
export function weeklyPlanningSemanticNoOpRetryResponseV5(result: WeeklyPlanningSemanticNormalizerResultV5): string | undefined {
  return acceptedNoOpRetryResponses.get(result);
}

function completenessRetryInstruction(params: {
  userText: string;
  final: boolean;
  pendingQuestion: boolean;
}): string {
  const exactUserText = JSON.stringify(params.userText);
  if (!params.pendingQuestion) {
    return [
      'The prior response is schema-valid but contains no new semantic content although a plan has already been accepted.',
      `The exact current userText to interpret is ${exactUserText}.`,
      'Re-read that exact current userText independently and return the complete semantic document again.',
      'An existing-entity shell and its sourceText are context/binding only, not semantic content; encode each supported current-turn change to the accepted plan in its typed field (sessions, splits, timing preferences, workload, effort, corrections).',
      'If the exact current userText is only conversation (thanks, an aside, or a question about the plan), return the no-op meaning with the matching conversation act. Do not invent facts.',
    ].join(' ');
  }
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

function hasAcceptedTask(summary: Record<string, unknown> | undefined): boolean {
  return Array.isArray(summary?.tasks) && summary.tasks.length > 0;
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

function acceptedPriorNoOpResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  document: WeeklyPlanningSemanticDocumentV5;
  attemptCount: number;
  repairAttempted: boolean;
  validationErrors: string[];
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: params.document,
    diagnostics: params.run.diagnostics({
      attemptCount: params.attemptCount,
      repairAttempted: params.repairAttempted,
      validationErrors: params.validationErrors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'schema_valid_noop_completeness_retry_fallback_initial',
  });
  return result;
}

/**
 * Whether an invalid re-read may have carried a change (typed shape only, never text). An
 * unreadable response cannot be told apart, so it counts as possibly carrying one; a parsed
 * response with no planning content at all keeps the still-valid no-op reading.
 */
function invalidRetryMayCarryChange(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return true;
  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.tasks)) return true;
  const nonEmpty = (key: string) => Array.isArray(doc[key]) && (doc[key] as unknown[]).length > 0;
  if (doc.planningWindow || ['relations', 'availabilityDeclarations', 'constraintSourceRequests', 'userContextFacts',
    'uncertainties', 'corrections', 'decisions'].some(nonEmpty)) return true;
  try {
    return hasTaskSemanticPayload({ tasks: (doc.tasks as Array<Record<string, unknown>>).map((task) => ({
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], ...task,
    })) } as unknown as WeeklyPlanningSemanticDocumentV5);
  } catch {
    return true;
  }
}

function rejectedNoOpRetryResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
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
      validationErrors: params.validationErrors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'schema_valid_noop_completeness_retry_rejected',
    severity: 'error',
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
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
  /**
   * Judging the re-read that follows a contradiction: the first reading already named an
   * accepted task, so a re-read that carries no delta and no self-sufficient act is still a
   * contradiction even though it names no task (the first-reading gate below does not apply).
   */
  rereadAfterContradiction?: boolean;
}): boolean {
  const actAware = conversationArchitecturePolicy(params.conversationArchitecture).actAwareNoOpRetry;
  // Interaction: once a plan is accepted, an empty delta without any conversational act is as
  // suspicious as one under a pending question (live D on fa6347e6 returned only task shells
  // for 「1回1時間くらいで2回に分けたい。どっちも夜がいい」 and reported the preview unchanged).
  const document = params.document;
  // Without a pending question only a response that names accepted tasks yet carries nothing
  // for them is re-read; a bare empty reply (「うん」, thanks) stays a valid no-op.
  if (!hasMachinePendingQuestion(params.publicStateSummary)
    && !(actAware && hasAcceptedTask(params.publicStateSummary)
      && (document.tasks.length > 0 || params.rereadAfterContradiction))) return false;
  // A typed non-mutating conversational act (explain / aside / resume / consultation) is a
  // valid complete result with an empty planning delta. Re-asking the model for "missing"
  // content would only waste dispatches; only a bare answer act without any delta is a
  // contradiction worth a bounded retry.
  if (actAware && hasSelfSufficientConversationActV5(document.conversationActs)) return false;
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
        {
          currentUserText: params.run.input.userText,
          supplementalContext: params.run.input.supplementalContext,
          selectedStarterTarget: params.run.input.selectedStarterTarget,
          recentConversation: params.run.input.recentConversation,
          publicStateSummary,
          committedGraph: params.run.input.committedGraph,
          conversationArchitecture: params.run.input.conversationArchitecture,
        },
      )
    : null;
  if (validation) params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);

  const acceptedDocument = validation?.document ?? null;
  const accepted = acceptedDocument !== null
    && !isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: acceptedDocument,
      publicStateSummary,
      conversationArchitecture: params.run.input.conversationArchitecture,
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
  acceptedNoOpRetryResponses.set(result, response);
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
  if (conversationArchitecturePolicy(params.run.input.conversationArchitecture).actAwareNoOpRetry
    && params.run.input.committedGraph
    && weeklyPlanningMaterialIdentityAnswersV5(params.run.input.committedGraph, params.initialDocument).length > 0) return null;
  if (!isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
    document: params.initialDocument,
    publicStateSummary: params.run.input.publicStateSummary,
    conversationArchitecture: params.run.input.conversationArchitecture,
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
  // A follow-up to an accepted plan (no pending question) gets one bounded re-read only.
  const pendingQuestion = hasMachinePendingQuestion(params.run.input.publicStateSummary);
  const retryLimit = pendingQuestion ? 2 : 1;

  for (let retryIndex = 0; retryIndex < retryLimit; retryIndex += 1) {
    const isFinalRetry = retryIndex === 1;
    const instruction = completenessRetryInstruction({
      userText: params.run.input.userText,
      final: isFinalRetry,
      pendingQuestion,
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
        responseFormat: semanticProviderResponseFormatV5(params.run.input.conversationArchitecture),
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
      // The turn's shared dispatch budget ran out: keep the already valid schema result
      // instead of turning it into a provider failure.
      if (isWeeklyPlanningTurnDispatchBudgetExceeded(error)) {
        return acceptedPriorNoOpResult({
          run: params.run,
          document: params.initialDocument,
          attemptCount: attemptCount - 1,
          repairAttempted,
          validationErrors,
        });
      }
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
      {
        currentUserText: params.run.input.userText,
        supplementalContext: params.run.input.supplementalContext,
        selectedStarterTarget: params.run.input.selectedStarterTarget,
        recentConversation: params.run.input.recentConversation,
        publicStateSummary: params.run.input.publicStateSummary,
        committedGraph: params.run.input.committedGraph,
          conversationArchitecture: params.run.input.conversationArchitecture,
      },
    );
    params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
    const stillNoOp = validation.document
      ? isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
          document: validation.document,
          publicStateSummary: params.run.input.publicStateSummary,
          conversationArchitecture: params.run.input.conversationArchitecture,
          rereadAfterContradiction: true,
        })
      : false;
    const shouldRetryAgain = retryIndex + 1 < retryLimit && (!validation.document || stillNoOp);

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
        fallback: retryIndex + 1 === retryLimit && (!validation.document || stillNoOp)
          ? 'initial_schema_valid_document'
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
      acceptedNoOpRetryResponses.set(result, response);
      return result;
    }

    if (!shouldRetryAgain
      && conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs
      && (pendingQuestion
        ? !validation.document && invalidRetryMayCarryChange(validation.parsedDocument ?? validation.providerDocument ?? null)
        : true)) {
      // The first reading was a schema-valid contradiction (it pointed at the plan but carried no
      // change) and the re-read did not recover the meaning: it is invalid, or valid yet carries
      // neither a delta nor a self-sufficient act. Accepting the empty reading would report the
      // plan as unchanged while the message went unused, so the turn is an unusable message
      // instead: nothing applied, recovery wording, no promotion. Under a pending question the
      // fallback to the initial reading stays (a readable, content-free invalid re-read keeps it).
      return rejectedNoOpRetryResult({
        run: params.run,
        attemptCount,
        repairAttempted,
        validationErrors: [...validationErrors, ...validation.errors.map((error) => `completeness_retry:${error}`)],
      });
    }
    if (!shouldRetryAgain) {
      return acceptedPriorNoOpResult({
        run: params.run,
        document: params.initialDocument,
        attemptCount,
        repairAttempted,
        validationErrors,
      });
    }
    previousResponse = response;
  }

  return acceptedPriorNoOpResult({
    run: params.run,
    document: params.initialDocument,
    attemptCount: attemptCountBeforeRetry + focusedAttemptOffset + retryLimit,
    repairAttempted,
    validationErrors,
  });
}
