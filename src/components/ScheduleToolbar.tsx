import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  formatMonthLabel,
  getMonthWeeks,
  getWeekDates,
  getWeekdayLabel,
} from '../lib/date';
import type { ViewMode } from '../types/domain';

const SCHEDULE_VIEW_OPTIONS: ReadonlyArray<{ mode: ViewMode; label: string }> = [
  { mode: 'month', label: '月' },
  { mode: 'week', label: '週' },
  { mode: 'day', label: '日' },
  { mode: 'todo', label: 'Todo' },
];

function parseDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

function formatDayHeading(dateString: string): string {
  const date = parseDate(dateString);
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月${date.getDate()}日 ${getWeekdayLabel(dateString)}`;
}

function formatWeekHeading(dateString: string): string {
  const date = parseDate(dateString);
  const weeks = getMonthWeeks(dateString);
  const weekIndex = weeks.findIndex((week) => week.dates.includes(dateString));
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月 第${Math.max(0, weekIndex) + 1}週`;
}

function dayNumber(dateString: string): number {
  return Number(dateString.slice(-2));
}

interface ScheduleToolbarProps {
  viewMode: ViewMode;
  selectedDate: string;
  monthDate: string;
  onChangeView: (mode: ViewMode) => void;
  onChangeMonth: (date: string) => void;
  onChangeWeek: (date: string) => void;
  onChangeDay: (date: string) => void;
}

export function ScheduleToolbar({
  viewMode,
  selectedDate,
  monthDate,
  onChangeView,
  onChangeMonth,
  onChangeWeek,
  onChangeDay,
}: ScheduleToolbarProps) {
  const weekDates = getWeekDates(selectedDate);
  const heading =
    viewMode === 'month'
      ? formatMonthLabel(monthDate)
      : viewMode === 'week'
        ? formatWeekHeading(selectedDate)
        : viewMode === 'day'
          ? formatDayHeading(selectedDate)
          : 'Todo';

  const handlePrevious = () => {
    if (viewMode === 'month') onChangeMonth(addDays(monthDate, -28));
    else if (viewMode === 'week') onChangeWeek(addDays(selectedDate, -7));
    else if (viewMode === 'day') onChangeDay(addDays(selectedDate, -1));
  };

  const handleNext = () => {
    if (viewMode === 'month') onChangeMonth(addDays(monthDate, 35));
    else if (viewMode === 'week') onChangeWeek(addDays(selectedDate, 7));
    else if (viewMode === 'day') onChangeDay(addDays(selectedDate, 1));
  };

  return (
    <div className="schedule-toolbar print-hide">
      <div className="schedule-toolbar-row">
        <div className="schedule-period-control">
          <CalendarDays aria-hidden="true" size={22} />
          {viewMode !== 'todo' ? (
            <button className="schedule-period-step" onClick={handlePrevious} type="button" aria-label="前へ">
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
          ) : null}
          <strong>{heading}</strong>
          {viewMode !== 'todo' ? (
            <>
              <ChevronDown className="schedule-period-chevron" aria-hidden="true" size={17} />
              <button className="schedule-period-step" onClick={handleNext} type="button" aria-label="次へ">
                <ChevronRight aria-hidden="true" size={16} />
              </button>
            </>
          ) : null}
        </div>

        <div className="schedule-view-tabs" role="tablist" aria-label="予定表示">
          {SCHEDULE_VIEW_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={viewMode === option.mode ? 'active' : ''}
              onClick={() => onChangeView(option.mode)}
              role="tab"
              aria-selected={viewMode === option.mode}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'day' ? (
        <div className="schedule-day-strip" aria-label="週の日付">
          {weekDates.map((date) => {
            const selected = date === selectedDate;
            const weekday = getWeekdayLabel(date);
            return (
              <button
                key={date}
                className={selected ? 'active' : ''}
                onClick={() => onChangeDay(date)}
                type="button"
                aria-current={selected ? 'date' : undefined}
              >
                <span>{weekday}</span>
                <strong>{dayNumber(date)}</strong>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
