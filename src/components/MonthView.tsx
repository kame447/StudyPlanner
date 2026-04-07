import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths,
  formatCompactDate,
  formatMinutes,
  formatMonthLabel,
  getCalendarDayTone,
  getJapaneseHolidayName,
  getMonthWeeks,
  getWeekdayLabels,
  minutesBetween,
  startOfWeek,
} from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRange,
  sortMonthEvents,
} from '../lib/monthEvents';
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
  const plansById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  );
  const studyPlanMinutesByDate = useMemo(() => {
    const totals = new Map<string, number>();

    plans.forEach((plan) => {
      if (plan.type !== 'study') {
        return;
      }

      totals.set(
        plan.date,
        (totals.get(plan.date) ?? 0) + minutesBetween(plan.startTime, plan.endTime),
      );
    });

    return totals;
  }, [plans]);
  const actualStudyMinutesByDate = useMemo(() => {
    const totals = new Map<string, number>();

    actuals.forEach((actual) => {
      const plan = plansById.get(actual.planId);

      if (!plan || plan.type !== 'study') {
        return;
      }

      totals.set(
        plan.date,
        (totals.get(plan.date) ?? 0) +
          minutesBetween(actual.actualStartTime, actual.actualEndTime),
      );
    });

    return totals;
  }, [actuals, plansById]);

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

  return (
    <section className="panel">
      <div className="view-header-stack">
        <div>
          <div className="view-titlebar">
            <h2>月ビュー</h2>
            <div className="view-title-actions print-hide">
              <div className="nav-actions view-title-nav">
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
                className="ghost-button view-print-button"
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
            {week.label}
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
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={cell.date}
              className={cellClassName}
              ref={(node) => registerCellRef(cell.date, node)}
              onClick={() => {
                onSelectDate(cell.date);
              }}
              onDoubleClick={() => {
                openMonthEventEditor(cell.date);
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
                  {formatCompactDate(cell.date)}
                </strong>
                {holidayName ? (
                  <span className="month-holiday-label" title={holidayName}>
                    {holidayName}
                  </span>
                ) : null}
                {cell.date === selectedDate ? <span className="today-dot" /> : null}
              </div>

              <div className="month-study-summary">
                <p className="month-target">
                  目標 {targetMinutes > 0 ? formatMinutes(targetMinutes) : '0分'}
                </p>
                <p className="month-target">
                  実績 {actualMinutes > 0 ? formatMinutes(actualMinutes) : '0分'}
                </p>
              </div>

              <div className="month-major-event-list">
                {limitedMonthEvents.map((monthEvent) => (
                  <span
                    key={monthEvent.id}
                    className="event-pill month-major-event-pill"
                  >
                    {formatMonthEventTimeRange(monthEvent)} {monthEvent.title}
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
