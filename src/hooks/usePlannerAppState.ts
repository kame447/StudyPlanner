import { useEffect, useState } from 'react';
import { removeByKey, upsertByKey } from '../lib/collections';
import { startOfMonth, todayIsoDate, isSameMonth, minutesBetween, sortByDateTime } from '../lib/date';
import { sortMonthEvents } from '../lib/monthEvents';
import { authRepository, plannerRepository } from '../repositories';
import {
  createActualFromDraft,
  createDayNoteFromDraft,
  createMonthEventFromDraft,
  createEmptyPlanDraft,
  createPlanDraftFromPlan,
  createPlanFromDraft,
  resolveDayNoteDraft,
} from '../domain/planner';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  EmailChallenge,
  MonthEvent,
  MonthEventDraft,
  Plan,
  PlanDraft,
  User,
  ViewMode,
} from '../types/domain';

type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeState {
  tone: NoticeTone;
  text: string;
}

interface PlannerAppState {
  booting: boolean;
  user: User | null;
  plans: Plan[];
  actuals: Actual[];
  dayNotes: DayNote[];
  monthEvents: MonthEvent[];
  viewMode: ViewMode;
  selectedDate: string;
  monthDate: string;
  challenge: EmailChallenge | null;
  notice: NoticeState | null;
  editorDraft: PlanDraft | null;
  editingPlanId: string | null;
  setViewMode: (viewMode: ViewMode) => void;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
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

export function usePlannerAppState(): PlannerAppState {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [monthEvents, setMonthEvents] = useState<MonthEvent[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [monthDate, setMonthDate] = useState(startOfMonth(todayIsoDate()));
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [editorDraft, setEditorDraft] = useState<PlanDraft | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      const currentUser = await authRepository.getCurrentUser();

      if (currentUser) {
        setUser(currentUser);
        await loadPlannerData(currentUser.id);
      }

      setBooting(false);
    }

    void bootstrap();
  }, []);

  async function loadPlannerData(userId: string) {
    const [nextPlans, nextActuals, nextDayNotes, nextMonthEvents] = await Promise.all([
      plannerRepository.getPlans(userId),
      plannerRepository.getActuals(userId),
      plannerRepository.getDayNotes(userId),
      plannerRepository.getMonthEvents(userId),
    ]);

    setPlans(sortByDateTime(nextPlans));
    setActuals(nextActuals);
    setDayNotes(nextDayNotes);
    setMonthEvents(sortMonthEvents(nextMonthEvents));
  }

  function showNotice(text: string, tone: NoticeTone = 'info') {
    setNotice({ text, tone });
  }

  async function requestCode(email: string) {
    try {
      const nextChallenge = await authRepository.requestEmailCode(email);
      setChallenge(nextChallenge);
      showNotice('認証コードを発行しました。MVP用メールボックスを確認してください。');
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : '認証コードを発行できませんでした。',
        'error',
      );
    }
  }

  async function verifyCode(email: string, code: string) {
    try {
      const currentUser = await authRepository.verifyEmailCode(email, code);
      setUser(currentUser);
      await loadPlannerData(currentUser.id);
      setChallenge(null);
      showNotice('ログインしました。', 'success');
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : 'ログインに失敗しました。',
        'error',
      );
    }
  }

  async function signOut() {
    await authRepository.signOut();
    setUser(null);
    setPlans([]);
    setActuals([]);
    setDayNotes([]);
    setMonthEvents([]);
    setChallenge(null);
    showNotice('ログアウトしました。');
  }

  function openCreatePlan() {
    if (!user) {
      return;
    }

    setEditingPlanId(null);
    setEditorDraft(createEmptyPlanDraft(user.id, selectedDate));
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
    if (!user) {
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
    if (!user) {
      return;
    }

    await plannerRepository.deletePlan(user.id, plan.id);
    setPlans((current) => removeByKey(current, plan.id, (item) => item.id));
    setActuals((current) => removeByKey(current, plan.id, (item) => item.planId));
    showNotice('予定を削除しました。');
  }

  async function saveActual(plan: Plan, draft: ActualDraft) {
    if (!user) {
      return;
    }

    const existingActual = actuals.find((actual) => actual.planId === plan.id);
    const nextActual = createActualFromDraft(user.id, draft, existingActual);

    await plannerRepository.upsertActual(nextActual);
    setActuals((current) =>
      upsertByKey(current, nextActual, (item) => item.planId),
    );
    showNotice('実績を保存しました。', 'success');
  }

  async function deleteActual(actual: Actual) {
    if (!user) {
      return;
    }

    await plannerRepository.deleteActual(user.id, actual.id);
    setActuals((current) => removeByKey(current, actual.id, (item) => item.id));
    showNotice('実績を削除しました。');
  }

  async function saveDayNote(draft: DayNoteDraft) {
    if (!user) {
      return;
    }

    const currentDayNote = dayNotes.find((dayNote) => dayNote.date === draft.date);
    const nextDayNote = createDayNoteFromDraft(draft, currentDayNote);

    await plannerRepository.upsertDayNote(nextDayNote);
    setDayNotes((current) =>
      upsertByKey(current, nextDayNote, (item) => item.id),
    );
    showNotice('日次メモを保存しました。', 'success');
  }

  async function saveMonthEvent(
    draft: MonthEventDraft,
    targetMonthEventId?: string,
  ) {
    if (!user) {
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
    if (!user) {
      return;
    }

    await plannerRepository.deleteMonthEvent(user.id, monthEvent.id);
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

  function openWeek(date: string) {
    selectDate(date);
    setViewMode('week');
  }

  function changeMonth(date: string) {
    const nextMonthDate = startOfMonth(date);
    setMonthDate(nextMonthDate);

    if (!isSameMonth(selectedDate, date)) {
      setSelectedDate(nextMonthDate);
    }
  }

  function openDay(date: string) {
    selectDate(date);
    setViewMode('day');
  }

  return {
    booting,
    user,
    plans,
    actuals,
    dayNotes,
    monthEvents,
    viewMode,
    selectedDate,
    monthDate,
    challenge,
    notice,
    editorDraft,
    editingPlanId,
    setViewMode,
    requestCode,
    verifyCode,
    signOut,
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
    currentDayNote: user
      ? resolveDayNoteDraft(dayNotes, user.id, selectedDate)
      : null,
  };
}
