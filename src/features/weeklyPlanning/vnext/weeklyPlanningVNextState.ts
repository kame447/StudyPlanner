import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningVNextV5Boundary';
import { WEEKLY_PLANNING_VNEXT_STATE_VERSION, type WeeklyPlanningVNextState } from './weeklyPlanningVNextTypes';

// Checkpoint reads need an empty state before the turn runtime is loaded. Keep construction
// independent of the transaction writer so reading a session does not load turn execution.
export function createEmptyWeeklyPlanningVNextState(): WeeklyPlanningVNextState {
  return { version: WEEKLY_PLANNING_VNEXT_STATE_VERSION,
    graph: { ...createEmptyWeeklyPlanningFactGraphV5(), effortEstimates: [], studyContexts: [] },
    workRelations: [], deferrals: [], learningStrategyProposalRecords: [], draftGenerationIntent: 'not_requested', optionalInvitationClosed: false };
}
