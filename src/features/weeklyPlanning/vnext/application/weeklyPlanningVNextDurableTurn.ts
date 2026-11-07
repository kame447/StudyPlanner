import type { IsolatedWeeklyPlanningTurnInput, IsolatedWeeklyPlanningTurnResult } from '../../application/weeklyPlanningIsolatedTurn';

/** Pure wire types shared with the Worker; the browser receipt reader lives in the gateway. */
/** Common calendar/turn input, with the VNext checkpoint as the only graph authority. */
export interface WeeklyPlanningVNextDurableTurnInput {
  core: 'vnext';
  input: IsolatedWeeklyPlanningTurnInput['input'];
  weekStartDate: string;
  checkpoint: string | null;
  legacyV5Checkpoint: string | null;
  /** Pages checked the current preview against its approval operations. Old payloads retain it. */
  allowUnapprovedPreviewReplan?: boolean;
}

export interface WeeklyPlanningVNextDurableTurnResult extends IsolatedWeeklyPlanningTurnResult {
  core: 'vnext';
  checkpointBefore: string | null;
  checkpointAfter: string | null;
}
