import { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  formatCompactDate,
  formatDateLabel,
  formatMonthLabel,
  getCalendarDayTone,
  getMonthGrid,
  getMonthWeeks,
  getWeekdayLabels,
  startOfMonth,
  startOfWeek,
  todayIsoDate,
} from '../lib/date';

interface WeekPickerDialogProps {
  open: boolean;
  selectedDate: string;
  onSelectWeek: (date: string) => void;
  onClose: () => void;
}

interface DayCalendarDialogProps {
  open: boolean;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

function buildMonthDate(year: number, month: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-01`;
}

function getYear(dateString: string): number {
  return Number(dateString.slice(0, 4));
}

function getMonth(dateString: string): number {
  return Number(dateString.slice(5, 7));
}

export function WeekPickerDialog({
  open,
  selectedDate,
  onSelectWeek,
  onClose,
}: WeekPickerDialogProps) {
  const activeYear = getYear(selectedDate);
  const activeMonth = getMonth(selectedDate);
  const selectedWeekStart = startOfWeek(selectedDate);
  const [year, setYear] = useState(activeYear);
  const [month, setMonth] = useState(activeMonth);
  const [weekStart, setWeekStart] = useState(selectedWeekStart);
  const today = todayIsoDate();
  const yearOptions = useMemo(() => {
    const currentYear = getYear(today);
    const startYear = Math.min(activeYear, currentYear) - 3;
    return Array.from({ length: 7 }, (_, index) => startYear + index);
  }, [activeYear, today]);
  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => index + 1),
    [],
  );
  const monthDate = buildMonthDate(year, month);
  const weekOptions = useMemo(() => getMonthWeeks(monthDate), [monthDate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setYear(activeYear);
    setMonth(activeMonth);
    setWeekStart(selectedWeekStart);
  }, [activeMonth, activeYear, open, selectedWeekStart]);

  useEffect(() => {
    if (!open || weekOptions.some((week) => week.startDate === weekStart)) {
      return;
    }

    setWeekStart(weekOptions[0]?.startDate ?? monthDate);
  }, [monthDate, open, weekOptions, weekStart]);

  if (!open) {
    return null;
  }

  const selectedWeek = weekOptions.find((week) => week.startDate === weekStart);

  return (
    <div className="overlay modal-overlay date-picker-overlay" onClick={onClose}>
      <div
        className="modal-card compact-date-picker-modal week-picker-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="compact-picker-title">
          <strong>週を選択</strong>
          <span>
            {selectedWeek
              ? `${formatCompactDate(selectedWeek.startDate)}-${formatCompactDate(
                  selectedWeek.endDate,
                )}`
              : formatMonthLabel(monthDate)}
          </span>
        </div>

        <div className="week-picker-grid" aria-label="週を選択">
          <div className="compact-picker-column">
            <span>年</span>
            <div className="compact-picker-options">
              {yearOptions.map((option) => (
                <button
                  key={option}
                  className={
                    option === year
                      ? 'compact-picker-option active'
                      : 'compact-picker-option'
                  }
                  onClick={() => setYear(option)}
                  type="button"
                >
                  {option}年
                </button>
              ))}
            </div>
          </div>

          <div className="compact-picker-column">
            <span>月</span>
            <div className="compact-picker-options">
              {monthOptions.map((option) => (
                <button
                  key={option}
                  className={
                    option === month
                      ? 'compact-picker-option active'
                      : 'compact-picker-option'
                  }
                  onClick={() => setMonth(option)}
                  type="button"
                >
                  {option}月
                </button>
              ))}
            </div>
          </div>

          <div className="compact-picker-column week-picker-week-column">
            <span>週</span>
            <div className="compact-picker-options">
              {weekOptions.map((week) => (
                <button
                  key={week.startDate}
                  className={
                    week.startDate === weekStart
                      ? 'compact-picker-option week-option active'
                      : 'compact-picker-option week-option'
                  }
                  onClick={() => setWeekStart(week.startDate)}
                  type="button"
                >
                  <strong>{week.label}</strong>
                  <small>
                    {formatCompactDate(week.startDate)}-{formatCompactDate(week.endDate)}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="compact-picker-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            キャンセル
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onSelectWeek(weekStart);
              onClose();
            }}
            type="button"
          >
            決定
          </button>
        </div>
      </div>
    </div>
  );
}

export function DayCalendarDialog({
  open,
  selectedDate,
  onSelectDate,
  onClose,
}: DayCalendarDialogProps) {
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(selectedDate));
  const today = todayIsoDate();
  const weekdayLabels = getWeekdayLabels();
  const days = useMemo(() => getMonthGrid(calendarMonth), [calendarMonth]);

  useEffect(() => {
    if (open) {
      setCalendarMonth(startOfMonth(selectedDate));
    }
  }, [open, selectedDate]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay modal-overlay date-picker-overlay" onClick={onClose}>
      <div
        className="modal-card compact-date-picker-modal day-calendar-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mini-calendar-header">
          <button
            className="ghost-button nav-icon-button"
            onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}
            type="button"
            aria-label="前月"
          >
            <span aria-hidden="true">＜</span>
          </button>
          <strong>{formatMonthLabel(calendarMonth)}</strong>
          <button
            className="ghost-button nav-icon-button"
            onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
            type="button"
            aria-label="翌月"
          >
            <span aria-hidden="true">＞</span>
          </button>
        </div>

        <div className="mini-calendar-grid" aria-label="日付を選択">
          {weekdayLabels.map((label) => (
            <span key={label} className="mini-calendar-weekday">
              {label}
            </span>
          ))}
          {days.map(({ date, inCurrentMonth }) => {
            const isSelected = date === selectedDate;
            const isToday = date === today;
            const tone = getCalendarDayTone(date);

            return (
              <button
                key={date}
                className={[
                  'mini-calendar-day',
                  inCurrentMonth ? '' : 'is-outside',
                  isSelected ? 'is-selected' : '',
                  isToday ? 'is-today' : '',
                  tone === 'saturday' ? 'is-saturday' : '',
                  tone === 'holiday' ? 'is-holiday' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onSelectDate(date);
                  onClose();
                }}
                type="button"
                aria-label={formatDateLabel(date)}
                aria-pressed={isSelected}
              >
                {Number(date.slice(8, 10))}
              </button>
            );
          })}
        </div>

        <div className="compact-picker-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            閉じる
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onSelectDate(today);
              onClose();
            }}
            type="button"
          >
            今日
          </button>
        </div>
      </div>
    </div>
  );
}
