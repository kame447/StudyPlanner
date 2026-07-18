import { useEffect, useMemo, useState } from 'react';
import { createPlanFromDraft } from '../domain/planner';
import { upsertByKey } from '../lib/collections';
import { minutesBetween, sortByDateTime } from '../lib/date';
import { plannerRepository } from '../repositories';
import { useAuthSessionState } from './useAuthSessionState';
import { useNoticeState, type NoticeState } from './useNoticeState';
import { usePlannerDataState } from './usePlannerDataState';
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
  ScheduleTemplate,
  ScheduleTemplateDraft,
  StudyMaterial,
  StudyMaterialDraft,
  StudySubject,
  StudySubjectDraft,
  TimetablePeriod,
  TimetablePeriodDraft,
  TimetableTerm,
  TimetableTermDraft,
  TodoTask,
  TodoTaskDraft,
  User,
  UserProfileDraft,
  ViewMode,
} from '../types/domain';

interface PlannerAppState {
  booting: boolean;
  user: User | null;
  plans: Plan[];
  actuals: Actual[];
  dayNotes: DayNote[];
  monthEvents: MonthEvent[];
  todos: TodoTask[];
  studySubjects: StudySubject[];
  studyMaterials: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTerms: TimetableTerm[];
  timetablePeriods: TimetablePeriod[];
  viewMode: ViewMode;
  selectedDate: string;
  monthDate: string;
  notice: NoticeState | null;
  editorDraft: PlanDraft | null;
  editingPlanId: string | null;
  editingPlan: Plan | null;
  isRecurringPlanEdit: boolean;
  pendingRecurringPlanAction: { kind: 'edit' | 'delete'; plan: Plan } | null;
  setViewMode: (viewMode: ViewMode) => void;
  dismissNotice: () => void;
  signUpWithPassword: (
    email: string,
    password: string,
    username: string,
  ) => Promise<boolean>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  saveUserProfile: (draft: UserProfileDraft) => Promise<void>;
  signOut: () => Promise<void>;
  openCreatePlan: () => void;
  openEditPlan: (plan: Plan) => void;
  closePlanEditor: () => void;
  savePlanDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
  deletePlan: (plan: Plan) => Promise<void>;
  confirmRecurringPlanScope: (scope: RecurringPlanScope) => Promise<void>;
  cancelRecurringPlanScope: () => void;
  saveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  saveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  linkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  deleteActual: (actual: Actual) => Promise<void>;
  saveDayNote: (draft: DayNoteDraft) => Promise<void>;
  saveMonthEvent: (draft: MonthEventDraft, targetMonthEventId?: string) => Promise<void>;
  deleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
  saveTodo: (draft: TodoTaskDraft, targetTodoId?: string) => Promise<void>;
  scheduleTodoAsPlan: (todo: TodoTask, draft: PlanDraft) => Promise<Plan>;
  deleteTodo: (todo: TodoTask) => Promise<void>;
  saveStudySubject: (
    draft: StudySubjectDraft,
    targetSubjectId?: string,
  ) => Promise<StudySubject>;
  deleteStudySubject: (subject: StudySubject) => Promise<void>;
  saveStudyMaterial: (
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
  ) => Promise<StudyMaterial>;
  deleteStudyMaterial: (material: StudyMaterial) => Promise<void>;
  saveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
  deleteScheduleTemplate: (template: ScheduleTemplate) => Promise<void>;
  activateTimetableTerm: (draft: TimetableTermDraft) => Promise<TimetableTerm>;
  deleteTimetableTerm: (term: TimetableTerm) => Promise<void>;
  clearTimetableTermData: (term: TimetableTerm) => Promise<void>;
  saveTimetablePeriod: (
    draft: TimetablePeriodDraft,
    targetPeriodId?: string,
  ) => Promise<TimetablePeriod>;
  deleteTimetablePeriod: (period: TimetablePeriod) => Promise<void>;
  selectDate: (date: string) => void;
  changeMonth: (date: string) => void;
  openWeek: (date: string) => void;
  openDay: (date: string) => void;
  setEditorDraft: (draft: PlanDraft | null) => void;
  currentDayNote: DayNote | DayNoteDraft | null;
}

export function usePlannerAppState(): PlannerAppState {
  const { notice, showNotice, dismissNotice } = useNoticeState();
  const {
    booting,
    user,
    bootstrapSession,
    signUpWithPassword: registerWithPassword,
    signInWithPassword: loginWithPassword,
    signInWithGoogle: loginWithGoogle,
    sendPasswordReset,
    saveUserProfile,
    signOut: signOutSession,
  } = useAuthSessionState({ showNotice });
  const {
    plans: storedPlans,
    actuals,
    dayNotes,
    monthEvents,
    todos,
    studySubjects,
    studyMaterials,
    scheduleTemplates,
    timetableTerms,
    timetablePeriods,
    viewMode,
    selectedDate,
    monthDate,
    editorDraft,
    editingPlanId,
    editingPlan,
    isRecurringPlanEdit,
    pendingRecurringPlanAction,
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
    saveStandaloneActual,
    linkStandaloneActualToPlan,
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    saveTodo,
    scheduleTodoAsPlan,
    deleteTodo,
    saveStudySubject,
    deleteStudySubject,
    saveStudyMaterial,
    deleteStudyMaterial,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    activateTimetableTerm,
    deleteTimetableTerm,
    clearTimetableTermData,
    saveTimetablePeriod,
    deleteTimetablePeriod,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote,
  } = usePlannerDataState({
    userId: user?.id ?? null,
    showNotice,
  });
  const [weeklyApprovedPlanOverlay, setWeeklyApprovedPlanOverlay] = useState<Plan[]>([]);
  const plans = useMemo(
    () => sortByDateTime(
      weeklyApprovedPlanOverlay.reduce(
        (current, plan) => upsertByKey(current, plan, (item) => item.id),
        storedPlans,
      ),
    ),
    [storedPlans, weeklyApprovedPlanOverlay],
  );

  useEffect(() => {
    setWeeklyApprovedPlanOverlay([]);
  }, [user?.id]);

  useEffect(() => {
    void bootstrapSession(loadPlannerData);
  }, [bootstrapSession, loadPlannerData]);

  useEffect(() => {
    void import('../data/naturalLanguageCatalog').then(
      ({ loadNaturalLanguageCatalog }) => {
        void loadNaturalLanguageCatalog({
          seedWhenMissing: Boolean(user?.id),
        });
      },
    );
  }, [user?.id]);

  async function signUpWithPassword(
    email: string,
    password: string,
    username: string,
  ) {
    return registerWithPassword(email, password, username);
  }

  async function signInWithPassword(email: string, password: string) {
    const currentUser = await loginWithPassword(email, password);

    if (currentUser) {
      await loadPlannerData(currentUser.id);
    }
  }

  async function signInWithGoogle() {
    const currentUser = await loginWithGoogle();

    if (currentUser) {
      await loadPlannerData(currentUser.id);
    }
  }

  async function signOut() {
    await signOutSession();
    setWeeklyApprovedPlanOverlay([]);
    resetPlannerData();
  }

  async function saveWeeklyApprovedPlan(draft: PlanDraft): Promise<Plan> {
    if (!user?.id) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }

    const nextPlan = createPlanFromDraft(draft);
    setWeeklyApprovedPlanOverlay((current) =>
      sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)),
    );

    try {
      const savedPlan = await plannerRepository.upsertPlan(nextPlan);
      setWeeklyApprovedPlanOverlay((current) =>
        sortByDateTime(
          upsertByKey(
            current.filter((plan) => plan.id !== nextPlan.id),
            savedPlan,
            (plan) => plan.id,
          ),
        ),
      );
      await loadPlannerData(user.id);
      setWeeklyApprovedPlanOverlay((current) =>
        current.filter((plan) => plan.id !== nextPlan.id && plan.id !== savedPlan.id),
      );
      return savedPlan;
    } catch (error) {
      setWeeklyApprovedPlanOverlay((current) =>
        current.filter((plan) => plan.id !== nextPlan.id),
      );
      throw error;
    }
  }

  return {
    booting,
    user,
    plans,
    actuals,
    dayNotes,
    monthEvents,
    todos,
    studySubjects,
    studyMaterials,
    scheduleTemplates,
    timetableTerms,
    timetablePeriods,
    viewMode,
    selectedDate,
    monthDate,
    notice,
    editorDraft,
    editingPlanId,
    editingPlan,
    isRecurringPlanEdit,
    pendingRecurringPlanAction,
    setViewMode,
    dismissNotice,
    signUpWithPassword,
    signInWithPassword,
    signInWithGoogle,
    sendPasswordReset,
    saveUserProfile,
    signOut,
    openCreatePlan,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    saveWeeklyApprovedPlan,
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    saveActual,
    saveStandaloneActual,
    linkStandaloneActualToPlan,
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    saveTodo,
    scheduleTodoAsPlan,
    deleteTodo,
    saveStudySubject,
    deleteStudySubject,
    saveStudyMaterial,
    deleteStudyMaterial,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    activateTimetableTerm,
    deleteTimetableTerm,
    clearTimetableTermData,
    saveTimetablePeriod,
    deleteTimetablePeriod,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote,
  };
}
