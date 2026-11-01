import type { WeeklyPlanningTurnRuntimeGateway, ExecuteWeeklyPlanningTurnRuntimeParams } from '../../application/weeklyPlanningTurnRuntimeGateway';
import type { WeeklyPlanningTurnStagingLifecycle } from '../../application/weeklyPlanningTurnSideEffects';
import { createWeeklyPlanningTurnRequestContext } from '../../application/weeklyPlanningTemporalContext';
import { durableWeeklyPlanningEnabled, executeDurableWeeklyTurn, saveDurableWeeklyTurnReceipt } from '../../application/weeklyPlanningDurableTurnClient';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import type { WeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { executeIsolatedWeeklyPlanningVNextTurn } from './weeklyPlanningVNextIsolatedTurn';
import { readWeeklyPlanningVNextDurableReceipt, type WeeklyPlanningVNextDurableTurnInput,
  type WeeklyPlanningVNextDurableTurnResult } from './weeklyPlanningVNextDurableTurn';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';

/** The existing controller owns admission and publication. Stage the session's single checkpoint
 * write until that controller prepares commit; cancellation/discard writes nothing. Rollback uses
 * the same receipt discipline as V5's staging lifecycle. LocalRuntime tests exercise both paths.
 */
export function createWeeklyPlanningVNextRuntimeGateway(params: {
  session: WeeklyPlanningVNextLocalSession;
  ports(input: ExecuteWeeklyPlanningTurnRuntimeParams): WeeklyPlanningVNextExperimentalPorts;
}): { runtimeGateway: WeeklyPlanningTurnRuntimeGateway; stagingLifecycle: WeeklyPlanningTurnStagingLifecycle } {
  const stages = new Map<string, { before: string | null; after: string }>();
  return {
    runtimeGateway: { async execute(input) {
      const ports = params.ports(input);
      const before = params.session.checkpoint.read();
      const clock = createWeeklyPlanningTurnRequestContext({ startedAtIso: input.pending.startedAt,
        timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Tokyo',
        weekStartsOn: input.weekStartsOn ?? 'monday' });
      const payload: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', checkpoint: before,
        legacyV5Checkpoint: params.session.legacyV5Checkpoint.read(), weekStartDate: input.snapshot.weekStartDate,
        input: { previousState: input.snapshot.intakeState, messages: input.snapshot.messages,
          userText: input.userText, supplementalContext: input.supplementalContext, selectedStarterTarget: input.selectedStarterTarget,
          selectedDate: input.selectedDate, userId: input.userId, plans: input.plans, actuals: input.actuals,
          monthEvents: input.monthEvents, studyMaterials: input.studyMaterials, scheduleTemplates: input.scheduleTemplates,
          timetableTermId: input.timetableTermId, timetableTerm: input.timetableTerm, timetableTerms: input.timetableTerms,
          conversationId: input.pending.conversationId, traceRequestId: input.pending.requestId,
          weekStartsOn: clock.weekStartsOn, requestContext: clock, inputStateRevision: input.pending.baseRevision,
          retainedPreviewCount: input.snapshot.previewCandidates?.length ?? 0 } };
      let completed: WeeklyPlanningVNextDurableTurnResult;
      if (durableWeeklyPlanningEnabled()) {
        const receipt = input.resumeDurable ? readWeeklyPlanningVNextDurableReceipt(input.userId) : {
          version: 1 as const, ownerId: input.userId, snapshot: input.snapshot, pending: input.pending, payload,
        };
        if (!receipt || receipt.pending.requestId !== input.pending.requestId
          || receipt.pending.conversationId !== input.pending.conversationId || receipt.payload.checkpoint !== before) {
          throw new Error('VNext durable receipt does not match the current conversation.');
        }
        if (!input.resumeDurable) saveDurableWeeklyTurnReceipt(receipt);
        completed = await executeDurableWeeklyTurn<WeeklyPlanningVNextDurableTurnResult>(receipt, {
          resumeOnly: input.resumeDurable, isCurrent: input.isCurrentTurn,
        });
      } else completed = await executeIsolatedWeeklyPlanningVNextTurn(payload, ports);
      if (input.isCurrentTurn?.() === false) throw new Error('Conversation changed before the VNext result returned.');
      if (completed.core !== 'vnext' || completed.checkpointBefore !== before
        || (completed.checkpointAfter !== null && typeof completed.checkpointAfter !== 'string')) {
        throw new Error('Invalid VNext durable result.');
      }
      const after = completed.checkpointAfter;
      if (after !== null) {
        const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw: after, ownerId: input.userId,
          weekStartDate: input.snapshot.weekStartDate });
        if (!parsed || parsed.conversationId !== input.pending.conversationId) throw new Error('Invalid VNext result checkpoint.');
        stages.set(input.pending.requestId, { before, after });
      }
      return completed.result;
    } },
    stagingLifecycle: {
      prepare({ pending }) {
        const staged = stages.get(pending.requestId);
        if (!staged) return undefined;
        if (params.session.checkpoint.read() !== staged.before) throw new Error('VNext checkpoint changed before commit.');
        params.session.checkpoint.write(staged.after);
        stages.delete(pending.requestId);
        return { rollback() {
          if (params.session.checkpoint.read() !== staged.after) throw new Error('VNext checkpoint changed before rollback.');
          if (staged.before === null) params.session.checkpoint.remove(); else params.session.checkpoint.write(staged.before);
        }, complete() {} };
      },
      discard(pending) { stages.delete(pending.requestId); },
    },
  };
}
