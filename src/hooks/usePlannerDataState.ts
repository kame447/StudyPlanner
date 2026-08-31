import { useCallback, useRef, useState } from 'react';
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
  mergeTimetablePeriodsByTermAndNumber,
  normalizeTimetableDate,
  normalizeTimetableTermsByYearAndKind,
  remapTimetableTermId,
  sortTimetableTerms,
} from '../domain/timetableDataNormalization';
import {
  PlannerDataReadAuthority,
  createInitialPlannerDataAvailability,
  type PlannerDataAvailability,
} from '../domain/plannerDataReadAuthority';
import { createId } from '../lib/id';
import { buildPlanOccurrenceKey, getActualOccurrenceKey } from '../lib/planRecurrence';
import { sortMonthEvents } from '../lib/monthEvents';
import { applyMaterialProgressUpdates } from '../lib/materialPace';
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

export function usePlannerDataState({
  userId,
  showNotice,
}: UsePlannerDataStateOptions): UsePlannerDataStateResult {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [monthEvents, setMonthEvents] = useState<MonthEvent[]>([]);
  const [todos, setTodos] = useState<TodoTask[]>([]);
  const [studySubjects, setStudySubjects] = useState<StudySubject[]>([]);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterial[]>([]);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [timetableTerms, setTimetableTerms] = useState<TimetableTerm[]>([]);
  const [timetablePeriods, setTimetablePeriods] = useState<TimetablePeriod[]>([]);
  const plannerDataReadAuthorityRef = useRef<PlannerDataReadAuthority | null>(null);
  if (!plannerDataReadAuthorityRef.current) {
    plannerDataReadAuthorityRef.current = new PlannerDataReadAuthority();
  }
  const plannerDataReadAuthority = plannerDataReadAuthorityRef.current;
  const [plannerDataAvailability, setPlannerDataAvailability] =
    useState<PlannerDataAvailability>(() => createInitialPlannerDataAvailability());
  const clearPlannerDataCollections = useCallback(() => {
    setPlans([]);
    setActuals([]);
    setDayNotes([]);
    setMonthEvents([]);
    setTodos([]);
    setStudySubjects([]);
    setStudyMaterials([]);
    setScheduleTemplates([]);
    setTimetableTerms([]);
    setTimetablePeriods([]);
  }, []);
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
    const loadStart = plannerDataReadAuthority.begin(nextUserId, new Date().toISOString());
    setPlannerDataAvailability(loadStart.availability);
    if (loadStart.ownerChanged) {
      clearPlannerDataCollections();
      setEditorDraft(null);
      setEditingPlanId(null);
      setEditingPlan(null);
      setPendingRecurringPlanAction(null);
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

    const {
      terms: resolvedTimetableTerms,
      termIdMap,
      obsoleteTermIds,
    } = normalizeTimetableTermsByYearAndKind(nextUserId, nextTimetableTerms);
    const remappedScheduleTemplates = nextScheduleTemplates.map((template) => {
      const nextTermId = remapTimetableTermId(template.termId, termIdMap);

      return nextTermId === (template.termId || 'default')
        ? template
        : {
            ...template,
            termId: nextTermId,
            updatedAt: new Date().toISOString(),
          };
    });
    const {
      periods: resolvedTimetablePeriods,
      obsoletePeriodIds,
    } = mergeTimetablePeriodsByTermAndNumber(
      nextTimetablePeriods.map((period) => {
        const nextTermId = remapTimetableTermId(period.termId, termIdMap);

        return nextTermId === period.termId
          ? period
          : {
              ...period,
              termId: nextTermId,
              updatedAt: new Date().toISOString(),
            };
      }),
    );

    const termUpserts = resolvedTimetableTerms.filter((term) => {
      const previousTerm = nextTimetableTerms.find((item) => item.id === term.id);
      return !(
        previousTerm &&
        previousTerm.year === term.year &&
        previousTerm.kind === term.kind &&
        previousTerm.label === term.label &&
        previousTerm.startDate === term.startDate &&
        previousTerm.endDate === term.endDate &&
        previousTerm.usesAlternatingWeeks === term.usesAlternatingWeeks &&
        previousTerm.alternatingWeekAnchorDate === term.alternatingWeekAnchorDate &&
        previousTerm.isActive === term.isActive
      );
    });
    const templateUpserts = remappedScheduleTemplates.filter((template) => {
      const previousTemplate = nextScheduleTemplates.find((item) => item.id === template.id);
      return previousTemplate?.termId !== template.termId;
    });
    const periodUpserts = resolvedTimetablePeriods.filter((period) => {
      const previousPeriod = nextTimetablePeriods.find((item) => item.id === period.id);
      return previousPeriod?.termId !== period.termId;
    });
    const termDeletes = nextTimetableTerms.filter((term) => obsoleteTermIds.includes(term.id));
    const periodDeletes = nextTimetablePeriods.filter((period) =>
      obsoletePeriodIds.includes(period.id),
    );
    let committedScheduleTemplates = remappedScheduleTemplates;
    let committedTimetableTerms = resolvedTimetableTerms;
    let committedTimetablePeriods = resolvedTimetablePeriods;

    try {
      await plannerRepository.applyTimetableMutation({
        userId: nextUserId,
        termUpserts,
        termDeletes,
        templateUpserts,
        templateDeletes: [],
        periodUpserts,
        periodDeletes,
      });
    } catch (error) {
      if (!plannerDataReadAuthority.isCurrent(loadStart.token)) {
        return;
      }
      console.warn('[Timetable] term canonicalization failed', error);
      committedScheduleTemplates = nextScheduleTemplates;
      committedTimetableTerms = nextTimetableTerms;
      committedTimetablePeriods = nextTimetablePeriods;
      showNotice('時間割データを整合化できませんでした。再読み込みしてください。', 'error');
    }

      if (!plannerDataReadAuthority.isCurrent(loadStart.token)) {
        return;
      }

      setPlans(sortByDateTime(nextPlans));
      setActuals(nextActuals);
      setDayNotes(nextDayNotes);
      setMonthEvents(sortMonthEvents(nextMonthEvents));
      setTodos(nextTodos);
      setStudySubjects(sortStudySubjects(nextStudySubjects));
      setStudyMaterials(sortStudyMaterials(nextStudyMaterials));
      setScheduleTemplates(committedScheduleTemplates);
      setTimetableTerms(committedTimetableTerms);
      setTimetablePeriods(committedTimetablePeriods);
      const readyAvailability = plannerDataReadAuthority.succeed(
        loadStart.token,
        new Date().toISOString(),
      );
      if (readyAvailability) {
        setPlannerDataAvailability(readyAvailability);
      }
    } catch (error) {
      const failedAvailability = plannerDataReadAuthority.fail(
        loadStart.token,
        new Date().toISOString(),
      );
      if (!failedAvailability) {
        return;
      }
      setPlannerDataAvailability(failedAvailability);
      throw error;
    }
  }, [clearPlannerDataCollections, plannerDataReadAuthority, showNotice]);

  const resetPlannerData = useCallback(() => {
    setPlannerDataAvailability(plannerDataReadAuthority.reset());
    clearPlannerDataCollections();
    setEditorDraft(null);
    setEditingPlanId(null);
    setEditingPlan(null);
    setPendingRecurringPlanAction(null);
  }, [clearPlannerDataCollections, plannerDataReadAuthority]);

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

    try {
      const mutation =
        pendingRecurringPlanAction.kind === 'edit'
          ? pendingRecurringPlanAction.draft
            ? buildRecurringPlanEditMutation(
                plans,
                actuals,
                sourcePlan,
                occurrenceDate,
                pendingRecurringPlanAction.draft,
                scope,
              )
            : null
          : buildRecurringPlanDeleteMutation(
              plans,
              actuals,
              sourcePlan,
              occurrenceDate,
              scope,
            );

      if (!mutation) {
        return;
      }

      await plannerRepository.applyRecurringPlanMutation(userId, mutation);
      const deletedPlanIds = new Set(
        mutation.planDeletes.map((plan) => plan.id),
      );
      const deletedActualIds = new Set(
        mutation.actualDeletes.map((actual) => actual.id),
      );
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

      if (pendingRecurringPlanAction.kind === 'edit') {
        setSelectedDate(occurrenceDate);
        setMonthDate(startOfMonth(occurrenceDate));
      }
      setPendingRecurringPlanAction(null);
      closePlanEditor();
      if (pendingRecurringPlanAction.kind === 'edit') {
        showNotice('繰り返し予定を更新しました。', 'success');
      } else {
        showNotice('繰り返し予定を削除しました。');
      }
    } catch (error) {
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
      await loadPlannerData(userId);
      showNotice(
        resolveErrorMessage(
          error,
          pendingRecurringPlanAction.kind === 'edit'
            ? '繰り返し予定の更新に失敗しました。'
            : '繰り返し予定の削除に失敗しました。',
        ),
        'error',
      );
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
    const previousPlans = plans;

    try {
      setPlans((current) =>
        sortByDateTime(upsertByKey(current, nextPlan, (item) => item.id)),
      );
      await plannerRepository.upsertPlan(nextPlan);
      showNotice('予定を移動しました。', 'success');
    } catch (error) {
      setPlans(previousPlans);
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
    const previousPlans = plans;
    const previousSelectedDate = selectedDate;
    const previousMonthDate = monthDate;

    try {
      setPlans((current) =>
        sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)),
      );
      setSelectedDate(nextPlan.date);
      setMonthDate(startOfMonth(nextPlan.date));
      closePlanEditor();
      await plannerRepository.upsertPlan(nextPlan);
      showNotice(
        currentPlan ? '学習予定を更新しました。' : '学習予定を追加しました。',
        'success',
      );
    } catch (error) {
      setPlans(previousPlans);
      setSelectedDate(previousSelectedDate);
      setMonthDate(previousMonthDate);
      showNotice(
        resolveErrorMessage(error, '学習予定を保存できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  function showDeleteUndoNotice(onUndo: () => Promise<void>) {
    showNotice('削除しました', 'info', {
      actionLabel: '元に戻す',
      durationMs: 8000,
      placement: 'bottom',
      onAction: async () => {
        try {
          await onUndo();
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

    const linkedTodo =
      plan.sourceType === 'todo' && plan.sourceId
        ? todos.find(
            (todo) => todo.id === plan.sourceId && todo.scheduledPlanId === plan.id,
          ) ?? null
        : null;
    const linkedActuals = actuals.filter((actual) => actual.planId === plan.id);
    const previousPlans = plans;
    const previousActuals = actuals;
    const previousTodos = todos;
    const nextLinkedTodo = linkedTodo
      ? {
          ...linkedTodo,
          status: 'open' as const,
          scheduledPlanId: null,
          updatedAt: new Date().toISOString(),
        }
      : null;

    try {
      setPlans((current) => removeByKey(current, plan.id, (item) => item.id));
      setActuals((current) => current.filter((actual) => actual.planId !== plan.id));
      if (nextLinkedTodo) {
        setTodos((current) => upsertByKey(current, nextLinkedTodo, (todo) => todo.id));
      }
      closePlanEditor();
      await plannerRepository.deletePlanWithDependents({
        userId,
        plan,
        todo: nextLinkedTodo,
      });
      showDeleteUndoNotice(async () => {
        await plannerRepository.restorePlanWithDependents({
          plan,
          actuals: linkedActuals,
          todo: linkedTodo,
        });
        setPlans((current) => sortAndUpsertPlans(current, [plan]));
        if (linkedActuals.length > 0) {
          setActuals((current) => upsertActualsById(current, linkedActuals));
        }
        if (linkedTodo) {
          setTodos((current) => upsertByKey(current, linkedTodo, (item) => item.id));
        }
      });
    } catch (error) {
      setPlans(previousPlans);
      setActuals(previousActuals);
      setTodos(previousTodos);
      showNotice(resolveErrorMessage(error, '予定を削除できませんでした。'), 'error');
      throw error;
    }
  }

  function resolveActualMaterialProgress(actual: Actual): {
    nextMaterials: StudyMaterial[];
    changedMaterials: StudyMaterial[];
  } {
    if (!actual.materialProgressUpdates?.length) {
      return { nextMaterials: studyMaterials, changedMaterials: [] };
    }
    const nextMaterials = applyMaterialProgressUpdates(
      studyMaterials,
      actual.materialProgressUpdates,
    );
    const changedMaterials = nextMaterials.filter((nextMaterial) => {
      const currentMaterial = studyMaterials.find(
        (material) => material.id === nextMaterial.id,
      );
      return Boolean(
        currentMaterial && currentMaterial.currentUnit !== nextMaterial.currentUnit,
      );
    });
    return { nextMaterials, changedMaterials };
  }

  async function saveActual(plan: Plan, draft: ActualDraft, targetActualId?: string) {
    if (!userId) throw new Error('ログイン状態を確認できませんでした。');
    const occurrenceKey = buildPlanOccurrenceKey(plan.id, draft.occurrenceDate);
    const existingActual = targetActualId
      ? actuals.find((actual) => actual.id === targetActualId)
      : actuals.find((actual) => getActualOccurrenceKey(actual) === occurrenceKey);
    const nextActual = createActualFromDraft(userId, draft, existingActual);
    const rollbackActual = existingActual;
    const progress = existingActual
      ? { nextMaterials: studyMaterials, changedMaterials: [] as StudyMaterial[] }
      : resolveActualMaterialProgress(nextActual);

    setActuals((current) =>
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
      showNotice('記録を保存しました。', 'success');
    } catch (error) {
      setActuals((current) => {
        const rolledBackActuals = current.filter(
          (actual) =>
            actual.id !== nextActual.id &&
            (!targetActualId || actual.id !== targetActualId) &&
            getActualOccurrenceKey(actual) !== occurrenceKey,
        );
        return rollbackActual
          ? upsertActualByOccurrenceKey(rolledBackActuals, rollbackActual)
          : rolledBackActuals;
      });
      showNotice(resolveErrorMessage(error, '記録を保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function saveStandaloneActual(draft: ActualDraft, targetActualId?: string) {
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
      ? actuals.find((actual) => actual.id === targetActualId && !actual.planId)
      : undefined;
    if (targetActualId && !existingActual) {
      showNotice('記録が見つかりませんでした。', 'error');
      throw new Error('記録が見つかりませんでした。');
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
    const previousActuals = actuals;
    const progress = existingActual
      ? { nextMaterials: studyMaterials, changedMaterials: [] as StudyMaterial[] }
      : resolveActualMaterialProgress(nextActual);

    try {
      setActuals((current) =>
        upsertByKey(
          targetActualId ? current.filter((actual) => actual.id !== targetActualId) : current,
          nextActual,
          (item) => getActualOccurrenceKey(item),
        ),
      );
      const savedActual = await plannerRepository.upsertActualWithMaterialProgress({
        actual: nextActual,
        materials: progress.changedMaterials,
      });
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
      showNotice('記録を保存しました。', 'success');
    } catch (error) {
      setActuals(previousActuals);
      showNotice(resolveErrorMessage(error, '記録を保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function linkStandaloneActualToPlan(actual: Actual, plan: Plan) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (actual.planId) {
      showNotice('この記録はすでに予定に紐づいています。', 'error');
      throw new Error('この記録はすでに予定に紐づいています。');
    }

    const occurrenceDate = actual.occurrenceDate;
    const existingLinkedActual = actuals.find(
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
    const previousActuals = actuals;

    try {
      setActuals((current) =>
        upsertByKey(
          current.filter((item) => item.id !== actual.id),
          nextActual,
          (item) => getActualOccurrenceKey(item),
        ),
      );
      const savedActual = await plannerRepository.upsertActual(nextActual);
      setActuals((current) =>
        upsertByKey(
          current.filter((item) => item.id !== actual.id),
          savedActual,
          (item) => getActualOccurrenceKey(item),
        ),
      );
      showNotice('予定に紐づけました。', 'success');
    } catch (error) {
      setActuals(previousActuals);
      showNotice(
        resolveErrorMessage(error, '予定に紐づけできませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function deleteActual(actual: Actual) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const previousActuals = actuals;

    try {
      setActuals((current) => removeByKey(current, actual.id, (item) => item.id));
      await plannerRepository.deleteActual(userId, actual.id);
      showNotice('記録を削除しました。');
    } catch (error) {
      setActuals(previousActuals);
      showNotice(
        resolveErrorMessage(error, '記録を削除できませんでした。'),
        'error',
      );
      throw error;
    }
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
    const previousMonthEvents = monthEvents;
    const previousSelectedDate = selectedDate;
    const previousMonthDate = monthDate;

    try {
      setMonthEvents((current) =>
        sortMonthEvents(upsertByKey(current, nextMonthEvent, (item) => item.id)),
      );

      if (!currentMonthEvent) {
        setSelectedDate(nextMonthEvent.date);
      }

      setMonthDate(startOfMonth(nextMonthEvent.date));
      await plannerRepository.upsertMonthEvent(nextMonthEvent);
      showNotice(
        currentMonthEvent ? '月の主要予定を更新しました。' : '月の主要予定を追加しました。',
        'success',
      );
    } catch (error) {
      setMonthEvents(previousMonthEvents);
      setSelectedDate(previousSelectedDate);
      setMonthDate(previousMonthDate);
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

    const previousMonthEvents = monthEvents;

    try {
      setMonthEvents((current) =>
        sortMonthEvents(removeByKey(current, monthEvent.id, (item) => item.id)),
      );
      await plannerRepository.deleteMonthEvent(userId, monthEvent.id);
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertMonthEvent(monthEvent);
        setMonthEvents((current) =>
          sortMonthEvents(
            upsertByKey(current, monthEvent, (item) => item.id),
          ),
        );
      });
    } catch (error) {
      setMonthEvents(previousMonthEvents);
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
    const previousTodos = todos;

    try {
      setTodos((current) => upsertByKey(current, nextTodo, (todo) => todo.id));
      await plannerRepository.upsertTodo(nextTodo);
      showNotice(currentTodo ? 'Todoを更新しました。' : 'Todoを追加しました。', 'success');
    } catch (error) {
      setTodos(previousTodos);
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
    const previousPlans = plans;
    const previousTodos = todos;
    const previousSelectedDate = selectedDate;
    const previousMonthDate = monthDate;

    try {
      setPlans((current) => sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)));
      setTodos((current) => upsertByKey(current, nextTodo, (item) => item.id));
      setSelectedDate(nextPlan.date);
      setMonthDate(startOfMonth(nextPlan.date));
      await plannerRepository.scheduleTodoPlan({ plan: nextPlan, todo: nextTodo });
      showNotice('Todoを予定化しました。', 'success');
      return nextPlan;
    } catch (error) {
      setPlans(previousPlans);
      setTodos(previousTodos);
      setSelectedDate(previousSelectedDate);
      setMonthDate(previousMonthDate);
      showNotice(resolveErrorMessage(error, 'Todoを予定化できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteTodo(todo: TodoTask) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const previousTodos = todos;

    try {
      setTodos((current) => removeByKey(current, todo.id, (item) => item.id));
      await plannerRepository.deleteTodo(userId, todo.id);
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertTodo(todo);
        setTodos((current) => upsertByKey(current, todo, (item) => item.id));
      });
    } catch (error) {
      setTodos(previousTodos);
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
    const currentSubject = studySubjects.find((subject) => subject.id === targetSubjectId);
    const now = new Date().toISOString();
    const nextSubject: StudySubject = {
      id: currentSubject?.id ?? createId('study-subject'),
      userId,
      name,
      color: draft.color.trim() || currentSubject?.color || '#2f6fc2',
      createdAt: currentSubject?.createdAt ?? now,
      updatedAt: now,
    };
    const updatedMaterials = currentSubject
      ? studyMaterials
          .filter((material) => material.subjectId === currentSubject.id)
          .map((material) => ({
            ...material,
            subjectName: nextSubject.name,
            color: nextSubject.color,
            updatedAt: now,
          }))
      : [];

    try {
      await plannerRepository.upsertStudySubjectWithMaterials({
        subject: nextSubject,
        materials: updatedMaterials,
      });
      setStudySubjects((current) =>
        sortStudySubjects(upsertByKey(current, nextSubject, (subject) => subject.id)),
      );
      if (updatedMaterials.length > 0) {
        setStudyMaterials((current) =>
          sortStudyMaterials(
            updatedMaterials.reduce(
              (records, material) => upsertByKey(records, material, (item) => item.id),
              current,
            ),
          ),
        );
      }
      showNotice(currentSubject ? '教科を更新しました。' : '教科を追加しました。', 'success');
      return nextSubject;
    } catch (error) {
      showNotice(resolveErrorMessage(error, '教科を保存できませんでした。'), 'error');
      throw error;
    }
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
  ): Promise<StudyMaterial> {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const name = draft.name.trim();
    const subject = studySubjects.find((item) => item.id === draft.subjectId);

    if (!name) {
      showNotice('教材名を入れてください。', 'error');
      throw new Error('教材名を入れてください。');
    }

    if (!subject) {
      showNotice('教科を選択してください。', 'error');
      throw new Error('教科を選択してください。');
    }

    const currentMaterial = studyMaterials.find(
      (material) => material.id === targetMaterialId,
    );
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
      id: currentMaterial?.id ?? createId('study-material'),
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
      setStudyMaterials((current) =>
        sortStudyMaterials(upsertByKey(current, nextMaterial, (item) => item.id)),
      );
      showNotice(
        currentMaterial ? '教材を更新しました。' : '教材を追加しました。',
        'success',
      );
      return nextMaterial;
    } catch (error) {
      showNotice(resolveErrorMessage(error, '教材を保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteStudyMaterial(material: StudyMaterial) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    try {
      await plannerRepository.deleteStudyMaterial(userId, material.id);
      setStudyMaterials((current) =>
        current.filter((item) => item.id !== material.id),
      );
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertStudyMaterial(material);
        setStudyMaterials((current) =>
          sortStudyMaterials(upsertByKey(current, material, (item) => item.id)),
        );
      });
    } catch (error) {
      showNotice(resolveErrorMessage(error, '教材を削除できませんでした。'), 'error');
      throw error;
    }
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
      : createTimetableTermId(year, draft.kind);
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
    todos,
    studySubjects,
    studyMaterials,
    scheduleTemplates,
    timetableTerms,
    timetablePeriods,
    plannerDataAvailability,
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
    movePlanOccurrence,
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
    currentDayNote: userId ? resolveDayNoteDraft(dayNotes, userId, selectedDate) : null,
  };
}
