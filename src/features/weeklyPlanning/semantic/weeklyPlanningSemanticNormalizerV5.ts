import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from './weeklyPlanningCurrentTurnProvenanceV5';
import { runGenericSemanticRepairRouteV5 } from './weeklyPlanningSemanticGenericRepairRouteV5';
import {
  tryFocusedAuthorizationRouteV5,
  tryFocusedContextualAnswerRouteV5,
} from './weeklyPlanningSemanticFocusedPreRoutesV5';
import { tryFocusedSemanticRepairRouteV5 } from './weeklyPlanningSemanticFocusedRepairRoutesV5';
import {
  tryWeeklyPlanningSemanticNoOpCompletenessRetryV5,
} from './weeklyPlanningSemanticNoOpCompletenessRetryV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerInputV5,
  type WeeklyPlanningSemanticNormalizerResultV5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
  semanticNormalizerErrorMessage,
  WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from './weeklyPlanningSemanticTypesV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

export {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';
export {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
} from './weeklyPlanningSemanticNormalizerContractsV5';
export type {
  WeeklyPlanningSemanticNormalizerDiagnosticsV5,
  WeeklyPlanningSemanticNormalizerInputV5,
  WeeklyPlanningSemanticNormalizerResultV5,
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerContractsV5';

function recordInitialValidation(params: {
  input: WeeklyPlanningSemanticNormalizerInputV5;
  validation: ReturnType<typeof validateWeeklyPlanningSemanticResponseV5>;
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'semantic_validation_result',
    data: {
      attempt: 'initial',
      accepted: Boolean(params.validation.document),
      errors: params.validation.errors,
      algorithmicRepairs: params.validation.algorithmicRepairs,
      parsedDocument: params.validation.parsedDocument,
    },
  });
}

function enforceFinalCurrentTurnProvenance(params: {
  input: WeeklyPlanningSemanticNormalizerInputV5;
  run: WeeklyPlanningSemanticNormalizerRunV5;
  result: WeeklyPlanningSemanticNormalizerResultV5;
}): WeeklyPlanningSemanticNormalizerResultV5 {
  if (!params.result.document) return params.result;

  const provenanceErrors = validateWeeklyPlanningCurrentTurnProvenanceV5({
    document: params.result.document,
    currentUserText: params.input.userText,
    publicStateSummary: params.input.publicStateSummary,
  });
  if (provenanceErrors.length === 0) return params.result;

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'rejected',
    document: null,
    diagnostics: {
      ...params.result.diagnostics,
      validationErrors: [...new Set([
        ...params.result.diagnostics.validationErrors,
        ...provenanceErrors,
      ])],
    },
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: 'error',
    data: {
      attempt: 'final_current_turn_provenance',
      accepted: false,
      errors: provenanceErrors,
      parsedDocument: params.result.document,
    },
  });
  params.run.recordDecision(result, {
    route: 'current_turn_provenance_guard',
    severity: 'error',
  });
  return result;
}

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const run = new WeeklyPlanningSemanticNormalizerRunV5(client, input);
      const finish = (result: WeeklyPlanningSemanticNormalizerResultV5) =>
        enforceFinalCurrentTurnProvenance({ input, run, result });

      const contextualResult = await tryFocusedContextualAnswerRouteV5(run);
      if (contextualResult) return finish(contextualResult);

      const authorization = await tryFocusedAuthorizationRouteV5(run);
      if (authorization.result) return finish(authorization.result);

      const baseMessages = createWeeklyPlanningSemanticBaseMessagesV5(input);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.traceRequestId,
        stage: 'semantic_normalizer_prepared',
        data: {
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          input,
          orchestrationContext: {
            focusedConversationDecision: authorization.decision,
          },
          request: {
            purpose: 'weekly_planning_semantic_normalizer',
            messages: baseMessages,
            temperature: 0,
            responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
            maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
          },
        },
      });

      let initialResponse: string;
      try {
        initialResponse = await run.callGeneric(baseMessages, 'initial');
      } catch (error) {
        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'provider_failure',
          document: null,
          diagnostics: run.diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: semanticNormalizerErrorMessage(error),
          }),
        };
        run.recordDecision(result, { severity: 'error' });
        return finish(result);
      }

      const initialValidation = validateWeeklyPlanningSemanticResponseV5(
        initialResponse,
        {
          currentUserText: input.userText,
          publicStateSummary: input.publicStateSummary,
        },
      );
      run.addAlgorithmicRepairs(initialValidation.algorithmicRepairs);
      recordInitialValidation({ input, validation: initialValidation });

      if (initialValidation.document) {
        const completenessRetry = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({
          run,
          baseMessages,
          initialResponse,
          initialDocument: initialValidation.document,
        });
        if (completenessRetry) return finish(completenessRetry);

        const result: WeeklyPlanningSemanticNormalizerResultV5 = {
          status: 'accepted',
          document: initialValidation.document,
          diagnostics: run.diagnostics({
            attemptCount: 1,
            repairAttempted: false,
            validationErrors: [],
            providerError: null,
          }),
        };
        run.recordDecision(result, { route: 'generic_semantic' });
        return finish(result);
      }

      const focusedRepairResult = await tryFocusedSemanticRepairRouteV5({
        run,
        initialResponse,
        initialValidation,
      });
      if (focusedRepairResult) return finish(focusedRepairResult);

      return finish(await runGenericSemanticRepairRouteV5({
        run,
        baseMessages,
        initialResponse,
        initialValidation,
      }));
    },
  };
}
