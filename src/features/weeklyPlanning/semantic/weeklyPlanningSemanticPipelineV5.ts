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
  applyWeeklyPlanningExistingEntityBindingsV5,
} from './weeklyPlanningExistingEntityBindingApplicationV5';
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

export const WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5 = {
  version: 'weekly-planning-correction-targeting-contract-v5',
  targetIdentity: 'For an explicit correction of an accepted public fact, set correction.target.publicId to the exact publicId from publicStateSummary and set correction.target.kind to the matching fact kind.',
  replacementIdentity: 'Create only the replacement fact stated by the user in the current semantic document and set correction.replacementLocalId to that fact localId.',
  minimalDelta: 'Do not copy unrelated accepted facts from publicStateSummary. Include only facts newly stated or changed in the current utterance.',
  multipleTargets: 'For multiple explicit corrections, emit one correction per exact target and do not exchange targets between tasks.',
  ambiguity: 'When the corrected target cannot be identified uniquely from publicStateSummary, do not guess a publicId. Emit an uncertainty describing the unresolved correction target.',
} as const;

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

export function shouldApplyWeeklyPlanningExistingEntityBindingsV5(params: { contextualAnswer: boolean; questionCode: string | null }): boolean {
  return !params.contextualAnswer || params.questionCode === 'semantic_uncertainty';
}

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

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function correctionTargetPublicFacts(
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> {
  const activeIds = activeFactIds(graph);
  return {
    planningWindows: graph.planningWindows
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        kind: fact.kind,
        value: fact.value,
        start: fact.start,
        end: fact.end,
      })),
    tasks: graph.tasks
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        category: fact.category,
        title: fact.title,
      })),
    components: graph.components
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        parentComponentPublicId: fact.parentComponentId,
        role: fact.role,
        label: fact.label,
      })),
    workloads: graph.workloads
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        componentPublicId: fact.componentId,
        quantityRole: fact.quantityRole,
        amount: fact.amount,
        unitCode: fact.unitCode,
        unitLabel: fact.unitLabel,
      })),
    effortEstimates: graph.effortEstimates
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        minutes: fact.minutes,
        unitCode: fact.unitCode,
        precision: fact.precision,
      })),
    temporalConstraints: graph.temporalConstraints
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        constraintLevel: fact.constraintLevel,
        dateExpression: fact.dateExpression,
        namedTimePeriod: fact.namedTimePeriod,
        startTime: fact.startTime,
        endTime: fact.endTime,
      })),
    recurrences: graph.recurrences
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        publicId: fact.id,
        taskPublicId: fact.taskId,
        targetPublicId: fact.targetFactId,
        kind: fact.kind,
        count: fact.count,
        days: fact.days,
      })),
  };
}

function normalizerPublicStateSummary(
  summary: Record<string, unknown> | undefined,
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> {
  return {
    ...(summary ?? {}),
    ...correctionTargetPublicFacts(graph),
    graphRevision: graph.revision,
    correctionContract: WEEKLY_PLANNING_CORRECTION_TARGETING_CONTRACT_V5,
  };
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
      const publicStateSummary = normalizerPublicStateSummary(
        input.publicStateSummary,
        graph,
      );
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
          publicStateSummary,
          schedulerContext: input.schedulerContext,
          externalSources: input.externalSources,
        },
      });

      const normalization = await normalizer.normalize({
        userText: input.userText,
        recentConversation: input.recentConversation,
        publicStateSummary,
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

      const pendingQuestion = readWeeklyPlanningPendingQuestionV5(publicStateSummary);
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
      const entityBindingApplication = shouldApplyWeeklyPlanningExistingEntityBindingsV5({
        contextualAnswer: Boolean(contextualAnswer),
        questionCode: pendingQuestion?.questionCode ?? null,
      })
        ? applyWeeklyPlanningExistingEntityBindingsV5({
            originalGraph: graph,
            document: normalization.document,
            canonicalization: baseCanonicalization,
          })
        : {
            version: 'weekly-planning-existing-entity-binding-application-v5' as const,
            status: 'not_applicable' as const,
            canonicalization: baseCanonicalization,
            errors: [],
          };
      const boundCanonicalization = entityBindingApplication.canonicalization;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'existing_entity_binding_application_evaluated',
        severity: entityBindingApplication.status === 'rejected' ? 'error' : 'info',
        data: entityBindingApplication,
      });
      const correctionResult = applyCanonicalCorrectionResult({
        originalGraph: graph,
        canonicalization: boundCanonicalization,
        operationKeyPrefix: `${input.conversationId}:${input.turnId}`,
      });
      const canonicalization = correctionResult.canonicalization;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'canonical_correction_application_evaluated',
        severity: correctionResult.application.status === 'rejected' ? 'error' : 'info',
        data: {
          inputCanonicalization: boundCanonicalization,
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
