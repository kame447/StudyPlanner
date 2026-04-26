import { useCallback, useState } from 'react';
import { removeByKey, upsertByKey } from '../lib/collections';
import {
  isSameMonth,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  todayIsoDate,
} from '../lib/date';
import { createId } from '../lib/id';
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
  ScheduleTemplate,
  ScheduleTemplateDraft,
  TimetablePeriod,
  TimetablePeriodDraft,
  TimetableTerm,
  TimetableTermDraft,
  TimetableTermKind,
  TodoTask,
  TodoTaskDraft,
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

function summarizeActualForLog(actual: Actual) {
  return {
    id: actual.id,
    userId: actual.userId,
    planId: actual.planId,
    occurrenceDate: actual.occurrenceDate,
    title: actual.title,
  };
}

function getTimetableTermKindLabel(kind: TimetableTermKind): string {
  switch (kind) {
    case 'firstHalf':
      return '前期';
    case 'secondHalf':
      return '後期';
    case 'term1':
      return '1学期';
    case 'term2':
      return '2学期';
    case 'term3':
      return '3学期';
    case 'term4':
      return '4学期';
    case 'fullYear':
      return '通年';
    case 'custom':
      return 'カスタム';
    default:
      return '通年';
  }
}

function createTimetableTermLabel(
  year: number,
  kind: TimetableTermKind,
  fallbackLabel?: string,
): string {
  const normalizedYear = Number.isFinite(year) ? Math.round(year) : new Date().getFullYear();
  const customLabel = fallbackLabel?.trim();

  if (kind === 'custom' && customLabel) {
    return customLabel;
  }

  return `${normalizedYear}年 ${getTimetableTermKindLabel(kind)}`;
}

function createDefaultTimetableTerm(userId: string): TimetableTerm {
  const now = new Date().toISOString();
  const year = new Date().getFullYear();

  return {
    id: 'default',
    userId,
    year,
    kind: 'fullYear',
    label: `${year}年 通年`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

interface UsePlannerDataStateResult {
  plans: Plan[];
  actuals: Actual[];
  dayNotes: DayNote[];
  monthEvents: MonthEvent[];
  todos: TodoTask[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTerms: TimetableTerm[];
  timetablePeriods: TimetablePeriod[];
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
  saveTodo: (draft: TodoTaskDraft, targetTodoId?: string) => Promise<void>;
  scheduleTodoAsPlan: (todo: TodoTask, draft: PlanDraft) => Promise<Plan>;
  deleteTodo: (todo: TodoTask) => Promise<void>;
  saveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
  deleteScheduleTemplate: (template: ScheduleTemplate) => Promise<void>;
  activateTimetableTerm: (draft: TimetableTermDraft) => Promise<TimetableTerm>;
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
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [timetableTerms, setTimetableTerms] = useState<TimetableTerm[]>([]);
  const [timetablePeriods, setTimetablePeriods] = useState<TimetablePeriod[]>([]);
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

  async function runSequentially<T>(
    items: T[],
    handler: (item: T) => Promise<void>,
  ): Promise<void> {
    for (const item of items) {
      await handler(item);
    }
  }

  function isScopedRecurringEditCandidate(plan: Plan | null): boolean {
    if (!plan) {
      return false;
    }

    return supportsScopedRecurringPlanEdits(resolveStoredPlan(plan));
  }

  const isRecurringPlanEdit = isScopedRecurringEditCandidate(editingPlan);

  const loadPlannerData = useCallback(async (nextUserId: string) => {
    const [
      nextPlans,
      nextActuals,
      nextDayNotes,
      nextMonthEvents,
      nextTodos,
      nextScheduleTemplates,
      nextTimetableTerms,
      nextTimetablePeriods,
    ] = await Promise.all([
      plannerRepository.getPlans(nextUserId),
      plannerRepository.getActuals(nextUserId),
      plannerRepository.getDayNotes(nextUserId),
      plannerRepository.getMonthEvents(nextUserId),
      plannerRepository.getTodos(nextUserId),
      plannerRepository.getScheduleTemplates(nextUserId),
      plannerRepository.getTimetableTerms(nextUserId),
      plannerRepository.getTimetablePeriods(nextUserId),
    ]);
    const nextActiveTerm = nextTimetableTerms.find((term) => term.isActive);
    const fallbackActiveTerm =
      nextActiveTerm ??
      nextTimetableTerms.find((term) => term.id === 'default') ??
      nextTimetableTerms[0] ??
      createDefaultTimetableTerm(nextUserId);
    const resolvedTimetableTerms = nextTimetableTerms.some(
      (term) => term.id === fallbackActiveTerm.id,
    )
      ? nextTimetableTerms.map((term) => ({
          ...term,
          isActive: term.id === fallbackActiveTerm.id,
        }))
      : [fallbackActiveTerm];

    setPlans(sortByDateTime(nextPlans));
    setActuals(nextActuals);
    setDayNotes(nextDayNotes);
    setMonthEvents(sortMonthEvents(nextMonthEvents));
    setTodos(nextTodos);
    setScheduleTemplates(nextScheduleTemplates);
    setTimetableTerms(resolvedTimetableTerms);
    setTimetablePeriods(
      nextTimetablePeriods.sort((left, right) => left.periodNumber - right.periodNumber),
    );
  }, []);

  const resetPlannerData = useCallback(() => {
    setPlans([]);
    setActuals([]);
    setDayNotes([]);
    setMonthEvents([]);
    setTodos([]);
    setScheduleTemplates([]);
    setTimetableTerms([]);
    setTimetablePeriods([]);
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

    try {
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

          await runSequentially(updatedPlans, async (plan) => {
            await plannerRepository.upsertPlan(plan);
          });
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
          await runSequentially(migratedActuals, async (actual) => {
            await plannerRepository.upsertActual(actual);
          });
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
        const seriesPlans = plans.filter(
          (plan) =>
            plan.seriesId === sourcePlan.seriesId && plan.userId === userId,
        );
        const skippedPlans = plans.filter(
          (plan) =>
            plan.seriesId === sourcePlan.seriesId && plan.userId !== userId,
        );
        const seriesPlanIds = seriesPlans.map((plan) => plan.id);
        const seriesActuals = actuals.filter(
          (actual) =>
            actual.userId === userId && seriesPlanIds.includes(actual.planId),
        );

        console.info('[RecurringPlanScope] delete-all targets', {
          source:
            editingPlanId && editingPlanId === sourcePlan.id
              ? 'plan-editor'
              : 'plan-card',
          action: 'delete',
          scope,
          userId,
          sourcePlanId: sourcePlan.id,
          sourceSeriesId: sourcePlan.seriesId,
          plans: seriesPlans.map(summarizePlanForLog),
          actuals: seriesActuals.map(summarizeActualForLog),
          skippedPlans: skippedPlans.map(summarizePlanForLog),
        });

        await runSequentially(seriesPlanIds, async (planId) => {
          console.info('[RecurringPlanScope] delete-all operation', {
            collection: 'plans',
            operation: 'delete-series-plan',
            planId,
            scope,
            seriesId: sourcePlan.seriesId,
          });
          try {
            await plannerRepository.deletePlan(userId, planId);
          } catch (error) {
            console.error('[RecurringPlanScope] delete-all operation failed', {
              collection: 'plans',
              operation: 'delete-series-plan',
              planId,
              scope,
              seriesId: sourcePlan.seriesId,
              error: getErrorDiagnostics(error),
            });
            throw error;
          }
        });
        setPlans((current) => removePlansByIds(current, seriesPlanIds));
        setActuals((current) =>
          current.filter((actual) => !seriesPlanIds.includes(actual.planId)),
        );
        setPendingRecurringPlanAction(null);
        closePlanEditor();
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
        await plannerRepository.upsertPlan(nextPlan);
        await runSequentially(actualsToDelete, async (actual) => {
          await plannerRepository.deleteActual(userId, actual.id);
        });
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
      closePlanEditor();
      showNotice('繰り返し予定を削除しました。');
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

    try {
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
    } catch (error) {
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
      setPendingRecurringPlanAction({
        kind: 'delete',
        plan,
      });
      return;
    }

    const linkedTodo =
      plan.sourceType === 'todo' && plan.sourceId
        ? todos.find(
            (todo) =>
              todo.id === plan.sourceId && todo.scheduledPlanId === plan.id,
          )
        : null;
    const linkedActuals = actuals.filter((actual) => actual.planId === plan.id);

    try {
      await plannerRepository.deletePlan(userId, plan.id);
      if (linkedTodo) {
        await plannerRepository.upsertTodo({
          ...linkedTodo,
          status: 'open',
          scheduledPlanId: null,
          updatedAt: new Date().toISOString(),
        });
      }

      setPlans((current) => removeByKey(current, plan.id, (item) => item.id));
      setActuals((current) => removeByKey(current, plan.id, (item) => item.planId));
      if (linkedTodo) {
        setTodos((current) =>
          upsertByKey(
            current,
            {
              ...linkedTodo,
              status: 'open',
              scheduledPlanId: null,
              updatedAt: new Date().toISOString(),
            },
            (todo) => todo.id,
          ),
        );
      }
      closePlanEditor();
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertPlan(plan);

        if (linkedTodo) {
          await plannerRepository.upsertTodo(linkedTodo);
        }

        setPlans((current) => sortAndUpsertPlans(current, [plan]));
        if (linkedActuals.length > 0) {
          setActuals((current) => upsertActualsById(current, linkedActuals));
        }
        if (linkedTodo) {
          setTodos((current) => upsertByKey(current, linkedTodo, (todo) => todo.id));
        }
      });
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '予定を削除できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function saveActual(plan: Plan, draft: ActualDraft) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const occurrenceKey = buildPlanOccurrenceKey(plan.id, draft.occurrenceDate);
    const existingActual = actuals.find(
      (actual) => getActualOccurrenceKey(actual) === occurrenceKey,
    );
    const nextActual = createActualFromDraft(userId, draft, existingActual);

    try {
      await plannerRepository.upsertActual(nextActual);
      setActuals((current) =>
        upsertByKey(current, nextActual, (item) => getActualOccurrenceKey(item)),
      );
      showNotice('実績を保存しました。', 'success');
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '実績を保存できませんでした。'),
        'error',
      );
      throw error;
    }
  }

  async function deleteActual(actual: Actual) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    try {
      await plannerRepository.deleteActual(userId, actual.id);
      setActuals((current) => removeByKey(current, actual.id, (item) => item.id));
      showNotice('実績を削除しました。');
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '実績を削除できませんでした。'),
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

    try {
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
    } catch (error) {
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

    try {
      await plannerRepository.deleteMonthEvent(userId, monthEvent.id);
      setMonthEvents((current) =>
        sortMonthEvents(removeByKey(current, monthEvent.id, (item) => item.id)),
      );
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertMonthEvent(monthEvent);
        setMonthEvents((current) =>
          sortMonthEvents(
            upsertByKey(current, monthEvent, (item) => item.id),
          ),
        );
      });
    } catch (error) {
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

    try {
      await plannerRepository.upsertTodo(nextTodo);
      setTodos((current) => upsertByKey(current, nextTodo, (todo) => todo.id));
      showNotice(currentTodo ? 'Todoを更新しました。' : 'Todoを追加しました。', 'success');
    } catch (error) {
      showNotice(resolveErrorMessage(error, 'Todoを保存できませんでした。'), 'error');
      throw error;
    }
  }

  async function scheduleTodoAsPlan(todo: TodoTask, draft: PlanDraft): Promise<Plan> {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      throw new Error('終了時刻は開始時刻より後にしてください。');
    }

    const nextPlan = createPlanFromDraft(
      {
        ...draft,
        sourceType: 'todo',
        sourceId: todo.id,
      },
    );

    const dueDate = todo.dueDate || null;
    const nextTodo: TodoTask = {
      ...todo,
      status: 'scheduled',
      scheduledPlanId: nextPlan.id,
      dueDate,
      dueTime: dueDate ? todo.dueTime ?? null : null,
      updatedAt: new Date().toISOString(),
    };

    let didCreatePlan = false;

    try {
      await plannerRepository.upsertPlan(nextPlan);
      didCreatePlan = true;
      await plannerRepository.upsertTodo(nextTodo);
      setPlans((current) =>
        sortByDateTime(upsertByKey(current, nextPlan, (plan) => plan.id)),
      );
      setTodos((current) => upsertByKey(current, nextTodo, (item) => item.id));
      setSelectedDate(nextPlan.date);
      setMonthDate(startOfMonth(nextPlan.date));
      showNotice('Todoを予定化しました。', 'success');
      return nextPlan;
    } catch (error) {
      if (didCreatePlan) {
        try {
          await plannerRepository.deletePlan(userId, nextPlan.id);
        } catch (rollbackError) {
          console.error('[TodoSchedule] failed to rollback created plan', {
            planId: nextPlan.id,
            error: getErrorDiagnostics(rollbackError),
          });
        }
      }

      showNotice(resolveErrorMessage(error, 'Todoを予定化できませんでした。'), 'error');
      throw error;
    }
  }

  async function deleteTodo(todo: TodoTask) {
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    try {
      await plannerRepository.deleteTodo(userId, todo.id);
      setTodos((current) => removeByKey(current, todo.id, (item) => item.id));
      showDeleteUndoNotice(async () => {
        await plannerRepository.upsertTodo(todo);
        setTodos((current) => upsertByKey(current, todo, (item) => item.id));
      });
    } catch (error) {
      showNotice(resolveErrorMessage(error, 'Todoを削除できませんでした。'), 'error');
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
    if (!userId) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const year = Number.isFinite(draft.year)
      ? Math.round(draft.year)
      : new Date().getFullYear();
    const label = createTimetableTermLabel(year, draft.kind, draft.label);
    const existingTerm = timetableTerms.find(
      (term) => term.id !== 'default' && term.year === year && term.kind === draft.kind,
    );
    const now = new Date().toISOString();
    const nextActiveTerm: TimetableTerm = {
      id: existingTerm?.id ?? createId('timetable-term'),
      userId,
      year,
      kind: draft.kind,
      label,
      isActive: true,
      createdAt: existingTerm?.createdAt ?? now,
      updatedAt: now,
    };
    const inactiveTerms = timetableTerms
      .filter((term) => term.id !== nextActiveTerm.id && term.id !== 'default')
      .map((term) => ({
        ...term,
        isActive: false,
        updatedAt: now,
      }));

    try {
      for (const term of inactiveTerms) {
        await plannerRepository.upsertTimetableTerm(term);
      }
      await plannerRepository.upsertTimetableTerm(nextActiveTerm);
      setTimetableTerms((current) => {
        const withInactive = current
          .filter((term) => term.id !== nextActiveTerm.id)
          .map((term) => ({ ...term, isActive: false, updatedAt: now }));
        return [...withInactive, nextActiveTerm].sort(
          (left, right) => left.year - right.year || left.label.localeCompare(right.label),
        );
      });
      showNotice('学期を切り替えました。', 'success');
      return nextActiveTerm;
    } catch (error) {
      showNotice(
        resolveErrorMessage(error, '学期を切り替えられませんでした。'),
        'error',
      );
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
    saveTodo,
    scheduleTodoAsPlan,
    deleteTodo,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    activateTimetableTerm,
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
