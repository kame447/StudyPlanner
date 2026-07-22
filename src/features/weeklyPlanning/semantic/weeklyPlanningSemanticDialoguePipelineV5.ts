import {
  decideWeeklyPlanningStableDialogueV5,
  type WeeklyPlanningStableDialogueDecisionV5,
} from './weeklyPlanningStableDialoguePolicyV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
  type WeeklyPlanningSemanticPipelineInputV5,
  type WeeklyPlanningSemanticPipelineResultV5,
} from './weeklyPlanningSemanticPipelineV5';
import type {
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

export const WEEKLY_PLANNING_SEMANTIC_DIALOGUE_PIPELINE_VERSION_V5 =
  'weekly-planning-semantic-dialogue-pipeline-v5' as const;

export interface WeeklyPlanningSemanticDialoguePipelineResultV5 {
  pipelineVersion: typeof WEEKLY_PLANNING_SEMANTIC_DIALOGUE_PIPELINE_VERSION_V5;
  semantic: WeeklyPlanningSemanticPipelineResultV5;
  dialogue: WeeklyPlanningStableDialogueDecisionV5 | null;
}

export function createWeeklyPlanningSemanticDialoguePipelineV5(
  normalizer: WeeklyPlanningSemanticNormalizerV5,
): {
  run(
    input: WeeklyPlanningSemanticPipelineInputV5,
  ): Promise<WeeklyPlanningSemanticDialoguePipelineResultV5>;
} {
  const semanticPipeline = createWeeklyPlanningSemanticPipelineV5(normalizer);
  return {
    async run(input) {
      const semantic = await semanticPipeline.run(input);
      return {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_DIALOGUE_PIPELINE_VERSION_V5,
        semantic,
        dialogue: semantic.scheduler
          ? decideWeeklyPlanningStableDialogueV5(semantic.scheduler)
          : null,
      };
    },
  };
}
