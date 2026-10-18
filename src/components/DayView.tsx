import { isScheduleActionMenuTarget } from '../lib/scheduleItemActions';
import { scheduleOccurrenceCoversDate, scheduleOccurrenceTimesForDate } from '../lib/weekViewLayout';
import { entryTimeRangeForDate } from '../lib/entryTimeRange';
import type { DayTimetableTimeChange } from '../domain/dayTimetableTimeEdit';
import type { ActualActionTarget } from '../hooks/useActualMutationAdmission';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrence,
} from '../domain/scheduleOccurrence';
import { deleteScheduleOccurrence } from '../domain/scheduleOccurrenceMutation';
import { dayOccurrenceCancellationPresentation } from '../lib/dayOccurrenceCancellationPresentation';
import { addDays, formatDateLabel, sortByDateTime } from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
  getRecurrenceWeekday,
  resolvePlanOccurrence,
} from '../lib/planRecurrence';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
import { sortMonthEvents } from '../lib/monthEvents';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import { useScheduleItemActionPress } from '../hooks/useScheduleItemActionPress';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { DailyMaterialShelf } from './DailyMaterialShelf';
import { DayDetailModal } from './DayDetailModal';
import { DayTimetableDetailModal } from './DayTimetableDetailModal';
import { DayTimeline } from './DayTimeline';
import { DayTimetableImportDialog } from './DayTimetableImportDialog';
import { MaterialQuickCreateModal } from './MaterialQuickCreateModal';
import { ScheduleItemRadialMenu } from './ScheduleItemRadialMenu';
import { ScheduleMoveDialog } from './ScheduleMoveDialog';
import { ScheduleMoveModeBanner } from './ScheduleMoveModeBanner';
import { useScheduleOccurrenceActions } from '../hooks/useScheduleOccurrenceActions';
import { createMonthEventActualPlan } from '../lib/scheduleItemActions';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  Plan,
  PlanDraft,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
  TimetableTerm,
} from '../types/domain';

interface DayViewProps {
  showTimetable?: boolean;
  onDeleteOccurrence?: (occurrence: ScheduleOccurrence) => Promise<void>;
  onChangeTimetableTime?: (occurrence: ScheduleOccurrence, time: DayTimetableTimeChange) => Promise<void>;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  studySubjects: StudySubject[];
  studyMaterials: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDuplicatePlan?: (plan: Plan) => void;
  onMovePlan: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onDeleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
  onPrepareTimetableRecord?: (occurrence: ScheduleOccurrence) => Promise<Plan>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  getActualActionBlockReason?: (target: ActualActionTarget) => string | null;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onOpenTimetable?: () => void;
  onOpenBookshelf: () => void;
  onOpenAddMaterial: () => void;
}

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'timetable-record'; plan: Plan; ownerId: string; viewedDate: string }
  | { type: 'plan-detail'; planId: string; actualId?: string; actualOccurrenceDate?: string; occurrenceId?: string; record?: boolean }
  | { type: 'month-event-detail'; monthEventId: string; actualId?: string; actualOccurrenceDate?: string; occurrenceId?: string; record?: boolean }
  | { type: 'timetable-detail'; occurrenceId: string; ownerId: string; viewedDate: string }
  | { type: 'standalone-actual-detail'; actual: Actual };

export function DayView({
  showTimetable = true,
  onDeleteOccurrence,
  onChangeTimetableTime,
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents,
  studySubjects,
  studyMaterials,
  scheduleTemplates,
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  onChangeDay,
  onEditPlan,
  onDuplicatePlan,
  onMovePlan,
  onDeletePlan,
  onDeleteMonthEvent,
  onSavePlan,
  onPrepareTimetableRecord,
  getActualActionBlockReason,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onOpenTimetable,
  onOpenBookshelf,
  onOpenAddMaterial,
}: DayViewProps) {
  const recordContext = useMemo(() => ({ userId, selectedDate }), [userId, selectedDate]);
  const activeRecordContext = useRef<typeof recordContext | null>(null);
  useLayoutEffect(() => { activeRecordContext.current = recordContext; return () => { activeRecordContext.current = null; }; }, [recordContext]);
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
  const [pendingTimetableRecord, setPendingTimetableRecord] = useState<{ context: typeof recordContext; occurrence: ScheduleOccurrence } | null>(null);
  const [pendingDetailDeletion, setPendingDetailDeletion] = useState<{ plan: Plan; viewedDate: string } | null>(null);
  const [actualOpenError, setActualOpenError] = useState('');
  const [quickMaterial, setQuickMaterial] = useState<StudyMaterial | null>(null);
  const [isTimetableImportOpen, setIsTimetableImportOpen] = useState(false);
  const scheduleAction = useScheduleItemActionPress<ScheduleOccurrence>();
  const moveWithHistory = useRef<((plan: Plan, target: WeekPlanMoveTarget) => Promise<void>) | null>(null);
  const dayRangeLabel = formatDateLabel(selectedDate);
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeDay(addDays(selectedDate, -1)),
    onNext: () => onChangeDay(addDays(selectedDate, 1)),
    disabled: modalState.type !== 'closed',
  });
  const dayScheduleProjection = useMemo(
    () =>
      createScheduleOccurrenceProjection({
        ownerId: userId,
        startDate: selectedDate,
        endDate: selectedDate,
        plans,
        monthEvents,
        scheduleTemplates,
        timetableTermId,
        timetableTerm,
        timetableTerms,
      }),
    [
      monthEvents,
      plans,
      scheduleTemplates,
      selectedDate,
      timetableTerm,
      timetableTermId,
      timetableTerms,
      userId,
    ],
  );
  const visibleDayOccurrences = useMemo(
    () => showTimetable ? dayScheduleProjection.occurrences : dayScheduleProjection.occurrences.filter(
      occurrence => occurrence.source.backingKind !== 'timetable-template',
    ),
    [dayScheduleProjection.occurrences, showTimetable],
  );
  const dayOccurrenceById = useMemo(
    () => new Map(visibleDayOccurrences.map((occurrence) => [occurrence.id, occurrence])),
    [visibleDayOccurrences],
  );
  const dayPlans = useMemo(
    () => sortByDateTime(expandPlansForDate(plans, selectedDate)),
    [plans, selectedDate],
  );
  const monthEventById = useMemo(
    () => new Map(monthEvents.map((monthEvent) => [monthEvent.id, monthEvent])),
    [monthEvents],
  );
  const dayMonthEventOccurrences = useMemo(
    () =>
      dayScheduleProjection.occurrences.filter(
        (occurrence) => occurrence.source.backingKind === 'month-event',
      ),
    [dayScheduleProjection.occurrences],
  );
  const dayMonthEvents = useMemo(
    () =>
      sortMonthEvents(
        dayMonthEventOccurrences.flatMap((occurrence) => {
          const monthEvent = monthEventById.get(occurrence.source.backingId);
          if (!monthEvent) return [];
          return [
            {
              ...monthEvent,
              date: selectedDate,
              endDate: selectedDate,
              startTime:
                occurrence.start.date === selectedDate
                  ? occurrence.start.time
                  : '00:00',
              endTime:
                occurrence.end.date === selectedDate
                  ? occurrence.end.time
                  : '24:00',
              repeat: 'none' as const,
              repeatUntil: null,
              excludedDates: [],
            },
          ];
        }),
      ),
    [dayMonthEventOccurrences, monthEventById, selectedDate],
  );
  const dayMonthEventPlans = useMemo(
    () =>
      dayMonthEvents.map((monthEvent) =>
        createMonthEventActualPlan(monthEvent, userId, selectedDate),
      ),
    [dayMonthEvents, selectedDate, userId],
  );
  const dayActuals = useMemo(
    () => actuals.filter(actual => actual.userId === userId && entryTimeRangeForDate(actual.occurrenceDate, actual.actualStartTime, actual.actualEndTime, selectedDate)),
    [actuals, selectedDate, userId],
  );
  const actualPlanSources = useMemo(() => dayActuals.flatMap(actual => {
    const plan = plans.find(plan => plan.userId === userId && plan.id === actual.planId);
    return plan ? [resolvePlanOccurrence(plan, actual.occurrenceDate)] : [];
  }), [plans, dayActuals, userId]);
  const actualMonthEventSources = useMemo(() => monthEvents.filter(event => event.userId === userId
    && dayActuals.some(actual => actual.planId === event.id)), [monthEvents, dayActuals, userId]);
  const dayPlanMap = useMemo(() => {
    const map = new Map([...actualPlanSources, ...dayPlans].map(plan => [plan.id, plan]));
    dayScheduleProjection.occurrences.forEach(occurrence => {
      if (occurrence.source.backingKind !== 'plan') return;
      const source = plans.find(plan => plan.id === occurrence.source.backingId && plan.userId === userId);
      if (source) map.set(source.id, resolvePlanOccurrence(source, occurrence.start.date));
    });
    return map;
  }, [actualPlanSources, dayPlans, dayScheduleProjection.occurrences, plans, userId]);
  const dayMonthEventPlanMap = useMemo(() => new Map([
    ...actualMonthEventSources.map(event => createMonthEventActualPlan(event, userId, selectedDate)),
    ...dayMonthEventPlans,
  ].map(plan => [plan.id, plan])), [actualMonthEventSources, dayMonthEventPlans, selectedDate, userId]);
  const dayMonthEventMap = useMemo(
    () =>
      new Map(
        [...actualMonthEventSources.map(event => [event.id, event] as const), ...dayMonthEventOccurrences.flatMap((occurrence) => {
          const monthEvent = monthEventById.get(occurrence.source.backingId);
          return monthEvent ? [[monthEvent.id, monthEvent] as const] : [];
        })],
      ),
    [dayMonthEventOccurrences, monthEventById, actualMonthEventSources],
  );
  const selectedWeekday = getRecurrenceWeekday(selectedDate);
  const resolvedTimetableTerm = useMemo(
    () =>
      timetableTerms.length > 0
        ? resolveTimetableTermForDate(selectedDate, timetableTerms, timetableTermId)
        : timetableTerm ?? null,
    [selectedDate, timetableTerm, timetableTermId, timetableTerms],
  );
  const resolvedTimetableTermId =
    resolvedTimetableTerm?.id ?? (timetableTerms.length === 0 ? timetableTermId : null);
  const timetableImportCandidates = useMemo(
    () =>
      resolvedTimetableTermId
        ? buildTimetableImportCandidates({
            templates: scheduleTemplates,
            date: selectedDate,
            weekday: selectedWeekday,
            termId: resolvedTimetableTermId,
            term: resolvedTimetableTerm,
          })
        : [],
    [
      resolvedTimetableTerm,
      resolvedTimetableTermId,
      scheduleTemplates,
      selectedDate,
      selectedWeekday,
    ],
  );
  const importedTimetableSourceIds = useMemo(
    () =>
      new Set(
        plans
          .filter(
            (plan) =>
              (plan.sourceDate?.trim() || plan.date) === selectedDate &&
              plan.sourceType === 'timetable' &&
              typeof plan.sourceId === 'string',
          )
          .map((plan) => plan.sourceId as string),
      ),
    [plans, selectedDate],
  );
  const actualByOccurrenceKey = useMemo(
    () => new Map(dayActuals.map((actual) => [getActualOccurrenceKey(actual), actual])),
    [dayActuals],
  );
  const retainedDeletingPlan = pendingDetailDeletion?.plan.userId === userId && pendingDetailDeletion.viewedDate === selectedDate
    ? pendingDetailDeletion.plan : null;
  const selectedActualReference = modalState.type === 'plan-detail' || modalState.type === 'month-event-detail'
    ? modalState : null;
  const selectedActualPlanId = selectedActualReference?.type === 'plan-detail' ? selectedActualReference.planId
    : selectedActualReference?.type === 'month-event-detail' ? selectedActualReference.monthEventId : undefined;
  const selectedTimelineActual = selectedActualReference?.actualId
    ? dayActuals.find(actual => actual.id === selectedActualReference.actualId)
      ?? dayActuals.find(actual => actual.planId === selectedActualPlanId
        && actual.occurrenceDate === selectedActualReference.actualOccurrenceDate) : undefined;
  const selectedActualOccurrenceDate = selectedActualReference?.actualOccurrenceDate ?? selectedTimelineActual?.occurrenceDate;
  const selectedActualSourcePlan = selectedActualReference?.type === 'plan-detail' && selectedActualReference.actualId
    ? plans.find(plan => plan.id === selectedActualReference.planId && plan.userId === userId) : undefined;
  const selectedTimelineOccurrence = (modalState.type === 'plan-detail' || modalState.type === 'month-event-detail') && modalState.occurrenceId
    ? dayOccurrenceById.get(modalState.occurrenceId) : undefined;
  const selectedOccurrenceSourcePlan = selectedTimelineOccurrence?.source.backingKind === 'plan'
    ? plans.find(plan => plan.id === selectedTimelineOccurrence.source.backingId && plan.userId === userId) : undefined;
  const selectedPlan =
    modalState.type === 'plan-detail'
      ? (modalState.occurrenceId
          ? selectedOccurrenceSourcePlan && selectedTimelineOccurrence
            ? resolvePlanOccurrence(selectedOccurrenceSourcePlan, selectedTimelineOccurrence.start.date) : null
          : modalState.actualId
            ? selectedActualSourcePlan && selectedActualOccurrenceDate
              ? resolvePlanOccurrence(selectedActualSourcePlan, selectedActualOccurrenceDate) : null
            : dayPlanMap.get(modalState.planId))
        ?? (retainedDeletingPlan?.id === modalState.planId ? retainedDeletingPlan : null)
      : modalState.type === 'timetable-record' && modalState.ownerId === userId && modalState.viewedDate === selectedDate
        ? dayPlanMap.get(modalState.plan.id) ?? modalState.plan : null;
  const selectedMonthEvent =
    modalState.type === 'month-event-detail'
      ? dayMonthEventMap.get(modalState.monthEventId) ?? null
      : null;
  const selectedMonthEventActualDate = selectedActualOccurrenceDate ?? selectedDate;
  const selectedMonthEventOccurrence = selectedMonthEvent ? visibleDayOccurrences.find(occurrence =>
    occurrence.source.backingKind === 'month-event' && occurrence.source.backingId === selectedMonthEvent.id
    && scheduleOccurrenceCoversDate(occurrence, selectedMonthEventActualDate)) : undefined;
  const selectedMonthEventPlan = selectedMonthEvent
    ? selectedActualOccurrenceDate && selectedMonthEventActualDate !== selectedDate
      ? createMonthEventActualPlan({
          ...selectedMonthEvent,
          ...(selectedMonthEventOccurrence ? scheduleOccurrenceTimesForDate(selectedMonthEventOccurrence, selectedMonthEventActualDate) : {}),
        }, userId, selectedMonthEventActualDate)
      : dayMonthEventPlanMap.get(selectedMonthEvent.id) ?? null
    : null;
  const selectedTimetableOccurrence = modalState.type === 'timetable-detail'
    && modalState.ownerId === userId && modalState.viewedDate === selectedDate
    ? (pendingTimetableRecord?.context === recordContext && pendingTimetableRecord.occurrence.id === modalState.occurrenceId
        ? pendingTimetableRecord.occurrence : dayOccurrenceById.get(modalState.occurrenceId)) : undefined;
  const detailTimetable = selectedTimetableOccurrence?.source.backingKind === 'timetable-template'
    ? selectedTimetableOccurrence : null;
  const selectedDetailPlan = selectedPlan ?? selectedMonthEventPlan;
  const selectedDetailOccurrence = selectedTimelineOccurrence ?? (selectedDetailPlan ? visibleDayOccurrences.find(occurrence =>
    occurrence.source.backingKind === (selectedMonthEvent ? 'month-event' : 'plan')
    && occurrence.source.backingId === selectedDetailPlan.id
    && (selectedMonthEvent
      ? scheduleOccurrenceCoversDate(occurrence, selectedMonthEventActualDate)
      : occurrence.start.date === (selectedActualOccurrenceDate ?? selectedDetailPlan.date))) : undefined);

  const deletionPresentation = selectedDetailOccurrence ? getDeletionPresentation(selectedDetailOccurrence) : undefined;
  const selectedDetailActual = selectedTimelineActual ?? (selectedDetailPlan
    ? actualByOccurrenceKey.get(
        buildPlanOccurrenceKey(selectedDetailPlan.id, selectedDetailPlan.date),
      )
    : undefined);
  const selectedStandaloneActual =
    modalState.type === 'standalone-actual-detail' && modalState.actual.userId === userId
      ? modalState.actual
      : null;

  useEffect(() => {
    if (modalState.type === 'plan-detail' && !selectedPlan) {
      setModalState({ type: 'closed' });
    }

    if (
      modalState.type === 'month-event-detail' &&
      (!dayMonthEventMap.has(modalState.monthEventId)
        || Boolean(modalState.occurrenceId && !selectedTimelineOccurrence))
    ) {
      setModalState({ type: 'closed' });
    }

    if (modalState.type === 'timetable-record' && (modalState.ownerId !== userId || modalState.viewedDate !== selectedDate)) setModalState({ type: 'closed' });
    if (modalState.type === 'timetable-detail' && !detailTimetable) setModalState({ type: 'closed' });
  }, [dayMonthEventMap, detailTimetable, modalState, selectedPlan, selectedTimelineActual, selectedTimelineOccurrence, userId, selectedDate]);

  useEffect(() => {
    setModalState({ type: 'closed' });
    setQuickMaterial(null);
    setActualOpenError('');
    scheduleAction.dismiss();
  }, [selectedDate, userId]);

  async function deleteDetailPlan(plan: Plan) {
    // Preserve only the in-flight menu target while the list updates optimistically.
    const target = { plan: structuredClone(plan), viewedDate: selectedDate };
    setPendingDetailDeletion(target);
    try {
      await onDeletePlan(plan);
    } finally {
      setPendingDetailDeletion((current) => current === target ? null : current);
    }
  }

  function closeModal() {
    setModalState({ type: 'closed' });
  }

  function resolveScheduleActionTarget(target: EventTarget | null): {
    element: HTMLElement;
    occurrence: ScheduleOccurrence;
  } | null {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>('[data-schedule-occurrence-id]');
    const occurrenceId = element?.dataset.scheduleOccurrenceId;
    const occurrence = occurrenceId ? dayOccurrenceById.get(occurrenceId) : undefined;
    return element && occurrence ? { element, occurrence } : null;
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
    const target = resolveScheduleActionTarget(event.target);
    if (!target || target.occurrence.id === radialActions.armedMove?.occurrenceId) return;
    scheduleAction.start(
      target.occurrence.id,
      target.occurrence,
      target.occurrence.title,
      'pointer',
      target.element,
      event.clientX,
      event.clientY,
      event.pointerId,
    );
  }

  function handlePointerMoveCapture(event: ReactPointerEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.pointerType === 'touch' || !scheduleAction.ownsInput('pointer', event.pointerId)) return;
    scheduleAction.move(event.clientX, event.clientY);
  }

  function handlePointerUpCapture(event: ReactPointerEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.pointerType === 'touch' || !scheduleAction.ownsInput('pointer', event.pointerId)) return;
    const target = resolveScheduleActionTarget(event.target);
    if (target) scheduleAction.finish(target.occurrence.id);
    else scheduleAction.cancel();
  }

  function handleTouchStartCapture(event: ReactTouchEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.touches.length !== 1) return;
    const target = resolveScheduleActionTarget(event.target);
    const touch = event.touches[0];
    if (!target || !touch || target.occurrence.id === radialActions.armedMove?.occurrenceId) return;
    scheduleAction.start(
      target.occurrence.id,
      target.occurrence,
      target.occurrence.title,
      'touch',
      target.element,
      touch.clientX,
      touch.clientY,
      touch.identifier,
    );
  }

  function handleTouchMoveCapture(event: ReactTouchEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    const touch = event.touches[0];
    if (touch && scheduleAction.ownsInput('touch', touch.identifier)) scheduleAction.move(touch.clientX, touch.clientY);
  }

  function handleTouchEndCapture(event: ReactTouchEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (!Array.from(event.changedTouches).some(touch => scheduleAction.ownsInput('touch', touch.identifier))) return;
    const target = resolveScheduleActionTarget(event.target);
    if (target) scheduleAction.finish(target.occurrence.id);
    else scheduleAction.cancel();
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    swipeNavigation.onClickCapture(event);
    if (!resolveScheduleActionTarget(event.target) || !scheduleAction.shouldSuppressClick()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function getDeletionPresentation(occurrence: ScheduleOccurrence) {
    const source = occurrence.source.backingKind === 'month-event'
      ? monthEvents.find(event => event.id === occurrence.source.backingId && event.userId === occurrence.ownerId)
      : plans.find(plan => plan.id === occurrence.source.backingId && plan.userId === occurrence.ownerId);
    return dayOccurrenceCancellationPresentation(occurrence, source);
  }

  async function handleDeleteOccurrence(occurrence: ScheduleOccurrence) {
    if (onDeleteOccurrence) {
      const copy = getDeletionPresentation(occurrence);
      if (copy.description && !window.confirm(`${occurrence.title}\n${copy.description}\n${copy.label}しますか？`)) return;
      await onDeleteOccurrence(occurrence); return;
    }
    await deleteScheduleOccurrence({
      occurrence,
      plans,
      monthEvents,
      deletePlan: onDeletePlan,
      deleteMonthEvent: onDeleteMonthEvent,
      confirmRecurringMonthEventSeries: (monthEvent) =>
        window.confirm(
          `「${monthEvent.title}」は繰り返し予定です。予定全体を削除しますか？`,
        ),
    });
  }

  const radialActions = useScheduleOccurrenceActions({
    occurrences: visibleDayOccurrences, activeOccurrence: scheduleAction.activeAction?.item, onDismissMenu: scheduleAction.dismiss,
    contextKey: `${userId}:${selectedDate}`, viewedDate: selectedDate, plans, monthEvents, actuals,
    onEditPlan, onDuplicatePlan, canMove: true,
    canDelete: occurrence => occurrence.source.backingKind !== 'timetable-template' || Boolean(onDeleteOccurrence),
    onDelete: handleDeleteOccurrence, onSaveActual, getActualActionBlockReason, onPrepareTimetableRecord,
    onOpenPreparedRecord: plan => setModalState({ type: 'timetable-record', plan, ownerId: userId, viewedDate: selectedDate }),
    onOpenDetail: (occurrence, record) => {
      if (occurrence.source.backingKind === 'timetable-template') {
        setModalState({ type: 'timetable-detail', occurrenceId: occurrence.id, ownerId: userId, viewedDate: selectedDate });
      } else if (occurrence.source.backingKind === 'plan') {
        setModalState({ type: 'plan-detail', planId: occurrence.source.backingId, occurrenceId: occurrence.id, record });
      } else {
        setModalState({ type: 'month-event-detail', monthEventId: occurrence.source.backingId, occurrenceId: occurrence.id, record });
      }
    },
  });

  return (
    <section
      className="section-stack swipe-view"
      {...swipeNavigation}
      onTouchStart={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchStart(event); }}
      onTouchMove={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchMove(event); }}
      onTouchEnd={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchEnd(); }}
      onTouchCancel={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchCancel(); }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={event => { if (event.pointerType !== 'touch' && !isScheduleActionMenuTarget(event.target)) scheduleAction.cancelPointer(event.pointerId); }}
      onTouchStartCapture={handleTouchStartCapture}
      onTouchMoveCapture={handleTouchMoveCapture}
      onTouchEndCapture={handleTouchEndCapture}
      onTouchCancelCapture={event => { if (!isScheduleActionMenuTarget(event.target)) scheduleAction.cancel(); }}
      onClickCapture={handleClickCapture}
      onContextMenu={event => {
        const target = resolveScheduleActionTarget(event.target);
        if (!target) return;
        event.preventDefault();
        scheduleAction.open(target.occurrence.id, target.occurrence, target.occurrence.title, target.element);
      }}
      onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        const target = resolveScheduleActionTarget(event.target);
        if (!target) return;
        event.preventDefault();
        scheduleAction.open(target.occurrence.id, target.occurrence, target.occurrence.title, target.element);
      }}
    >
      {radialActions.notice ? (
        // Floating like the app toast so the calendar layout never shifts.
        <div className="app-toast-layer print-hide bottom" aria-live="polite">
          <p className={`app-notice app-toast ${radialActions.notice.tone}`} role="status">{radialActions.notice.text}</p>
        </div>
      ) : null}
      {radialActions.movingPlan ? <ScheduleMoveDialog key={`${userId}:${selectedDate}:${radialActions.movingPlan.id}`} plan={radialActions.movingPlan} onClose={radialActions.closeMove}
        onMove={(plan, target) => moveWithHistory.current ? moveWithHistory.current(plan, target) : onMovePlan(plan, target)} /> : null}
      {radialActions.armedMove ? <ScheduleMoveModeBanner title={radialActions.armedMove.title}
        onOpenDialog={radialActions.openMoveDialog} onCancel={radialActions.closeMove} /> : null}
      {actualOpenError ? <p className="inline-error" role="alert">{actualOpenError}</p> : null}
      {detailTimetable ? (
        <DayTimetableDetailModal key={detailTimetable.id} occurrence={detailTimetable}
          onClose={closeModal} onOpenTimetable={onOpenTimetable} onSaveTime={onChangeTimetableTime}
          onPrepareRecord={onPrepareTimetableRecord ? async () => {
            setPendingTimetableRecord({ context: recordContext, occurrence: detailTimetable });
            try {
              const plan = await onPrepareTimetableRecord(detailTimetable);
              if (activeRecordContext.current !== recordContext) return;
              setModalState({ type: 'timetable-record', plan, ownerId: userId, viewedDate: selectedDate });
            } finally {
              if (activeRecordContext.current === recordContext) setPendingTimetableRecord(null);
            }
          } : undefined}
          onDeleteOccurrence={onDeleteOccurrence ? () => onDeleteOccurrence(detailTimetable) : undefined} />
      ) : null}
      <DayDetailModal
        detailPlan={selectedDetailPlan}
        key={modalState.type === 'plan-detail' || modalState.type === 'month-event-detail' ? `${modalState.type}:${modalState.record ?? false}:${selectedDetailPlan?.id}` : modalState.type}
        openRecordInitially={modalState.type === 'timetable-record' || ((modalState.type === 'plan-detail' || modalState.type === 'month-event-detail') && modalState.record)}
        monthEvent={selectedMonthEvent}
        detailActual={selectedDetailActual}
        standaloneActual={selectedStandaloneActual}
        plans={plans}
        actuals={actuals}
        onEditPlan={onEditPlan}
        onDeletePlan={deleteDetailPlan}
        showWholePlanDelete={!onDeleteOccurrence || deletionPresentation?.isRecurring !== false}
        deleteOccurrenceLabel={deletionPresentation?.label}
        deleteOccurrenceDescription={deletionPresentation?.description}
        historyOnly={Boolean(selectedDetailPlan && !selectedDetailOccurrence && !retainedDeletingPlan
          && (selectedMonthEvent ?? selectedDetailPlan).excludedDates.includes(selectedActualOccurrenceDate ?? selectedDetailPlan.date))}
        onDeleteOccurrence={selectedDetailOccurrence && onDeleteOccurrence ? () => onDeleteOccurrence(selectedDetailOccurrence) : undefined}
        getActualActionBlockReason={getActualActionBlockReason}
        onSaveActual={onSaveActual}
        onSaveStandaloneActual={onSaveStandaloneActual}
        onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
        onDeleteActual={onDeleteActual}
        onClose={closeModal}
      />

      {quickMaterial ? (
        <MaterialQuickCreateModal
          userId={userId}
          selectedDate={selectedDate}
          material={quickMaterial}
          onClose={() => setQuickMaterial(null)}
          onSavePlan={onSavePlan}
          onSaveStandaloneActual={onSaveStandaloneActual}
        />
      ) : null}

      <DayTimetableImportDialog
        open={isTimetableImportOpen}
        dateLabel={dayRangeLabel}
        selectedDate={selectedDate}
        userId={userId}
        candidates={timetableImportCandidates}
        importedSourceIds={importedTimetableSourceIds}
        onSavePlan={onSavePlan}
        onClose={() => setIsTimetableImportOpen(false)}
      />

      <DayTimeline
        date={selectedDate}
        dateLabel={dayRangeLabel}
        plans={dayPlans}
        monthEvents={dayMonthEvents}
        scheduleOccurrences={visibleDayOccurrences}
        actuals={dayActuals}
        actualPlanSources={actualPlanSources}
        actualMonthEventSources={actualMonthEventSources}
        weeklyDraftBlocks={weeklyDraftBlocks.filter(
          (block) => block.date === selectedDate && block.status === 'draft',
        )}
        onRemoveWeeklyDraftBlock={onRemoveWeeklyDraftBlock}
        onMovePlan={onMovePlan}
        registerMoveWithHistory={handler => { moveWithHistory.current = handler; }}
        armedMoveOccurrenceId={radialActions.armedMove?.occurrenceId}
        onArmedMoveCommit={radialActions.closeMove}
        selectedEntryId={
          selectedTimelineActual ? `actual:${selectedTimelineActual.id}` : detailTimetable
            ? `timetable:${detailTimetable.id}`
            : selectedPlan
            ? `plan:${selectedPlan.id}`
            : selectedMonthEvent
              ? `month-event:${selectedMonthEvent.id}`
              : selectedStandaloneActual
                ? `standalone-actual:${selectedStandaloneActual.id}`
                : undefined
        }
        onSelectEntry={(entry) => {
          if (entry.kind === 'timetable') {
            setActualOpenError('');
            setModalState({ type: 'timetable-detail', occurrenceId: entry.id, ownerId: userId, viewedDate: selectedDate });
            return;
          }
          if (entry.kind === 'standalone-actual') {
            const actual = dayActuals.find(item => item.id === entry.id && !item.planId);
            const reason = actual ? getActualActionBlockReason?.(actual) : null;
            setActualOpenError(reason ?? '');
            if (actual && !reason) setModalState({ type: 'standalone-actual-detail', actual: structuredClone(actual) });
            return;
          }
          setActualOpenError('');
          const actualOccurrenceDate = entry.actualId ? dayActuals.find(actual => actual.id === entry.actualId)?.occurrenceDate : undefined;
          setModalState(entry.kind === 'plan'
            ? { type: 'plan-detail', planId: entry.id, actualId: entry.actualId, actualOccurrenceDate, occurrenceId: entry.occurrenceId }
            : { type: 'month-event-detail', monthEventId: entry.id, actualId: entry.actualId, actualOccurrenceDate, occurrenceId: entry.occurrenceId });
        }}
        onPreviousDay={() => onChangeDay(addDays(selectedDate, -1))}
        onNextDay={() => onChangeDay(addDays(selectedDate, 1))}
        onPrint={() => window.print()}
        onImportTimetable={() => setIsTimetableImportOpen(true)}
        timetableImportCount={timetableImportCandidates.length}
      />

      <DailyMaterialShelf
        userId={userId}
        subjects={studySubjects}
        materials={studyMaterials}
        onOpenBookshelf={onOpenBookshelf}
        onOpenAddMaterial={onOpenAddMaterial}
        onSelectMaterial={setQuickMaterial}
      />

      <ScheduleItemRadialMenu
        action={scheduleAction.activeAction}
        actions={radialActions.actionsFor(scheduleAction.activeAction?.item)}
        onSelect={radialActions.select}
        onDismiss={scheduleAction.dismiss}
      />
    </section>
  );
}
