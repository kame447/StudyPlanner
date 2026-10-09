import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { weeklyPlanningSemanticRepairConsumedV5 } from './weeklyPlanningSemanticRepairLedgerV5';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from './weeklyPlanningCurrentTurnProvenanceV5';
import {
  tryWeeklyPlanningDenseTurnCompletenessRetryV5,
  denseTurnCompletenessAuditEligibleV5,
} from './weeklyPlanningSemanticDenseTurnCompletenessV5';
import { hasWeeklyPlanningEvidenceCoverageTaskModificationV5 } from './weeklyPlanningSemanticEvidenceCoverageNeedV5';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { runGenericSemanticRepairRouteV5 } from './weeklyPlanningSemanticGenericRepairRouteV5';
import { continueWithConversationActsOnlyV5 } from './weeklyPlanningSemanticConversationOnlyTurnV5';
import {
  tryFocusedAuthorizationRouteV5,
  tryFocusedContextualAnswerRouteV5,
} from './weeklyPlanningSemanticFocusedPreRoutesV5';
import { semanticResponseCarriesPlanningContentV5 } from './weeklyPlanningSemanticValidatorV5';
import { tryFocusedSemanticRepairRouteV5, tryFocusedTemporalReplacementRecoveryAfterRepairV5 } from './weeklyPlanningSemanticFocusedRepairRoutesV5';
import {
  tryWeeklyPlanningSemanticNoOpCompletenessRetryV5,
  weeklyPlanningSemanticNoOpRetryResponseV5,
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
import { semanticProviderResponseFormatV5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
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
      ...(params.validation.conversationActs
        ? {
            conversationActs: params.validation.conversationActs,
            conversationActDiagnostics: params.validation.conversationActDiagnostics ?? [],
          }
        : {}),
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
    supplementalContext: params.input.supplementalContext,
    selectedStarterTarget: params.input.selectedStarterTarget,
    recentConversation: params.input.recentConversation,
    publicStateSummary: params.input.publicStateSummary,
    committedGraph: params.input.committedGraph,
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

async function auditAcceptedNoOpCompletenessRetry(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ReturnType<typeof createWeeklyPlanningSemanticBaseMessagesV5>;
  result: WeeklyPlanningSemanticNormalizerResultV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
  const { run, result } = params;
  if (result.status !== 'accepted' || !result.document
    || !conversationArchitecturePolicy(run.input.conversationArchitecture).semanticConversationActs
    || denseTurnCompletenessAuditEligibleV5(run.input.userText)
    || !hasWeeklyPlanningEvidenceCoverageTaskModificationV5({
      document: result.document, committedGraph: run.input.committedGraph,
    })) return result;

  const rawResponse = weeklyPlanningSemanticNoOpRetryResponseV5(result);
  if (rawResponse === undefined) return result;
  const afterNoOpAudit = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({
    run, baseMessages: params.baseMessages, initialResponse: rawResponse,
    initialDocument: result.document,
    semanticRepairConsumed: () => weeklyPlanningSemanticRepairConsumedV5(run),
  });
  const selected = afterNoOpAudit ?? result;
  const final = { ...selected, diagnostics: { ...run.diagnostics({
    attemptCount: Math.max(selected.diagnostics.attemptCount, run.responseLengths.length),
    repairAttempted: selected.diagnostics.repairAttempted || weeklyPlanningSemanticRepairConsumedV5(run),
    validationErrors: selected.diagnostics.validationErrors, providerError: selected.diagnostics.providerError,
  }), algorithmicRepairs: selected.diagnostics.algorithmicRepairs } };
  run.recordDecision(final, { route: 'accepted_noop_reread_evidence_coverage_rechecked' });
  return final;
}

export function createWeeklyPlanningSemanticNormalizerV5(
  client: OpenAiCompatibleClient,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const run = new WeeklyPlanningSemanticNormalizerRunV5(client, input);
      // A turn whose planning delta is unusable may still be carried by a valid
      // non-mutating conversation act from the same model response (interaction only:
      // legacy responses carry no acts, so no candidate is ever recorded there).
      const finish = (result: WeeklyPlanningSemanticNormalizerResultV5) => {
        if (weeklyPlanningSemanticRepairConsumedV5(run)
          && (!result.diagnostics.repairAttempted || result.diagnostics.attemptCount < run.responseLengths.length)) {
          result = { ...result, diagnostics: { ...result.diagnostics, repairAttempted: true,
            attemptCount: Math.max(result.diagnostics.attemptCount, run.responseLengths.length) } };
          run.recordDecision(result, { route: 'focused_material_fallthrough_repair_consumed' });
        }
        const enforced = enforceFinalCurrentTurnProvenance({ input, run, result });
        const continued = continueWithConversationActsOnlyV5({ run, result: enforced });
        return continued.status === 'rejected' && run.genericResponses.some(semanticResponseCarriesPlanningContentV5)
          ? { ...continued, planningContentRejected: true as const }
          : continued;
      };

      const contextualResult = input.supplementalContext?.trim()
        ? null
        : await tryFocusedContextualAnswerRouteV5(run);
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
            responseFormat: semanticProviderResponseFormatV5(input.conversationArchitecture),
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
        return finish(result);
      }

      const initialValidation = validateWeeklyPlanningSemanticResponseV5(
        initialResponse,
        {
          currentUserText: input.userText,
          supplementalContext: input.supplementalContext,
          selectedStarterTarget: input.selectedStarterTarget,
          recentConversation: input.recentConversation,
          publicStateSummary: input.publicStateSummary,
          committedGraph: input.committedGraph,
          conversationArchitecture: input.conversationArchitecture,
        },
      );
      run.addAlgorithmicRepairs(initialValidation.algorithmicRepairs);
      run.recordRejectedPlanningConversationActs('initial', initialValidation);
      recordInitialValidation({ input, validation: initialValidation });

      if (initialValidation.document) {
        const denseCompletenessRetry = await tryWeeklyPlanningDenseTurnCompletenessRetryV5({
          run,
          baseMessages,
          initialResponse,
          initialDocument: initialValidation.document,
          semanticRepairConsumed: () => weeklyPlanningSemanticRepairConsumedV5(run),
        });
        if (denseCompletenessRetry) return finish(denseCompletenessRetry);

        const completenessRetry = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({
          run,
          baseMessages,
          initialResponse,
          initialDocument: initialValidation.document,
        });
        if (completenessRetry) {
          return finish(await auditAcceptedNoOpCompletenessRetry({ run, baseMessages, result: completenessRetry }));
        }

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
        afterNoOpCompletenessRetry: result => auditAcceptedNoOpCompletenessRetry({ run, baseMessages, result }),
        // D2: a dangling TEMPORAL replacement the generic repair could not resolve either is read by one focused call.
        recoverRejectedRepair: ({ response, validation }) => tryFocusedTemporalReplacementRecoveryAfterRepairV5({
          run, initialResponse: response, initialValidation: validation,
        }),
      }));
    },
  };
}
