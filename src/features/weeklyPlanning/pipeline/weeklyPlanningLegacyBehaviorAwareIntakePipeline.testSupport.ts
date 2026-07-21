import { applyRenderedQuestionContext } from './weeklyPlanningRenderedQuestionContext';
import {
  finalizeBehaviorAwareOutput,
  proposalRecords,
  synchronizeProposalRecords,
  withSessionProposalContext,
  type WeeklyPlanningBehaviorAwarePipelineOptions,
  type WeeklyPlanningBehaviorAwarePipelineOutput,
} from './weeklyPlanningBehaviorAwareIntakePipeline';
import { runLegacyWeeklyPlanningIntakePipelineForTests } from './weeklyPlanningLegacyIntakePipeline.testSupport';
import type { WeeklyPlanningIntakePipelineInput } from './weeklyPlanningIntakePipeline';
import {
  prepareWeeklyPlanningTraceOptions,
  recordWeeklyPlanningPipelineTrace,
} from '../trace/weeklyPlanningTraceRuntime';

/** Legacy parser harness. Test-only; never import from production application code. */
export async function runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
  rawInput: WeeklyPlanningIntakePipelineInput,
  rawOptions: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const options = prepareWeeklyPlanningTraceOptions(rawInput, rawOptions);
  const input = withSessionProposalContext(rawInput, options);
  const base = synchronizeProposalRecords(
    runLegacyWeeklyPlanningIntakePipelineForTests(input),
    proposalRecords(input),
  );
  const output = applyRenderedQuestionContext(
    await finalizeBehaviorAwareOutput({ base, input, options }),
  );
  recordWeeklyPlanningPipelineTrace({ input, options, output });
  return output;
}
