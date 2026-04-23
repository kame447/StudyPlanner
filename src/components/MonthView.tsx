import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths,
  formatMinutes,
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
  buildPlanOccurrenceKey,
  expandPlansForDateRange,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
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

function formatCompactStudyMinutes(minutes: number): string {
  if (minutes <= 0) {
    return '0m';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h${remainingMinutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${remainingMinutes}m`;
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
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusSelectedCell = useRef(false);
  const pendingCellClickTimeout = useRef<number | null>(null);
  const lastCellClick = useRef<{ date: string; at: number } | null>(null);
  const todayDate = todayIsoDate();
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeMonth(addMonths(monthDate, -1)),
    onNext: () => onChangeMonth(addMonths(monthDate, 1)),
    disabled: eventModalDate !== null || isMonthPickerOpen,
  });
  const weeks = getMonthWeeks(monthDate);
  const grid = useMemo(
    () =>
      weeks.flatMap((week) =>
        week.dates.map((date) => ({
          date,
          inCurrentMonth: date.startsWith(monthDate.slice(0, 7)),
        })),
      ),
    [monthDate, weeks],
  );
  const selectedWeek = startOfWeek(selectedDate);
  const gridIndexByDate = useMemo(
    () => new Map(grid.map((cell, index) => [cell.date, index])),
    [grid],
  );
  const visiblePlanOccurrences = useMemo(() => {
    if (grid.length === 0) {
      return [];
    }

    return expandPlansForDateRange(plans, grid[0].date, grid[grid.length - 1].date);
  }, [grid, plans]);
  const studyPlanMinutesByDate = useMemo(() => {
    const totals = new Map<string, number>();

    visiblePlanOccurrences.forEach((plan) => {
      if (plan.type !== 'study') {
        return;
      }

      totals.set(
        plan.date,
        (totals.get(plan.date) ?? 0) + minutesBetween(plan.startTime, plan.endTime),
      );
    });

    return totals;
  }, [visiblePlanOccurrences]);
  const actualStudyMinutesByDate = useMemo(() => {
    const totals = new Map<string, number>();
    const actualByOccurrenceKey = new Map(
      actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
    );

    visiblePlanOccurrences.forEach((plan) => {
      const actual = actualByOccurrenceKey.get(
        buildPlanOccurrenceKey(plan.id, plan.date),
      );

      if (!actual || plan.type !== 'study') {
        return;
      }

      totals.set(
        plan.date,
        (totals.get(plan.date) ?? 0) + minutesBetween(actual.actualStartTime, actual.actualEndTime),
      );
    });

    return totals;
  }, [actuals, visiblePlanOccurrences]);

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

    cellRefs.current.get(selectedDate)?.focus();
    shouldFocusSelectedCell.current = false;
  }, [selectedDate, monthDate]);

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

  return (
    <section className="panel swipe-view" {...swipeNavigation}>
      <div className="view-header-stack">
        <div>
          <div className="view-titlebar month-view-titlebar">
            <h2>Monthly</h2>
            <div className="view-title-actions print-hide month-view-title-actions">
              <div className="nav-actions view-title-nav month-view-title-nav">
                <button
                  className="ghost-button"
                  onClick={() => onChangeMonth(addMonths(monthDate, -1))}
                  type="button"
                >
                  前の月
                </button>
                <button
                  className="ghost-button month-picker-trigger"
                  onClick={() => setIsMonthPickerOpen(true)}
                  type="button"
                >
                  {formatMonthLabel(monthDate)}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => onChangeMonth(addMonths(monthDate, 1))}
                  type="button"
                >
                  次の月
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
                week.dates.find((date) => date.startsWith(monthDate.slice(0, 7))) ??
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

        {grid.map((cell) => {
          const dayTone = getCalendarDayTone(cell.date);
          const holidayName = getJapaneseHolidayName(cell.date);
          const targetMinutes = studyPlanMinutesByDate.get(cell.date) ?? 0;
          const actualMinutes = actualStudyMinutesByDate.get(cell.date) ?? 0;
          const visibleMonthEvents = sortMonthEvents(
            monthEvents.filter((monthEvent) => doesMonthEventOccurOnDate(monthEvent, cell.date)),
          );
          const limitedMonthEvents = visibleMonthEvents.slice(0, 2);
          const cellClassName = [
            'month-cell',
            cell.inCurrentMonth ? '' : 'is-muted',
            cell.date === selectedDate ? 'is-selected' : '',
            cell.date === todayDate ? 'is-today' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={cell.date}
              className={cellClassName}
              ref={(node) => registerCellRef(cell.date, node)}
              onClick={() => {
                handleCellClick(cell.date);
              }}
              onKeyDown={(event) => {
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
              }}
              tabIndex={cell.date === selectedDate ? 0 : -1}
              aria-selected={cell.date === selectedDate}
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

              <div className="month-study-summary">
                <p className="month-target">
                  <span className="month-target-label month-target-label-full">目標</span>
                  <span className="month-target-label month-target-label-short">目</span>{' '}
                  <span className="month-target-value month-target-value-full">
                    {targetMinutes > 0 ? formatMinutes(targetMinutes) : '0分'}
                  </span>
                  <span className="month-target-value month-target-value-short">
                    {formatCompactStudyMinutes(targetMinutes)}
                  </span>
                </p>
                <p className="month-target">
                  <span className="month-target-label month-target-label-full">実績</span>
                  <span className="month-target-label month-target-label-short">実</span>{' '}
                  <span className="month-target-value month-target-value-full">
                    {actualMinutes > 0 ? formatMinutes(actualMinutes) : '0分'}
                  </span>
                  <span className="month-target-value month-target-value-short">
                    {formatCompactStudyMinutes(actualMinutes)}
                  </span>
                </p>
              </div>

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
                    <span className="month-major-event-short">{monthEvent.title}</span>
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
        activeMonthDate={monthDate}
        onSelectMonth={onChangeMonth}
        onClose={() => setIsMonthPickerOpen(false)}
      />
    </section>
  );
}
