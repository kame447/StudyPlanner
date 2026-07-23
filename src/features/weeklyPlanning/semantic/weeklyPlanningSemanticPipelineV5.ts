import type {
  ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';
import {
  createEmptyWeeklyPlanningFactGraphV5,
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
  inferWeeklyPlanningStableV5ContextualQuestionCode,
} from './weeklyPlanningStableV5ContextualAnswer';
import type {
  WeeklyPlanningSemanticNormalizerInputV5,
  WeeklyPlanningSemanticNormalizerResultV5,
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

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
      const normalization = await normalizer.normalize({
        userText: input.userText,
        recentConversation: input.recentConversation,
        publicStateSummary: input.publicStateSummary,
      });

      if (normalization.status === 'provider_failure') {
        return {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'provider_failure',
          graph,
          normalization,
          canonicalization: null,
          scheduler: null,
        };
      }
      if (!normalization.document) {
        return {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'normalization_rejected',
          graph,
          normalization,
          canonicalization: null,
          scheduler: null,
        };
      }

      const contextualQuestionCode = inferWeeklyPlanningStableV5ContextualQuestionCode(
        input.publicStateSummary,
      );
      const contextualAnswer = contextualQuestionCode
        ? applyWeeklyPlanningStableV5ContextualAnswer({
            graph,
            document: normalization.document,
            questionCode: contextualQuestionCode,
            conversationId: input.conversationId,
            turnId: input.turnId,
            expectedRevision: input.expectedRevision,
            userText: input.userText,
          })
        : null;
      const canonicalization = contextualAnswer
        ?? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
          graph,
          document: normalization.document,
          context: {
            conversationId: input.conversationId,
            turnId: input.turnId,
            expectedRevision: input.expectedRevision,
          },
        });
      if (canonicalization.status === 'rejected') {
        return {
          pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
          status: 'canonicalization_rejected',
          graph,
          normalization,
          canonicalization,
          scheduler: null,
        };
      }

      const scheduler = compileGenericSchedulerInput({
        graph: createWeeklyPlanningActiveSchedulerGraphViewV5(canonicalization.graph),
        context: input.schedulerContext,
        externalSources: input.externalSources,
      });
      return {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
        status: canonicalization.status === 'duplicate'
          ? 'duplicate_turn'
          : schedulerStatus(scheduler),
        graph: canonicalization.graph,
        normalization,
        canonicalization,
        scheduler,
      };
    },
  };
}
