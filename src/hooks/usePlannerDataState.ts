import { useCallback, useState } from 'react';
import { removeByKey, upsertByKey } from '../lib/collections';
import {
  isSameMonth,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  todayIsoDate,
} from '../lib/date';
import { sortMonthEvents } from '../lib/monthEvents';
import { plannerRepository } from '../repositories';
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
  ViewMode,
} from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UsePlannerDataStateOptions {
  userId: string | null;
  showNotice: ShowNotice;
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
  loadPlannerData: (userId: string) => Promise<void>;
  resetPlannerData: () => void;
  setViewMode: (viewMode: ViewMode) => void;
  openCreatePlan: () => void;
  openEditPlan: (plan: Plan) => void;
  closePlanEditor: () => void;
  savePlanDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  deletePlan: (plan: Plan) => Promise<void>;
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
  }, []);

  function openCreatePlan() {
    if (!userId) {
      return;
    }

    setEditingPlanId(null);
    setEditorDraft(createEmptyPlanDraft(userId, selectedDate));
  }

  function openEditPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setEditorDraft(createPlanDraftFromPlan(plan));
  }

  function closePlanEditor() {
    setEditingPlanId(null);
    setEditorDraft(null);
  }

  async function savePlanDraft(draft: PlanDraft, targetPlanId?: string) {
    if (!userId) {
      return;
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
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
    showNotice(currentPlan ? '予定を更新しました。' : '予定を追加しました。', 'success');
  }

  async function deletePlan(plan: Plan) {
    if (!userId) {
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

    const existingActual = actuals.find((actual) => actual.planId === plan.id);
    const nextActual = createActualFromDraft(userId, draft, existingActual);

    await plannerRepository.upsertActual(nextActual);
    setActuals((current) => upsertByKey(current, nextActual, (item) => item.planId));
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
    loadPlannerData,
    resetPlannerData,
    setViewMode,
    openCreatePlan,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    deletePlan,
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
