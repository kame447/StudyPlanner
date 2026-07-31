import type {
  ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';
import {
  applyWeeklyPlanningCanonicalCorrectionsV5,
} from './weeklyPlanningCanonicalCorrectionApplicationV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactDiffEntryV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputCompilationResult,
  type GenericSchedulerInputContext,
} from './weeklyPlanningGenericSchedulerInput';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  applyWeeklyPlanningStableV5ContextualAnswer,
} from './weeklyPlanningStableV5ContextualAnswer';
import {
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';
import {
  recordWeeklyPlanningStableV5FailureDiagnostics,
} from './weeklyPlanningStableV5FailureDiagnostics';
import type {
  WeeklyPlanningSemanticNormalizerInputV5,
  WeeklyPlanningSemanticNormalizerResultV5,
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';

export const WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5 =
  'weekly-planning-semantic-pipeline-v5' as const;

export interface WeeklyPlanningSemanticPipelineInputV5
  extends WeeklyPlanningSemanticNormalizerInputV5 {
  conversationId: string;
  turnId: string;
  expectedRevision: number;
  graph?: WeeklyPlanningFactGraphV5;
  schedulerContext: GenericSchedulerInputContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}

export type WeeklyPlanningSemanticPipelineStatusV5 =
  | 'normalization_rejected'
  | 'provider_failure'
  | 'canonicalization_rejected'
  | 'duplicate_turn'
  | 'scheduler_needs_resolution'
  | 'scheduler_empty'
  | 'scheduler_ready';

export interface WeeklyPlanningSemanticPipelineResultV5 {
  pipelineVersion: typeof WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5;
  status: WeeklyPlanningSemanticPipelineStatusV5;
  graph: WeeklyPlanningFactGraphV5;
  normalization: WeeklyPlanningSemanticNormalizerResultV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5 | null;
  scheduler: GenericSchedulerInputCompilationResult | null;
}

function schedulerStatus(
  compilation: GenericSchedulerInputCompilationResult,
): WeeklyPlanningSemanticPipelineStatusV5 {
  if (compilation.status === 'ready') return 'scheduler_ready';
  if (compilation.status === 'empty') return 'scheduler_empty';
  return 'scheduler_needs_resolution';
}

function uniqueDiffEntries(
  entries: readonly WeeklyPlanningFactDiffEntryV5[],
): WeeklyPlanningFactDiffEntryV5[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyCanonicalCorrectionResult(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): {
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  application: ReturnType<typeof applyWeeklyPlanningCanonicalCorrectionsV5>;
} {
  const application = applyWeeklyPlanningCanonicalCorrectionsV5(params);
  if (application.status === 'rejected') {
    return {
      application,
      canonicalization: {
        status: 'rejected',
        graph: params.originalGraph,
        diff: null,
        errors: application.errors.map((error) => `correction-application:${error}`),
        localToFactId: params.canonicalization.localToFactId,
      },
    };
  }
  if (application.status !== 'applied' || !params.canonicalization.diff) {
    return { application, canonicalization: params.canonicalization };
  }
  return {
    application,
    canonicalization: {
      ...params.canonicalization,
      graph: application.graph,
      diff: {
        ...params.canonicalization.diff,
        toRevision: application.graph.revision,
        superseded: uniqueDiffEntries([
          ...params.canonicalization.diff.superseded,
          ...application.superseded,
        ]),
        removed: uniqueDiffEntries([
          ...params.canonicalization.diff.removed,
          ...application.removed,
        ]),
      },
    },
  };
}

function contextualBindingObservations(params: {
  graph: WeeklyPlanningFactGraphV5;
  normalization: WeeklyPlanningSemanticNormalizerResultV5;
  expectedRevision: number;
  userText: string;
  pendingQuestion: ReturnType<typeof readWeeklyPlanningPendingQuestionV5>;
}) {
  const document = params.normalization.document;
  const normalizedUserText = params.userText
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。！？!?]+$/g, '');
  const wholeTurnTaskSourceMatch = document?.tasks.some((task) =>
    task.sourceText
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[。！？!?]+$/g, '') === normalizedUserText) ?? false;
  return {
    criteriaVersion: 'weeklyPlanningStableV5ContextualAnswer:machinePendingQuestion',
    observations: {
      pendingQuestion: params.pendingQuestion,
      pendingQuestionExists: Boolean(params.pendingQuestion),
      pendingQuestionRevisionMatches:
        params.pendingQuestion?.graphRevision === params.graph.revision,
      pendingQuestionTargetExists: Boolean(
        params.pendingQuestion?.targetFactId
        && params.graph.workloads.some(
          (workload) => workload.id === params.pendingQuestion?.targetFactId,
        ),
      ),
      userTextLength: params.userText.trim().length,
      userTextLengthAtMost40: params.userText.trim().length > 0
        && params.userText.trim().length <= 40,
      wholeTurnTaskSourceMatch,
      expectedRevision: params.expectedRevision,
      graphRevision: params.graph.revision,
      revisionMatches: params.expectedRevision === params.graph.revision,
      planningIntent: document?.planningIntent ?? null,
      planningIntentIsNotCreatePlan: document?.planningIntent !== 'create_plan',
      planningWindowIsNull: document?.planningWindow === null,
      taskCount: document?.tasks.length ?? 0,
      relationCount: document?.relations.length ?? 0,
      availabilityDeclarationCount: document?.availabilityDeclarations.length ?? 0,
      constraintSourceRequestCount: document?.constraintSourceRequests.length ?? 0,
      uncertaintyCount: document?.uncertainties.length ?? 0,
      correctionCount: document?.corrections.length ?? 0,
      decisionCount: document?.decisions.length ?? 0,
    },
  };
}

export function createWeeklyPlanningSemanticPipelineV5(
  normalizer: WeeklyPlanningSemanticNormalizerV5,
): {
  run(
    input: WeeklyPlanningSemanticPipelineInputV5,
  ): Promise<WeeklyPlanningSemanticPipelineResultV5>;
} {
  return {
    async run(input) {
      const graph = input.graph ?? createEmptyWeeklyPlanningFactGraphV5();
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'semantic_pipeline_input',
        data: {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          conversationId: input.conversationId,
          turnId: input.turnId,
          expectedRevision: input.expectedRevision,
          graph,
          userText: input.userText,
          recentConversation: input.recentConversation,
          publicStateSummary: input.publicStateSummary,
          schedulerContext: input.schedulerContext,
          externalSources: input.externalSources,
        },
      });

      const normalization = await normalizer.normalize({
        userText: input.userText,
        recentConversation: input.recentConversation,
        publicStateSummary: input.publicStateSummary,
        traceRequestId: input.turnId,
      });
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'semantic_normalization_completed',
        severity: normalization.status === 'accepted' ? 'info' : 'error',
        data: normalization,
      });

      if (normalization.status === 'provider_failure') {
        recordWeeklyPlanningStableV5FailureDiagnostics({
          turnId: input.turnId,
          status: 'provider_failure',
          diagnostics: normalization.diagnostics,
        });
        const result: WeeklyPlanningSemanticPipelineResultV5 = {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'provider_failure',
          graph,
          normalization,
          canonicalization: null,
          scheduler: null,
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.turnId,
          stage: 'semantic_pipeline_decision',
          severity: 'error',
          data: {
            selectedStatus: result.status,
            basis: 'normalization.status === provider_failure',
            result,
          },
        });
        return result;
      }
      if (!normalization.document) {
        recordWeeklyPlanningStableV5FailureDiagnostics({
          turnId: input.turnId,
          status: 'normalization_rejected',
          diagnostics: normalization.diagnostics,
        });
        const result: WeeklyPlanningSemanticPipelineResultV5 = {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'normalization_rejected',
          graph,
          normalization,
          canonicalization: null,
          scheduler: null,
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.turnId,
          stage: 'semantic_pipeline_decision',
          severity: 'error',
          data: {
            selectedStatus: result.status,
            basis: 'normalization.document is null',
            result,
          },
        });
        return result;
      }

      const pendingQuestion = readWeeklyPlanningPendingQuestionV5(
        input.publicStateSummary,
      );
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'pending_question_resolved',
        data: {
          source: 'publicStateSummary.pendingQuestion',
          pendingQuestion,
          rendererTextInspected: false,
        },
      });

      const bindingObservations = contextualBindingObservations({
        graph,
        normalization,
        expectedRevision: input.expectedRevision,
        userText: input.userText,
        pendingQuestion,
      });
      const contextualAnswer = pendingQuestion
        ? applyWeeklyPlanningStableV5ContextualAnswer({
            graph,
            document: normalization.document,
            pendingQuestion,
            conversationId: input.conversationId,
            turnId: input.turnId,
            expectedRevision: input.expectedRevision,
            userText: input.userText,
          })
        : null;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'contextual_answer_binding_evaluated',
        data: {
          ...bindingObservations,
          contextualAnswerApplied: Boolean(contextualAnswer),
          contextualAnswerResult: contextualAnswer,
        },
      });

      const canonicalizationContext = {
        conversationId: input.conversationId,
        turnId: input.turnId,
        expectedRevision: input.expectedRevision,
      };
      const baseCanonicalization = contextualAnswer
        ?? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
          graph,
          document: normalization.document,
          context: canonicalizationContext,
        });
      const correctionResult = applyCanonicalCorrectionResult({
        originalGraph: graph,
        canonicalization: baseCanonicalization,
        operationKeyPrefix: `${input.conversationId}:${input.turnId}`,
      });
      const canonicalization = correctionResult.canonicalization;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'canonical_correction_application_evaluated',
        severity: correctionResult.application.status === 'rejected' ? 'error' : 'info',
        data: {
          inputCanonicalization: baseCanonicalization,
          application: correctionResult.application,
          resultingCanonicalization: canonicalization,
        },
      });
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'semantic_canonicalization_evaluated',
        severity: canonicalization.status === 'rejected' ? 'error' : 'info',
        data: {
          branch: contextualAnswer ? 'contextual_answer_binding' : 'semantic_canonicalizer',
          input: {
            graph,
            document: normalization.document,
            context: canonicalizationContext,
            pendingQuestion,
          },
          result: canonicalization,
          adoptedOperations: canonicalization.diff,
          localReferenceResolution: canonicalization.localToFactId,
          rejectionErrors: canonicalization.errors,
        },
      });
      if (canonicalization.status === 'rejected') {
        recordWeeklyPlanningStableV5FailureDiagnostics({
          turnId: input.turnId,
          status: 'canonicalization_rejected',
          diagnostics: normalization.diagnostics,
        });
        const result: WeeklyPlanningSemanticPipelineResultV5 = {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'canonicalization_rejected',
          graph,
          normalization,
          canonicalization,
          scheduler: null,
        };
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.turnId,
          stage: 'semantic_pipeline_decision',
          severity: 'error',
          data: {
            selectedStatus: result.status,
            basis: 'canonicalization.status === rejected',
            result,
          },
        });
        return result;
      }

      const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(canonicalization.graph);
      const scheduler = compileGenericSchedulerInput({
        graph: activeGraph,
        context: input.schedulerContext,
        externalSources: input.externalSources,
      });
      const status = canonicalization.status === 'duplicate'
        ? 'duplicate_turn'
        : schedulerStatus(scheduler);
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'scheduler_compilation_evaluated',
        severity: scheduler.status === 'ready' ? 'info' : 'warn',
        data: {
          input: {
            graph: activeGraph,
            context: input.schedulerContext,
            externalSources: input.externalSources,
          },
          result: scheduler,
          selectedPipelineStatus: status,
          statusBasis: canonicalization.status === 'duplicate'
            ? 'canonicalization.status === duplicate'
            : `scheduler.status === ${scheduler.status}`,
        },
      });
      const result: WeeklyPlanningSemanticPipelineResultV5 = {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
        status,
        graph: canonicalization.graph,
        normalization,
        canonicalization,
        scheduler,
      };
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'semantic_pipeline_decision',
        data: {
          selectedStatus: result.status,
          result,
        },
      });
      return result;
    },
  };
}
