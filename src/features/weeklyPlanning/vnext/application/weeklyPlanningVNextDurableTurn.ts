import type { VNextConfirmedUserContext } from '../weeklyPlanningVNextConfirmedUserContext';
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
  /** Confirmed memory fixed for this turn (bounded; see the pure module). It lives only in this execution payload, so the existing 24-hour receipt and job retention erase it. */
  confirmedUserContext?: VNextConfirmedUserContext;
}

export interface WeeklyPlanningVNextDurableTurnResult extends IsolatedWeeklyPlanningTurnResult {
  core: 'vnext';
  checkpointBefore: string | null;
  checkpointAfter: string | null;
}
