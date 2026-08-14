import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
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
}): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
  const repairMessages = createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: params.baseMessages,
    invalidResponse: params.initialResponse,
    validationErrors: params.initialValidation.errors,
    input: params.run.input,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_repair_prepared',
    severity: 'warn',
    data: {
      invalidResponse: params.initialResponse,
      validationErrors: params.initialValidation.errors,
      repairMessages,
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
        attemptCount: 2,
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
    { publicStateSummary: params.run.input.publicStateSummary },
  );
  params.run.addAlgorithmicRepairs(repairedValidation.algorithmicRepairs);
  const preservationErrors = validateWeeklyPlanningSemanticRepairPreservationV5({
    initialDocument: params.initialValidation.parsedDocument,
    repairedDocument: repairedValidation.document,
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
    },
  });

  if (!repairedValidation.document || preservationErrors.length > 0) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'rejected',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: 2,
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

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: repairedValidation.document,
    diagnostics: params.run.diagnostics({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: params.initialValidation.errors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'generic_semantic_repair' });
  return result;
}
