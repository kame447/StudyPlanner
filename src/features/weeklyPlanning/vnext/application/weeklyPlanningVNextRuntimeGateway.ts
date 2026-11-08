import type { WeeklyPlanningTurnRuntimeGateway, ExecuteWeeklyPlanningTurnRuntimeParams } from '../../application/weeklyPlanningTurnRuntimeGateway';
import type { WeeklyPlanningTurnStagingLifecycle } from '../../application/weeklyPlanningTurnSideEffects';
import { createWeeklyPlanningTurnRequestContext } from '../../application/weeklyPlanningTemporalContext';
import { durableWeeklyPlanningEnabled, executeDurableWeeklyTurn, readDurableWeeklyTurnReceipt, saveDurableWeeklyTurnReceipt } from '../../application/weeklyPlanningDurableTurnClient';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import type { WeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { loadWeeklyPlanningVNextRuntimeModule } from './weeklyPlanningVNextRuntimeLoader';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from './weeklyPlanningVNextDurableTurn';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyDraftApprovalOperation } from '../../planning/weeklyPlanningApprovalTypes';
import type { UserPlanningContextRecordV1 } from '../../../userPlanningContext/userPlanningContextTypes';
import { selectVNextConfirmedUserContext, vnextRelevantScopeKeys, type VNextConfirmedUserContext } from '../weeklyPlanningVNextConfirmedUserContext';

/** One turn payload for both local execution and the durable Worker. Optimistic actuals from a still-pending
 * save cannot be used as evidence that the records are already saved. */
export function buildWeeklyPlanningVNextTurnPayload(input: ExecuteWeeklyPlanningTurnRuntimeParams, before: string | null,
  legacyV5Checkpoint: string | null, clock: ReturnType<typeof createWeeklyPlanningTurnRequestContext>,
  savingActualRecordIds: ReadonlySet<string>, allowUnapprovedPreviewReplan = false,
  confirmedUserContext: VNextConfirmedUserContext | null = null): WeeklyPlanningVNextDurableTurnInput {
  return { core: 'vnext', checkpoint: before, legacyV5Checkpoint, weekStartDate: input.snapshot.weekStartDate,
    ...(allowUnapprovedPreviewReplan ? { allowUnapprovedPreviewReplan: true } : {}),
    ...(confirmedUserContext ? { confirmedUserContext } : {}),
    input: { previousState: input.snapshot.intakeState, messages: input.snapshot.messages,
      userText: input.userText, supplementalContext: input.supplementalContext, selectedStarterTarget: input.selectedStarterTarget,
      selectedDate: input.selectedDate, userId: input.userId, plans: input.plans,
      actuals: input.actuals?.filter(actual => !savingActualRecordIds.has(actual.id)),
      monthEvents: input.monthEvents, studyMaterials: input.studyMaterials, scheduleTemplates: input.scheduleTemplates,
      timetableTermId: input.timetableTermId, timetableTerm: input.timetableTerm, timetableTerms: input.timetableTerms,
      conversationId: input.pending.conversationId, traceRequestId: input.pending.requestId,
      weekStartsOn: clock.weekStartsOn, requestContext: clock, inputStateRevision: input.pending.baseRevision,
      retainedPreviewCount: input.snapshot.previewCandidates?.length ?? 0 } };
}

export function readWeeklyPlanningVNextDurableReceipt(ownerId: string) {
  const receipt = readDurableWeeklyTurnReceipt<WeeklyPlanningVNextDurableTurnInput>(ownerId, 'vnext');
  return receipt?.payload.core === 'vnext' ? receipt : null;
}

/** The existing controller owns admission and publication. Stage the session's single checkpoint
 * write until that controller prepares commit; cancellation/discard writes nothing. Rollback uses
 * the same receipt discipline as V5's staging lifecycle. LocalRuntime tests exercise both paths.
 */
export function createWeeklyPlanningVNextRuntimeGateway(params: {
  session: Pick<WeeklyPlanningVNextLocalSession, 'checkpoint' | 'legacyV5Checkpoint'>;
  savingActualRecordIds?: () => ReadonlySet<string>;
  approvalOperations?: () => readonly WeeklyDraftApprovalOperation[];
  /** The owner's stored memory, read without writing; null when it cannot be read (the turn then runs without memory). */
  userContextRecords?: (ownerId: string, currentDate: string) => readonly UserPlanningContextRecordV1[] | null;
  /** Built only when the turn runs in this tab, so a lazy runtime loads after durable execution is ruled out. */
  ports(input: ExecuteWeeklyPlanningTurnRuntimeParams): WeeklyPlanningVNextExperimentalPorts | Promise<WeeklyPlanningVNextExperimentalPorts>;
}): { runtimeGateway: WeeklyPlanningTurnRuntimeGateway; stagingLifecycle: WeeklyPlanningTurnStagingLifecycle } {
  const stages = new Map<string, { before: string | null; after: string }>();
  return {
    runtimeGateway: { async execute(input) {
      const before = params.session.checkpoint.read();
      const clock = createWeeklyPlanningTurnRequestContext({ startedAtIso: input.pending.startedAt,
        timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Tokyo',
        weekStartsOn: input.weekStartsOn ?? 'monday' });
      const checkpoint = before === null ? null : parseWeeklyPlanningVNextSessionCheckpoint({ raw: before,
        ownerId: input.userId, weekStartDate: input.snapshot.weekStartDate });
      const shown = checkpoint?.vnext.preview;
      const operations = params.approvalOperations?.();
      const allowReplan = Boolean(shown && operations && !operations.some(operation => operation.userId === input.userId
        && operation.previewId === shown.previewId && operation.previewStateRevision === shown.graphRevision));
      // Fixed once per turn into the one payload that local and durable execution both read; the typed scope keys are
      // the checkpoint's active task titles and the UI-selected starter target, never parsed from the user's words.
      const state = checkpoint?.vnext.state;
      const activeFacts = new Set(state?.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
      const records = params.userContextRecords?.(input.userId, clock.currentDate) ?? null;
      const confirmedUserContext = records ? selectVNextConfirmedUserContext({ ownerId: input.userId, records,
        relevantScopeKeys: vnextRelevantScopeKeys([...(state?.graph.tasks ?? []).filter(task => activeFacts.has(task.id)).map(task => task.title),
          input.selectedStarterTarget?.label]) }) : null;
      const payload = buildWeeklyPlanningVNextTurnPayload(input, before, params.session.legacyV5Checkpoint.read(),
        clock, params.savingActualRecordIds?.() ?? new Set(), allowReplan, confirmedUserContext);
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
      } else {
        const { executeIsolatedWeeklyPlanningVNextTurn } = await loadWeeklyPlanningVNextRuntimeModule();
        completed = await executeIsolatedWeeklyPlanningVNextTurn(payload, await params.ports(input));
      }
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
