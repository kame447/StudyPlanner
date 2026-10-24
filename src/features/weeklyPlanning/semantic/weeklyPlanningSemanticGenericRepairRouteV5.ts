import type { ChatMessage } from '../../../services/ai/openAiCompatibleClientTypes';
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
  // Referenced aliases cannot be compacted without a binding policy. Do not
  // open a whole-document AI repair for this newly detected representation error.
  if (params.initialValidation.errors.some(error => error.startsWith('same-container-workload-duplicate-referenced:'))) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'rejected',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: attemptCountBeforeRepair,
        repairAttempted: false,
        validationErrors: params.initialValidation.errors,
        providerError: null,
      }),
    };
    params.run.recordDecision(result, { severity: 'error' });
    return result;
  }
  const repairAttemptCount = attemptCountBeforeRepair + 1;
  const repairMessages = createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: params.baseMessages,
    invalidResponse: params.initialResponse,
    validationErrors: params.initialValidation.errors,
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
    },
  );
  // An empty repair must not erase a separate, valid update from a compound
  // answer. Recover only independently validated updates to already-bound tasks;
  // cross-task operations and new identities still require the whole-document path.
  const initial = params.initialValidation.providerDocument;
  const repaired = repairedValidation.document;
  const pending = params.run.input.publicStateSummary?.pendingQuestion as { questionCode?: unknown } | undefined;
  if (pending?.questionCode === 'missing_effort_estimate'
    && initial?.planningIntent === 'update_plan' && initial.planningWindow === null
    && initial.tasks.length > 1 && repaired && repaired.tasks.length === 0
    && repaired.planningIntent === initial.planningIntent
    && [initial, repaired].every(document => document.planningWindow === null
      && document.relations.length === 0 && document.availabilityDeclarations.length === 0
      && document.constraintSourceRequests.length === 0 && (document.userContextFacts?.length ?? 0) === 0
      && document.uncertainties.length === 0 && document.corrections.length === 0
      && document.decisions.length === 0 && (document.conversationActs?.length ?? 0) === 0)) {
    const tasks = initial.tasks.flatMap(task => {
      if (!task?.existingPublicId) return [];
      const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify({ ...initial, tasks: [task] }), {
        currentUserText: params.run.input.userText,
        supplementalContext: params.run.input.supplementalContext,
        selectedStarterTarget: params.run.input.selectedStarterTarget,
        recentConversation: params.run.input.recentConversation,
        publicStateSummary: params.run.input.publicStateSummary,
        committedGraph: params.run.input.committedGraph,
      });
      return validation.document?.tasks.filter(value => value.effortEstimates.length > 0
        || value.temporalConstraints.length > 0) ?? [];
    });
    if (tasks.length > 0) {
      const recovered = validateWeeklyPlanningSemanticResponseV5(JSON.stringify({ ...repaired, tasks }), {
        currentUserText: params.run.input.userText,
        supplementalContext: params.run.input.supplementalContext,
        selectedStarterTarget: params.run.input.selectedStarterTarget,
        recentConversation: params.run.input.recentConversation,
        publicStateSummary: params.run.input.publicStateSummary,
        committedGraph: params.run.input.committedGraph,
      });
      if (recovered.document) {
        recovered.algorithmicRepairs.push('semantic-repair:retained-independently-validated-task-updates');
        Object.assign(repairedValidation, recovered);
      }
    }
  }
  params.run.addAlgorithmicRepairs(repairedValidation.algorithmicRepairs);
  // Compare provider shapes only as a pair. Legacy omitted optional fields can
  // prevent raw reading; retain the existing parsed/validated guard in that case.
  const comparisonDocuments = params.initialValidation.providerDocument && repairedValidation.providerDocument
    ? { initialDocument: params.initialValidation.providerDocument, repairedDocument: repairedValidation.providerDocument }
    : { initialDocument: params.initialValidation.parsedDocument, repairedDocument: repairedValidation.document };
  const preservationErrors = validateWeeklyPlanningSemanticRepairPreservationV5({
    ...comparisonDocuments,
    initialErrors: params.initialValidation.errors,
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
    },
  });

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
