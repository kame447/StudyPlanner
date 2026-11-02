import { sameAiPlanningModuleRecoveryBinding, type AiPlanningModuleRecoveryBinding } from '../chat/aiPlanningModuleRecovery';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutionTypes';

export type WeeklyPlanningTurnPreparationResult =
  | { ready: true }
  | { ready: false; reason: 'planner-data-changed' | 'request-changed' };

export interface WeeklyPlanningApplicationSubmissionResult extends WeeklyPlanningTurnSubmissionResult {
  rejectionReason?: 'planner-data-changed';
}

/** What a conversation core supplies; the sequence itself belongs to neither core. */
export interface WeeklyPlanningTurnPreparationPorts {
  /** The planner data captured with this render's request is still the current authority. */
  isPlannerDataCurrent(): boolean;
  /** The conversation this turn would extend, or null while it cannot accept a turn. */
  binding(): AiPlanningModuleRecoveryBinding | null;
  /** This render's request input is the one the UI last committed. */
  isRequestCurrent(): boolean;
  /** Identities of the live conversation state and chat index, compared before and after the preflight. */
  stateIdentity(): unknown;
  indexIdentity(): unknown;
  /** Loads the core's lazy runtime. A failure rejects here, before any OCR or provider call. */
  preflight(): Promise<unknown>;
}

/**
 * The single preparation sequence of a weekly-planning turn. Order matters: stale planner data is reported
 * as such before and after the preflight (the UI then asks to review updated data); the lazy runtime is
 * loaded before anything that costs money (image OCR, provider calls); and nothing may have changed
 * under the turn while the preflight awaited.
 */
export async function prepareWeeklyPlanningTurn(ports: WeeklyPlanningTurnPreparationPorts): Promise<WeeklyPlanningTurnPreparationResult> {
  if (!ports.isPlannerDataCurrent()) return { ready: false, reason: 'planner-data-changed' };
  const binding = ports.binding();
  if (!binding || !ports.isRequestCurrent()) return { ready: false, reason: 'request-changed' };
  const stateAtStart = ports.stateIdentity();
  const indexAtStart = ports.indexIdentity();
  await ports.preflight();
  if (!ports.isPlannerDataCurrent()) return { ready: false, reason: 'planner-data-changed' };
  return stateAtStart === ports.stateIdentity() && indexAtStart === ports.indexIdentity()
    && ports.isRequestCurrent() && sameAiPlanningModuleRecoveryBinding(binding, ports.binding())
    ? { ready: true } : { ready: false, reason: 'request-changed' };
}

/** What a submit captured before it awaited the preparation. */
export interface WeeklyPlanningTurnStart {
  state: unknown;
  index: unknown;
  binding: AiPlanningModuleRecoveryBinding | null;
}

/**
 * Admission after the preparation resolved. The bound planner-data lease is re-read here (not the latest
 * render's readiness), and a turn whose conversation, chat or request moved while it awaited is not accepted.
 */
export function admitPreparedWeeklyPlanningTurn(params: {
  preparation: WeeklyPlanningTurnPreparationResult;
  start: WeeklyPlanningTurnStart;
  ports: Pick<WeeklyPlanningTurnPreparationPorts, 'isPlannerDataCurrent' | 'binding' | 'isRequestCurrent' | 'stateIdentity' | 'indexIdentity'>;
}): { admitted: true } | { admitted: false; result: WeeklyPlanningApplicationSubmissionResult } {
  const { preparation, start, ports } = params;
  if (!ports.isPlannerDataCurrent() || (!preparation.ready && preparation.reason === 'planner-data-changed')) {
    return { admitted: false, result: { accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed' } };
  }
  if (!preparation.ready || !ports.isRequestCurrent()
    || start.state !== ports.stateIdentity() || start.index !== ports.indexIdentity()
    || !sameAiPlanningModuleRecoveryBinding(start.binding, ports.binding())) {
    return { admitted: false, result: { accepted: false, draftCandidates: [] } };
  }
  return { admitted: true };
}
