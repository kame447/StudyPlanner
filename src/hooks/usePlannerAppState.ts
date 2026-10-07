import type { MaterialEditBaseline } from './useActualMutationAdmission';
import type { ActualActionTarget } from './useActualMutationAdmission';
import { useEffect, useMemo } from 'react';
import { PlannerMutationScopeExpiredError, usePlannerMutationScope, useScopedPlannerState } from './usePlannerMutationScope';
import { createPlanFromDraft } from '../domain/planner';
import type { PlannerDataAvailability, PlannerDataRecovery } from '../domain/plannerDataReadAuthority';
import { upsertByKey } from '../lib/collections';
import { minutesBetween, sortByDateTime } from '../lib/date';
import {
  getWeeklyPlanningApprovalPlanRepository,
} from '../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository';
import type { WeeklyDraftApprovalOperation } from '../features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';
import { useAuthSessionState } from './useAuthSessionState';
import { useNoticeState, type NoticeState } from './useNoticeState';
import { usePlannerDataState } from './usePlannerDataState';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
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
  plannerDataAvailability: PlannerDataAvailability;
  plannerDataRecovery: PlannerDataRecovery | null;
  retryPlannerData: () => Promise<void>;
  isPlannerDataSnapshotCurrent: () => boolean;
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
  saveUserProfile: (draft: UserProfileDraft) => Promise<User>;
  signOut: () => Promise<void>;
  openCreatePlan: () => void;
  openEditPlan: (plan: Plan) => void;
  closePlanEditor: () => void;
  savePlanDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  movePlanOccurrence: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
  completeWeeklyApprovalOperation: (operation: WeeklyDraftApprovalOperation) => Promise<void>;
  deletePlan: (plan: Plan) => Promise<void>;
  confirmRecurringPlanScope: (scope: RecurringPlanScope) => Promise<void>;
  cancelRecurringPlanScope: () => void;
  getActualActionBlockReason: (target: ActualActionTarget) => string | null;
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
  captureStudyMaterialBaseline: (material: StudyMaterial) => MaterialEditBaseline;
  saveStudyMaterial: (
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
    baseline?: MaterialEditBaseline,
  ) => Promise<StudyMaterial>;
  deleteStudyMaterial: (material: StudyMaterial, baseline?: MaterialEditBaseline) => Promise<void>;
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

export function usePlannerAppState({ noticeAutoDismiss = true, expectedUserId, onBootstrapSettled }: { noticeAutoDismiss?: boolean; expectedUserId?: string; onBootstrapSettled?: () => void } = {}): PlannerAppState {
  const { notice, showNotice, dismissNotice } = useNoticeState(noticeAutoDismiss);
  const weeklyPlanningApprovalPlanRepository =
    getWeeklyPlanningApprovalPlanRepository();
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
  } = useAuthSessionState({ showNotice, expectedUserId, onBootstrapSettled });
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
    plannerDataAvailability,
    plannerDataRecovery,
    retryPlannerData,
    isPlannerDataSnapshotCurrent,
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
    movePlanOccurrence,
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    getActualActionBlockReason,
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
    captureStudyMaterialBaseline,
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
  const { scope: approvalScope, invalidate: invalidateApprovalScope } = usePlannerMutationScope(user?.id ?? null);
  const [weeklyApprovedPlanOverlay, setWeeklyApprovedPlanOverlay, clearWeeklyApprovedPlanOverlay] =
    useScopedPlannerState<Plan[]>([], approvalScope);
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
    clearWeeklyApprovedPlanOverlay([]);
  }, [clearWeeklyApprovedPlanOverlay, user?.id]);

  useEffect(() => {
    void bootstrapSession(loadPlannerData);
  }, [bootstrapSession, loadPlannerData]);

  // Keep the early request, but do not repeat a confirmed successful read when
  // the root-owned profile is restored. A fresh root mount gets a fresh scope.
  const catalogStartup = useMemo(() => ({ successful: false }), [expectedUserId]);
  useEffect(() => {
    if (expectedUserId && catalogStartup.successful) return;
    let active = true;
    void import('../data/naturalLanguageCatalog').then(
      async ({ loadNaturalLanguageCatalogWithOutcome }) => {
        if (!active) return;
        const result = await loadNaturalLanguageCatalogWithOutcome();
        // Completion belongs to this mount/owner scope, not the user-id effect:
        // null-to-owner cleanup must not invalidate an already-started shared read.
        if (result.source === 'server') catalogStartup.successful = true;
      },
    );
    return () => { active = false; };
  }, [catalogStartup, expectedUserId, user?.id]);

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
    invalidateApprovalScope();
    clearWeeklyApprovedPlanOverlay([]);
    resetPlannerData();
  }

  async function saveWeeklyApprovedPlan(draft: PlanDraft): Promise<Plan> {
    if (!user?.id) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (draft.userId !== user.id) {
      throw new Error('承認予定の所有者が一致しません。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }

    const nextPlan = createPlanFromDraft(draft);
    setWeeklyApprovedPlanOverlay((current) =>
      sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)),
    );

    try {
      const savedPlan = await weeklyPlanningApprovalPlanRepository.saveApprovedPlan(draft);
      if (!approvalScope.isCurrent()) throw new PlannerMutationScopeExpiredError();
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

  async function completeWeeklyApprovalOperation(
    operation: WeeklyDraftApprovalOperation,
  ): Promise<void> {
    if (!user?.id || operation.userId !== user.id) {
      throw new Error('承認操作の所有者が一致しません。');
    }
    await weeklyPlanningApprovalPlanRepository.completeOperation(operation);
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
    plannerDataAvailability,
    plannerDataRecovery,
    retryPlannerData,
    isPlannerDataSnapshotCurrent,
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
    movePlanOccurrence,
    saveWeeklyApprovedPlan: approvalScope.bindMutation(saveWeeklyApprovedPlan),
    completeWeeklyApprovalOperation: approvalScope.bindMutation(completeWeeklyApprovalOperation),
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    getActualActionBlockReason,
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
    captureStudyMaterialBaseline,
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
