import {
  createRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlanDraft, createPlanFromDraft } from '../domain/planner';
import type { Plan } from '../types/domain';
import { usePlannerAppState } from './usePlannerAppState';

const repositoryUpsertPlanMock = vi.hoisted(() => vi.fn());
const approvalSavePlanMock = vi.hoisted(() => vi.fn());
const approvalCompleteOperationMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadPlannerDataMock = vi.hoisted(() => vi.fn(async () => undefined));
const editorSavePlanDraftMock = vi.hoisted(() => vi.fn(async () => undefined));
const showNoticeMock = vi.hoisted(() => vi.fn());
const bootstrapSessionMock = vi.hoisted(() => vi.fn(async () => undefined));
const plannerFixture = vi.hoisted(() => ({ plans: [] as Plan[] }));
const stableNoop = vi.hoisted(() => vi.fn());
const stableAsyncNoop = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../repositories', () => ({
  plannerRepository: {
    upsertPlan: repositoryUpsertPlanMock,
  },
}));

vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => ({
    saveApprovedPlan: approvalSavePlanMock,
    completeOperation: approvalCompleteOperationMock,
  }),
}));

vi.mock('./useNoticeState', () => ({
  useNoticeState: () => ({
    notice: null,
    showNotice: showNoticeMock,
    dismissNotice: stableNoop,
  }),
}));

vi.mock('./useAuthSessionState', () => ({
  useAuthSessionState: () => ({
    booting: false,
    user: {
      id: 'user-1',
      email: 'user@example.com',
      username: 'User',
      avatar: '',
      createdAt: '2026-07-18T00:00:00.000Z',
    },
    bootstrapSession: bootstrapSessionMock,
    signUpWithPassword: stableAsyncNoop,
    signInWithPassword: stableAsyncNoop,
    signInWithGoogle: stableAsyncNoop,
    sendPasswordReset: stableAsyncNoop,
    saveUserProfile: stableAsyncNoop,
    signOut: stableAsyncNoop,
  }),
}));

vi.mock('../data/naturalLanguageCatalog', () => ({
  loadNaturalLanguageCatalog: stableAsyncNoop,
}));

vi.mock('./usePlannerDataState', () => ({
  usePlannerDataState: () => ({
    plans: plannerFixture.plans,
    actuals: [],
    dayNotes: [],
    monthEvents: [],
    todos: [],
    studySubjects: [],
    studyMaterials: [],
    scheduleTemplates: [],
    timetableTerms: [],
    timetablePeriods: [],
    viewMode: 'month',
    selectedDate: '2026-07-14',
    monthDate: '2026-07-01',
    editorDraft: null,
    editingPlanId: null,
    editingPlan: null,
    isRecurringPlanEdit: false,
    pendingRecurringPlanAction: null,
    loadPlannerData: loadPlannerDataMock,
    resetPlannerData: stableNoop,
    setViewMode: stableNoop,
    openCreatePlan: stableNoop,
    openEditPlan: stableNoop,
    closePlanEditor: stableNoop,
    savePlanDraft: editorSavePlanDraftMock,
    deletePlan: stableAsyncNoop,
    confirmRecurringPlanScope: stableAsyncNoop,
    cancelRecurringPlanScope: stableNoop,
    saveActual: stableAsyncNoop,
    saveStandaloneActual: stableAsyncNoop,
    linkStandaloneActualToPlan: stableAsyncNoop,
    deleteActual: stableAsyncNoop,
    saveDayNote: stableAsyncNoop,
    saveMonthEvent: stableAsyncNoop,
    deleteMonthEvent: stableAsyncNoop,
    saveTodo: stableAsyncNoop,
    scheduleTodoAsPlan: stableAsyncNoop,
    deleteTodo: stableAsyncNoop,
    saveStudySubject: stableAsyncNoop,
    deleteStudySubject: stableAsyncNoop,
    saveStudyMaterial: stableAsyncNoop,
    deleteStudyMaterial: stableAsyncNoop,
    saveScheduleTemplate: stableAsyncNoop,
    deleteScheduleTemplate: stableAsyncNoop,
    activateTimetableTerm: stableAsyncNoop,
    deleteTimetableTerm: stableAsyncNoop,
    clearTimetableTermData: stableAsyncNoop,
    saveTimetablePeriod: stableAsyncNoop,
    deleteTimetablePeriod: stableAsyncNoop,
    selectDate: stableNoop,
    changeMonth: stableNoop,
    openWeek: stableNoop,
    openDay: stableNoop,
    setEditorDraft: stableNoop,
    currentDayNote: null,
  }),
}));

type PlannerAppState = ReturnType<typeof usePlannerAppState>;

const AppStateHarness = forwardRef<PlannerAppState>(function AppStateHarness(_, ref) {
  const state = usePlannerAppState();
  useImperativeHandle(ref, () => state, [state]);
  return null;
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createExistingPlan(id: string): Plan {
  const draft = {
    ...createEmptyPlanDraft('user-1', '2026-07-13'),
    title: '先に保存済み',
    subject: '英語',
    startTime: '09:00',
    endTime: '10:00',
  };
  return {
    ...createPlanFromDraft(draft),
    id,
  };
}

describe('usePlannerAppState weekly approval save', () => {
  let renderer: ReactTestRenderer;
  const ref = createRef<PlannerAppState>();

  beforeEach(async () => {
    plannerFixture.plans = [];
    repositoryUpsertPlanMock.mockReset();
    approvalSavePlanMock.mockReset();
    approvalCompleteOperationMock.mockClear();
    loadPlannerDataMock.mockClear();
    editorSavePlanDraftMock.mockClear();
    showNoticeMock.mockClear();
    bootstrapSessionMock.mockClear();
    await act(async () => {
      renderer = create(<AppStateHarness ref={ref} />);
    });
  });

  it('saves optimistically without changing editor or calendar UI state and returns the persisted Plan', async () => {
    const deferred = createDeferred<Plan>();
    approvalSavePlanMock.mockImplementation(() => deferred.promise);
    const draft = {
      ...createEmptyPlanDraft('user-1', '2026-07-20'),
      title: '承認予定',
      startTime: '18:00',
      endTime: '19:00',
    };
    let savePromise!: Promise<Plan>;

    await act(async () => {
      savePromise = ref.current!.saveWeeklyApprovedPlan(draft);
      await Promise.resolve();
    });

    expect(ref.current!.plans).toHaveLength(1);
    expect(ref.current!.plans[0].date).toBe('2026-07-20');
    expect(ref.current!.selectedDate).toBe('2026-07-14');
    expect(ref.current!.monthDate).toBe('2026-07-01');
    expect(ref.current!.viewMode).toBe('month');
    expect(ref.current!.editorDraft).toBeNull();
    expect(editorSavePlanDraftMock).not.toHaveBeenCalled();
    expect(showNoticeMock).not.toHaveBeenCalled();

    const optimisticPlan = approvalSavePlanMock.mock.calls[0][0] as Plan;
    const persistedPlan = { ...optimisticPlan, id: 'persisted-plan-1' };
    let result!: Plan;
    await act(async () => {
      deferred.resolve(persistedPlan);
      result = await savePromise;
    });

    expect(result.id).toBe('persisted-plan-1');
    expect(loadPlannerDataMock).toHaveBeenCalledWith('user-1');
    expect(editorSavePlanDraftMock).not.toHaveBeenCalled();
    expect(showNoticeMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('removes only the failed optimistic Plan and preserves an earlier Plan', async () => {
    const existingPlan = createExistingPlan('persisted-plan-earlier');
    plannerFixture.plans = [existingPlan];
    await act(async () => {
      renderer.update(<AppStateHarness ref={ref} />);
    });
    const deferred = createDeferred<Plan>();
    approvalSavePlanMock.mockImplementation(() => deferred.promise);
    const draft = {
      ...createEmptyPlanDraft('user-1', '2026-07-21'),
      title: '失敗予定',
      startTime: '20:00',
      endTime: '21:00',
    };
    let savePromise!: Promise<Plan>;

    await act(async () => {
      savePromise = ref.current!.saveWeeklyApprovedPlan(draft);
      await Promise.resolve();
    });
    expect(ref.current!.plans.map((plan) => plan.id)).toContain('persisted-plan-earlier');
    expect(ref.current!.plans).toHaveLength(2);

    await act(async () => {
      deferred.reject(new Error('forced-save-failure'));
      await expect(savePromise).rejects.toThrow('forced-save-failure');
    });

    expect(ref.current!.plans.map((plan) => plan.id)).toEqual(['persisted-plan-earlier']);
    expect(loadPlannerDataMock).not.toHaveBeenCalledWith('user-1');
    expect(editorSavePlanDraftMock).not.toHaveBeenCalled();
    expect(showNoticeMock).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});
