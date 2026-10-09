import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import { tryWeeklyPlanningSemanticNoOpCompletenessRetryV5 } from './weeklyPlanningSemanticNoOpCompletenessRetryV5';
import {
  semanticNormalizerErrorMessage,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from './weeklyPlanningSemanticRepairPromptV5';
import { validateWeeklyPlanningSemanticRepairPreservationV5 } from './weeklyPlanningSemanticRepairPreservationV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { markWeeklyPlanningSemanticRepairConsumedV5, weeklyPlanningSemanticRepairConsumedV5 } from './weeklyPlanningSemanticRepairLedgerV5';

type SemanticValidationResultV5 = ReturnType<typeof validateWeeklyPlanningSemanticResponseV5>;

export async function runGenericSemanticRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
  attemptCountBeforeRepair?: number;
  afterNoOpCompletenessRetry?: (result: WeeklyPlanningSemanticNormalizerResultV5) => Promise<WeeklyPlanningSemanticNormalizerResultV5>;
  /**
   * D2: the generic repair's own response was rejected. A focused recovery (one more call) may still read what the repair left
   * dangling; null leaves the rejection as it is. Supplied by the normalizer (the focused routes cannot be imported from here).
   */
  recoverRejectedRepair?: (rejected: { response: string; validation: ReturnType<typeof validateWeeklyPlanningSemanticResponseV5> }) => Promise<WeeklyPlanningSemanticNormalizerResultV5 | null>;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
  // Completeness re-reads also reach this boundary after a valid initial response.
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
  const attemptCountBeforeRepair = params.attemptCountBeforeRepair ?? 1;
  const repairAttemptCount = attemptCountBeforeRepair + 1;
  const repairMessages = createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: params.baseMessages,
    invalidResponse: params.initialResponse,
    validationErrors: params.initialValidation.errors,
    conversationArchitecture: params.run.input.conversationArchitecture,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_repair_prepared',
    severity: 'warn',
    data: {
      invalidResponse: params.initialResponse,
      validationErrors: params.initialValidation.errors,
      repairMessages,
      attemptCountBeforeRepair,
    },
  });

  let repairedResponse: string;
  try {
    markWeeklyPlanningSemanticRepairConsumedV5(params.run);
    repairedResponse = await params.run.callGeneric(repairMessages, 'repair');
  } catch (error) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'provider_failure',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: repairAttemptCount,
        repairAttempted: true,
        validationErrors: params.initialValidation.errors,
        providerError: semanticNormalizerErrorMessage(error),
      }),
    };
    params.run.recordDecision(result, { severity: 'error' });
    return result;
  }

  const repairedValidation = validateWeeklyPlanningSemanticResponseV5(
    repairedResponse,
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
  params.run.addAlgorithmicRepairs(repairedValidation.algorithmicRepairs);
  params.run.recordRejectedPlanningConversationActs('repair', repairedValidation);
  // Interaction compares what the provider wrote in both responses: post-parse
  // canonicalization and projections (for example a bookshelf id) are not repair changes.
  const providerComparison = conversationArchitecturePolicy(params.run.input.conversationArchitecture)
    .semanticConversationActs;
  const preservationErrors = validateWeeklyPlanningSemanticRepairPreservationV5({
    initialDocument: providerComparison
      ? params.initialValidation.providerDocument ?? null
      : params.initialValidation.parsedDocument,
    repairedDocument: providerComparison && repairedValidation.document
      ? repairedValidation.providerDocument ?? null
      : repairedValidation.document,
    initialErrors: params.initialValidation.errors,
    conversationArchitecture: params.run.input.conversationArchitecture,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: repairedValidation.document && preservationErrors.length === 0
      ? 'info'
      : 'error',
    data: {
      attempt: 'repair',
      accepted: Boolean(repairedValidation.document) && preservationErrors.length === 0,
      errors: [...repairedValidation.errors, ...preservationErrors],
      algorithmicRepairs: repairedValidation.algorithmicRepairs,
      parsedDocument: repairedValidation.parsedDocument,
      semanticAttemptCount: repairAttemptCount,
      ...(repairedValidation.conversationActs
        ? {
            conversationActs: repairedValidation.conversationActs,
            conversationActDiagnostics: repairedValidation.conversationActDiagnostics ?? [],
          }
        : {}),
    },
  });

  if (!repairedValidation.document && params.recoverRejectedRepair) {
    const recovered = await params.recoverRejectedRepair({ response: repairedResponse, validation: repairedValidation });
    if (recovered) return recovered;
  }
  if (!repairedValidation.document || preservationErrors.length > 0) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'rejected',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: repairAttemptCount,
        repairAttempted: true,
        validationErrors: [
          ...params.initialValidation.errors.map((value) => `initial:${value}`),
          ...repairedValidation.errors.map((value) => `repair:${value}`),
          ...preservationErrors.map((value) => `repair:${value}`),
        ],
        providerError: null,
      }),
    };
    params.run.recordDecision(result, { severity: 'error' });
    return result;
  }

  const completenessRetry = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({
    run: params.run,
    baseMessages: params.baseMessages,
    initialResponse: repairedResponse,
    initialDocument: repairedValidation.document,
    attemptCountBeforeRetry: repairAttemptCount,
    repairAttempted: true,
    validationErrors: params.initialValidation.errors,
  });
  if (completenessRetry) {
    return completenessRetry.status === 'accepted' && completenessRetry.document && params.afterNoOpCompletenessRetry
      ? params.afterNoOpCompletenessRetry(completenessRetry) : completenessRetry;
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: repairedValidation.document,
    diagnostics: params.run.diagnostics({
      attemptCount: repairAttemptCount,
      repairAttempted: true,
      validationErrors: params.initialValidation.errors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'generic_semantic_repair' });
  return result;
}
