import { useMemo, useState } from 'react';
import {
  addMonths,
  formatCompactDate,
  formatMinutes,
  formatMonthLabel,
  getCalendarDayTone,
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

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h2>月ビュー</h2>
        </div>

        <div className="nav-actions">
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
      </div>

      <div className="week-chip-row">
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
              onClick={() => {
                onSelectDate(cell.date);
                setEventModalDate(cell.date);
              }}
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
