import type { WeeklyPlanningTurnRuntimeGateway, ExecuteWeeklyPlanningTurnRuntimeParams } from '../../application/weeklyPlanningTurnRuntimeGateway';
import type { WeeklyPlanningTurnStagingLifecycle } from '../../application/weeklyPlanningTurnSideEffects';
import { createWeeklyPlanningTurnRequestContext } from '../../application/weeklyPlanningTemporalContext';
import { addCalendarDays } from '../../semantic/weeklyPlanningCalendarResolver';
import { createInitialPlanningIntakeState } from '../weeklyPlanningVNextV5Boundary';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import type { WeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { captureWeeklyPlanningVNextTurnDiagnostics } from './weeklyPlanningVNextTurnDiagnostics';

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
      const diagnostic = captureWeeklyPlanningVNextTurnDiagnostics(input.pending.requestId, ports);
      const before = params.session.checkpoint.read();
      let after: string | null = null;
      const clock = createWeeklyPlanningTurnRequestContext({ startedAtIso: input.pending.startedAt,
        timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Tokyo',
        weekStartsOn: input.weekStartsOn ?? 'monday' });
      const read = params.session.readCheckpoint();
      const planningEndDate = addCalendarDays(input.snapshot.weekStartDate, 6);
      if (!planningEndDate) throw new Error('Invalid selected planning week.');
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({
        scope: { ownerId: input.userId, weekStartDate: input.snapshot.weekStartDate,
          conversationId: input.pending.conversationId, notBeforeTime: clock.notBeforeTime,
          clock: { currentDate: clock.currentDate, weekStartsOn: clock.weekStartsOn, timeZone: clock.timeZone,
            planningStartDate: input.snapshot.weekStartDate, planningEndDate } },
        ports: { ...diagnostic.ports, checkpoint: { read: () => after ?? params.session.checkpoint.read(), write: raw => { after = raw; } } },
        turnId: input.pending.requestId, userText: input.userText,
        supplementalContext: input.supplementalContext,
        shownRevision: read?.vnext.presentedQuestion?.graphRevision ?? null,
      });
      if (after !== null && input.isCurrentTurn?.() !== false) stages.set(input.pending.requestId, { before, after });
      const intake = input.snapshot.intakeState ?? createInitialPlanningIntakeState();
      return { state: turn.authorizationRequired ? { ...intake, status: 'needs_scope' } : intake, message: turn.reply,
        draftCandidates: turn.draftCandidates ?? [],
        preserveExistingPreview: Boolean(turn.preview && !turn.draftCandidates?.length),
        ...diagnostic.finish(turn) };
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
