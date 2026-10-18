import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { Actual, ActualDraft, MonthEvent, Plan } from '../types/domain';
import type { ActualActionTarget } from './useActualMutationAdmission';
import { createCompletionDraft, resolveScheduleActionPlan, ScheduleCompletionGuard, scheduleItemActions } from '../lib/scheduleItemActions';
import { useNoticeState, type NoticeTone } from './useNoticeState';
import type { ScheduleRadialActionId } from '../lib/scheduleRadialActions';

export function useScheduleOccurrenceActions(options: {
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
  const [movingPlan, setMovingPlan] = useState<Plan | null>(null);
  const guard = useMemo(() => new ScheduleCompletionGuard(), [options.contextKey]);
  const context = useMemo(() => ({}), [options.contextKey]);
  const activeContext = useRef<object | null>(null);
  const preparing = useRef(false);
  useLayoutEffect(() => { activeContext.current = context; preparing.current = false; dismissNotice(); setMovingPlan(null);
    return () => { activeContext.current = null; }; }, [context]);
  useLayoutEffect(() => { guard.observe(options.actuals); }, [guard, options.actuals]);
  function planFor(occurrence: ScheduleOccurrence) {
    return resolveScheduleActionPlan(occurrence, options.plans, options.monthEvents, options.viewedDate);
  }
  function actionsFor(occurrence: ScheduleOccurrence | undefined) {
    if (!occurrence) return [];
    const plan = planFor(occurrence);
    const timetable = occurrence.source.backingKind === 'timetable-template';
    return scheduleItemActions(occurrence, {
      edit: Boolean(plan ? occurrence.source.backingKind !== 'plan' || options.onEditPlan : timetable),
      move: Boolean(plan && options.canMove), duplicate: Boolean(plan && options.onDuplicatePlan),
      actual: Boolean(options.onSaveActual && (plan || options.onPrepareTimetableRecord)), delete: options.canDelete(occurrence),
      actualBlockReason: plan ? options.getActualActionBlockReason?.({ userId: plan.userId, planId: plan.id, occurrenceDate: plan.occurrenceDate ?? plan.date }) : null,
    });
  }
  async function select(id: ScheduleRadialActionId, occurrence: ScheduleOccurrence) {
    if (actionsFor(occurrence).find(action => action.id === id)?.disabledReason) return;
    const plan = planFor(occurrence);
    const notify = (message: string, tone: NoticeTone = 'info') => { if (activeContext.current === context) showNotice(message, tone, { durationMs: 4000 }); };
    try {
      if (id === 'delete') { await options.onDelete(occurrence); return; }
      if (id === 'edit') {
        if (plan && occurrence.source.backingKind === 'plan') options.onEditPlan?.(plan);
        else options.onOpenDetail(occurrence, false);
      }
      if (id === 'duplicate' && plan) options.onDuplicatePlan?.(plan);
      if (id === 'move' && plan) setMovingPlan(structuredClone(plan));
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
        try { await options.onSaveActual(plan, createCompletionDraft(plan)); saved = true; notify('予定通りの実績を記録しました', 'success'); }
        finally { guard.finish(plan, saved); }
      }
    } catch (error) { notify(error instanceof Error ? error.message : '操作を完了できませんでした。もう一度お試しください', 'error'); }
  }
  return { notice, movingPlan, closeMove: () => setMovingPlan(null), actionsFor, select };
}
