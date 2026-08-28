import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import {
  getWeekDates,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import {
  calculateWeekPlanVelocityTilt,
  hasWeekPlanMoveChanged,
  resolveWeekPlanDragTarget,
  type WeekPlanMoveTarget,
} from '../lib/weekPlanDrag';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import type { Actual, Plan, PlanSourceType } from '../types/domain';
import '../styles/week-plan-drag.css';

type WeekTimelineMode = 'plan' | 'actual';
type DragInputKind = 'pointer' | 'touch';

interface WeekViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onOpenPlan?: (plan: Plan) => void;
  onMovePlan?: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
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
}

interface WeekPreviewBlock extends WeekPreviewBaseBlock {
  lane: number;
  laneCount: number;
}

interface DragSession {
  inputKind: DragInputKind;
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
  title: string;
  active: boolean;
  canceled: boolean;
  longPressTimer: number | null;
  target: WeekPlanMoveTarget;
  reducedMotion: boolean;
}

interface DragVisualState {
  blockId: string;
  title: string;
  toneClass: string;
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
const TOUCH_LONG_PRESS_MS = 240;
const TOUCH_MOVE_TOLERANCE_PX = 9;
const POINTER_DRAG_THRESHOLD_PX = 4;
const DRAG_EDGE_SCROLL_PX = 30;
const DRAG_EDGE_SCROLL_STEP_PX = 14;
const CLICK_SUPPRESSION_MS = 700;

function formatWeekDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  const weekday = WEEKDAY_LABELS[date.getDay()] ?? '';
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
}

function resolveActualTitle(actual: Actual, plan?: Plan): string {
  return actual.title?.trim() || plan?.title || '記録';
}

function resolveActualSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject || '記録';
}

function buildLanes<T extends WeekPreviewBaseBlock>(items: T[]): Array<T & WeekPreviewBlock> {
  const sorted = [...items].sort((left, right) => {
    const startDelta = minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    if (startDelta !== 0) return startDelta;
    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });
  const active: Array<{ lane: number; endMinutes: number }> = [];
  const laneById = new Map<string, number>();
  let laneCount = 0;

  sorted.forEach((item) => {
    const startMinutes = minutesFromTime(item.startTime);
    const endMinutes = Math.max(
      startMinutes + minutesBetween(item.startTime, item.endTime),
      startMinutes + 1,
    );

    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].endMinutes <= startMinutes) active.splice(index, 1);
    }

    const used = new Set(active.map((entry) => entry.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;

    laneById.set(item.id, lane);
    laneCount = Math.max(laneCount, lane + 1);
    active.push({ lane, endMinutes });
  });

  return sorted.map((item) => ({
    ...item,
    lane: laneById.get(item.id) ?? 0,
    laneCount: Math.max(laneCount, 1),
  }));
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

function getToneClass(entry: WeekPreviewBaseBlock): string {
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

export function WeekView({
  selectedDate,
  plans,
  actuals,
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  onOpenPlan,
  onMovePlan,
  onOpenDay,
}: WeekViewProps) {
  const [timelineMode, setTimelineMode] = useState<WeekTimelineMode>('plan');
  const [dragVisual, setDragVisual] = useState<DragVisualState | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressClickUntilRef = useRef(0);
  const weekDates = getWeekDates(selectedDate);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const gridStyle = {
    gridTemplateColumns: '46px repeat(7, minmax(0, 1fr))',
  } as CSSProperties;
  const timelineStyle = { height: '100%' } as CSSProperties;

  function clearLongPressTimer(session: DragSession | null) {
    if (session?.longPressTimer !== null && session?.longPressTimer !== undefined) {
      window.clearTimeout(session.longPressTimer);
      session.longPressTimer = null;
    }
  }

  function clearDragSession() {
    clearLongPressTimer(dragSessionRef.current);
    dragSessionRef.current = null;
    setDragVisual(null);
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer(dragSessionRef.current);
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
      title: entry.title,
      active: false,
      canceled: false,
      longPressTimer: null,
      target,
      reducedMotion:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  function activateDrag(session: DragSession, clientX: number, clientY: number) {
    if (dragSessionRef.current !== session || session.canceled || session.active) {
      return;
    }

    clearLongPressTimer(session);
    session.active = true;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;

    if (session.inputKind === 'touch' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }

    updateDrag(session, clientX, clientY);
  }

  function nudgeHorizontalScroll(session: DragSession, clientX: number) {
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
    clearDragSession();

    if (shouldSave && onMovePlan) {
      void onMovePlan(plan, target).catch(() => undefined);
    }
  }

  function handlePlanPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    entry: WeekPreviewBlock,
  ) {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) {
      return;
    }

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
    session.longPressTimer = window.setTimeout(() => {
      activateDrag(session, session.startX, session.startY);
    }, TOUCH_LONG_PRESS_MS);
  }

  function handlePlanTouchMove(event: ReactTouchEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'touch' || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    if (!session.active) {
      if (
        getDistance(session.startX, session.startY, touch.clientX, touch.clientY) >
        TOUCH_MOVE_TOLERANCE_PX
      ) {
        session.canceled = true;
        clearLongPressTimer(session);
      }
      return;
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

    clearDragSession();
  }

  function handlePlanTouchCancel() {
    const session = dragSessionRef.current;
    if (session?.inputKind === 'touch') {
      clearDragSession();
    }
  }

  function handlePlanClick(event: React.MouseEvent<HTMLButtonElement>, plan: Plan) {
    event.preventDefault();
    event.stopPropagation();

    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }

    onOpenPlan?.(plan);
  }

  const dragOverlay =
    dragVisual && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={`schedule-week-drag-overlay ${dragVisual.toneClass}`}
            style={{
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
      <section className="panel schedule-week-view">
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
            <div className="weekly-draft-preview-grid schedule-week-preview-grid">
              <div className="weekly-draft-preview-header" style={gridStyle}>
                <div className="weekly-draft-preview-corner">時間</div>
                {weekDates.map((date) => (
                  <button
                    className="weekly-draft-preview-date"
                    key={date}
                    onClick={() => onOpenDay(date)}
                    type="button"
                  >
                    <strong>{formatWeekDate(date)}</strong>
                  </button>
                ))}
              </div>

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
                  const dayPlanKeys = new Set(
                    dayPlans.map((plan) => buildPlanOccurrenceKey(plan.id, plan.date)),
                  );
                  const linkedActuals = dayPlans.flatMap((plan) => {
                    const actual = actualByOccurrenceKey.get(
                      buildPlanOccurrenceKey(plan.id, plan.date),
                    );
                    return actual ? [{ actual, plan }] : [];
                  });
                  const standaloneActuals = actuals
                    .filter(
                      (actual) =>
                        actual.occurrenceDate === date &&
                        !dayPlanKeys.has(getActualOccurrenceKey(actual)),
                    )
                    .map((actual) => ({
                      actual,
                      plan: actual.planId ? planById.get(actual.planId) : undefined,
                    }));
                  const dayActuals = [...linkedActuals, ...standaloneActuals].sort(
                    (left, right) =>
                      minutesFromTime(left.actual.actualStartTime) -
                      minutesFromTime(right.actual.actualStartTime),
                  );
                  const dayDraftBlocks = weeklyDraftBlocks.filter(
                    (block) => block.date === date && block.status === 'draft',
                  );

                  const planBlocks = buildLanes<WeekPreviewBaseBlock>([
                    ...dayPlans.map((plan) => ({
                      id: buildPlanOccurrenceKey(plan.id, plan.date),
                      title: plan.title,
                      subject: plan.subject,
                      type: plan.type,
                      sourceType: plan.sourceType,
                      startTime: plan.startTime,
                      endTime: plan.endTime,
                      plan,
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
                    dayActuals.map(({ actual, plan }) => ({
                      id: actual.id,
                      title: resolveActualTitle(actual, plan),
                      subject: resolveActualSubject(actual, plan),
                      type: plan?.type ?? 'other',
                      sourceType: plan?.sourceType,
                      startTime: actual.actualStartTime,
                      endTime: actual.actualEndTime,
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
                      aria-label={`${formatWeekDate(date)}の${timelineMode === 'plan' ? '予定' : '記録'}`}
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
                          style={buildDropGhostStyle(targetGhost.target)}
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
                              }`}
                              key={entry.id}
                              style={buildBlockStyle(entry)}
                              title={`${entry.title} / ${entry.startTime}-${entry.endTime}`}
                              type="button"
                              aria-label={`${entry.title} ${entry.startTime}から${entry.endTime}。タップで編集、長押しで移動`}
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
                            style={buildBlockStyle(entry)}
                            title={`${entry.title} / ${entry.startTime}-${entry.endTime}${entry.draft ? ' / 仮予定' : ''}`}
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
    </>
  );
}
