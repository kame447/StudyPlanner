import { createWeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import type { WeeklyPlanningIntakePipelineOutput } from './weeklyPlanningIntakePipelineCore';

export function rebuildWeeklyPlanningDialogueDecision(
  output: WeeklyPlanningIntakePipelineOutput,
) {
  return createWeeklyPlanningDialogueDecision({
    state: output.state,
    draftRequest: output.draftRequest,
    remainingWorkItems: output.remainingWorkItems,
    dryRunCandidates: output.draftCandidates,
    dryRunDiagnostics: output.diagnostics,
    assumedDraft: output.assumedDraft,
  });
}
