import type { WeeklyPlanningConsultationCommunication } from '../application/weeklyPlanningConsultationCommunication';
import type { WeeklyPlanningInteractionOutcome } from '../application/weeklyPlanningInteractionOutcome';
import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningStableV5CommunicationContext } from './weeklyPlanningStableV5DialogueContracts';

/** Read-only presentation evidence. A what-if never replaces or approves the current preview. */
export function retainedPreviewCommunicationForStableV5Dialogue(params: {
  preview: WeeklyPlanningTurnExecutionInput['currentPreview'];
  outcome: WeeklyPlanningInteractionOutcome | undefined;
  consultation: WeeklyPlanningConsultationCommunication | null | undefined;
}): Pick<WeeklyPlanningStableV5CommunicationContext, 'retainedPreviewUnchanged' | 'alternativeRequiresAdoption'> {
  const preview = params.preview;
  if (!preview || preview.candidateCount <= 0) return {};
  const retainedPreviewUnchanged = params.outcome?.kind === 'recover' && params.outcome.failure === 'semantic';
  const alternative = params.consultation?.assessmentScope === 'proposed_days' ? params.consultation.alternative : undefined;
  const movableTasks = new Set(params.consultation?.workEstimates.map(item => item.taskId) ?? []);
  const selectedTasks = new Set((alternative?.taskIds ?? []).filter(taskId => movableTasks.size === 0 || movableTasks.has(taskId)));
  const dates = new Set(alternative?.dates ?? []);
  const selectedPlacements = preview.placements.filter(placement => selectedTasks.has(placement.taskId));
  const placedTasks = new Set(selectedPlacements.map(placement => placement.taskId));
  const alternativeRequiresAdoption = Boolean(alternative && dates.size > 0 && (
    // Missing placement provenance cannot prove that the displayed preview matches the trial.
    preview.placements.length < preview.candidateCount
    || [...selectedTasks].some(taskId => !placedTasks.has(taskId))
    || selectedPlacements.some(placement => !dates.has(placement.date))
  ));
  return {
    ...(retainedPreviewUnchanged ? { retainedPreviewUnchanged: true } : {}),
    ...(alternativeRequiresAdoption ? { alternativeRequiresAdoption: true } : {}),
  };
}
