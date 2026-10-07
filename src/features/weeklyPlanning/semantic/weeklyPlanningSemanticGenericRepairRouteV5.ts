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

type SemanticValidationResultV5 = ReturnType<typeof validateWeeklyPlanningSemanticResponseV5>;

export async function runGenericSemanticRepairRouteV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialResponse: string;
  initialValidation: SemanticValidationResultV5;
  attemptCountBeforeRepair?: number;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
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

  if (!repairedValidation.document || preservationErrors.length > 0) {
    // Interaction: post-parse checks only run on a parsed document, so a repair that fixed the
    // parse-stage errors can reveal errors the first repair never saw (live B on 48a42eec:
    // empty task fields hid a workload id sent as a task id). Each validation stage gets one
    // repair; a post-parse failure the first repair already saw is never repaired twice.
    if (providerComparison && preservationErrors.length === 0
      && params.initialValidation.failedStage === 'parse' && repairedValidation.failedStage === 'post_parse') {
      return runStagedSemanticRepairV5({
        run: params.run,
        baseMessages: params.baseMessages,
        initialValidation: params.initialValidation,
        repairedResponse,
        repairedValidation,
        attemptCountBeforeRepair: repairAttemptCount,
      });
    }
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
  if (completenessRetry) return completenessRetry;

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

async function runStagedSemanticRepairV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialValidation: SemanticValidationResultV5;
  repairedResponse: string;
  repairedValidation: SemanticValidationResultV5;
  attemptCountBeforeRepair: number;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
  const attemptCount = params.attemptCountBeforeRepair + 1;
  const earlierErrors = [
    ...params.initialValidation.errors.map((value) => `initial:${value}`),
    ...params.repairedValidation.errors.map((value) => `repair:${value}`),
  ];
  const stagedMessages = createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: params.baseMessages,
    invalidResponse: params.repairedResponse,
    validationErrors: params.repairedValidation.errors,
    conversationArchitecture: params.run.input.conversationArchitecture,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_repair_prepared',
    severity: 'warn',
    data: {
      attempt: 'staged_repair',
      invalidResponse: params.repairedResponse,
      validationErrors: params.repairedValidation.errors,
      repairMessages: stagedMessages,
      attemptCountBeforeRepair: params.attemptCountBeforeRepair,
    },
  });

  let stagedResponse: string;
  try {
    stagedResponse = await params.run.callGeneric(stagedMessages, 'staged_repair');
  } catch (error) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'provider_failure',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount,
        repairAttempted: true,
        validationErrors: earlierErrors,
        providerError: semanticNormalizerErrorMessage(error),
      }),
    };
    params.run.recordDecision(result, { severity: 'error' });
    return result;
  }

  const stagedValidation = validateWeeklyPlanningSemanticResponseV5(
    stagedResponse,
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
  params.run.addAlgorithmicRepairs(stagedValidation.algorithmicRepairs);
  params.run.recordRejectedPlanningConversationActs('repair', stagedValidation);
  const preservationErrors = validateWeeklyPlanningSemanticRepairPreservationV5({
    initialDocument: params.repairedValidation.providerDocument ?? null,
    repairedDocument: stagedValidation.document ? stagedValidation.providerDocument ?? null : null,
    initialErrors: params.repairedValidation.errors,
    conversationArchitecture: params.run.input.conversationArchitecture,
  });
  const accepted = Boolean(stagedValidation.document) && preservationErrors.length === 0;
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: accepted ? 'info' : 'error',
    data: {
      attempt: 'staged_repair',
      accepted,
      errors: [...stagedValidation.errors, ...preservationErrors],
      algorithmicRepairs: stagedValidation.algorithmicRepairs,
      parsedDocument: stagedValidation.parsedDocument,
      semanticAttemptCount: attemptCount,
      ...(stagedValidation.conversationActs
        ? {
            conversationActs: stagedValidation.conversationActs,
            conversationActDiagnostics: stagedValidation.conversationActDiagnostics ?? [],
          }
        : {}),
    },
  });

  if (!stagedValidation.document || preservationErrors.length > 0) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'rejected',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount,
        repairAttempted: true,
        validationErrors: [
          ...earlierErrors,
          ...stagedValidation.errors.map((value) => `staged_repair:${value}`),
          ...preservationErrors.map((value) => `staged_repair:${value}`),
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
    initialResponse: stagedResponse,
    initialDocument: stagedValidation.document,
    attemptCountBeforeRetry: attemptCount,
    repairAttempted: true,
    validationErrors: params.initialValidation.errors,
  });
  if (completenessRetry) return completenessRetry;

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: stagedValidation.document,
    diagnostics: params.run.diagnostics({
      attemptCount,
      repairAttempted: true,
      validationErrors: params.initialValidation.errors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'generic_semantic_staged_repair' });
  return result;
}
