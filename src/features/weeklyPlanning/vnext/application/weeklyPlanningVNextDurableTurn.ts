import type { IsolatedWeeklyPlanningTurnInput, IsolatedWeeklyPlanningTurnResult } from '../../application/weeklyPlanningIsolatedTurn';
import { readDurableWeeklyTurnReceipt } from '../../application/weeklyPlanningDurableTurnClient';

/** Common calendar/turn input, with the VNext checkpoint as the only graph authority. */
export interface WeeklyPlanningVNextDurableTurnInput {
  core: 'vnext';
  input: IsolatedWeeklyPlanningTurnInput['input'];
  weekStartDate: string;
  checkpoint: string | null;
  legacyV5Checkpoint: string | null;
}

export interface WeeklyPlanningVNextDurableTurnResult extends IsolatedWeeklyPlanningTurnResult {
  core: 'vnext';
  checkpointBefore: string | null;
  checkpointAfter: string | null;
}

export function readWeeklyPlanningVNextDurableReceipt(ownerId: string) {
  const receipt = readDurableWeeklyTurnReceipt<WeeklyPlanningVNextDurableTurnInput>(ownerId);
  return receipt?.payload.core === 'vnext' ? receipt : null;
}
