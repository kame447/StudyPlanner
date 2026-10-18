import { isScheduleActionMenuTarget } from '../lib/scheduleItemActions';
import { entryTimeRangeForDate } from '../lib/entryTimeRange';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { getPlanScheduleColor, getScheduleOccurrenceColor, scheduleEventWeekStyle } from '../lib/scheduleEventColor';
import { createPortal } from 'react-dom';
import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrence,
} from '../domain/scheduleOccurrence';
import { deleteScheduleOccurrence } from '../domain/scheduleOccurrenceMutation';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import {
  addDays,
  getWeekDates,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  resolvePlanOccurrence,
} from '../lib/planRecurrence';
import {
  isScheduleOccurrenceOutsideHourlyGrid,
  layoutWeekSpanningOccurrences,
} from '../lib/scheduleOccurrencePresentation';
import { acquireTimelineDragInteractionLock } from '../lib/timelineDragInteractionLock';
import { SCHEDULE_LONG_PRESS_MS } from '../lib/scheduleGestureTiming';
import { allowsSpatialMotion } from '../lib/motionPreference';
import {
  calculateWeekPlanVelocityTilt,
  hasWeekPlanMoveChanged,
  resolveWeekPlanDragTarget,
  type WeekPlanMoveTarget,
} from '../lib/weekPlanDrag';
import {
  buildLanes,
  scheduleOccurrenceCoversDate,
  scheduleOccurrenceTimesForDate,
  type WeekViewLane,
} from '../lib/weekViewLayout';
import { useDataChangeMotion } from '../hooks/useDataChangeMotion';
import { usePeriodNavigationMotion } from '../hooks/usePeriodNavigationMotion';
import { useScheduleItemActionPress } from '../hooks/useScheduleItemActionPress';
import { useTimelineTouchMoveGuard } from '../hooks/useTimelineTouchMoveGuard';
import { useTimelineDragCancellation } from '../hooks/useTimelineDragCancellation';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { useUndoRedoHistory } from '../hooks/useUndoRedoHistory';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  Plan,
  PlanSourceType,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';
import { DragUndoRedoControls } from './DragUndoRedoControls';
import { ScheduleItemRadialMenu } from './ScheduleItemRadialMenu';
import { ScheduleMoveDialog } from './ScheduleMoveDialog';
import { ScheduleMoveModeBanner } from './ScheduleMoveModeBanner';
import { DayDetailModal } from './DayDetailModal';
import { useScheduleOccurrenceActions } from '../hooks/useScheduleOccurrenceActions';
import { resolveScheduleActionPlan } from '../lib/scheduleItemActions';
import type { ActualActionTarget } from '../hooks/useActualMutationAdmission';
import { WeekSpanningEventsLane } from './WeekSpanningEventsLane';
import '../styles/week-plan-drag.css';

type WeekTimelineMode = 'plan' | 'actual';
type DragInputKind = 'pointer' | 'touch';

interface WeekViewProps {
  selectedDate: string;
  userId?: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents?: MonthEvent[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onOpenPlan?: (plan: Plan) => void;
  onDuplicatePlan?: (plan: Plan) => void;
  onPrepareTimetableRecord?: (occurrence: ScheduleOccurrence) => Promise<Plan>;
  getActualActionBlockReason?: (target: ActualActionTarget) => string | null;
  onSaveActual?: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual?: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan?: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual?: (actual: Actual) => Promise<void>;
  onMovePlan?: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
  onDeletePlan?: (plan: Plan) => Promise<void>;
  onDeleteMonthEvent?: (monthEvent: MonthEvent) => Promise<void>;
  onChangeWeek?: (date: string) => void;
  onOpenDay: (date: string) => void;
}

interface WeekPreviewBaseBlock {
  id: string;
  title: string;
  subject: string;
  type: Plan['type'];
  sourceType?: PlanSourceType;
  startTime: string;
  endTime: string;
  draft?: boolean;
  plan?: Plan;
  occurrence?: ScheduleOccurrence;
}

type WeekPreviewBlock = WeekPreviewBaseBlock & WeekViewLane;

interface DragSession {
  inputKind: DragInputKind;
  sourceElement: HTMLElement;
  blockId: string;
  plan: Plan;
  originalDate: string;
  originalStartTime: string;
  originalEndTime: string;
  allowDateChange: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastSampleTime: number;
  smoothedVelocityX: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  dayWidth: number;
  timelineHeight: number;
  startScrollLeft: number;
  scrollElement: HTMLDivElement | null;
  toneClass: string;
  toneStyle: CSSProperties;
  title: string;
  active: boolean;
  canceled: boolean;
  longPressArmed: boolean;
  /** Lifted by the radial 移動 action: a touch drags on first movement, no hold. */
  moveArmed: boolean;
  longPressTimer: number | null;
  releaseInteractionLock: (() => void) | null;
  target: WeekPlanMoveTarget;
  reducedMotion: boolean;
}

interface DragVisualState {
  blockId: string;
  title: string;
  toneClass: string;
  toneStyle: CSSProperties;
  target: WeekPlanMoveTarget;
  overlayX: number;
  overlayY: number;
  width: number;
  height: number;
  tilt: number;
  dateLocked: boolean;
}

const WEEK_HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const MINUTES_PER_DAY = 24 * 60;
const TOUCH_LONG_PRESS_MS = SCHEDULE_LONG_PRESS_MS;
const TOUCH_MOVE_TOLERANCE_PX = 9;
const POINTER_DRAG_THRESHOLD_PX = 4;
const DRAG_EDGE_SCROLL_PX = 30;
const DRAG_EDGE_SCROLL_STEP_PX = 14;
const CLICK_SUPPRESSION_MS = 700;

function formatWeekDate(dateString: string, format: 'compact' | 'full'): string {
  const date = new Date(`${dateString}T00:00:00`);
  const weekday = WEEKDAY_LABELS[date.getDay()] ?? '';
  const day = format === 'full'
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getDate()}`;
  return `${day}（${weekday}）`;
}

function resolveActualTitle(actual: Actual, plan?: Plan): string {
  return actual.title?.trim() || plan?.title || '記録';
}

function resolveActualSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject || '記録';
}

function buildMarkerStyle(hour: number): CSSProperties {
  return {
    top: `${(hour / 24) * 100}%`,
  };
}

function buildBlockStyle(entry: WeekPreviewBlock): CSSProperties {
  const startMinutes = Math.max(0, minutesFromTime(entry.startTime));
  const durationMinutes = Math.max(minutesBetween(entry.startTime, entry.endTime), 1);
  const laneWidth = 100 / Math.max(entry.laneCount, 1);
  const topPercent = (startMinutes / MINUTES_PER_DAY) * 100;
  const heightPercent = (durationMinutes / MINUTES_PER_DAY) * 100;

  return {
    ...getBlockColorStyle(entry),
    top: `${topPercent}%`,
    height: `max(${heightPercent}%, 14px)`,
    left: `calc(${entry.lane * laneWidth}% + 2px)`,
    width: `calc(${laneWidth}% - 4px)`,
    right: 'auto',
  };
}

function buildDropGhostStyle(target: WeekPlanMoveTarget): CSSProperties {
  const startMinutes = Math.max(0, minutesFromTime(target.startTime));
  const durationMinutes = Math.max(minutesBetween(target.startTime, target.endTime), 1);
  const topPercent = (startMinutes / MINUTES_PER_DAY) * 100;
  const heightPercent = (durationMinutes / MINUTES_PER_DAY) * 100;

  return {
    top: `${topPercent}%`,
    height: `max(${heightPercent}%, 14px)`,
    left: '2px',
    width: 'calc(100% - 4px)',
    right: 'auto',
  };
}

function getBlockColorStyle(entry: WeekPreviewBaseBlock): CSSProperties {
  return entry.draft ? {} : scheduleEventWeekStyle(entry.occurrence
    ? getScheduleOccurrenceColor(entry.occurrence) : getPlanScheduleColor(entry),
  entry.occurrence?.source.backingKind === 'month-event' ? 'theme' : 'pastel');
}

function getToneClass(entry: WeekPreviewBaseBlock): string {
  if (!entry.draft) return '';
  const key = (entry.subject || entry.title || entry.id).trim();
  const toneIndex = Array.from(key || entry.id).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 8;
  return `weekly-draft-tone-${toneIndex + 1}`;
}

function getDurationClass(entry: WeekPreviewBaseBlock): string {
  const duration = minutesBetween(entry.startTime, entry.endTime);
  if (duration <= 20) return 'schedule-week-block-micro';
  if (duration <= 40) return 'schedule-week-block-short';
  return '';
}

function getDistance(startX: number, startY: number, x: number, y: number): number {
  return Math.hypot(x - startX, y - startY);
}

// Stable defaults so absent optional data is not mistaken for a data change.
const NO_MONTH_EVENTS: MonthEvent[] = [];
const NO_DRAFT_BLOCKS: WeeklyPlanDraftBlock[] = [];

export function WeekView({
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents = NO_MONTH_EVENTS,
  scheduleTemplates = [],
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  weeklyDraftBlocks = NO_DRAFT_BLOCKS,
  onRemoveWeeklyDraftBlock,
  onOpenPlan,
  onDuplicatePlan,
  onPrepareTimetableRecord,
  getActualActionBlockReason,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onMovePlan,
  onDeletePlan,
  onDeleteMonthEvent,
  onOpenDay,
  onChangeWeek,
}: WeekViewProps) {
  const [timelineMode, setTimelineMode] = useState<WeekTimelineMode>('plan');
  const [dragVisual, setDragVisual] = useState<DragVisualState | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressClickUntilRef = useRef(0);
  const moveHistory = useUndoRedoHistory<string, WeekPlanMoveTarget>();
  const [recordSelection, setRecordSelection] = useState<{ plan: Plan; record: boolean; context: string } | null>(null);
  const recordContext = `${userId}:${selectedDate}`;
  const detailSelection = recordSelection?.context === recordContext ? recordSelection : null;
  const scheduleAction = useScheduleItemActionPress<ScheduleOccurrence>();
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeWeek?.(addDays(selectedDate, -7)),
    onNext: () => onChangeWeek?.(addDays(selectedDate, 7)),
    disabled: !onChangeWeek || Boolean(dragVisual || scheduleAction.activeAction || detailSelection),
  });
  useEffect(() => { setRecordSelection(null); scheduleAction.dismiss(); }, [recordContext]);
  const weekDates = getWeekDates(selectedDate);
  const weekSectionRef = useRef<HTMLElement | null>(null);
  useDataChangeMotion(weekSectionRef, `${weekDates[0]}:${timelineMode}`, [plans, actuals, monthEvents, weeklyDraftBlocks]);
  useTimelineTouchMoveGuard(weekSectionRef);
  const weekGridRef = useRef<HTMLDivElement | null>(null);
  usePeriodNavigationMotion(weekGridRef, weekDates[0]);
  const weekStartDate = weekDates[0];
  const weekEndDate = weekDates[weekDates.length - 1];
  const scheduleProjection = useMemo(
    () =>
      weekStartDate && weekEndDate
        ? createScheduleOccurrenceProjection({
            ownerId:
              userId ??
              plans[0]?.userId ??
              monthEvents[0]?.userId ??
              scheduleTemplates[0]?.userId ??
              timetableTerm?.userId ??
              timetableTerms[0]?.userId ??
              '',
            startDate: weekStartDate,
            endDate: weekEndDate,
            plans,
            monthEvents,
            scheduleTemplates,
            timetableTermId,
            timetableTerm,
            timetableTerms,
          })
        : { occurrences: [], issues: [] },
    [
      monthEvents,
      plans,
      scheduleTemplates,
      timetableTerm,
      timetableTermId,
      timetableTerms,
      userId,
      weekEndDate,
      weekStartDate,
    ],
  );
  const spanningLayout = layoutWeekSpanningOccurrences(
    scheduleProjection.occurrences,
    weekDates,
  );
  const showSpanningLane = timelineMode === 'plan' && spanningLayout.items.length > 0;
  const occurrenceById = useMemo(
    () => new Map(scheduleProjection.occurrences.map((occurrence) => [occurrence.id, occurrence])),
    [scheduleProjection.occurrences],
  );
  const occurrenceByPlanDate = useMemo(
    () =>
      new Map(
        scheduleProjection.occurrences
          .filter((occurrence) => occurrence.source.backingKind === 'plan')
          .map((occurrence) => [
            `${occurrence.source.backingId}:${occurrence.start.date}`,
            occurrence,
          ]),
      ),
    [scheduleProjection.occurrences],
  );
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const gridStyle = {
    gridTemplateColumns: '46px repeat(7, minmax(0, 1fr))',
  } as CSSProperties;
  const previewGridStyle = {
    gridTemplateRows: showSpanningLane
      ? 'auto auto minmax(0, 1fr)'
      : 'auto minmax(0, 1fr)',
  } as CSSProperties;
  const timelineStyle = { height: '100%' } as CSSProperties;

  function clearLongPressTimer(session: DragSession | null) {
    if (session?.longPressTimer !== null && session?.longPressTimer !== undefined) {
      window.clearTimeout(session.longPressTimer);
      session.longPressTimer = null;
    }
  }

  function releaseInteractionLock(session: DragSession | null) {
    session?.releaseInteractionLock?.();
    if (session) session.releaseInteractionLock = null;
  }

  function clearDragSession() {
    const session = dragSessionRef.current;
    if (!session) return;
    clearLongPressTimer(session);
    releaseInteractionLock(session);
    dragSessionRef.current = null;
    setDragVisual(null);
  }

  useTimelineDragCancellation(clearDragSession);

  useEffect(() => {
    if (dragSessionRef.current?.sourceElement.isConnected === false) clearDragSession();
  });

  useEffect(() => {
    return () => {
      const session = dragSessionRef.current;
      clearLongPressTimer(session);
      releaseInteractionLock(session);
      dragSessionRef.current = null;
    };
  }, []);

  function createDragSession(
    inputKind: DragInputKind,
    entry: WeekPreviewBlock,
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ): DragSession | null {
    if (!entry.plan || !onMovePlan) {
      return null;
    }

    const dayColumn = element.closest<HTMLElement>('.schedule-week-day-column');
    if (!dayColumn) {
      return null;
    }

    const scrollElement = element.closest<HTMLDivElement>('.schedule-week-preview-scroll');
    const cardRect = element.getBoundingClientRect();
    const dayRect = dayColumn.getBoundingClientRect();
    const storedPlan = planById.get(entry.plan.id) ?? entry.plan;
    const allowDateChange = !supportsScopedRecurringPlanEdits(storedPlan);
    const target = {
      date: entry.plan.occurrenceDate ?? entry.plan.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
    };

    return {
      inputKind,
      sourceElement: element,
      blockId: entry.id,
      plan: entry.plan,
      originalDate: target.date,
      originalStartTime: entry.startTime,
      originalEndTime: entry.endTime,
      allowDateChange,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastSampleTime: performance.now(),
      smoothedVelocityX: 0,
      grabOffsetX: clientX - cardRect.left,
      grabOffsetY: clientY - cardRect.top,
      width: cardRect.width,
      height: cardRect.height,
      dayWidth: Math.max(dayRect.width, 1),
      timelineHeight: Math.max(dayRect.height, 1),
      startScrollLeft: scrollElement?.scrollLeft ?? 0,
      scrollElement,
      toneClass: getToneClass(entry),
      toneStyle: getBlockColorStyle(entry),
      title: entry.title,
      active: false,
      canceled: false,
      longPressArmed: false,
      moveArmed: Boolean(entry.occurrence && entry.occurrence.id === radialActions.armedMove?.occurrenceId),
      longPressTimer: null,
      releaseInteractionLock: null,
      target,
      reducedMotion: !allowsSpatialMotion(),
    };
  }

  function activateDrag(session: DragSession, clientX: number, clientY: number) {
    if (dragSessionRef.current !== session || session.canceled || session.active) {
      return;
    }

    clearLongPressTimer(session);
    session.active = true;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;

    if (session.inputKind === 'touch') {
      session.releaseInteractionLock ??= acquireTimelineDragInteractionLock();
      if ('vibrate' in navigator) navigator.vibrate?.(10);
    }

    updateDrag(session, clientX, clientY);
  }

  function nudgeHorizontalScroll(session: DragSession, clientX: number) {
    if (session.inputKind === 'touch') return;

    const scrollElement = session.scrollElement;
    if (!scrollElement || scrollElement.scrollWidth <= scrollElement.clientWidth) {
      return;
    }

    const rect = scrollElement.getBoundingClientRect();
    if (clientX <= rect.left + DRAG_EDGE_SCROLL_PX) {
      scrollElement.scrollLeft = Math.max(
        0,
        scrollElement.scrollLeft - DRAG_EDGE_SCROLL_STEP_PX,
      );
    } else if (clientX >= rect.right - DRAG_EDGE_SCROLL_PX) {
      scrollElement.scrollLeft = Math.min(
        scrollElement.scrollWidth - scrollElement.clientWidth,
        scrollElement.scrollLeft + DRAG_EDGE_SCROLL_STEP_PX,
      );
    }
  }

  function updateDrag(session: DragSession, clientX: number, clientY: number) {
    if (!session.active || dragSessionRef.current !== session) {
      return;
    }

    nudgeHorizontalScroll(session, clientX);
    const scrollDelta =
      (session.scrollElement?.scrollLeft ?? session.startScrollLeft) - session.startScrollLeft;
    const target = resolveWeekPlanDragTarget({
      weekDates,
      originalDate: session.originalDate,
      originalStartTime: session.originalStartTime,
      originalEndTime: session.originalEndTime,
      deltaX: clientX - session.startX + scrollDelta,
      deltaY: clientY - session.startY,
      dayWidth: session.dayWidth,
      timelineHeight: session.timelineHeight,
      allowDateChange: session.allowDateChange,
    });
    const now = performance.now();
    const elapsedMs = Math.max(now - session.lastSampleTime, 8);
    const instantaneousVelocityX = ((clientX - session.lastX) / elapsedMs) * 1000;
    session.smoothedVelocityX =
      session.smoothedVelocityX * 0.72 + instantaneousVelocityX * 0.28;
    session.lastX = clientX;
    session.lastSampleTime = now;
    session.target = target;

    setDragVisual({
      blockId: session.blockId,
      title: session.title,
      toneClass: session.toneClass,
      toneStyle: session.toneStyle,
      target,
      overlayX: clientX - session.grabOffsetX,
      overlayY: clientY - session.grabOffsetY,
      width: session.width,
      height: session.height,
      tilt: session.reducedMotion
        ? 0
        : calculateWeekPlanVelocityTilt(session.smoothedVelocityX),
      dateLocked: !session.allowDateChange,
    });
  }

  function finishDrag(session: DragSession) {
    if (dragSessionRef.current !== session) {
      return;
    }

    const shouldSave =
      session.active &&
      hasWeekPlanMoveChanged(
        session.originalDate,
        session.originalStartTime,
        session.originalEndTime,
        session.target,
      );
    const plan = session.plan;
    const target = session.target;
    const before = {
      date: session.originalDate,
      startTime: session.originalStartTime,
      endTime: session.originalEndTime,
    };
    const storedPlan = planById.get(plan.id) ?? plan;
    clearDragSession();

    if (!shouldSave || !onMovePlan) {
      return;
    }
    if (session.moveArmed) radialActions.closeMove();

    if (supportsScopedRecurringPlanEdits(storedPlan)) {
      void onMovePlan(plan, target).catch(() => undefined);
      return;
    }

    void onMovePlan(plan, target)
      .then(() => {
        moveHistory.record({
          key: plan.id,
          before,
          after: target,
        });
      })
      .catch(() => undefined);
  }

  function applyHistoryTarget(planId: string, target: WeekPlanMoveTarget) {
    const currentPlan = plans.find((plan) => plan.id === planId);
    if (!currentPlan || !onMovePlan) {
      return Promise.reject(new Error('移動対象の予定を確認できませんでした。'));
    }
    return onMovePlan(currentPlan, target);
  }

  function handleUndoMove() {
    void moveHistory
      .undo((entry, target) => applyHistoryTarget(entry.key, target))
      .catch(() => undefined);
  }

  function handleRedoMove() {
    void moveHistory
      .redo((entry, target) => applyHistoryTarget(entry.key, target))
      .catch(() => undefined);
  }

  function handlePlanPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    entry: WeekPreviewBlock,
  ) {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) {
      return;
    }

    clearDragSession();

    const session = createDragSession(
      'pointer',
      entry,
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    if (!session) {
      return;
    }

    dragSessionRef.current = session;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePlanPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'pointer') {
      return;
    }

    if (!session.active) {
      if (
        getDistance(session.startX, session.startY, event.clientX, event.clientY) <
        POINTER_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      activateDrag(session, event.clientX, event.clientY);
    }

    event.preventDefault();
    event.stopPropagation();
    updateDrag(session, event.clientX, event.clientY);
  }

  function handlePlanPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'pointer') {
      return;
    }

    if (session.active) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      finishDrag(session);
      return;
    }

    clearDragSession();
  }

  function handlePlanPointerCancel() {
    const session = dragSessionRef.current;
    if (session?.inputKind === 'pointer') {
      clearDragSession();
    }
  }

  function handlePlanTouchStart(
    event: ReactTouchEvent<HTMLButtonElement>,
    entry: WeekPreviewBlock,
  ) {
    clearDragSession();
    if (event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const session = createDragSession(
      'touch',
      entry,
      event.currentTarget,
      touch.clientX,
      touch.clientY,
    );
    if (!session) {
      return;
    }

    dragSessionRef.current = session;
    if (session.moveArmed) {
      // Already lifted for moving: guard native scroll before the first move.
      session.releaseInteractionLock = acquireTimelineDragInteractionLock();
    }
    session.longPressTimer = window.setTimeout(() => {
      if (dragSessionRef.current !== session || session.canceled) return;
      if (!session.sourceElement.isConnected) {
        clearDragSession();
        return;
      }
      // The first move must reach a native non-passive guard before React.
      session.releaseInteractionLock ??= acquireTimelineDragInteractionLock();
      session.longPressArmed = true;
    }, TOUCH_LONG_PRESS_MS);
  }

  function handlePlanTouchMove(event: ReactTouchEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'touch') {
      return;
    }
    if (event.touches.length !== 1) {
      clearDragSession();
      return;
    }
    if (session.canceled) return;

    const touch = event.touches[0];
    if (!session.active) {
      const movement = getDistance(session.startX, session.startY, touch.clientX, touch.clientY);
      if (movement <= TOUCH_MOVE_TOLERANCE_PX) {
        return;
      }

      if (session.longPressArmed || session.moveArmed) {
        activateDrag(session, touch.clientX, touch.clientY);
      } else {
        session.canceled = true;
        clearLongPressTimer(session);
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    updateDrag(session, touch.clientX, touch.clientY);
  }

  function handlePlanTouchEnd(event: ReactTouchEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'touch') {
      return;
    }

    if (session.active) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      finishDrag(session);
      return;
    }

    if (session.longPressArmed && !session.canceled) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
    }
    clearDragSession();
  }

  function handlePlanTouchCancel() {
    const session = dragSessionRef.current;
    if (session?.inputKind === 'touch') {
      clearDragSession();
    }
  }

  function handlePlanClick(event: ReactMouseEvent<HTMLButtonElement>, plan: Plan) {
    event.preventDefault();
    event.stopPropagation();

    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }

    onOpenPlan?.(plan);
  }

  function resolveScheduleActionTarget(target: EventTarget | null): {
    element: HTMLElement;
    occurrence: ScheduleOccurrence;
  } | null {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>('[data-schedule-occurrence-id]');
    const occurrenceId = element?.dataset.scheduleOccurrenceId;
    const occurrence = occurrenceId ? occurrenceById.get(occurrenceId) : undefined;
    if (!element || !occurrence) {
      return null;
    }
    return { element, occurrence };
  }

  function handleActionPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
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

  function handleActionPointerMoveCapture(event: ReactPointerEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.pointerType === 'touch' || !scheduleAction.ownsInput('pointer', event.pointerId)) return;
    scheduleAction.move(event.clientX, event.clientY);
  }

  function handleActionPointerUpCapture(event: ReactPointerEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (event.pointerType === 'touch' || !scheduleAction.ownsInput('pointer', event.pointerId)) return;
    const target = resolveScheduleActionTarget(event.target);
    if (target) scheduleAction.finish(target.occurrence.id);
    else scheduleAction.cancel();
  }

  function handleActionTouchStartCapture(event: ReactTouchEvent<HTMLElement>) {
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

  function handleActionTouchMoveCapture(event: ReactTouchEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    const touch = event.touches[0];
    if (touch && scheduleAction.ownsInput('touch', touch.identifier)) scheduleAction.move(touch.clientX, touch.clientY);
  }

  function handleActionTouchEndCapture(event: ReactTouchEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    if (!Array.from(event.changedTouches).some(touch => scheduleAction.ownsInput('touch', touch.identifier))) return;
    const target = resolveScheduleActionTarget(event.target);
    if (target) scheduleAction.finish(target.occurrence.id);
    else scheduleAction.cancel();
  }

  function handleActionClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (isScheduleActionMenuTarget(event.target)) return;
    swipeNavigation.onClickCapture(event);
    if (!scheduleAction.shouldSuppressClick()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleDeleteOccurrence(occurrence: ScheduleOccurrence) {
    if (!onDeletePlan || !onDeleteMonthEvent) {
      throw new Error('予定削除の操作境界を確認できませんでした。');
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
    occurrences: scheduleProjection.occurrences, activeOccurrence: scheduleAction.activeAction?.item, onDismissMenu: scheduleAction.dismiss,
    contextKey: recordContext, viewedDate: selectedDate, plans, monthEvents, actuals,
    onEditPlan: onOpenPlan, onDuplicatePlan, canMove: Boolean(onMovePlan),
    canDelete: occurrence => occurrence.source.backingKind !== 'timetable-template' && Boolean(onDeletePlan && onDeleteMonthEvent),
    onDelete: handleDeleteOccurrence, onSaveActual, getActualActionBlockReason, onPrepareTimetableRecord,
    onOpenPreparedRecord: plan => setRecordSelection({ plan, record: true, context: recordContext }),
    onOpenDetail: (occurrence, record) => {
      const plan = resolveScheduleActionPlan(occurrence, plans, monthEvents, selectedDate, scheduleProjection.occurrences);
      if (plan) setRecordSelection({ plan, record, context: recordContext });
      else onOpenDay(occurrence.start.date);
    },
  });
  async function moveFromDialog(plan: Plan, target: WeekPlanMoveTarget) {
    if (!onMovePlan) return;
    await onMovePlan(plan, target);
    if (!supportsScopedRecurringPlanEdits(plan)) moveHistory.record({ key: plan.id,
      before: { date: plan.occurrenceDate ?? plan.date, startTime: plan.startTime, endTime: plan.endTime }, after: target });
  }

  const dragOverlay =
    dragVisual && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={`schedule-week-drag-overlay ${dragVisual.toneClass}`}
            style={{
              ...dragVisual.toneStyle,
              left: dragVisual.overlayX,
              top: dragVisual.overlayY,
              width: dragVisual.width,
              height: dragVisual.height,
              transform: `translate3d(0, 0, 0) rotate(${dragVisual.tilt}deg) scale(1.04)`,
            }}
            aria-hidden="true"
          >
            <strong>{dragVisual.title}</strong>
            <small>
              {dragVisual.target.startTime}-{dragVisual.target.endTime}
            </small>
            {dragVisual.dateLocked ? (
              <span className="schedule-week-drag-lock">曜日固定</span>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <section
        ref={weekSectionRef}
        className="panel schedule-week-view"
        {...swipeNavigation}
        onTouchStart={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchStart(event); }}
        onTouchMove={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchMove(event); }}
        onTouchEnd={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchEnd(); }}
        onTouchCancel={event => { if (!isScheduleActionMenuTarget(event.target)) swipeNavigation.onTouchCancel(); }}
        onPointerDownCapture={handleActionPointerDownCapture}
        onPointerMoveCapture={handleActionPointerMoveCapture}
        onPointerUpCapture={handleActionPointerUpCapture}
        onPointerCancelCapture={event => { if (event.pointerType !== 'touch' && !isScheduleActionMenuTarget(event.target)) scheduleAction.cancelPointer(event.pointerId); }}
        onTouchStartCapture={handleActionTouchStartCapture}
        onTouchMoveCapture={handleActionTouchMoveCapture}
        onTouchEndCapture={handleActionTouchEndCapture}
        onTouchCancelCapture={event => { if (!isScheduleActionMenuTarget(event.target)) scheduleAction.cancel(); }}
        onClickCapture={handleActionClickCapture}
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
        <div className="week-timeline-toolbar print-hide">
          <div className="segmented-control week-timeline-mode-control">
            <button
              className={timelineMode === 'plan' ? 'segment active' : 'segment'}
              onClick={() => setTimelineMode('plan')}
              type="button"
            >
              予定
            </button>
            <button
              className={timelineMode === 'actual' ? 'segment active' : 'segment'}
              onClick={() => setTimelineMode('actual')}
              type="button"
            >
              記録
            </button>
          </div>
        </div>

        <div className="weekly-draft-preview schedule-week-preview">
          <div className="weekly-draft-preview-scroll schedule-week-preview-scroll">
            <div
              ref={weekGridRef}
              className="weekly-draft-preview-grid schedule-week-preview-grid"
              style={previewGridStyle}
            >
              <div className="weekly-draft-preview-header" style={gridStyle}>
                <div className="weekly-draft-preview-corner">時間</div>
                {weekDates.map((date) => (
                  <button
                    aria-label={formatWeekDate(date, 'full')}
                    className="weekly-draft-preview-date"
                    key={date}
                    onClick={() => onOpenDay(date)}
                    type="button"
                  >
                    <strong>{formatWeekDate(date, 'compact')}</strong>
                  </button>
                ))}
              </div>

              {showSpanningLane ? (
                <WeekSpanningEventsLane
                  layout={spanningLayout}
                  plans={plans}
                  onOpenPlan={onOpenPlan}
                />
              ) : null}

              <div className="weekly-draft-preview-body schedule-week-preview-body" style={gridStyle}>
                <div className="weekly-draft-preview-time-axis" style={timelineStyle} aria-hidden="true">
                  {WEEK_HOURS.map((hour) => (
                    <span
                      className={[
                        'weekly-draft-preview-time-label',
                        hour === 0 ? 'weekly-draft-preview-time-label--start' : '',
                        hour === 24 ? 'weekly-draft-preview-time-label--end' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={hour}
                      style={buildMarkerStyle(hour)}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>

                {weekDates.map((date) => {
                  const dayPlans = sortByDateTime(expandPlansForDate(plans, date));
                  const timedDayPlans = dayPlans.filter((plan) => {
                    const occurrence = occurrenceByPlanDate.get(`${plan.id}:${date}`);
                    return !occurrence || !isScheduleOccurrenceOutsideHourlyGrid(occurrence);
                  });
                  const dayNonPlanOccurrences = scheduleProjection.occurrences
                    .filter((occurrence) => occurrence.source.backingKind !== 'plan')
                    .filter((occurrence) => scheduleOccurrenceCoversDate(occurrence, date));
                  const timedDayNonPlanOccurrences = dayNonPlanOccurrences.filter(
                    (occurrence) => !isScheduleOccurrenceOutsideHourlyGrid(occurrence),
                  );
                  const dayActuals = actuals.flatMap((actual) => {
                    const range = entryTimeRangeForDate(actual.occurrenceDate, actual.actualStartTime, actual.actualEndTime, date);
                    if (!range) return [];
                    const source = actual.planId ? planById.get(actual.planId) : undefined;
                    return [{ actual, plan: source ? resolvePlanOccurrence(source, actual.occurrenceDate) : undefined, range }];
                  });
                  const dayDraftBlocks = weeklyDraftBlocks.filter(
                    (block) => block.date === date && block.status === 'draft',
                  );

                  const planBlocks = buildLanes<WeekPreviewBaseBlock>([
                    ...timedDayPlans.map((plan) => ({
                      id: buildPlanOccurrenceKey(plan.id, plan.date),
                      title: plan.title,
                      subject: plan.subject,
                      type: plan.type,
                      sourceType: plan.sourceType,
                      startTime: plan.startTime,
                      endTime: plan.endTime,
                      plan,
                      occurrence: occurrenceByPlanDate.get(`${plan.id}:${date}`),
                    })),
                    ...timedDayNonPlanOccurrences.map((occurrence) => ({
                      id: occurrence.id,
                      title: occurrence.title,
                      subject: occurrence.subject,
                      type:
                        occurrence.source.backingKind === 'timetable-template'
                          ? ('school-event' as const)
                          : ('other' as const),
                      sourceType:
                        occurrence.source.kind === 'timetable'
                          ? ('timetable' as const)
                          : ('manual' as const),
                      occurrence,
                      ...scheduleOccurrenceTimesForDate(occurrence, date),
                    })),
                    ...dayDraftBlocks.map((block) => ({
                      id: block.id,
                      title: block.title,
                      subject: block.subject || block.label,
                      type: block.type,
                      startTime: block.startTime,
                      endTime: block.endTime,
                      draft: true,
                    })),
                  ]);
                  const actualBlocks = buildLanes<WeekPreviewBaseBlock>(
                    dayActuals.map(({ actual, plan, range }) => ({
                      id: actual.id,
                      title: resolveActualTitle(actual, plan),
                      subject: resolveActualSubject(actual, plan),
                      type: plan?.type ?? 'other',
                      sourceType: plan?.sourceType,
                      ...range,
                    })),
                  );
                  const visibleBlocks = timelineMode === 'plan' ? planBlocks : actualBlocks;
                  const targetGhost =
                    dragVisual && dragVisual.target.date === date ? dragVisual : null;

                  return (
                    <div
                      className="weekly-draft-preview-day-column schedule-week-day-column"
                      key={date}
                      onDoubleClick={() => onOpenDay(date)}
                      style={timelineStyle}
                      role="group"
                      aria-label={`${formatWeekDate(date, 'full')}の${timelineMode === 'plan' ? '予定' : '記録'}`}
                    >
                      {WEEK_HOURS.map((hour) => (
                        <span
                          className="weekly-draft-preview-hour-line"
                          key={`${date}-${hour}`}
                          style={buildMarkerStyle(hour)}
                        />
                      ))}

                      {targetGhost ? (
                        <span
                          className={`schedule-week-drop-ghost ${targetGhost.toneClass}`}
                          style={{ ...buildDropGhostStyle(targetGhost.target), ...targetGhost.toneStyle }}
                          aria-hidden="true"
                        >
                          <strong>{targetGhost.title}</strong>
                          <small>
                            {targetGhost.target.startTime}-{targetGhost.target.endTime}
                          </small>
                        </span>
                      ) : null}

                      {visibleBlocks.map((entry) => {
                        const blockClassName = [
                          'weekly-draft-preview-block',
                          'weekly-draft-preview-block--overview',
                          'schedule-week-block',
                          getToneClass(entry),
                          getDurationClass(entry),
                          entry.draft ? 'schedule-week-block-draft' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        const isSavedPlan = Boolean(entry.plan && !entry.draft);

                        if (isSavedPlan && entry.plan) {
                          return (
                            <button
                              className={`${blockClassName} schedule-week-plan-button${
                                dragVisual?.blockId === entry.id ? ' is-drag-source' : ''
                              }${
                                entry.occurrence && entry.occurrence.id === radialActions.armedMove?.occurrenceId ? ' is-move-armed' : ''
                              }`}
                              key={entry.id}
                              data-motion-key={`${date}:${entry.id}`}
                              data-motion-signature={`${entry.startTime}-${entry.endTime} ${entry.title}`}
                              data-schedule-occurrence-id={entry.occurrence?.id}
                              style={buildBlockStyle(entry)}
                              title={`${entry.title} / ${entry.startTime}-${entry.endTime}`}
                              type="button"
                              aria-label={`${entry.title} ${entry.startTime}から${entry.endTime}。タップで編集、長押しで操作、長押しして動かすと移動`}
                              onClick={(event) => handlePlanClick(event, entry.plan!)}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => handlePlanPointerDown(event, entry)}
                              onPointerMove={handlePlanPointerMove}
                              onPointerUp={handlePlanPointerUp}
                              onPointerCancel={handlePlanPointerCancel}
                              onTouchStart={(event) => handlePlanTouchStart(event, entry)}
                              onTouchMove={handlePlanTouchMove}
                              onTouchEnd={handlePlanTouchEnd}
                              onTouchCancel={handlePlanTouchCancel}
                              onContextMenu={(event) => event.preventDefault()}
                            >
                              <strong>{entry.title}</strong>
                              <small>{entry.startTime}-{entry.endTime}</small>
                            </button>
                          );
                        }

                        return (
                          <span
                            className={blockClassName}
                            key={entry.id}
                            data-motion-key={`${date}:${entry.draft ? 'draft' : 'entry'}:${entry.id}`}
                            data-motion-signature={`${entry.startTime}-${entry.endTime} ${entry.title}`}
                            data-schedule-occurrence-id={entry.occurrence?.id}
                            tabIndex={entry.occurrence ? 0 : undefined}
                            style={buildBlockStyle(entry)}
                            title={`${entry.title} / ${entry.startTime}-${entry.endTime}${entry.draft ? ' / 仮予定' : ''}`}
                            aria-label={
                              entry.occurrence?.source.backingKind === 'timetable-template'
                                ? `${entry.title} ${entry.startTime}から${entry.endTime}。時間割`
                                : undefined
                            }
                            onContextMenu={
                              entry.occurrence
                                ? (event) => event.preventDefault()
                                : undefined
                            }
                          >
                            <strong>{entry.title}</strong>
                            <small>{entry.startTime}-{entry.endTime}</small>
                            {entry.draft && onRemoveWeeklyDraftBlock ? (
                              <span
                                className="schedule-week-draft-remove"
                                role="button"
                                tabIndex={0}
                                aria-label={`${entry.title}を削除`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onRemoveWeeklyDraftBlock(entry.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onRemoveWeeklyDraftBlock(entry.id);
                                }}
                              >
                                ×
                              </span>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
      {dragOverlay}
      {radialActions.movingPlan ? <ScheduleMoveDialog key={`${userId}:${selectedDate}:${radialActions.movingPlan.id}`} plan={radialActions.movingPlan} onMove={moveFromDialog} onClose={radialActions.closeMove} /> : null}
      {radialActions.armedMove ? <ScheduleMoveModeBanner title={radialActions.armedMove.title}
        onOpenDialog={radialActions.openMoveDialog} onCancel={radialActions.closeMove} /> : null}
      {detailSelection && onSaveActual && onSaveStandaloneActual && onLinkStandaloneActualToPlan && onDeleteActual ? <DayDetailModal
        key={`${recordContext}:${detailSelection.plan.id}:${detailSelection.record}`}
        detailPlan={detailSelection.plan} openRecordInitially={detailSelection.record}
        monthEvent={monthEvents.find(event => event.id === detailSelection.plan.id) ?? null}
        detailActual={actuals.find(actual => actual.userId === detailSelection.plan.userId && actual.planId === detailSelection.plan.id && actual.occurrenceDate === (detailSelection.plan.occurrenceDate ?? detailSelection.plan.date))}
        standaloneActual={null} plans={plans} actuals={actuals}
        onEditPlan={plan => { setRecordSelection(null); onOpenPlan?.(plan); }}
        onDeletePlan={async plan => { await onDeletePlan?.(plan); }}
        onSaveActual={onSaveActual} getActualActionBlockReason={getActualActionBlockReason}
        onSaveStandaloneActual={onSaveStandaloneActual} onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
        onDeleteActual={onDeleteActual} onClose={() => setRecordSelection(null)} /> : null}
      <ScheduleItemRadialMenu
        action={scheduleAction.activeAction}
        actions={radialActions.actionsFor(scheduleAction.activeAction?.item)}
        onSelect={radialActions.select}
        onDismiss={scheduleAction.dismiss}
      />
      <DragUndoRedoControls
        visible={moveHistory.hasHistory}
        canUndo={moveHistory.canUndo}
        canRedo={moveHistory.canRedo}
        isBusy={moveHistory.isBusy}
        onUndo={handleUndoMove}
        onRedo={handleRedoMove}
      />
    </>
  );
}
