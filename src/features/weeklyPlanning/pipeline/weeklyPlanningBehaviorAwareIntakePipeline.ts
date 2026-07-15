import type {
  WeeklyPlanningIntakePipelineInput,
  WeeklyPlanningIntakePipelineWithInterpreterInput,
} from './weeklyPlanningIntakePipeline';
import {
  hasAllowedDialogueAction,
  runWeeklyPlanningBehaviorAwarePipeline as runCore,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter as runCoreWithInterpreter,
  type WeeklyPlanningBehaviorAwarePipelineOptions,
  type WeeklyPlanningBehaviorAwarePipelineOutput,
} from './weeklyPlanningBehaviorAwareIntakePipelineCore';
import { renderResolvedClarification } from './weeklyPlanningClarificationRendering';
import { applyRenderedQuestionContext } from './weeklyPlanningRenderedQuestionContext';

export { hasAllowedDialogueAction };
export type {
  BehaviorAwareDialoguePlanner,
  WeeklyPlanningBehaviorAwarePipelineOptions,
  WeeklyPlanningBehaviorAwarePipelineOutput,
  WeeklyPlanningLifecycleDiagnostics,
} from './weeklyPlanningBehaviorAwareIntakePipelineCore';

function finalize(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  return applyRenderedQuestionContext(renderResolvedClarification(output));
}

export async function runWeeklyPlanningBehaviorAwarePipeline(
  input: WeeklyPlanningIntakePipelineInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  return finalize(await runCore(input, options));
}

export async function runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
  input: WeeklyPlanningIntakePipelineWithInterpreterInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  return finalize(await runCoreWithInterpreter(input, options));
}
