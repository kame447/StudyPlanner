import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type TransitionEvent,
} from 'react';
import {
  addMonths,
  formatCompactMinutes,
  formatMonthLabel,
  getCalendarDayTone,
  getJapaneseHolidayName,
  getMonthWeeks,
  getWeekdayLabels,
  minutesBetween,
  startOfWeek,
  todayIsoDate,
} from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRange,
  sortMonthEvents,
} from '../lib/monthEvents';
import {
  expandPlansForDateRange,
} from '../lib/planRecurrence';
import {
  isStudyRecordForDisplay,
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
} from '../lib/studyRecords';
import { MonthPickerDialog } from './MonthPickerDialog';
import { MonthEventDialog } from './MonthEventDialog';
import type { Actual, MonthEvent, MonthEventDraft, Plan } from '../types/domain';

interface MonthViewProps {
  monthDate: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  onSelectDate: (date: string) => void;
  onChangeMonth: (date: string) => void;
  onOpenWeek: (date: string) => void;
  onSaveMonthEvent: (draft: MonthEventDraft, targetMonthEventId?: string) => Promise<void>;
  onDeleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
}

const MONTH_PAGER_DRAG_LIMIT_RATIO = 0.92;
const MONTH_PAGER_DRAG_THRESHOLD_RATIO = 0.22;
const MONTH_PAGER_MAX_DRAG_THRESHOLD = 96;
const MONTH_PAGER_MIN_CLICK_SUPPRESS_DELTA = 8;
const MONTH_PAGER_DIRECTION_RATIO = 1.15;
const MONTH_PAGER_CENTER_INDEX = 2;
const MONTH_PAGER_EXTENSION_COUNT = 2;
const MONTH_PAGER_EDGE_BUFFER = 1;

function createPagerMonths(centerMonthDate: string): string[] {
  return Array.from({ length: 5 }, (_, index) =>
    addMonths(centerMonthDate, index - MONTH_PAGER_CENTER_INDEX),
  );
}

function createMonthsBefore(firstMonthDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addMonths(firstMonthDate, index - count),
  );
}

function createMonthsAfter(lastMonthDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addMonths(lastMonthDate, index + 1),
  );
}

function getCalendarDayNumber(dateString: string): string {
  return Number.parseInt(dateString.slice(-2), 10).toString();
}

function getHolidayLabelLengthClass(holidayName: string): string {
  const holidayLength = [...holidayName].length;

  if (holidayLength >= 7) {
    return 'is-ultra-long';
  }

  if (holidayLength >= 6) {
    return 'is-very-long';
  }

  if (holidayLength >= 5) {
    return 'is-long';
  }

  if (holidayLength >= 4) {
    return 'is-medium';
  }

  return '';
}

export function MonthView({
  monthDate,
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents,
  onSelectDate,
  onChangeMonth,
  onOpenWeek,
  onSaveMonthEvent,
  onDeleteMonthEvent,
}: MonthViewProps) {
  const [eventModalDate, setEventModalDate] = useState<string | null>(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [visibleMonths, setVisibleMonths] = useState(() =>
    createPagerMonths(monthDate),
  );
  const [activeMonthIndex, setActiveMonthIndex] = useState(
    MONTH_PAGER_CENTER_INDEX,
  );
  const [pagerOffset, setPagerOffset] = useState(0);
  const [pagerTransitionEnabled, setPagerTransitionEnabled] = useState(true);
  const [pendingPagerDirection, setPendingPagerDirection] = useState<-1 | 1 | null>(
    null,
  );
  const pagerViewportRef = useRef<HTMLDivElement | null>(null);
  const pagerPointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    didDrag: boolean;
  } | null>(null);
  const pagerStepRef = useRef(0);
  const suppressNextCellClick = useRef(false);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusSelectedCell = useRef(false);
  const pendingCellClickTimeout = useRef<number | null>(null);
  const lastCellClick = useRef<{ date: string; at: number } | null>(null);
  const activeMonthDate = visibleMonths[activeMonthIndex] ?? monthDate;
  const todayDate = todayIsoDate();
  const weeks = getMonthWeeks(activeMonthDate);
  const grid = useMemo(
    () =>
      weeks.flatMap((week) =>
        week.dates.map((date) => ({
          date,
          inCurrentMonth: date.startsWith(activeMonthDate.slice(0, 7)),
        })),
      ),
    [activeMonthDate, weeks],
  );
  const selectedWeek = startOfWeek(selectedDate);
  const gridIndexByDate = useMemo(
    () => new Map(grid.map((cell, index) => [cell.date, index])),
    [grid],
  );

  const registerCellRef = useCallback((date: string, node: HTMLButtonElement | null) => {
    if (node) {
      cellRefs.current.set(date, node);
      return;
    }

    cellRefs.current.delete(date);
  }, []);

  useEffect(() => {
    if (!shouldFocusSelectedCell.current) {
      return;
    }

    cellRefs.current.get(selectedDate)?.focus({ preventScroll: true });
    shouldFocusSelectedCell.current = false;
  }, [selectedDate, activeMonthDate]);

  const measurePagerStep = useCallback(() => {
    const viewport = pagerViewportRef.current;

    if (!viewport) {
      return pagerStepRef.current;
    }

    const nextStep = viewport.clientWidth;

    pagerStepRef.current = nextStep;
    return nextStep;
  }, []);

  useEffect(() => {
    measurePagerStep();

    const viewport = pagerViewportRef.current;

    if (!viewport || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measurePagerStep();
    });

    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [measurePagerStep]);

  useEffect(() => {
    const currentVisibleMonth = visibleMonths[activeMonthIndex];

    if (currentVisibleMonth === monthDate) {
      return;
    }

    setPagerTransitionEnabled(false);
    setPagerOffset(0);
    setPendingPagerDirection(null);
    pagerPointerRef.current = null;
    setVisibleMonths(createPagerMonths(monthDate));
    setActiveMonthIndex(MONTH_PAGER_CENTER_INDEX);

    window.requestAnimationFrame(() => {
      setPagerTransitionEnabled(true);
    });
  }, [monthDate]);

  function animateMonthChange(direction: -1 | 1) {
    if (pendingPagerDirection !== null || eventModalDate || isMonthPickerOpen) {
      return;
    }

    measurePagerStep();

    setPagerTransitionEnabled(true);
    setPendingPagerDirection(direction);
    setPagerOffset(0);
    setActiveMonthIndex((currentIndex) => currentIndex + direction);
  }

  function handlePagerTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return;
    }

    if (pendingPagerDirection === null) {
      return;
    }

    const settledMonthDate = visibleMonths[activeMonthIndex] ?? activeMonthDate;
    const settledIndex = activeMonthIndex;

    setPagerOffset(0);
    setPendingPagerDirection(null);
    onChangeMonth(settledMonthDate);

    if (settledIndex <= MONTH_PAGER_EDGE_BUFFER) {
      const firstMonthDate = visibleMonths[0] ?? settledMonthDate;
      const prependedMonths = createMonthsBefore(
        firstMonthDate,
        MONTH_PAGER_EXTENSION_COUNT,
      );

      setPagerTransitionEnabled(false);
      setVisibleMonths((currentMonths) => [...prependedMonths, ...currentMonths]);
      setActiveMonthIndex(settledIndex + MONTH_PAGER_EXTENSION_COUNT);

      window.requestAnimationFrame(() => {
        setPagerTransitionEnabled(true);
      });
      return;
    }

    if (settledIndex >= visibleMonths.length - 1 - MONTH_PAGER_EDGE_BUFFER) {
      const lastMonthDate =
        visibleMonths[visibleMonths.length - 1] ?? settledMonthDate;
      const appendedMonths = createMonthsAfter(
        lastMonthDate,
        MONTH_PAGER_EXTENSION_COUNT,
      );

      setVisibleMonths((currentMonths) => [...currentMonths, ...appendedMonths]);
    }

    setPagerTransitionEnabled(true);
  }

  function handlePagerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pendingPagerDirection !== null || eventModalDate || isMonthPickerOpen) {
      return;
    }

    measurePagerStep();
    pagerPointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
    };
    setPagerTransitionEnabled(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePagerPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pointer = pagerPointerRef.current;

    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const step = pagerStepRef.current || measurePagerStep();
    const clampedOffset = Math.max(
      -step * MONTH_PAGER_DRAG_LIMIT_RATIO,
      Math.min(step * MONTH_PAGER_DRAG_LIMIT_RATIO, deltaX),
    );

    if (Math.abs(deltaX) > MONTH_PAGER_MIN_CLICK_SUPPRESS_DELTA) {
      pointer.didDrag = true;
      suppressNextCellClick.current = true;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) * MONTH_PAGER_DIRECTION_RATIO) {
      event.preventDefault();
    }

    setPagerOffset(clampedOffset);
  }

  function finishPagerDrag(event: PointerEvent<HTMLDivElement>) {
    const pointer = pagerPointerRef.current;

    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const step = pagerStepRef.current || measurePagerStep();
    const threshold = Math.min(
      MONTH_PAGER_MAX_DRAG_THRESHOLD,
      step * MONTH_PAGER_DRAG_THRESHOLD_RATIO,
    );
    const isHorizontalSwipe =
      Math.abs(deltaX) > Math.abs(deltaY) * MONTH_PAGER_DIRECTION_RATIO;

    pagerPointerRef.current = null;
    setPagerTransitionEnabled(true);

    if (pointer.didDrag) {
      window.setTimeout(() => {
        suppressNextCellClick.current = false;
      }, 0);
    }

    if (Math.abs(deltaX) >= threshold && isHorizontalSwipe) {
      const direction = deltaX < 0 ? 1 : -1;

      setPendingPagerDirection(direction);
      setPagerOffset(0);
      setActiveMonthIndex((currentIndex) => currentIndex + direction);
      return;
    }

    setPagerOffset(0);
  }

  const moveSelectionByKeyboard = useCallback((currentDate: string, offset: number) => {
    const currentIndex = gridIndexByDate.get(currentDate);

    if (currentIndex === undefined) {
      return;
    }

    const nextIndex = currentIndex + offset;

    if (nextIndex < 0 || nextIndex >= grid.length) {
      return;
    }

    const nextDate = grid[nextIndex]?.date;

    if (!nextDate) {
      return;
    }

    shouldFocusSelectedCell.current = true;
    onSelectDate(nextDate);
  }, [grid, gridIndexByDate, onSelectDate]);

  function openMonthEventEditor(date: string) {
    onSelectDate(date);
    setEventModalDate(date);
  }

  function handleCellClick(date: string) {
    if (suppressNextCellClick.current) {
      suppressNextCellClick.current = false;
      return;
    }

    const clickTimestamp = window.performance.now();

    if (
      lastCellClick.current &&
      lastCellClick.current.date === date &&
      clickTimestamp - lastCellClick.current.at <= 320
    ) {
      if (pendingCellClickTimeout.current !== null) {
        window.clearTimeout(pendingCellClickTimeout.current);
        pendingCellClickTimeout.current = null;
      }

      lastCellClick.current = null;
      openMonthEventEditor(date);
      return;
    }

    lastCellClick.current = { date, at: clickTimestamp };

    if (pendingCellClickTimeout.current !== null) {
      window.clearTimeout(pendingCellClickTimeout.current);
      pendingCellClickTimeout.current = null;
    }

    pendingCellClickTimeout.current = window.setTimeout(() => {
      onSelectDate(date);
      pendingCellClickTimeout.current = null;
      lastCellClick.current = null;
    }, 240);
  }

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (eventModalDate || isMonthPickerOpen) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        const isTypingField =
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target.isContentEditable;

        if (isTypingField) {
          return;
        }
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          moveSelectionByKeyboard(selectedDate, -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveSelectionByKeyboard(selectedDate, 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveSelectionByKeyboard(selectedDate, -7);
          break;
        case 'ArrowDown':
          event.preventDefault();
          moveSelectionByKeyboard(selectedDate, 7);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [eventModalDate, isMonthPickerOpen, moveSelectionByKeyboard, selectedDate]);

  useEffect(() => {
    return () => {
      if (pendingCellClickTimeout.current !== null) {
        window.clearTimeout(pendingCellClickTimeout.current);
      }

      lastCellClick.current = null;
    };
  }, []);

  function renderMonthPanel(panelMonthDate: string, panelIndex: number) {
    const isCurrentPanel = panelIndex === activeMonthIndex;
    const panelWeeks = getMonthWeeks(panelMonthDate);
    const panelGrid = panelWeeks.flatMap((week) =>
      week.dates.map((date) => ({
        date,
        inCurrentMonth: date.startsWith(panelMonthDate.slice(0, 7)),
      })),
    );
    const panelPlanOccurrences =
      panelGrid.length > 0
        ? expandPlansForDateRange(
            plans,
            panelGrid[0].date,
            panelGrid[panelGrid.length - 1].date,
          )
        : [];
    const panelStudyPlanMinutesByDate = new Map<string, number>();

    panelPlanOccurrences.forEach((plan) => {
      if (plan.type !== 'study') {
        return;
      }

      panelStudyPlanMinutesByDate.set(
        plan.date,
        (panelStudyPlanMinutesByDate.get(plan.date) ?? 0) +
          minutesBetween(plan.startTime, plan.endTime),
      );
    });

    const panelActualStudyMinutesByDate = new Map<string, number>();
    const panelActualRecords =
      panelGrid.length > 0
        ? normalizeStudyRecordsForDisplay({
            actuals,
            plans,
            startDate: panelGrid[0].date,
            endDate: panelGrid[panelGrid.length - 1].date,
          }).filter(isStudyRecordForDisplay)
        : [];

    panelGrid.forEach((cell) => {
      const dayRecords = panelActualRecords.filter(
        (record) => record.date === cell.date,
      );

      panelActualStudyMinutesByDate.set(
        cell.date,
        sumStudyRecordMinutes(dayRecords),
      );
    });

    return (
      <article
        className={isCurrentPanel ? 'month-pager-panel is-current' : 'month-pager-panel'}
        key={panelMonthDate}
        aria-hidden={!isCurrentPanel}
      >
        <div className="month-grid">
          {getWeekdayLabels().map((label, index) => (
            <div
              key={label}
              className={[
                'month-weekday',
                index === 5 ? 'is-saturday' : '',
                index === 6 ? 'is-holiday' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {label}
            </div>
          ))}

          {panelGrid.map((cell) => {
            const dayTone = getCalendarDayTone(cell.date);
            const holidayName = getJapaneseHolidayName(cell.date);
            const targetMinutes = panelStudyPlanMinutesByDate.get(cell.date) ?? 0;
            const actualMinutes = panelActualStudyMinutesByDate.get(cell.date) ?? 0;
            const visibleMonthEvents = sortMonthEvents(
              monthEvents.filter((monthEvent) =>
                doesMonthEventOccurOnDate(monthEvent, cell.date),
              ),
            );
            const limitedMonthEvents = visibleMonthEvents.slice(0, 3);
            const cellClassName = [
              'month-cell',
              cell.inCurrentMonth ? '' : 'is-muted',
              isCurrentPanel && cell.date === selectedDate ? 'is-selected' : '',
              cell.date === todayDate ? 'is-today' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={cell.date}
                className={cellClassName}
                ref={
                  isCurrentPanel
                    ? (node) => registerCellRef(cell.date, node)
                    : undefined
                }
                onClick={
                  isCurrentPanel
                    ? () => {
                        handleCellClick(cell.date);
                      }
                    : undefined
                }
                onKeyDown={
                  isCurrentPanel
                    ? (event) => {
                        switch (event.key) {
                          case 'Enter':
                            event.preventDefault();
                            openMonthEventEditor(cell.date);
                            break;
                          case 'ArrowLeft':
                            event.preventDefault();
                            moveSelectionByKeyboard(cell.date, -1);
                            break;
                          case 'ArrowRight':
                            event.preventDefault();
                            moveSelectionByKeyboard(cell.date, 1);
                            break;
                          case 'ArrowUp':
                            event.preventDefault();
                            moveSelectionByKeyboard(cell.date, -7);
                            break;
                          case 'ArrowDown':
                            event.preventDefault();
                            moveSelectionByKeyboard(cell.date, 7);
                            break;
                          default:
                            break;
                        }
                      }
                    : undefined
                }
                tabIndex={isCurrentPanel && cell.date === selectedDate ? 0 : -1}
                aria-selected={isCurrentPanel && cell.date === selectedDate}
                type="button"
              >
                <div className="month-cell-head">
                  <strong
                    className={[
                      'month-date-number',
                      dayTone === 'saturday' ? 'is-saturday' : '',
                      dayTone === 'holiday' ? 'is-holiday' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {getCalendarDayNumber(cell.date)}
                  </strong>
                  {holidayName ? (
                    <span
                      className={[
                        'month-holiday-label',
                        getHolidayLabelLengthClass(holidayName),
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={holidayName}
                    >
                      {holidayName}
                    </span>
                  ) : null}
                </div>

                <p className="month-study-summary">
                  <span>目標 {formatCompactMinutes(targetMinutes)}</span>
                  <span>記録 {formatCompactMinutes(actualMinutes)}</span>
                </p>

                <div className="month-major-event-list">
                  {limitedMonthEvents.map((monthEvent) => (
                    <span
                      key={monthEvent.id}
                      className="event-pill month-major-event-pill"
                      title={`${formatMonthEventTimeRange(monthEvent)} ${monthEvent.title}`}
                    >
                      <span className="month-major-event-full">
                        {formatMonthEventTimeRange(monthEvent)} {monthEvent.title}
                      </span>
                      <span className="month-major-event-short">
                        {monthEvent.title}
                      </span>
                    </span>
                  ))}

                  {visibleMonthEvents.length > limitedMonthEvents.length ? (
                    <span className="month-event-more">
                      +{visibleMonthEvents.length - limitedMonthEvents.length}件
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </article>
    );
  }

  const pagerOffsetTerm =
    pagerOffset >= 0 ? `+ ${pagerOffset}px` : `- ${Math.abs(pagerOffset)}px`;
  const pagerBaseOffset = `-${activeMonthIndex * 100}%`;
  const pagerTransform =
    pagerOffset === 0
      ? `translate3d(${pagerBaseOffset}, 0, 0)`
      : `translate3d(calc(${pagerBaseOffset} ${pagerOffsetTerm}), 0, 0)`;

  return (
    <section className="panel swipe-view">
      <div className="view-header-stack">
        <div>
          <div className="view-titlebar month-view-titlebar">
            <h2>Monthly</h2>
            <div className="view-title-actions print-hide month-view-title-actions">
              <div className="nav-actions view-title-nav month-view-title-nav">
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => animateMonthChange(-1)}
                  type="button"
                  aria-label="前月"
                >
                  <span aria-hidden="true">＜</span>
                </button>
                <button
                  className="ghost-button month-picker-trigger"
                  onClick={() => setIsMonthPickerOpen(true)}
                  type="button"
                >
                  {formatMonthLabel(activeMonthDate)}
                </button>
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => animateMonthChange(1)}
                  type="button"
                  aria-label="翌月"
                >
                  <span aria-hidden="true">＞</span>
                </button>
              </div>
              <button
                className="ghost-button view-print-button month-view-print-button"
                onClick={() => window.print()}
                type="button"
              >
                印刷
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="week-chip-row month-week-chip-row print-hide">
        {weeks.map((week) => (
          <button
            key={week.startDate}
            className={
              selectedWeek === week.startDate ? 'week-chip active' : 'week-chip'
            }
            onClick={() => {
              const focusDate =
                week.dates.find((date) =>
                  date.startsWith(activeMonthDate.slice(0, 7)),
                ) ??
                week.startDate;
              onOpenWeek(focusDate);
            }}
            type="button"
          >
            <span className="month-week-chip-full">{week.label}</span>
            <span className="month-week-chip-short">{week.index + 1}週</span>
          </button>
        ))}
      </div>

      <div
        className="month-pager-viewport"
        ref={pagerViewportRef}
        onPointerDown={handlePagerPointerDown}
        onPointerMove={handlePagerPointerMove}
        onPointerUp={finishPagerDrag}
        onPointerCancel={finishPagerDrag}
      >
        <div
          className={[
            'month-pager-track',
            pagerTransitionEnabled ? 'is-animated' : 'is-dragging',
          ]
            .filter(Boolean)
            .join(' ')}
          onTransitionEnd={handlePagerTransitionEnd}
          style={{
            transform: pagerTransform,
          }}
        >
          {visibleMonths.map((visibleMonthDate, panelIndex) =>
            renderMonthPanel(visibleMonthDate, panelIndex),
          )}
        </div>
      </div>

      <MonthEventDialog
        openDate={eventModalDate}
        userId={userId}
        monthEvents={monthEvents}
        onSave={onSaveMonthEvent}
        onDelete={onDeleteMonthEvent}
        onClose={() => setEventModalDate(null)}
      />

      <MonthPickerDialog
        open={isMonthPickerOpen}
        activeMonthDate={activeMonthDate}
        onSelectMonth={onChangeMonth}
        onClose={() => setIsMonthPickerOpen(false)}
      />
    </section>
  );
}
