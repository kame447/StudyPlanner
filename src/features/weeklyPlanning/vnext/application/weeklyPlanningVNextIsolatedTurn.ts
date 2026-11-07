import { addCalendarDays } from '../../semantic/weeklyPlanningCalendarResolver';
import { createInitialPlanningIntakeState } from '../weeklyPlanningVNextV5Boundary';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { captureWeeklyPlanningVNextTurnDiagnostics } from './weeklyPlanningVNextTurnDiagnostics';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from './weeklyPlanningVNextDurableTurn';

/** Invocation-local execution, shared by browser and the existing durable job. Only the caller
 * publishes the returned checkpoint. No React, browser storage, approval or Plan writes occur here.
 */
export async function executeIsolatedWeeklyPlanningVNextTurn(
  payload: WeeklyPlanningVNextDurableTurnInput,
  provider: Pick<WeeklyPlanningVNextExperimentalPorts, 'client' | 'interpret' | 'createRenderer'>,
): Promise<WeeklyPlanningVNextDurableTurnResult> {
  const input = payload.input;
  const clock = input.requestContext;
  const planningEndDate = addCalendarDays(payload.weekStartDate, 6);
  if (!planningEndDate || !input.conversationId || !input.traceRequestId) throw new Error('Invalid isolated VNext turn identity.');
  const before = payload.checkpoint;
  let after = before;
  const read = before === null ? null : parseWeeklyPlanningVNextSessionCheckpoint({ raw: before,
    ownerId: input.userId, weekStartDate: payload.weekStartDate });
  const unavailable = () => { throw new Error('Approval and saving belong to the existing application.'); };
  const diagnostic = captureWeeklyPlanningVNextTurnDiagnostics(input.traceRequestId, {
    ...provider, checkpoint: { read: () => after, write: raw => { after = raw; } },
    legacyV5Checkpoint: { read: () => payload.legacyV5Checkpoint },
    approvalLedger: { read: () => null, write: unavailable },
    allowUnapprovedPreviewReplan: payload.allowUnapprovedPreviewReplan === true,
    plans: { findExistingPlanId: async () => undefined, saveBlock: unavailable },
    calendar: () => ({ plans: input.plans, actuals: input.actuals ?? [], monthEvents: input.monthEvents ?? [],
      scheduleTemplates: input.scheduleTemplates, timetableTermId: input.timetableTermId }),
    // Replaying a journal must not change acceptance/placement time or checkpoint bytes.
    now: () => clock.startedAtIso,
  });
  const turn = await submitWeeklyPlanningVNextExperimentalTurn({
    scope: { ownerId: input.userId, weekStartDate: payload.weekStartDate,
      conversationId: input.conversationId, notBeforeTime: clock.notBeforeTime,
      clock: { currentDate: clock.currentDate, weekStartsOn: clock.weekStartsOn, timeZone: clock.timeZone,
        planningStartDate: payload.weekStartDate, planningEndDate } },
    ports: diagnostic.ports, turnId: input.traceRequestId, userText: input.userText,
    supplementalContext: input.supplementalContext,
    selectedStarterTarget: input.selectedStarterTarget,
    confirmedUserContext: payload.confirmedUserContext,
    shownRevision: read?.vnext.presentedQuestion?.graphRevision ?? null,
  });
  const intake = input.previousState ?? createInitialPlanningIntakeState();
  return { core: 'vnext', checkpointBefore: before, checkpointAfter: after,
    result: { state: turn.authorizationRequired ? { ...intake, status: 'needs_scope' } : intake,
      message: turn.reply, draftCandidates: turn.draftCandidates ?? [],
      preserveExistingPreview: Boolean(turn.preview && !turn.draftCandidates?.length), ...diagnostic.finish(turn) },
    stagedContextFacts: [], observedDate: clock.currentDate };
}
