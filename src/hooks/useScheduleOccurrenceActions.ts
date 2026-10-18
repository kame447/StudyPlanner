import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { Actual, ActualDraft, MonthEvent, Plan } from '../types/domain';
import type { ActualActionTarget } from './useActualMutationAdmission';
import { createCompletionDraft, resolveCurrentScheduleActionOccurrence, resolveScheduleActionPlan, ScheduleCompletionGuard, scheduleItemActions } from '../lib/scheduleItemActions';
import { useNoticeState, type NoticeTone } from './useNoticeState';
import type { ScheduleRadialActionId } from '../lib/scheduleRadialActions';

export function useScheduleOccurrenceActions(options: {
  occurrences: readonly ScheduleOccurrence[];
  activeOccurrence?: ScheduleOccurrence;
  onDismissMenu: () => void;
  contextKey: string; viewedDate: string; plans: Plan[]; monthEvents: MonthEvent[]; actuals: Actual[];
  onEditPlan?: (plan: Plan) => void; onDuplicatePlan?: (plan: Plan) => void;
  canMove: boolean; canDelete: (occurrence: ScheduleOccurrence) => boolean;
  onDelete: (occurrence: ScheduleOccurrence) => Promise<void>;
  onOpenDetail: (occurrence: ScheduleOccurrence, record: boolean) => void;
  onOpenPreparedRecord: (plan: Plan) => void;
  onPrepareTimetableRecord?: (occurrence: ScheduleOccurrence) => Promise<Plan>;
  onSaveActual?: (plan: Plan, draft: ActualDraft, id?: string) => Promise<void>;
  getActualActionBlockReason?: (target: ActualActionTarget) => string | null;
}) {
  const { notice, showNotice, dismissNotice } = useNoticeState();
  const [moveSession, setMoveSession] = useState<{ plan: Plan; context: object } | null>(null);
  const guard = useMemo(() => new ScheduleCompletionGuard(), [options.contextKey]);
  const context = useMemo(() => ({}), [options.contextKey]);
  const activeContext = useRef<object | null>(null);
  const preparing = useRef(false);
  const currentOptions = useRef(options);
  useLayoutEffect(() => { currentOptions.current = options; });
  useLayoutEffect(() => { activeContext.current = context; preparing.current = false; dismissNotice(); setMoveSession(null);
    return () => { activeContext.current = null; }; }, [context]);
  useLayoutEffect(() => { guard.observe(options.actuals); }, [guard, options.actuals]);
  const staleNotice = '予定が変更されました。もう一度予定を選んでください';
  useLayoutEffect(() => {
    if (options.activeOccurrence && !resolveCurrentScheduleActionOccurrence(options.activeOccurrence, options.occurrences)) {
      options.onDismissMenu();
      showNotice(staleNotice, 'info', { durationMs: 4000 });
    }
  }, [options.activeOccurrence, options.occurrences, showNotice]);
  function planFor(occurrence: ScheduleOccurrence, current = options) {
    return resolveScheduleActionPlan(occurrence, current.plans, current.monthEvents, current.viewedDate, current.occurrences);
  }
  function actionsFor(target: ScheduleOccurrence | undefined, current = options) {
    if (!target) return [];
    const occurrence = resolveCurrentScheduleActionOccurrence(target, current.occurrences);
    if (!occurrence) return scheduleItemActions(target, {
      edit: false, move: false, duplicate: false, actual: false, delete: false,
    }).map(action => ({ ...action, disabledReason: staleNotice }));
    const plan = planFor(occurrence, current);
    const timetable = occurrence.source.backingKind === 'timetable-template';
    return scheduleItemActions(occurrence, {
      edit: Boolean(plan ? occurrence.source.backingKind === 'plan' && current.onEditPlan : timetable),
      move: Boolean(plan && current.canMove), duplicate: Boolean(plan && current.onDuplicatePlan),
      actual: Boolean(current.onSaveActual && (plan || current.onPrepareTimetableRecord)), delete: current.canDelete(occurrence),
      actualBlockReason: plan ? current.getActualActionBlockReason?.({ userId: plan.userId, planId: plan.id, occurrenceDate: plan.occurrenceDate ?? plan.date }) : null,
    });
  }
  async function select(id: ScheduleRadialActionId, target: ScheduleOccurrence) {
    if (activeContext.current !== context) return;
    const options = currentOptions.current;
    const occurrence = resolveCurrentScheduleActionOccurrence(target, options.occurrences);
    if (!occurrence) {
      options.onDismissMenu();
      showNotice(staleNotice, 'info', { durationMs: 4000 });
      return;
    }
    if (actionsFor(occurrence, options).find(action => action.id === id)?.disabledReason) return;
    const plan = planFor(occurrence, options);
    const notify = (message: string, tone: NoticeTone = 'info') => { if (activeContext.current === context) showNotice(message, tone, { durationMs: 4000 }); };
    try {
      if (id === 'delete') { await options.onDelete(occurrence); return; }
      if (id === 'edit') {
        if (plan && occurrence.source.backingKind === 'plan') options.onEditPlan?.(plan);
        else options.onOpenDetail(occurrence, false);
      }
      if (id === 'duplicate' && plan) options.onDuplicatePlan?.(plan);
      if (id === 'move' && plan) setMoveSession({ plan: structuredClone(plan), context });
      if (id === 'actual') {
        if (plan) options.onOpenDetail(occurrence, true);
        else if (options.onPrepareTimetableRecord && !preparing.current) {
          preparing.current = true;
          try { const prepared = await options.onPrepareTimetableRecord(occurrence);
            if (activeContext.current === context) options.onOpenPreparedRecord(prepared);
          } finally { if (activeContext.current === context) preparing.current = false; }
        }
      }
      if (id === 'complete' && plan && options.onSaveActual) {
        const admission = guard.begin(plan, options.actuals);
        if (admission === 'existing') { notify('この予定の実績は記録済みです'); return; }
        if (admission === 'pending') return;
        let saved = false;
        try { await options.onSaveActual(plan, createCompletionDraft(plan)); saved = true;
          // The app-wide save toast confirms success; clear any stale inline message.
          if (activeContext.current === context) dismissNotice(); }
        finally { guard.finish(plan, saved); }
      }
    } catch (error) { notify(error instanceof Error ? error.message : '操作を完了できませんでした。もう一度お試しください', 'error'); }
  }
  const movingPlan = moveSession?.context === context ? moveSession.plan : null;
  function closeMove() {
    if (activeContext.current !== context) return;
    setMoveSession(current => current === moveSession ? null : current);
  }
  return { notice, movingPlan, closeMove, actionsFor, select };
}
