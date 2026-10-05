import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlannerMutationReconciliation } from '../domain/plannerMutationReconciliation';
import { PlannerMutationScopeExpiredError, usePlannerMutationScope, useScopedPlannerState } from './usePlannerMutationScope';
import { useOptimisticPlannerState } from './useOptimisticPlannerState';
import { ActualMutationAdmissionError, actualUnavailableMessage, useActualMutationAdmission, MaterialMutationAdmissionError, materialStaleMessage, materialRefreshMessage, type MaterialEditBaseline, type ActualActionTarget } from './useActualMutationAdmission';
import { removeByKey, upsertByKey } from '../lib/collections';
import {
  isSameMonth,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  todayIsoDate,
} from '../lib/date';
import {
  createTimetableTermId,
  createTimetableTermLabel,
  normalizeTimetableDate,
  sortTimetableTerms,
} from '../domain/timetableDataNormalization';
import {
  PlannerDataReadAuthority,
  type PlannerDataAvailability,
  type PlannerDataRecovery,
  type PlannerRepairTarget,
} from '../domain/plannerDataReadAuthority';
import {
  normalizePlannerTimetableData,
  resolveActualMaterialProgress,
} from '../domain/plannerDataTransforms';
import { createId } from '../lib/id';
import { buildPlanOccurrenceKey, getActualOccurrenceKey } from '../lib/planRecurrence';
import { sortMonthEvents } from '../lib/monthEvents';
import { plannerRepository } from '../repositories';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import {
  buildRecurringPlanDeleteMutation,
  buildRecurringPlanEditMutation,
} from '../domain/recurringPlanMutation';
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
  ViewMode,
} from '../types/domain';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
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

function getErrorDiagnostics(error: unknown): {
  code: string | null;
  message: string | null;
  customData?: unknown;
} {
  if (!error || typeof error !== 'object') {
    return {
      code: null,
      message: null,
    };
  }

  const firebaseError = error as {
    code?: string | null;
    message?: string | null;
    customData?: unknown;
  };

  return {
    code: firebaseError.code?.trim() || null,
    message: firebaseError.message?.trim() || null,
    customData: firebaseError.customData,
  };
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const diagnostics = getErrorDiagnostics(error);
    if (diagnostics.code && diagnostics.message) {
      return `${diagnostics.code}: ${diagnostics.message}`;
    }

    const message = error.message.trim();
    return message || fallback;
  }

  const diagnostics = getErrorDiagnostics(error);
  if (diagnostics.code && diagnostics.message) {
    return `${diagnostics.code}: ${diagnostics.message}`;
  }

  return diagnostics.message || fallback;
}

function summarizePlanForLog(plan: Plan) {
  return {
    id: plan.id,
    seriesId: plan.seriesId,
    userId: plan.userId,
    date: plan.date,
    occurrenceDate: plan.occurrenceDate ?? null,
    title: plan.title,
    repeat: plan.repeat,
    repeatUntil: plan.repeatUntil,
    excludedDates: plan.excludedDates,
    recurrenceRuleKinds: plan.recurrenceRules.map((rule) => rule.kind),
    hasOverrides: plan.recurrenceRules.some(
      (rule) => rule.isOverride || rule.kind === 'date',
    ),
  };
}

function sortStudySubjects(subjects: StudySubject[]): StudySubject[] {
  return subjects
    .slice()
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'ja') ||
        left.createdAt.localeCompare(right.createdAt),
    );
}

function sortStudyMaterials(materials: StudyMaterial[]): StudyMaterial[] {
  return materials
    .slice()
    .sort(
      (left, right) =>
        left.subjectName.localeCompare(right.subjectName, 'ja') ||
        left.name.localeCompare(right.name, 'ja') ||
        left.createdAt.localeCompare(right.createdAt),
    );
}

export interface UsePlannerDataStateResult {
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
  movePlanOccurrence: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
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

export function usePlannerDataState({
  userId,
  showNotice: showOwnerNotice,
}: UsePlannerDataStateOptions): UsePlannerDataStateResult {
  const { scope: mutationScope, invalidate: invalidateMutationScope } = usePlannerMutationScope(userId);
  const showNotice = useMemo(() => mutationScope.bindNotice(showOwnerNotice), [mutationScope, showOwnerNotice]);
  const planState = useOptimisticPlannerState<Plan[]>([], mutationScope);
  const { value: plans, set: setPlans, replace: rawSetPlans } = planState;
  const actualState = useOptimisticPlannerState<Actual[]>([], mutationScope);
  const { value: actuals, set: setActuals, replace: rawSetActuals } = actualState;
  const [dayNotes, setDayNotes, rawSetDayNotes] = useScopedPlannerState<DayNote[]>([], mutationScope);
  const monthEventState = useOptimisticPlannerState<MonthEvent[]>([], mutationScope);
  const { value: monthEvents, set: setMonthEvents, replace: rawSetMonthEvents } = monthEventState;
  const [studySubjects, setStudySubjects, rawSetStudySubjects] = useScopedPlannerState<StudySubject[]>([], mutationScope);
  const [studyMaterials, setStudyMaterials, rawSetStudyMaterials] = useScopedPlannerState<StudyMaterial[]>([], mutationScope);
  const actualAdmission = useActualMutationAdmission(mutationScope, userId, actuals, plans, monthEvents, studyMaterials, studySubjects);
  const committedActualAdmission = useRef<{
    ownerId: string | null;
    scope: typeof mutationScope;
    admission: typeof actualAdmission;
  } | null>(null);
  useLayoutEffect(() => {
    const committed = { ownerId: userId, scope: mutationScope, admission: actualAdmission };
    committedActualAdmission.current = committed;
    return () => { if (committedActualAdmission.current === committed) committedActualAdmission.current = null; };
  }, [actualAdmission, mutationScope, userId]);
  const todoState = useOptimisticPlannerState<TodoTask[]>([], mutationScope);
  const { value: todos, set: setTodos, replace: rawSetTodos } = todoState;
  const [scheduleTemplates, setScheduleTemplates, rawSetScheduleTemplates] = useScopedPlannerState<ScheduleTemplate[]>([], mutationScope);
  const [timetableTerms, setTimetableTerms, rawSetTimetableTerms] = useScopedPlannerState<TimetableTerm[]>([], mutationScope);
  const [timetablePeriods, setTimetablePeriods, rawSetTimetablePeriods] = useScopedPlannerState<TimetablePeriod[]>([], mutationScope);
  const plannerDataReadAuthorityRef = useRef<PlannerDataReadAuthority | null>(null);
  if (!plannerDataReadAuthorityRef.current) {
    plannerDataReadAuthorityRef.current = new PlannerDataReadAuthority();
  }
  const plannerDataReadAuthority = plannerDataReadAuthorityRef.current;
  const [plannerDataReadSnapshot, setPlannerDataReadSnapshot] = useState(() => plannerDataReadAuthority.readSnapshot());
  const { availability: plannerDataAvailability, recovery: plannerDataRecovery } = plannerDataReadSnapshot;
  const publishReadSnapshot = useCallback(() => {
    setPlannerDataReadSnapshot(plannerDataReadAuthority.readSnapshot());
  }, [plannerDataReadAuthority]);
  type RepairSnapshot = {
    actualMaterial?: { actuals: Actual[]; materials: StudyMaterial[]; subjects?: StudySubject[] };
    monthEvents?: MonthEvent[];
    plansTodos?: { plans: Plan[]; todos: TodoTask[] };
  };
  const reconciliationRef = useRef<PlannerMutationReconciliation<RepairSnapshot> | null>(null);
  if (!reconciliationRef.current) reconciliationRef.current = new PlannerMutationReconciliation(plannerDataReadAuthority);
  const reconciliation = reconciliationRef.current;
  const mounted = useRef(false);
  // Only a committed owner/scope may change the coordinator's callbacks. A
  // suspended render for another owner must not revoke the visible owner's read.
  useLayoutEffect(() => {
    reconciliation.configure({
      isCurrent: ownerId => mounted.current && userId === ownerId && mutationScope.isCurrent(),
      read: async (ownerId, targets) => {
        // Capture the optional subject dependency once for this attempt. A
        // later fanout changes reconciliation activity and invalidates the
        // whole snapshot before publication; it cannot borrow this receipt.
        const repairSubjects = actualAdmission.requiresSubjectRepair();
        const [actualMaterial, nextMonthEvents, plansTodos] = await Promise.all([
          targets.includes('actual-material') ? Promise.all([
            plannerRepository.getActuals(ownerId),
            plannerRepository.getStudyMaterials(ownerId),
            repairSubjects ? plannerRepository.getStudySubjects(ownerId) : undefined,
          ]) : undefined,
          targets.includes('month-events') ? plannerRepository.getMonthEvents(ownerId) : undefined,
          targets.includes('plans-todos') ? Promise.all([
            plannerRepository.getPlans(ownerId),
            plannerRepository.getTodos(ownerId),
          ]) : undefined,
        ]);
        // Prepare every requested group before publishing any. A failure keeps
        // the whole batch retryable, without certifying or replacing one slice.
        return {
          actualMaterial: actualMaterial ? {
            actuals: actualMaterial[0], materials: sortStudyMaterials(actualMaterial[1]), subjects: actualMaterial[2] ? sortStudySubjects(actualMaterial[2]) : undefined,
          } : undefined,
          monthEvents: nextMonthEvents ? sortMonthEvents(nextMonthEvents) : undefined,
          plansTodos: plansTodos ? { plans: sortByDateTime(plansTodos[0]), todos: plansTodos[1] } : undefined,
        };
      },
      publish: snapshot => {
        if (snapshot.actualMaterial) {
          rawSetActuals(snapshot.actualMaterial.actuals);
          actualAdmission.refreshed(['actual-material']);
          rawSetStudyMaterials(snapshot.actualMaterial.materials);
          if (snapshot.actualMaterial.subjects) rawSetStudySubjects(snapshot.actualMaterial.subjects);
        }
        if (snapshot.monthEvents) rawSetMonthEvents(snapshot.monthEvents);
        if (snapshot.plansTodos) {
          rawSetPlans(snapshot.plansTodos.plans);
          rawSetTodos(snapshot.plansTodos.todos);
          actualAdmission.refreshed(['plans-todos']);
        }
      },
      changed: publishReadSnapshot,
    });
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      plannerDataReadAuthority.reset();
      reconciliation.reset(null);
    };
  }, [plannerDataReadAuthority, reconciliation]);
  useLayoutEffect(() => {
    const scope = plannerDataReadAuthority.captureOwnerScope();
    if (scope && scope.ownerId !== userId) {
      plannerDataReadAuthority.reset();
      publishReadSnapshot();
    }
    // The initial load can begin before the auth-state render. Adopt that same
    // owner without resetting activity again when its render catches up.
    reconciliation.activateOwner(userId);
    reconciliation.pump();
  }, [userId, mutationScope, plannerDataReadAuthority, publishReadSnapshot, reconciliation]);
  function trackMutation<Args extends unknown[], Result>(
    operation: (...args: Args) => Promise<Result>,
    targets: readonly PlannerRepairTarget[] = [],
  ) {
    return mutationScope.bindMutation(async (...args: Args) => {
      const ticket = reconciliation.beginMutation(targets);
      let outcome: 'success' | 'failure' = 'failure';
      try {
        const result = await operation(...args);
        outcome = 'success';
        return result;
      } finally { reconciliation.settleMutation(ticket, outcome); }
    });
  }
  const projectionLease = plannerDataReadSnapshot.projectionLease;
  const isPlannerDataSnapshotCurrent = useCallback(() => mutationScope.isCurrent() && projectionLease !== null
    && projectionLease.ownerId === userId && plannerDataReadAuthority.isProjectionUsable(projectionLease),
  [mutationScope, projectionLease, userId, plannerDataReadAuthority]);
  const clearPlannerDataCollections = useCallback(() => {
    rawSetPlans([]);
    rawSetActuals([]);
    rawSetDayNotes([]);
    rawSetMonthEvents([]);
    rawSetTodos([]);
    rawSetStudySubjects([]);
    rawSetStudyMaterials([]);
    rawSetScheduleTemplates([]);
    rawSetTimetableTerms([]);
    rawSetTimetablePeriods([]);
  }, []);
  const [viewMode, setViewMode] = useScopedPlannerState<ViewMode>('month', mutationScope);
  const selectionState = useOptimisticPlannerState(selectionAt(todayIsoDate()), mutationScope);
  const { selectedDate, monthDate } = selectionState.value;
  // Preserve current calendar position while discarding old scope's pending intents.
  useLayoutEffect(() => { selectionState.replace(current => current); }, [mutationScope, selectionState.replace]);
  function selectionAt(date: string) { return { selectedDate: date, monthDate: startOfMonth(date) }; }
  const [editorDraft, setEditorDraft, rawSetEditorDraft] = useScopedPlannerState<PlanDraft | null>(null, mutationScope);
  const [editingPlanId, setEditingPlanId, rawSetEditingPlanId] = useScopedPlannerState<string | null>(null, mutationScope);
  const [editingPlan, setEditingPlan, rawSetEditingPlan] = useScopedPlannerState<Plan | null>(null, mutationScope);
  const [pendingRecurringPlanAction, setPendingRecurringPlanAction, rawSetPendingRecurringPlanAction] = useScopedPlannerState<PendingRecurringPlanActionState | null>(null, mutationScope);

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

  function upsertActualsById(current: Actual[], nextActuals: Actual[]): Actual[] {
    return nextActuals.reduce(
      (records, nextActual) => upsertByKey(records, nextActual, (actual) => actual.id),
      current,
    );
  }

  function upsertActualByOccurrenceKey(
    current: Actual[],
    nextActual: Actual,
    removedActualIds: string[] = [],
  ): Actual[] {
    const removedIdSet = new Set(removedActualIds);

    return upsertByKey(
      current.filter((actual) => !removedIdSet.has(actual.id)),
      nextActual,
      (actual) => getActualOccurrenceKey(actual),
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
    if (!mounted.current) return;
    reconciliation.activateOwner(nextUserId);
    const fullReadActivity = reconciliation.captureActivity();
    const loadStart = plannerDataReadAuthority.begin(nextUserId, new Date().toISOString());
    publishReadSnapshot();
    if (loadStart.ownerChanged) {
      invalidateMutationScope();
      clearPlannerDataCollections();
      rawSetEditorDraft(null);
      rawSetEditingPlanId(null);
      rawSetEditingPlan(null);
      rawSetPendingRecurringPlanAction(null);
    }

    try {
      const [
      nextPlans,
      nextActuals,
      nextDayNotes,
      nextMonthEvents,
      nextTodos,
      nextStudySubjects,
      nextStudyMaterials,
      nextScheduleTemplates,
      nextTimetableTerms,
      nextTimetablePeriods,
    ] = await Promise.all([
      plannerRepository.getPlans(nextUserId),
      plannerRepository.getActuals(nextUserId),
      plannerRepository.getDayNotes(nextUserId),
      plannerRepository.getMonthEvents(nextUserId),
      plannerRepository.getTodos(nextUserId),
      plannerRepository.getStudySubjects(nextUserId),
      plannerRepository.getStudyMaterials(nextUserId),
      plannerRepository.getScheduleTemplates(nextUserId),
      plannerRepository.getTimetableTerms(nextUserId),
      plannerRepository.getTimetablePeriods(nextUserId),
    ]);

    if (!plannerDataReadAuthority.isCurrent(loadStart.token)) {
      return;
    }

    const normalizedTimetable = normalizePlannerTimetableData(
      nextUserId,
      {
        scheduleTemplates: nextScheduleTemplates,
        timetableTerms: nextTimetableTerms,
        timetablePeriods: nextTimetablePeriods,
      },
      new Date().toISOString(),
    );
    let committedScheduleTemplates = normalizedTimetable.scheduleTemplates;
    let committedTimetableTerms = normalizedTimetable.timetableTerms;
    let committedTimetablePeriods = normalizedTimetable.timetablePeriods;

    try {
      await plannerRepository.applyTimetableMutation(normalizedTimetable.mutation);
    } catch (error) {
      if (!plannerDataReadAuthority.isCurrent(loadStart.token)) {
        return;
      }
      console.warn('[Timetable] term canonicalization failed', error);
      committedScheduleTemplates = nextScheduleTemplates;
      committedTimetableTerms = nextTimetableTerms;
      committedTimetablePeriods = nextTimetablePeriods;
      showOwnerNotice('時間割データを整合化できませんでした。再読み込みしてください。', 'error');
    }

      if (!plannerDataReadAuthority.isCurrent(loadStart.token)) {
        return;
      }

      rawSetPlans(sortByDateTime(nextPlans));
      rawSetActuals(nextActuals);
      rawSetDayNotes(nextDayNotes);
      rawSetMonthEvents(sortMonthEvents(nextMonthEvents));
      rawSetTodos(nextTodos);
      rawSetStudySubjects(sortStudySubjects(nextStudySubjects));
      rawSetStudyMaterials(sortStudyMaterials(nextStudyMaterials));
      rawSetScheduleTemplates(committedScheduleTemplates);
      rawSetTimetableTerms(committedTimetableTerms);
      rawSetTimetablePeriods(committedTimetablePeriods);
      // Auth retains this loader across owner/scope recreation. Resolve only
      // the committed current owner here; an abandoned render cannot redirect
      // read publication or make a retained loader use a revoked admission map.
      const committed = committedActualAdmission.current;
      const readAdmission = committed?.ownerId === nextUserId && committed.scope.isCurrent()
        ? committed.admission : null;
      const fullReadIsQuiescent = reconciliation.isQuiescentSince(fullReadActivity);
      const readyAvailability = plannerDataReadAuthority.succeed(
        loadStart.token,
        new Date().toISOString(),
        fullReadIsQuiescent,
        [
          ...reconciliation.successfulTargetsSince(fullReadActivity),
          ...reconciliation.planRestoreTargetsSince(fullReadActivity),
          // A nonquiescent full read cannot certify an outstanding claim. Keep
          // its required groups in the canonical concern, even if this newer
          // full read would otherwise retire the older repair request.
          ...(!fullReadIsQuiescent ? readAdmission?.requiredProjections() ?? [] : []),
        ],
      );
      if (readyAvailability) {
        if (fullReadIsQuiescent) readAdmission?.refreshed(['actual-material', 'plans-todos']);
        publishReadSnapshot();
      }
    } catch (error) {
      const failedAvailability = plannerDataReadAuthority.fail(
        loadStart.token,
        new Date().toISOString(),
      );
      if (!failedAvailability) {
        return;
      }
      publishReadSnapshot();
      throw error;
    } finally {
      reconciliation.pump();
    }
  }, [clearPlannerDataCollections, invalidateMutationScope, plannerDataReadAuthority, publishReadSnapshot, reconciliation, showOwnerNotice]);

  const resetPlannerData = useCallback(() => {
    invalidateMutationScope();
    plannerDataReadAuthority.reset();
    reconciliation.reset();
    publishReadSnapshot();
    clearPlannerDataCollections();
    rawSetEditorDraft(null);
    rawSetEditingPlanId(null);
    rawSetEditingPlan(null);
    rawSetPendingRecurringPlanAction(null);
  }, [clearPlannerDataCollections, invalidateMutationScope, plannerDataReadAuthority, publishReadSnapshot, reconciliation]);

  const retryPlannerData = async () => {
    if (!mutationScope.isCurrent() || !projectionLease || projectionLease.ownerId !== userId) return;
    const action = plannerDataReadAuthority.retryAction(projectionLease);
    if (action === 'full') {
      // Full load classifies its own failure; a click must not reject unhandled.
      try { await loadPlannerData(projectionLease.ownerId); } catch { /* Persistent recovery owns the error. */ }
    } else if (action === 'projection' && plannerDataReadAuthority.retryReconciliation(projectionLease, new Date().toISOString())) {
      publishReadSnapshot();
      reconciliation.pump();
    }
  };

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
    const sourcePlan = requireCurrentPlan(occurrencePlan);
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    let releaseAdmission: ReturnType<typeof admitActualMutation> | undefined;
    let needsRefresh = false;
    const occurrenceDate = occurrencePlan.occurrenceDate ?? occurrencePlan.date;

    try {
      const mutation =
        pendingRecurringPlanAction.kind === 'edit'
          ? pendingRecurringPlanAction.draft
            ? buildRecurringPlanEditMutation(
                actualAdmission.plans(),
                actualAdmission.current(),
                sourcePlan,
                occurrenceDate,
                pendingRecurringPlanAction.draft,
                scope,
              )
            : null
          : buildRecurringPlanDeleteMutation(
              actualAdmission.plans(),
              actualAdmission.current(),
              sourcePlan,
              occurrenceDate,
              scope,
            );

      if (!mutation) {
        return;
      }

      const affectedPlanIds = [...new Set([
        sourcePlan.id,
        ...mutation.planUpserts.map(plan => plan.id),
        ...mutation.planDeletes.map(plan => plan.id),
        ...[...mutation.actualUpserts, ...mutation.actualDeletes].flatMap(actual => actual.planId ? [actual.planId] : []),
      ])];
      releaseAdmission = admitActualMutation([...mutation.actualUpserts, ...mutation.actualDeletes], affectedPlanIds);
      await plannerRepository.applyRecurringPlanMutation(userId, mutation);
      const deletedPlanIds = new Set(
        mutation.planDeletes.map((plan) => plan.id),
      );
      const deletedActualIds = new Set(
        mutation.actualDeletes.map((actual) => actual.id),
      );
      needsRefresh = Boolean(acknowledgedProjection && plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection));
      if (!needsRefresh) {
        setPlans((current) =>
          sortAndUpsertPlans(
            current.filter((plan) => !deletedPlanIds.has(plan.id)),
            mutation.planUpserts,
          ),
        );
        setActuals((current) =>
          upsertActualsById(
            current.filter(
              (actual) =>
                !deletedActualIds.has(actual.id) &&
                (!actual.planId || !deletedPlanIds.has(actual.planId)),
            ),
            mutation.actualUpserts,
          ),
        );
      }

      if (pendingRecurringPlanAction.kind === 'edit') {
        selectionState.set(selectionAt(occurrenceDate));
      }
      setPendingRecurringPlanAction(null);
      closePlanEditor();
      if (pendingRecurringPlanAction.kind === 'edit') {
        showNotice('繰り返し予定を更新しました。', 'success');
      } else {
        showNotice('繰り返し予定を削除しました。');
      }
    } catch (error) {
      if (!mutationScope.isCurrent() || error instanceof ActualMutationAdmissionError) throw error;
      console.error('[RecurringPlanScope] failed', {
        action: pendingRecurringPlanAction.kind,
        scope,
        source:
          editingPlanId && editingPlanId === sourcePlan.id
            ? 'plan-editor'
            : 'plan-card',
        userId,
        sourcePlan: summarizePlanForLog(sourcePlan),
        error: getErrorDiagnostics(error),
      });
      try { await loadPlannerData(userId); }
      catch { needsRefresh = true; }
      showNotice(
        resolveErrorMessage(
          error,
          pendingRecurringPlanAction.kind === 'edit'
            ? '繰り返し予定の更新に失敗しました。'
            : '繰り返し予定の削除に失敗しました。',
        ),
        'error',
      );
    } finally {
      if (releaseAdmission) settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material', 'plans-todos'], needsRefresh);
    }
  }

  async function movePlanOccurrence(plan: Plan, target: WeekPlanMoveTarget) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(target.startTime, target.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }

    const sourcePlan = resolveStoredPlan(plan);
    const occurrenceDate = plan.occurrenceDate ?? plan.date;
    const draft: PlanDraft = {
      ...createPlanDraftFromPlan(plan),
      date: target.date,
      startTime: target.startTime,
      endTime: target.endTime,
    };

    if (isScopedRecurringEditCandidate(sourcePlan)) {
      if (target.date !== occurrenceDate) {
        showNotice(
          '繰り返し予定は週表示のドラッグでは曜日を変更できません。時刻は変更できます。',
          'info',
        );
        return;
      }

      setPendingRecurringPlanAction({
        kind: 'edit',
        plan,
        draft,
      });
      return;
    }

    const nextPlan = createPlanFromDraft(draft, sourcePlan);
    const planOperation = planState.begin(current => sortByDateTime(upsertByKey(current, nextPlan, plan => plan.id)));

    try {
      await plannerRepository.upsertPlan(nextPlan);
      planState.commit(planOperation);
      showNotice('予定を移動しました。', 'success');
    } catch (error) {
      planState.reject(planOperation);
      showNotice(
        resolveErrorMessage(error, '予定を移動できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function savePlanDraft(draft: PlanDraft, targetPlanId?: string) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('終了時刻は開始時刻より後にしてください。');
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
    const planOperation = planState.begin(current => sortByDateTime(upsertByKey(current, nextPlan, plan => plan.id)));
    const selectionOperation = selectionState.begin(() => selectionAt(nextPlan.date));

    try {
      closePlanEditor();
      await plannerRepository.upsertPlan(nextPlan);
      selectionState.commit(selectionOperation);
      planState.commit(planOperation);
      showNotice(
        currentPlan ? '学習予定を更新しました。' : '学習予定を追加しました。',
        'success',
      );
    } catch (error) {
      planState.reject(planOperation);
      selectionState.reject(selectionOperation);
      showNotice(
        resolveErrorMessage(error, '学習予定を保存できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  function showDeleteUndoNotice(onUndo: () => Promise<void>, targets: readonly PlannerRepairTarget[] = []) {
    showNotice('削除しました', 'info', {
      actionLabel: '元に戻す',
      durationMs: 8000,
      placement: 'bottom',
      onAction: async () => {
        try {
          await trackMutation(onUndo, targets)();
          showNotice('元に戻しました。', 'success');
        } catch (error) {
          showNotice(resolveErrorMessage(error, '復元できませんでした。'), 'error');
        }
      },
    });
  }

  async function deletePlan(plan: Plan) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (isScopedRecurringEditCandidate(plan)) {
      setPendingRecurringPlanAction({ kind: 'delete', plan });
      return;
    }

    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    const releaseAdmission = admitActualMutation([], [plan.id]);
    try { plan = requireCurrentPlan(plan); } catch (error) { releaseAdmission(); throw error; }
    const linkedTodo =
      plan.sourceType === 'todo' && plan.sourceId
        ? todos.find(
            (todo) => todo.id === plan.sourceId && todo.scheduledPlanId === plan.id,
          ) ?? null
        : null;
    const linkedActuals = actualAdmission.current().filter((actual) => actual.planId === plan.id);
    const nextLinkedTodo = linkedTodo
      ? {
          ...linkedTodo,
          status: 'open' as const,
          scheduledPlanId: null,
          updatedAt: new Date().toISOString(),
        }
      : null;

    const planOperation = planState.begin(current => removeByKey(current, plan.id, item => item.id));
    const actualOperation = actualState.begin(current => current.filter(actual => actual.planId !== plan.id));
    const todoOperation = todoState.begin(current => nextLinkedTodo
      ? upsertByKey(current, nextLinkedTodo, todo => todo.id) : current);
    try {
      closePlanEditor();
      await plannerRepository.deletePlanWithDependents({
        userId,
        plan,
        todo: nextLinkedTodo,
      });
      planState.commit(planOperation);
      actualState.commit(actualOperation);
      todoState.commit(todoOperation);
      showDeleteUndoNotice(async () => {
        const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
        // Only local owner admission is known to reject safely before dispatch.
        // Repository validation/outcome policy remains behind its own boundary.
        if (!mutationScope.isCurrent() || !acknowledgedProjection
          || acknowledgedProjection.ownerId !== userId || plan.userId !== userId) {
          throw new PlannerMutationScopeExpiredError();
        }
        const releaseRestoreAdmission = admitActualMutation(linkedActuals, [plan.id]);
        const restore = reconciliation.beginPlanRestore();
        let restoreNeedsRefresh = false;
        let outcome: 'success' | 'failure' = 'failure';
        try {
          await plannerRepository.restorePlanWithDependents({
            plan,
            actuals: linkedActuals,
            todo: linkedTodo,
          });
          outcome = 'success';
          // Publish all captured dependents under one accepted-projection lease.
          // A failed/superseded read alone does not revoke this acknowledgement.
          if (!mutationScope.isCurrent() || !plannerDataReadAuthority.isOwnerCurrent(acknowledgedProjection)) return;
          if (plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
            restoreNeedsRefresh = true;
            return;
          }
          setPlans((current) => sortAndUpsertPlans(current, [plan]));
          if (linkedActuals.length > 0) {
            setActuals((current) => upsertActualsById(current, linkedActuals));
          }
          if (linkedTodo) {
            setTodos((current) => upsertByKey(current, linkedTodo, (item) => item.id));
          }
        } finally {
          settleActualAdmission(releaseRestoreAdmission, acknowledgedProjection, ['actual-material', 'plans-todos'], restoreNeedsRefresh || outcome === 'failure');
          reconciliation.settleMutation(restore, outcome);
        }
      });
    } catch (error) {
      planState.reject(planOperation);
      actualState.reject(actualOperation);
      todoState.reject(todoOperation);
      showNotice(resolveErrorMessage(error, '予定を削除できませんでした。'), 'error');
      throw error;
    } finally {
      settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material', 'plans-todos']);
    }
  }

  function requireCurrentActual(id: string): Actual {
    const current = actualAdmission.current().find(actual => actual.id === id && actual.userId === userId);
    const reason = actualAdmission.reason(current ?? { id, userId: userId ?? '', planId: null, occurrenceDate: '' });
    if (reason || !current) {
      const error = new ActualMutationAdmissionError(reason ?? actualUnavailableMessage);
      showNotice(error.message, 'error');
      throw error;
    }
    return current;
  }

  function admitActualMutation(targets: ActualActionTarget[], planIds: string[] = [], materialIds: string[] = [], subjectIds: string[] = []) {
    try {
      if (materialIds.length || subjectIds.length) {
        const lease = plannerDataReadAuthority.captureProjectionLease();
        // Use the canonical owner/read lifetime, not a second readiness flag.
        // A first-load/old-owner callback cannot dispatch a write for which
        // unknown-outcome repair has no current owner projection to certify.
        if (!lease || lease.ownerId !== userId || !plannerDataReadAuthority.isOwnerCurrent(lease)
          || plannerDataReadAuthority.read().lastSuccessfulAt === null) {
          throw new MaterialMutationAdmissionError(materialRefreshMessage);
        }
      }
      return actualAdmission.acquire(targets, planIds, materialIds, subjectIds);
    } catch (error) {
      showNotice(resolveErrorMessage(error, '記録を更新できませんでした。'), 'error');
      throw error;
    }
  }

  function settleActualAdmission(
    release: ReturnType<typeof actualAdmission.acquire>,
    lease: ReturnType<typeof plannerDataReadAuthority.captureProjectionLease>,
    targets: readonly ('actual-material' | 'plans-todos')[] = ['actual-material'],
    forceRepair = false,
  ) {
    const needsRefresh = Boolean(lease && mutationScope.isCurrent()
      && plannerDataReadAuthority.isOwnerCurrent(lease)
      && (forceRepair || plannerDataReadAuthority.hasAcceptedProjectionChanged(lease)
        // An in-flight full read can still install its pre-mutation snapshot
        // after this promise settles. Retain the claim through its repair too.
        || plannerDataReadAuthority.read().status === 'loading'));
    if (needsRefresh && lease) reconciliation.request(lease, targets);
    release(needsRefresh ? targets : false);
  }

  function requireLinkedTarget(planId: string, occurrenceDate: string) {
    const reason = actualAdmission.reason({ userId: userId ?? '', planId, occurrenceDate });
    if (reason || !actualAdmission.hasLinkedTarget(planId)) {
      const error = new ActualMutationAdmissionError(reason ?? actualUnavailableMessage);
      showNotice(error.message, 'error');
      throw error;
    }
  }

  function requireCurrentPlan(plan: Plan): Plan {
    const current = actualAdmission.plans().find(item => item.id === plan.id && item.userId === userId);
    if (!current || plan.userId !== userId) {
      const error = new ActualMutationAdmissionError(actualUnavailableMessage);
      showNotice(error.message, 'error');
      throw error;
    }
    return current;
  }

  async function saveActual(_plan: Plan, draft: ActualDraft, targetActualId?: string) {
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    if (draft.planId) requireLinkedTarget(draft.planId, draft.occurrenceDate);
    const occurrenceKey = draft.planId ? buildPlanOccurrenceKey(draft.planId, draft.occurrenceDate) : null;
    const existingActual = targetActualId
      ? requireCurrentActual(targetActualId)
      : actualAdmission.current().find((actual) => getActualOccurrenceKey(actual) === occurrenceKey);
    const nextActual = createActualFromDraft(userId, draft, existingActual);
    // Dependencies include missing, disabled and clamped rows. Admission must
    // precede resolving the absolute payload, including for retained callbacks.
    const materialIds = existingActual ? [] : nextActual.materialProgressUpdates?.map(update => update.materialId) ?? [];
    const releaseAdmission = admitActualMutation([...(existingActual ? [existingActual] : []), nextActual], [], materialIds);
    const progress = existingActual
      ? { changedMaterials: [] as StudyMaterial[] }
      : resolveActualMaterialProgress(actualAdmission.materials(), nextActual, new Date().toISOString());
    let dispatchedFailure = false;
    const actualOperation = actualState.begin((current) =>
      upsertActualByOccurrenceKey(
        targetActualId ? current.filter((actual) => actual.id !== targetActualId) : current,
        nextActual,
      ),
    );

    try {
      const savedActual = await plannerRepository.upsertActualWithMaterialProgress({
        actual: nextActual,
        materials: progress.changedMaterials,
      });
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setActuals((current) =>
          upsertActualByOccurrenceKey(
            current,
            savedActual,
            targetActualId ? [targetActualId, nextActual.id] : [nextActual.id],
          ),
        );
        if (progress.changedMaterials.length > 0) {
          setStudyMaterials((current) =>
            sortStudyMaterials(
              progress.changedMaterials.reduce(
                (records, nextMaterial) =>
                  upsertByKey(records, nextMaterial, (material) => material.id),
                current,
              ),
            ),
          );
        }
      }
      actualState.commit(actualOperation);
      showNotice('記録を保存しました。', 'success');
    } catch (error) {
      dispatchedFailure = materialIds.length > 0;
      actualState.reject(actualOperation);
      showNotice(resolveErrorMessage(error, '記録を保存できませんでした。'), 'error');
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material'], dispatchedFailure); }
  }

  async function saveStandaloneActual(draft: ActualDraft, targetActualId?: string) {
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    if (!draft.title.trim()) {
      showNotice('記録のタイトルを入力してください。', 'error');
      throw new Error('記録のタイトルを入力してください。');
    }
    if (minutesBetween(draft.actualStartTime, draft.actualEndTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }
    const existingActual = targetActualId
      ? requireCurrentActual(targetActualId)
      : undefined;
    if (existingActual?.planId) {
      const message = actualUnavailableMessage;
      showNotice(message, 'error');
      throw new ActualMutationAdmissionError(message);
    }
    const nextActual = createActualFromDraft(
      userId,
      {
        ...draft,
        planId: null,
        title: draft.title.trim(),
        subject: draft.subject.trim(),
        isAlignedToPlan: false,
        note: draft.note.trim(),
      },
      existingActual,
    );
    // Dependencies include missing, disabled and clamped rows. Admission must
    // precede resolving the absolute payload, including for retained callbacks.
    const materialIds = existingActual ? [] : nextActual.materialProgressUpdates?.map(update => update.materialId) ?? [];
    const releaseAdmission = admitActualMutation([...(existingActual ? [existingActual] : []), nextActual], [], materialIds);
    const progress = existingActual
      ? { changedMaterials: [] as StudyMaterial[] }
      : resolveActualMaterialProgress(actualAdmission.materials(), nextActual, new Date().toISOString());
    let dispatchedFailure = false;
    const actualOperation = actualState.begin((current) =>
      upsertByKey(
        targetActualId ? current.filter((actual) => actual.id !== targetActualId) : current,
        nextActual,
        (item) => getActualOccurrenceKey(item),
      ),
    );

    try {
      const savedActual = await plannerRepository.upsertActualWithMaterialProgress({
        actual: nextActual,
        materials: progress.changedMaterials,
      });
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setActuals((current) =>
          upsertByKey(
            current.filter((actual) => actual.id !== nextActual.id),
            savedActual,
            (item) => getActualOccurrenceKey(item),
          ),
        );
        if (progress.changedMaterials.length > 0) {
          setStudyMaterials((current) =>
            sortStudyMaterials(
              progress.changedMaterials.reduce(
                (records, nextMaterial) =>
                  upsertByKey(records, nextMaterial, (material) => material.id),
                current,
              ),
            ),
          );
        }
      }
      actualState.commit(actualOperation);
      showNotice('記録を保存しました。', 'success');
    } catch (error) {
      dispatchedFailure = materialIds.length > 0;
      actualState.reject(actualOperation);
      showNotice(resolveErrorMessage(error, '記録を保存できませんでした。'), 'error');
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material'], dispatchedFailure); }
  }

  async function linkStandaloneActualToPlan(actual: Actual, plan: Plan) {
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const sourceActual = requireCurrentActual(actual.id);
    if (sourceActual.planId) {
      showNotice('この記録はすでに予定に紐づいています。', 'error');
      throw new Error('この記録はすでに予定に紐づいています。');
    }

    const occurrenceDate = actual.occurrenceDate;
    requireLinkedTarget(plan.id, occurrenceDate);
    const destination = { userId, planId: plan.id, occurrenceDate };
    const destinationReason = actualAdmission.reason(destination);
    if (destinationReason) {
      showNotice(destinationReason, 'error');
      throw new ActualMutationAdmissionError(destinationReason);
    }
    const existingLinkedActual = actualAdmission.current().find(
      (item) =>
        item.id !== actual.id &&
        item.planId === plan.id &&
        item.occurrenceDate === occurrenceDate,
    );

    if (existingLinkedActual) {
      showNotice('この予定にはすでに記録があります。', 'error');
      throw new Error('この予定にはすでに記録があります。');
    }

    const nextActual: Actual = {
      ...actual,
      planId: plan.id,
      title: actual.title?.trim() || plan.title,
      subject: actual.subject.trim() || plan.subject,
      isAlignedToPlan: false,
      note: actual.note.trim(),
      updatedAt: new Date().toISOString(),
    };

    const releaseAdmission = admitActualMutation([sourceActual, nextActual]);
    const actualOperation = actualState.begin((current) =>
      upsertByKey(
        current.filter((item) => item.id !== actual.id),
        nextActual,
        (item) => getActualOccurrenceKey(item),
      ),
    );

    try {
      const savedActual = await plannerRepository.upsertActual(nextActual);
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setActuals((current) =>
          upsertByKey(
            current.filter((item) => item.id !== actual.id),
            savedActual,
            (item) => getActualOccurrenceKey(item),
          ),
        );
      }
      actualState.commit(actualOperation);
      showNotice('予定に紐づけました。', 'success');
    } catch (error) {
      actualState.reject(actualOperation);
      showNotice(
        resolveErrorMessage(error, '予定に紐づけできませんでした。'),
        'error',
      );
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection); }
  }

  async function deleteActual(actual: Actual) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    actual = requireCurrentActual(actual.id);
    const releaseAdmission = admitActualMutation([actual]);
    const actualOperation = actualState.begin((current) => removeByKey(current, actual.id, (item) => item.id));

    try {
      await plannerRepository.deleteActual(userId, actual.id);
      actualState.commit(actualOperation);
      showNotice('記録を削除しました。');
    } catch (error) {
      actualState.reject(actualOperation);
      showNotice(
        resolveErrorMessage(error, '記録を削除できませんでした。'),
        'error',
      );
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection); }
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
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('主要予定の終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('主要予定の終了時刻は開始時刻より後にしてください。');
    }

    if (!draft.title.trim()) {
      showNotice('主要予定のタイトルを入れてください。', 'error');
      throw new Error('主要予定のタイトルを入れてください。');
    }

    const currentMonthEvent = monthEvents.find(
      (monthEvent) => monthEvent.id === targetMonthEventId,
    );
    const nextMonthEvent = createMonthEventFromDraft(draft, currentMonthEvent);
    const selectionOperation = selectionState.begin(() => selectionAt(
      currentMonthEvent && (
        currentMonthEvent.date === nextMonthEvent.date
        || isSameMonth(selectedDate, nextMonthEvent.date)
      )
        ? selectedDate : nextMonthEvent.date,
    ));

    const monthEventOperation = monthEventState.begin((current) =>
      sortMonthEvents(upsertByKey(current, nextMonthEvent, (item) => item.id)),
    );
    try {
      await plannerRepository.upsertMonthEvent(nextMonthEvent);
      monthEventState.commit(monthEventOperation);
      selectionState.commit(selectionOperation);
      showNotice(
        currentMonthEvent ? '月の主要予定を更新しました。' : '月の主要予定を追加しました。',
        'success',
      );
    } catch (error) {
      monthEventState.reject(monthEventOperation);
      selectionState.reject(selectionOperation);
      showNotice(
        resolveErrorMessage(error, '月の主要予定を保存できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function deleteMonthEvent(monthEvent: MonthEvent) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const monthEventOperation = monthEventState.begin((current) =>
      sortMonthEvents(removeByKey(current, monthEvent.id, (item) => item.id)),
    );
    try {
      await plannerRepository.deleteMonthEvent(userId, monthEvent.id);
      monthEventState.commit(monthEventOperation);
      showDeleteUndoNotice(async () => {
        const undoProjection = plannerDataReadAuthority.captureProjectionLease();
        await plannerRepository.upsertMonthEvent(monthEvent);
        // A newer accepted read may contain a newer stored version. The tracked
        // successful settlement repairs that projection without replaying this row.
        if (undoProjection && plannerDataReadAuthority.isOwnerCurrent(undoProjection)
          && !plannerDataReadAuthority.hasAcceptedProjectionChanged(undoProjection)) {
          setMonthEvents((current) =>
            sortMonthEvents(upsertByKey(current, monthEvent, (item) => item.id)),
          );
        }
      }, ['month-events']);
    } catch (error) {
      monthEventState.reject(monthEventOperation);
      showNotice(
        resolveErrorMessage(error, '月の主要予定を削除できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function saveTodo(draft: TodoTaskDraft, targetTodoId?: string) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (!draft.title.trim()) {
      showNotice('Todoのタイトルを入れてください。', 'error');
      throw new Error('Todoのタイトルを入れてください。');
    }

    const currentTodo = todos.find((todo) => todo.id === targetTodoId);
    const now = new Date().toISOString();
    const dueDate = draft.dueDate || null;
    const status = draft.status ?? currentTodo?.status ?? 'open';
    const pinned =
      status === 'done' ? false : draft.pinned ?? currentTodo?.pinned ?? false;
    const nextTodo: TodoTask = {
      id: currentTodo?.id ?? createId('todo'),
      ...draft,
      title: draft.title.trim(),
      subject: draft.subject.trim(),
      estimatedMinutes:
        typeof draft.estimatedMinutes === 'number'
          ? Math.max(0, Math.round(draft.estimatedMinutes))
          : null,
      dueDate,
      dueTime: dueDate ? draft.dueTime || null : null,
      memo: draft.memo.trim(),
      status,
      scheduledPlanId:
        draft.scheduledPlanId !== undefined
          ? draft.scheduledPlanId
          : currentTodo?.scheduledPlanId ?? null,
      pinned,
      createdAt: currentTodo?.createdAt ?? now,
      updatedAt: now,
    };

    const todoOperation = todoState.begin(current => upsertByKey(current, nextTodo, todo => todo.id));
    try {
      await plannerRepository.upsertTodo(nextTodo);
      todoState.commit(todoOperation);
      showNotice(currentTodo ? 'Todoを更新しました。' : 'Todoを追加しました。', 'success');
    } catch (error) {
      todoState.reject(todoOperation);
      showNotice(resolveErrorMessage(error, 'Todoを保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function scheduleTodoAsPlan(todo: TodoTask, draft: PlanDraft): Promise<Plan> {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }
    const nextPlan = createPlanFromDraft({ ...draft, sourceType: 'todo', sourceId: todo.id });
    const dueDate = todo.dueDate || null;
    const nextTodo: TodoTask = {
      ...todo,
      status: 'scheduled',
      scheduledPlanId: nextPlan.id,
      dueDate,
      dueTime: dueDate ? todo.dueTime ?? null : null,
      updatedAt: new Date().toISOString(),
    };
    const planOperation = planState.begin(current => sortByDateTime(upsertByKey(current, nextPlan, plan => plan.id)));
    const selectionOperation = selectionState.begin(() => selectionAt(nextPlan.date));

    const todoOperation = todoState.begin(current => upsertByKey(current, nextTodo, item => item.id));
    try {
      await plannerRepository.scheduleTodoPlan({ plan: nextPlan, todo: nextTodo });
      selectionState.commit(selectionOperation);
      planState.commit(planOperation);
      todoState.commit(todoOperation);
      showNotice('Todoを予定化しました。', 'success');
      return nextPlan;
    } catch (error) {
      planState.reject(planOperation);
      todoState.reject(todoOperation);
      selectionState.reject(selectionOperation);
      showNotice(resolveErrorMessage(error, 'Todoを予定化できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteTodo(todo: TodoTask) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const todoOperation = todoState.begin(current => removeByKey(current, todo.id, item => item.id));
    try {
      await plannerRepository.deleteTodo(userId, todo.id);
      todoState.commit(todoOperation);
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertTodo(todo);
        setTodos((current) => upsertByKey(current, todo, (item) => item.id));
      });
    } catch (error) {
      todoState.reject(todoOperation);
      showNotice(resolveErrorMessage(error, 'Todoを削除できませんでした。'), 'error');
      throw error;
    }
  }

  async function saveStudySubject(
    draft: StudySubjectDraft,
    targetSubjectId?: string,
  ): Promise<StudySubject> {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    const name = draft.name.trim();
    if (!name) {
      showNotice('教科名を入れてください。', 'error');
      throw new Error('教科名を入れてください。');
    }
    const currentSubject = actualAdmission.subjects().find((subject) => subject.id === targetSubjectId);
    if (targetSubjectId && !currentSubject) throw new MaterialMutationAdmissionError(materialStaleMessage);
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    const subjectId = currentSubject?.id ?? createId('study-subject');
    const members = currentSubject ? actualAdmission.materials().filter(material => material.subjectId === currentSubject.id) : [];
    const releaseAdmission = admitActualMutation([], [], members.map(material => material.id), [subjectId]);
    let dispatchedFailure = false;
    const now = new Date().toISOString();
    const nextSubject: StudySubject = {
      id: subjectId,
      userId,
      name,
      color: draft.color.trim() || currentSubject?.color || '#2f6fc2',
      createdAt: currentSubject?.createdAt ?? now,
      updatedAt: now,
    };
    const updatedMaterials = members.map(material => ({
      ...material, subjectName: nextSubject.name, color: nextSubject.color, updatedAt: now,
    }));

    try {
      await plannerRepository.upsertStudySubjectWithMaterials({
        subject: nextSubject,
        materials: updatedMaterials,
      });
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setStudySubjects(current => sortStudySubjects(upsertByKey(current, nextSubject, subject => subject.id)));
        if (updatedMaterials.length > 0) {
          setStudyMaterials(current => sortStudyMaterials(updatedMaterials.reduce(
            (records, material) => upsertByKey(records, material, item => item.id), current,
          )));
        }
      }
      showNotice(currentSubject ? '教科を更新しました。' : '教科を追加しました。', 'success');
      return nextSubject;
    } catch (error) {
      dispatchedFailure = true;
      showNotice(resolveErrorMessage(error, '教科を保存できませんでした。'), 'error');
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material'], dispatchedFailure); }
  }

  async function deleteStudySubject(subject: StudySubject) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const hasMaterials = studyMaterials.some(
      (material) =>
        material.userId === userId &&
        material.subjectId === subject.id,
    );

    if (hasMaterials) {
      showNotice('教材がある教科は削除できません。先に教材を削除してください。', 'error');
      throw new Error('教材がある教科は削除できません。');
    }

    try {
      await plannerRepository.deleteStudySubject(userId, subject.id);
      setStudySubjects((current) =>
        current.filter((item) => item.id !== subject.id),
      );
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertStudySubject(subject);
        setStudySubjects((current) =>
          sortStudySubjects(upsertByKey(current, subject, (item) => item.id)),
        );
      });
    } catch (error) {
      showNotice(resolveErrorMessage(error, '教科を削除できませんでした。'), 'error');
      throw error;
    }
  }

  async function saveStudyMaterial(
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
    baseline?: MaterialEditBaseline,
  ): Promise<StudyMaterial> {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const name = draft.name.trim();
    const subject = actualAdmission.subjects().find((item) => item.id === draft.subjectId);

    if (!name) {
      showNotice('教材名を入れてください。', 'error');
      throw new Error('教材名を入れてください。');
    }

    if (!subject) {
      showNotice('教科を選択してください。', 'error');
      throw new Error('教科を選択してください。');
    }

    let currentMaterial: StudyMaterial | undefined;
    try {
      currentMaterial = targetMaterialId ? actualAdmission.requireMaterialBaseline(targetMaterialId, baseline) : undefined;
    } catch (error) {
      showNotice(resolveErrorMessage(error, materialStaleMessage), 'error');
      throw error;
    }
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    const materialId = currentMaterial?.id ?? createId('study-material');
    const releaseAdmission = admitActualMutation([], [], [materialId]);
    let dispatchedFailure = false;
    const now = new Date().toISOString();
    const paceEnabled = draft.paceEnabled === true;
    const totalUnits =
      typeof draft.totalUnits === 'number' && Number.isFinite(draft.totalUnits)
        ? Math.max(0, draft.totalUnits)
        : undefined;
    const currentUnit =
      typeof draft.currentUnit === 'number' && Number.isFinite(draft.currentUnit)
        ? Math.min(Math.max(0, draft.currentUnit), totalUnits ?? draft.currentUnit)
        : undefined;
    const estimatedMinutesPerUnit =
      typeof draft.estimatedMinutesPerUnit === 'number' &&
      Number.isFinite(draft.estimatedMinutesPerUnit)
        ? Math.max(0, draft.estimatedMinutesPerUnit)
        : undefined;
    const maxUnitsPerDay =
      typeof draft.maxUnitsPerDay === 'number' && Number.isFinite(draft.maxUnitsPerDay)
        ? Math.max(0, draft.maxUnitsPerDay)
        : undefined;
    const nextMaterial: StudyMaterial = {
      id: materialId,
      userId,
      name,
      subjectId: subject.id,
      subjectName: subject.name,
      color: draft.color ?? subject.color,
      coverImageUrl: draft.coverImageUrl || undefined,
      coverImageDataUrl: draft.coverImageDataUrl || undefined,
      catalogEntryId: draft.catalogEntryId?.trim() || currentMaterial?.catalogEntryId,
      catalogTitle: draft.catalogTitle?.trim() || currentMaterial?.catalogTitle,
      catalogIsbn10: draft.catalogIsbn10?.trim() || currentMaterial?.catalogIsbn10,
      catalogIsbn13: draft.catalogIsbn13?.trim() || currentMaterial?.catalogIsbn13,
      aliases: draft.aliases ?? currentMaterial?.aliases ?? [],
      status: draft.status ?? currentMaterial?.status ?? 'active',
      paceEnabled,
      progressUnit: draft.progressUnit ?? currentMaterial?.progressUnit ?? 'page',
      progressUnitLabel:
        draft.progressUnit === 'custom'
          ? draft.progressUnitLabel?.trim() || undefined
          : undefined,
      totalUnits,
      currentUnit,
      targetDate: draft.targetDate?.trim() || undefined,
      estimatedMinutesPerUnit,
      maxUnitsPerDay,
      createdAt: currentMaterial?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await plannerRepository.upsertStudyMaterial(nextMaterial);
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setStudyMaterials((current) => sortStudyMaterials(upsertByKey(current, nextMaterial, (item) => item.id)));
      }
      showNotice(
        currentMaterial ? '教材を更新しました。' : '教材を追加しました。',
        'success',
      );
      return nextMaterial;
    } catch (error) {
      dispatchedFailure = true;
      showNotice(resolveErrorMessage(error, '教材を保存できませんでした。'), 'error');
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material'], dispatchedFailure); }
  }

  async function deleteStudyMaterial(material: StudyMaterial, baseline?: MaterialEditBaseline) {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    // The editor's token carries its original scope/generation. Content equality
    // alone must not silently re-baseline an old dialog after reset or ABA.
    actualAdmission.captureMaterial(material);
    material = actualAdmission.requireMaterialBaseline(material.id, baseline)!;
    const acknowledgedProjection = plannerDataReadAuthority.captureProjectionLease();
    const releaseAdmission = admitActualMutation([], [], [material.id]);
    const undoBaseline = actualAdmission.expectMaterialRemoval(material);
    let dispatchedFailure = false;
    try {
      await plannerRepository.deleteStudyMaterial(userId, material.id);
      if (!acknowledgedProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(acknowledgedProjection)) {
        setStudyMaterials(current => current.filter(item => item.id !== material.id));
      }
      showDeleteUndoNotice(async () => {
        actualAdmission.requireMaterialBaseline(material.id, undoBaseline, true);
        const restoreProjection = plannerDataReadAuthority.captureProjectionLease();
        const releaseRestore = admitActualMutation([], [], [material.id]);
        let restoreFailure = false;
        try {
          await plannerRepository.upsertStudyMaterial(material);
          if (!restoreProjection || !plannerDataReadAuthority.hasAcceptedProjectionChanged(restoreProjection)) {
            setStudyMaterials(current => sortStudyMaterials(upsertByKey(current, material, item => item.id)));
          }
        } catch (error) { restoreFailure = true; throw error; }
        finally { settleActualAdmission(releaseRestore, restoreProjection, ['actual-material'], restoreFailure); }
      });
    } catch (error) {
      dispatchedFailure = true;
      showNotice(resolveErrorMessage(error, '教材を削除できませんでした。'), 'error');
      throw error;
    } finally { settleActualAdmission(releaseAdmission, acknowledgedProjection, ['actual-material'], dispatchedFailure); }
  }

  async function saveScheduleTemplate(
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('時間割の終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('時間割の終了時刻は開始時刻より後にしてください。');
    }

    if (!draft.title.trim()) {
      showNotice('時間割のタイトルを入れてください。', 'error');
      throw new Error('時間割のタイトルを入れてください。');
    }

    if (draft.weekInterval === 2 && !normalizeTimetableDate(draft.weekIntervalAnchorDate)) {
      showNotice('隔週の授業は基準日を設定してください。', 'error');
      throw new Error('隔週の授業は基準日を設定してください。');
    }

    const currentTemplate = scheduleTemplates.find(
      (template) => template.id === targetTemplateId,
    );
    const now = new Date().toISOString();
    const nextTemplate: ScheduleTemplate = {
      id: currentTemplate?.id ?? createId('schedule-template'),
      ...draft,
      title: draft.title.trim(),
      subject: draft.subject.trim(),
      termId: draft.termId?.trim() || 'default',
      periodNumber:
        typeof draft.periodNumber === 'number' && Number.isFinite(draft.periodNumber)
          ? Math.max(1, Math.round(draft.periodNumber))
          : undefined,
      classroom: draft.classroom?.trim() ?? '',
      alternatingWeek:
        draft.alternatingWeek === 'a' || draft.alternatingWeek === 'b'
          ? draft.alternatingWeek
          : 'both',
      weekInterval: draft.weekInterval === 2 ? 2 : 1,
      weekIntervalAnchorDate:
        draft.weekInterval === 2
          ? normalizeTimetableDate(draft.weekIntervalAnchorDate)
          : null,
      memo: draft.memo.trim(),
      createdAt: currentTemplate?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await plannerRepository.upsertScheduleTemplate(nextTemplate);
      setScheduleTemplates((current) =>
        upsertByKey(current, nextTemplate, (template) => template.id),
      );
      showNotice(
        currentTemplate ? '時間割を更新しました。' : '時間割を追加しました。',
        'success',
      );
    } catch (error) {
      showNotice(resolveErrorMessage(error, '時間割を保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteScheduleTemplate(template: ScheduleTemplate) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    try {
      await plannerRepository.deleteScheduleTemplate(userId, template.id);
      setScheduleTemplates((current) =>
        removeByKey(current, template.id, (item) => item.id),
      );
      showNotice('時間割を削除しました。');
    } catch (error) {
      showNotice(resolveErrorMessage(error, '時間割を削除できませんでした。'), 'error');
      throw error;
    }
  }

  async function activateTimetableTerm(draft: TimetableTermDraft): Promise<TimetableTerm> {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    const startDate = normalizeTimetableDate(draft.startDate);
    const endDate = normalizeTimetableDate(draft.endDate);
    if (startDate && endDate && endDate < startDate) {
      showNotice('時間割の終了日は開始日以降にしてください。', 'error');
      throw new Error('時間割の終了日は開始日以降にしてください。');
    }
    const usesAlternatingWeeks = draft.usesAlternatingWeeks === true;
    const alternatingWeekAnchorDate = usesAlternatingWeeks
      ? normalizeTimetableDate(draft.alternatingWeekAnchorDate) ?? startDate
      : null;
    if (usesAlternatingWeeks && !alternatingWeekAnchorDate) {
      showNotice('交互週を使う場合はA週の基準日を設定してください。', 'error');
      throw new Error('交互週を使う場合はA週の基準日を設定してください。');
    }
    const yearFromStartDate = startDate ? Number(startDate.slice(0, 4)) : null;
    const year = Number.isFinite(yearFromStartDate)
      ? Number(yearFromStartDate)
      : Number.isFinite(draft.year)
        ? Math.round(draft.year)
        : new Date().getFullYear();
    const isCustomPeriod = draft.kind === 'custom';
    const stableTermId = isCustomPeriod
      ? draft.id?.trim() || createId('timetable-term')
      : createTimetableTermId(userId, year, draft.kind);
    const label = createTimetableTermLabel(year, draft.kind, draft.label);
    const existingTerm = timetableTerms.find((term) => term.id === stableTermId) ??
      (!isCustomPeriod
        ? timetableTerms.find((term) => term.year === year && term.kind === draft.kind)
        : undefined);
    const now = new Date().toISOString();
    const nextActiveTerm: TimetableTerm = {
      id: stableTermId,
      userId,
      year,
      kind: draft.kind,
      label,
      startDate,
      endDate,
      usesAlternatingWeeks,
      alternatingWeekAnchorDate,
      isActive: true,
      createdAt: existingTerm?.createdAt ?? now,
      updatedAt: now,
    };
    const inactiveTerms = timetableTerms
      .filter((term) => term.id !== nextActiveTerm.id)
      .map((term) => ({ ...term, isActive: false, updatedAt: now }));

    try {
      await plannerRepository.applyTimetableMutation({
        userId,
        termUpserts: [...inactiveTerms, nextActiveTerm],
        termDeletes: [],
        templateUpserts: [],
        templateDeletes: [],
        periodUpserts: [],
        periodDeletes: [],
      });
      setTimetableTerms(sortTimetableTerms([...inactiveTerms, nextActiveTerm]));
      showNotice('時間割の期間を保存しました。', 'success');
      return nextActiveTerm;
    } catch (error) {
      showNotice(resolveErrorMessage(error, '時間割の期間を保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteTimetableTerm(term: TimetableTerm) {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    const targetTerm = timetableTerms.find((item) => item.id === term.id) ?? term;
    if (timetableTerms.length <= 1) {
      showNotice('最後の期間は削除できません。新しい期間を追加してから削除してください。', 'error');
      throw new Error('最後の期間は削除できません。');
    }
    const targetTermId = targetTerm.id;
    const targetTemplates = scheduleTemplates.filter(
      (template) => (template.termId || 'default') === targetTermId,
    );
    const targetPeriods = timetablePeriods.filter((period) => period.termId === targetTermId);
    const remainingTerms = timetableTerms.filter((item) => item.id !== targetTermId);
    const fallbackTerm = targetTerm.isActive ? sortTimetableTerms(remainingTerms)[0] ?? null : null;
    const nextFallbackTerm = fallbackTerm
      ? { ...fallbackTerm, isActive: true, updatedAt: new Date().toISOString() }
      : null;

    try {
      await plannerRepository.applyTimetableMutation({
        userId,
        termUpserts: nextFallbackTerm ? [nextFallbackTerm] : [],
        termDeletes: [targetTerm],
        templateUpserts: [],
        templateDeletes: targetTemplates,
        periodUpserts: [],
        periodDeletes: targetPeriods,
      });
      setScheduleTemplates((current) =>
        current.filter((template) => (template.termId || 'default') !== targetTermId),
      );
      setTimetablePeriods((current) => current.filter((period) => period.termId !== targetTermId));
      setTimetableTerms((current) =>
        sortTimetableTerms(
          current
            .filter((item) => item.id !== targetTermId)
            .map((item) =>
              nextFallbackTerm && item.id === nextFallbackTerm.id ? nextFallbackTerm : item,
            ),
        ),
      );
      showNotice('期間を削除しました。', 'success');
    } catch (error) {
      showNotice(resolveErrorMessage(error, '期間を削除できませんでした。'), 'error');
      throw error;
    }
  }

  async function clearTimetableTermData(term: TimetableTerm) {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    const targetTermId = term.id;
    const targetTemplates = scheduleTemplates.filter(
      (template) => (template.termId || 'default') === targetTermId,
    );
    const targetPeriods = timetablePeriods.filter((period) => period.termId === targetTermId);
    const nextTerm: TimetableTerm = { ...term, updatedAt: new Date().toISOString() };

    try {
      await plannerRepository.applyTimetableMutation({
        userId,
        termUpserts: [nextTerm],
        termDeletes: [],
        templateUpserts: [],
        templateDeletes: targetTemplates,
        periodUpserts: [],
        periodDeletes: targetPeriods,
      });
      setScheduleTemplates((current) =>
        current.filter((template) => (template.termId || 'default') !== targetTermId),
      );
      setTimetablePeriods((current) => current.filter((period) => period.termId !== targetTermId));
      setTimetableTerms((current) =>
        sortTimetableTerms(current.map((item) => (item.id === targetTermId ? nextTerm : item))),
      );
      showNotice('この期間の授業をすべて削除しました。', 'success');
    } catch (error) {
      showNotice(resolveErrorMessage(error, 'この期間の授業を削除できませんでした。'), 'error');
      throw error;
    }
  }

  async function saveTimetablePeriod(
    draft: TimetablePeriodDraft,
    targetPeriodId?: string,
  ): Promise<TimetablePeriod> {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (
      draft.startTime &&
      draft.endTime &&
      minutesBetween(draft.startTime, draft.endTime) <= 0
    ) {
      showNotice('時限の終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('時限の終了時刻は開始時刻より後にしてください。');
    }

    const currentPeriod = timetablePeriods.find((period) => period.id === targetPeriodId);
    const periodNumber = Math.max(1, Math.round(draft.periodNumber));
    const now = new Date().toISOString();
    const nextPeriod: TimetablePeriod = {
      id: currentPeriod?.id ?? createId('timetable-period'),
      userId,
      termId: draft.termId.trim() || 'default',
      periodNumber,
      label: draft.label.trim() || String(periodNumber),
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      createdAt: currentPeriod?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await plannerRepository.upsertTimetablePeriod(nextPeriod);
      setTimetablePeriods((current) =>
        upsertByKey(current, nextPeriod, (period) => period.id).sort(
          (left, right) =>
            left.termId.localeCompare(right.termId) ||
            left.periodNumber - right.periodNumber,
        ),
      );
      return nextPeriod;
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '時限設定を保存できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function deleteTimetablePeriod(period: TimetablePeriod) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const periodTemplates = scheduleTemplates.filter(
      (template) =>
        (template.termId || 'default') === period.termId &&
        template.periodNumber === period.periodNumber,
    );

    if (periodTemplates.length > 0) {
      showNotice('授業が入っている時限は削除できません。', 'error');
      throw new Error('授業が入っている時限は削除できません。');
    }

    try {
      await plannerRepository.deleteTimetablePeriod(userId, period.id);
      setTimetablePeriods((current) =>
        current.filter((item) => item.id !== period.id),
      );
      showNotice('時限を削除しました。');
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '時限を削除できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  function selectDate(date: string) {
    selectionState.set(selectionAt(date));
  }

  function changeMonth(date: string) {
    const nextMonthDate = startOfMonth(date);
    selectionState.set({ selectedDate: isSameMonth(selectedDate, date) ? selectedDate : nextMonthDate, monthDate: nextMonthDate });
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
    savePlanDraft: trackMutation(savePlanDraft),
    movePlanOccurrence: trackMutation(movePlanOccurrence),
    deletePlan: trackMutation(deletePlan, ['actual-material', 'plans-todos']),
    confirmRecurringPlanScope: trackMutation(confirmRecurringPlanScope),
    cancelRecurringPlanScope,
    getActualActionBlockReason: actualAdmission.reason,
    saveActual: trackMutation(saveActual),
    saveStandaloneActual: trackMutation(saveStandaloneActual),
    linkStandaloneActualToPlan: trackMutation(linkStandaloneActualToPlan),
    deleteActual: trackMutation(deleteActual),
    saveDayNote: trackMutation(saveDayNote),
    saveMonthEvent: trackMutation(saveMonthEvent, ['month-events']),
    deleteMonthEvent: trackMutation(deleteMonthEvent, ['month-events']),
    saveTodo: trackMutation(saveTodo),
    scheduleTodoAsPlan: trackMutation(scheduleTodoAsPlan),
    deleteTodo: trackMutation(deleteTodo),
    saveStudySubject: trackMutation(saveStudySubject),
    deleteStudySubject: trackMutation(deleteStudySubject),
    captureStudyMaterialBaseline: actualAdmission.captureMaterial,
    saveStudyMaterial: trackMutation(saveStudyMaterial),
    deleteStudyMaterial: trackMutation(deleteStudyMaterial),
    saveScheduleTemplate: trackMutation(saveScheduleTemplate),
    deleteScheduleTemplate: trackMutation(deleteScheduleTemplate),
    activateTimetableTerm: trackMutation(activateTimetableTerm),
    deleteTimetableTerm: trackMutation(deleteTimetableTerm),
    clearTimetableTermData: trackMutation(clearTimetableTermData),
    saveTimetablePeriod: trackMutation(saveTimetablePeriod),
    deleteTimetablePeriod: trackMutation(deleteTimetablePeriod),
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote: userId ? resolveDayNoteDraft(dayNotes, userId, selectedDate) : null,
  };
}
