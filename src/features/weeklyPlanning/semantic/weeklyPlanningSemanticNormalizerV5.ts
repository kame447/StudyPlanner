import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  tryWeeklyPlanningDenseTurnCompletenessRetryV5,
} from './weeklyPlanningSemanticDenseTurnCompletenessV5';
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
  semanticNormalizerCompletionTokenBudgetV5,
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

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const run = new WeeklyPlanningSemanticNormalizerRunV5(client, input);

      const contextualResult = await tryFocusedContextualAnswerRouteV5(run);
      if (contextualResult) return contextualResult;

      const authorization = await tryFocusedAuthorizationRouteV5(run);
      if (authorization.result) return authorization.result;

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
            maxCompletionTokens: semanticNormalizerCompletionTokenBudgetV5(input),
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
        return result;
      }

      const initialValidation = validateWeeklyPlanningSemanticResponseV5(
        initialResponse,
        { publicStateSummary: input.publicStateSummary },
      );
      run.addAlgorithmicRepairs(initialValidation.algorithmicRepairs);
      recordInitialValidation({ input, validation: initialValidation });

      if (initialValidation.document) {
        const denseCompletenessRetry = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({
          run,
          baseMessages,
          initialResponse,
          initialDocument: initialValidation.document,
        });
        if (denseCompletenessRetry) return denseCompletenessRetry;

        const completenessRetry = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({
          run,
          baseMessages,
          initialResponse,
          initialDocument: initialValidation.document,
        });
        if (completenessRetry) return completenessRetry;

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
        return result;
      }

      const focusedRepairResult = await tryFocusedSemanticRepairRouteV5({
        run,
        initialResponse,
        initialValidation,
      });
      if (focusedRepairResult) return focusedRepairResult;

      return runGenericSemanticRepairRouteV5({
        run,
        baseMessages,
        initialResponse,
        initialValidation,
      });
    },
  };
}
