import { useEffect } from 'react';
import { useAuthSessionState } from './useAuthSessionState';
import { useNoticeState, type NoticeState } from './useNoticeState';
import { usePlannerDataState } from './usePlannerDataState';
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
  viewMode: ViewMode;
  selectedDate: string;
  monthDate: string;
  challenge: EmailChallenge | null;
  notice: NoticeState | null;
  editorDraft: PlanDraft | null;
  editingPlanId: string | null;
  setViewMode: (viewMode: ViewMode) => void;
  dismissNotice: () => void;
  requestCode: (email: string, username: string) => Promise<void>;
  verifyCode: (email: string, code: string, username: string) => Promise<void>;
  resetChallenge: () => void;
  saveUserProfile: (draft: UserProfileDraft) => Promise<void>;
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
  const { notice, showNotice, dismissNotice } = useNoticeState();
  const {
    booting,
    user,
    challenge,
    bootstrapSession,
    requestCode: requestAuthCode,
    verifyCode: verifyAuthCode,
    resetChallenge,
    saveUserProfile,
    signOut: signOutSession,
  } = useAuthSessionState({ showNotice });
  const {
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
    currentDayNote,
  } = usePlannerDataState({
    userId: user?.id ?? null,
    showNotice,
  });

  useEffect(() => {
    void bootstrapSession(loadPlannerData);
  }, [bootstrapSession, loadPlannerData]);

  async function requestCode(email: string, username: string) {
    const currentUser = await requestAuthCode(email, username);

    if (currentUser) {
      await loadPlannerData(currentUser.id);
    }
  }

  async function verifyCode(email: string, code: string, username: string) {
    const currentUser = await verifyAuthCode(email, code, username);

    if (currentUser) {
      await loadPlannerData(currentUser.id);
    }
  }

  async function signOut() {
    await signOutSession();
    resetPlannerData();
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
    dismissNotice,
    requestCode,
    verifyCode,
    resetChallenge,
    saveUserProfile,
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
    currentDayNote,
  };
}
