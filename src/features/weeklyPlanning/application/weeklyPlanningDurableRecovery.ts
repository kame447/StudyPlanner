import type { PlanningState } from '../types';
import { cancelDurableWeeklyTurn, clearDurableWeeklyTurnReceipt,
  type DurableWeeklyTurnPayload, type DurableWeeklyTurnReceipt } from './weeklyPlanningDurableTurnClient';
import type { IsolatedWeeklyPlanningTurnInput } from './weeklyPlanningIsolatedTurn';

/** The original request, rebuilt from a saved receipt. The caller adds only its own session and state ports. */
export function durableReceiptTurnParams(receipt: DurableWeeklyTurnReceipt<{ input: IsolatedWeeklyPlanningTurnInput['input'] }>) {
  const original = receipt.payload.input;
  return {
    userText: original.userText, supplementalContext: original.supplementalContext,
    selectedStarterTarget: original.selectedStarterTarget,
    ...(original.machineBoundAnswer ? { machineBoundAnswer: original.machineBoundAnswer } : {}),
    selectedDate: original.selectedDate,
    plans: original.plans, monthEvents: original.monthEvents, actuals: original.actuals,
    studyMaterials: original.studyMaterials, scheduleTemplates: original.scheduleTemplates,
    timetableTermId: original.timetableTermId, timetableTerm: original.timetableTerm, timetableTerms: original.timetableTerms,
    weekStartsOn: original.requestContext.weekStartsOn, timeZone: original.requestContext.timeZone,
    resumePending: receipt.pending,
  };
}

/**
 * One recovery step for the saved durable receipt, shared by every conversation core: finish an
 * unacknowledged cancellation, retire a receipt whose newer state is already persisted, or resume the
 * very same request read-only. A newer persisted state always owns the conversation, so an old reply
 * is never applied twice. The caller supplies its core's receipt, saved revision and resubmission.
 */
export function recoverDurableWeeklyTurn<Payload extends DurableWeeklyTurnPayload>(params: {
  ownerId: string;
  conversationId: string | undefined;
  state: PlanningState;
  recovering: { current: string | null };
  plannerDataReady: boolean;
  receipt: DurableWeeklyTurnReceipt<Payload> | null;
  /** Revision persisted for the receipt's conversation, once the live state has moved past the request. */
  persistedRevision(): number | undefined;
  chatSaved(): boolean;
  resubmit(receipt: DurableWeeklyTurnReceipt<Payload>): Promise<unknown>;
}): void {
  const { receipt, state, recovering } = params;
  if (!params.conversationId || !receipt || receipt.pending.conversationId !== params.conversationId) return;
  const requestId = receipt.pending.requestId;
  if (state.pendingTurn || state.pendingApproval || recovering.current === requestId) return;
  const release = () => { if (recovering.current === requestId) recovering.current = null; };
  if (receipt.cancelRequested) {
    recovering.current = requestId;
    void cancelDurableWeeklyTurn(params.ownerId, requestId).finally(release);
    return;
  }
  if (state.revision > receipt.pending.baseRevision) {
    const saved = params.persistedRevision();
    if (saved !== undefined && saved >= receipt.pending.baseRevision + 2 && params.chatSaved()) {
      clearDurableWeeklyTurnReceipt(params.ownerId, requestId);
    }
    return;
  }
  if (state.revision !== receipt.pending.baseRevision || state.weekStartDate !== receipt.pending.weekStartDate
    || JSON.stringify(state.intakeState) !== JSON.stringify(receipt.snapshot.intakeState)
    || !params.plannerDataReady) return;
  recovering.current = requestId;
  void params.resubmit(receipt).catch(() => undefined).finally(release);
}
