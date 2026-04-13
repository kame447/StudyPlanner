import { useCallback, useState } from 'react';
import { removeByKey, upsertByKey } from '../lib/collections';
import {
  isSameMonth,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  todayIsoDate,
} from '../lib/date';
import { buildPlanOccurrenceKey, getActualOccurrenceKey } from '../lib/planRecurrence';
import { sortMonthEvents } from '../lib/monthEvents';
import { plannerRepository } from '../repositories';
import {
  applyRecurringPlanDeleteScope,
  applyRecurringPlanEditScope,
  applyRecurringPlanSeriesEdit,
  supportsScopedRecurringPlanEdits,
} from '../domain/recurringPlan';
import {
  createActualFromDraft,
  createDayNoteFromDraft,
  createEmptyPlanDraft,
  createMonthEventFromDraft,
  createPlanDraftFromPlan,
  createPlanFromDraft,
  resolveDayNoteDraft,
} from '../domain/planner';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  MonthEvent,
  MonthEventDraft,
  Plan,
  PlanDraft,
  RecurringPlanScope,
  ViewMode,
} from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UsePlannerDataStateOptions {
  userId: string | null;
  showNotice: ShowNotice;
}

interface PendingRecurringPlanActionState {
  kind: 'edit' | 'delete';
  plan: Plan;
  draft?: PlanDraft;
}

interface UsePlannerDataStateResult {
  plans: Plan[];
  actuals: Actual[];
  dayNotes: DayNote[];
  monthEvents: MonthEvent[];
  viewMode: ViewMode;
  selectedDate: string;
  monthDate: string;
  editorDraft: PlanDraft | null;
  editingPlanId: string | null;
  editingPlan: Plan | null;
  isRecurringPlanEdit: boolean;
  pendingRecurringPlanAction: { kind: 'edit' | 'delete'; plan: Plan } | null;
  loadPlannerData: (userId: string) => Promise<void>;
  resetPlannerData: () => void;
  setViewMode: (viewMode: ViewMode) => void;
  openCreatePlan: () => void;
  openEditPlan: (plan: Plan) => void;
  closePlanEditor: () => void;
  savePlanDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  deletePlan: (plan: Plan) => Promise<void>;
  confirmRecurringPlanScope: (scope: RecurringPlanScope) => Promise<void>;
  cancelRecurringPlanScope: () => void;
  saveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  deleteActual: (actual: Actual) => Promise<void>;
  saveDayNote: (draft: DayNoteDraft) => Promise<void>;
  saveMonthEvent: (draft: MonthEventDraft, targetMonthEventId?: string) => Promise<void>;
  deleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
  selectDate: (date: string) => void;
  changeMonth: (date: string) => void;
  openWeek: (date: string) => void;
  openDay: (date: string) => void;
  setEditorDraft: (draft: PlanDraft | null) => void;
  currentDayNote: DayNote | DayNoteDraft | null;
}

export function usePlannerDataState({
  userId,
  showNotice,
}: UsePlannerDataStateOptions): UsePlannerDataStateResult {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [monthEvents, setMonthEvents] = useState<MonthEvent[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [monthDate, setMonthDate] = useState(startOfMonth(todayIsoDate()));
  const [editorDraft, setEditorDraft] = useState<PlanDraft | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [pendingRecurringPlanAction, setPendingRecurringPlanAction] =
    useState<PendingRecurringPlanActionState | null>(null);

  function resolveStoredPlan(plan: Plan): Plan {
    return plans.find((item) => item.id === plan.id) ?? plan;
  }

  function sortAndUpsertPlans(current: Plan[], nextPlans: Plan[]): Plan[] {
    return sortByDateTime(
      nextPlans.reduce(
        (records, nextPlan) => upsertByKey(records, nextPlan, (plan) => plan.id),
        current,
      ),
    );
  }

  function removePlansByIds(current: Plan[], planIds: string[]): Plan[] {
    const idSet = new Set(planIds);
    return current.filter((plan) => !idSet.has(plan.id));
  }

  function upsertActualsById(current: Actual[], nextActuals: Actual[]): Actual[] {
    return nextActuals.reduce(
      (records, nextActual) => upsertByKey(records, nextActual, (actual) => actual.id),
      current,
    );
  }

  function isScopedRecurringEditCandidate(plan: Plan | null): boolean {
    if (!plan) {
      return false;
    }

    return supportsScopedRecurringPlanEdits(resolveStoredPlan(plan));
  }

  const isRecurringPlanEdit = isScopedRecurringEditCandidate(editingPlan);

  const loadPlannerData = useCallback(async (nextUserId: string) => {
    const [nextPlans, nextActuals, nextDayNotes, nextMonthEvents] = await Promise.all([
      plannerRepository.getPlans(nextUserId),
      plannerRepository.getActuals(nextUserId),
      plannerRepository.getDayNotes(nextUserId),
      plannerRepository.getMonthEvents(nextUserId),
    ]);

    setPlans(sortByDateTime(nextPlans));
    setActuals(nextActuals);
    setDayNotes(nextDayNotes);
    setMonthEvents(sortMonthEvents(nextMonthEvents));
  }, []);

  const resetPlannerData = useCallback(() => {
    setPlans([]);
    setActuals([]);
    setDayNotes([]);
    setMonthEvents([]);
    setEditorDraft(null);
    setEditingPlanId(null);
    setEditingPlan(null);
    setPendingRecurringPlanAction(null);
  }, []);

  function openCreatePlan() {
    if (!userId) {
      return;
    }

    setEditingPlanId(null);
    setEditingPlan(null);
    setPendingRecurringPlanAction(null);
    setEditorDraft(createEmptyPlanDraft(userId, selectedDate));
  }

  function openEditPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setEditingPlan(plan);
    setEditorDraft(createPlanDraftFromPlan(plan));
  }

  function closePlanEditor() {
    setEditingPlanId(null);
    setEditingPlan(null);
    setEditorDraft(null);
  }

  function cancelRecurringPlanScope() {
    setPendingRecurringPlanAction(null);
  }

  async function confirmRecurringPlanScope(scope: RecurringPlanScope) {
    if (!userId || !pendingRecurringPlanAction) {
      return;
    }

    const occurrencePlan = pendingRecurringPlanAction.plan;
    const sourcePlan = resolveStoredPlan(occurrencePlan);
    const occurrenceDate = occurrencePlan.occurrenceDate ?? occurrencePlan.date;

    if (pendingRecurringPlanAction.kind === 'edit') {
      const draft = pendingRecurringPlanAction.draft;

      if (!draft) {
        return;
      }

      if (scope === 'all') {
        const seriesPlans = plans.filter(
          (plan) => plan.seriesId === sourcePlan.seriesId,
        );
        const updatedPlans = seriesPlans.map((plan) =>
          applyRecurringPlanSeriesEdit(plan, draft),
        );

        await Promise.all(updatedPlans.map((plan) => plannerRepository.upsertPlan(plan)));
        setPlans((current) => sortAndUpsertPlans(current, updatedPlans));
        setSelectedDate(occurrenceDate);
        setMonthDate(startOfMonth(occurrenceDate));
        setPendingRecurringPlanAction(null);
        closePlanEditor();
        showNotice('繰り返し予定を更新しました。', 'success');
        return;
      }

      const editResult = applyRecurringPlanEditScope(
        sourcePlan,
        occurrenceDate,
        draft,
        scope,
      );
      const migratedActuals =
        scope === 'future' && editResult.createdPlan
          ? actuals
              .filter(
                (actual) =>
                  actual.planId === sourcePlan.id &&
                  actual.occurrenceDate.localeCompare(occurrenceDate) >= 0,
              )
              .map((actual) => ({
                ...actual,
                planId: editResult.createdPlan?.id ?? actual.planId,
              }))
          : [];
      const deletedPlanIds =
        editResult.updatedPlan === null ? [sourcePlan.id] : [];

      if (editResult.createdPlan) {
        await plannerRepository.upsertPlan(editResult.createdPlan);
      }

      if (editResult.updatedPlan) {
        await plannerRepository.upsertPlan(editResult.updatedPlan);
      }

      if (migratedActuals.length > 0) {
        await Promise.all(
          migratedActuals.map((actual) => plannerRepository.upsertActual(actual)),
        );
      }

      if (editResult.updatedPlan === null) {
        await plannerRepository.deletePlan(userId, sourcePlan.id);
      }

      setPlans((current) => {
        const withoutDeleted = removePlansByIds(current, deletedPlanIds);
        const nextPlans = [
          ...(editResult.updatedPlan ? [editResult.updatedPlan] : []),
          ...(editResult.createdPlan ? [editResult.createdPlan] : []),
        ];
        return sortAndUpsertPlans(withoutDeleted, nextPlans);
      });
      setActuals((current) => upsertActualsById(current, migratedActuals));
      setSelectedDate(occurrenceDate);
      setMonthDate(startOfMonth(occurrenceDate));
      setPendingRecurringPlanAction(null);
      closePlanEditor();
      showNotice('繰り返し予定を更新しました。', 'success');
      return;
    }

    if (scope === 'all') {
      const seriesPlanIds = plans
        .filter((plan) => plan.seriesId === sourcePlan.seriesId)
        .map((plan) => plan.id);

      await Promise.all(
        seriesPlanIds.map((planId) => plannerRepository.deletePlan(userId, planId)),
      );
      setPlans((current) => removePlansByIds(current, seriesPlanIds));
      setActuals((current) =>
        current.filter((actual) => !seriesPlanIds.includes(actual.planId)),
      );
      setPendingRecurringPlanAction(null);
      showNotice('繰り返し予定を削除しました。');
      return;
    }

    const nextPlan = applyRecurringPlanDeleteScope(sourcePlan, occurrenceDate, scope);
    const actualsToDelete = actuals.filter(
      (actual) =>
        actual.planId === sourcePlan.id &&
        (scope === 'single'
          ? actual.occurrenceDate === occurrenceDate
          : actual.occurrenceDate.localeCompare(occurrenceDate) >= 0),
    );

    if (nextPlan) {
      await Promise.all([
        plannerRepository.upsertPlan(nextPlan),
        ...actualsToDelete.map((actual) => plannerRepository.deleteActual(userId, actual.id)),
      ]);
      setPlans((current) => sortAndUpsertPlans(current, [nextPlan]));
    } else {
      await plannerRepository.deletePlan(userId, sourcePlan.id);
      setPlans((current) => removePlansByIds(current, [sourcePlan.id]));
    }

    setActuals((current) =>
      current.filter(
        (actual) =>
          !actualsToDelete.some((candidate) => candidate.id === actual.id) &&
          !(nextPlan === null && actual.planId === sourcePlan.id),
      ),
    );
    setPendingRecurringPlanAction(null);
    showNotice('繰り返し予定を削除しました。');
  }

  async function savePlanDraft(draft: PlanDraft, targetPlanId?: string) {
    if (!userId) {
      return;
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      return;
    }

    if (editingPlan && isScopedRecurringEditCandidate(editingPlan)) {
      setPendingRecurringPlanAction({
        kind: 'edit',
        plan: editingPlan,
        draft,
      });
      return;
    }

    const currentPlan = plans.find((plan) => plan.id === (targetPlanId ?? editingPlanId));
    const nextPlan = createPlanFromDraft(draft, currentPlan);

    await plannerRepository.upsertPlan(nextPlan);
    setPlans((current) =>
      sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)),
    );
    setSelectedDate(nextPlan.date);
    setMonthDate(startOfMonth(nextPlan.date));
    closePlanEditor();
    showNotice(
      currentPlan ? '学習予定を更新しました。' : '学習予定を追加しました。',
      'success',
    );
  }

  async function deletePlan(plan: Plan) {
    if (!userId) {
      return;
    }

    if (isScopedRecurringEditCandidate(plan)) {
      setPendingRecurringPlanAction({
        kind: 'delete',
        plan,
      });
      return;
    }

    await plannerRepository.deletePlan(userId, plan.id);
    setPlans((current) => removeByKey(current, plan.id, (item) => item.id));
    setActuals((current) => removeByKey(current, plan.id, (item) => item.planId));
    showNotice('予定を削除しました。');
  }

  async function saveActual(plan: Plan, draft: ActualDraft) {
    if (!userId) {
      return;
    }

    const occurrenceKey = buildPlanOccurrenceKey(plan.id, draft.occurrenceDate);
    const existingActual = actuals.find(
      (actual) => getActualOccurrenceKey(actual) === occurrenceKey,
    );
    const nextActual = createActualFromDraft(userId, draft, existingActual);

    await plannerRepository.upsertActual(nextActual);
    setActuals((current) =>
      upsertByKey(current, nextActual, (item) => getActualOccurrenceKey(item)),
    );
    showNotice('実績を保存しました。', 'success');
  }

  async function deleteActual(actual: Actual) {
    if (!userId) {
      return;
    }

    await plannerRepository.deleteActual(userId, actual.id);
    setActuals((current) => removeByKey(current, actual.id, (item) => item.id));
    showNotice('実績を削除しました。');
  }

  async function saveDayNote(draft: DayNoteDraft) {
    if (!userId) {
      return;
    }

    const currentDayNote = dayNotes.find((dayNote) => dayNote.date === draft.date);
    const nextDayNote = createDayNoteFromDraft(draft, currentDayNote);

    await plannerRepository.upsertDayNote(nextDayNote);
    setDayNotes((current) => upsertByKey(current, nextDayNote, (item) => item.id));
    showNotice('日次メモを保存しました。', 'success');
  }

  async function saveMonthEvent(
    draft: MonthEventDraft,
    targetMonthEventId?: string,
  ) {
    if (!userId) {
      return;
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('主要予定の終了時刻は開始時刻より後にしてください。', 'error');
      return;
    }

    if (!draft.title.trim()) {
      showNotice('主要予定のタイトルを入れてください。', 'error');
      return;
    }

    const currentMonthEvent = monthEvents.find(
      (monthEvent) => monthEvent.id === targetMonthEventId,
    );
    const nextMonthEvent = createMonthEventFromDraft(draft, currentMonthEvent);

    await plannerRepository.upsertMonthEvent(nextMonthEvent);
    setMonthEvents((current) =>
      sortMonthEvents(upsertByKey(current, nextMonthEvent, (item) => item.id)),
    );

    if (!currentMonthEvent) {
      setSelectedDate(nextMonthEvent.date);
    }

    setMonthDate(startOfMonth(nextMonthEvent.date));
    showNotice(
      currentMonthEvent ? '月の主要予定を更新しました。' : '月の主要予定を追加しました。',
      'success',
    );
  }

  async function deleteMonthEvent(monthEvent: MonthEvent) {
    if (!userId) {
      return;
    }

    await plannerRepository.deleteMonthEvent(userId, monthEvent.id);
    setMonthEvents((current) =>
      sortMonthEvents(removeByKey(current, monthEvent.id, (item) => item.id)),
    );
    showNotice('月の主要予定を削除しました。');
  }

  function selectDate(date: string) {
    setSelectedDate(date);

    if (!isSameMonth(monthDate, date)) {
      setMonthDate(startOfMonth(date));
    }
  }

  function changeMonth(date: string) {
    const nextMonthDate = startOfMonth(date);
    setMonthDate(nextMonthDate);

    if (!isSameMonth(selectedDate, date)) {
      setSelectedDate(nextMonthDate);
    }
  }

  function openWeek(date: string) {
    selectDate(date);
    setViewMode('week');
  }

  function openDay(date: string) {
    selectDate(date);
    setViewMode('day');
  }

  return {
    plans,
    actuals,
    dayNotes,
    monthEvents,
    viewMode,
    selectedDate,
    monthDate,
    editorDraft,
    editingPlanId,
    editingPlan,
    isRecurringPlanEdit,
    pendingRecurringPlanAction:
      pendingRecurringPlanAction
        ? {
            kind: pendingRecurringPlanAction.kind,
            plan: pendingRecurringPlanAction.plan,
          }
        : null,
    loadPlannerData,
    resetPlannerData,
    setViewMode,
    openCreatePlan,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    saveActual,
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote: userId ? resolveDayNoteDraft(dayNotes, userId, selectedDate) : null,
  };
}
