import { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  formatDateLabel,
  formatMonthLabel,
  getCalendarDayTone,
  getMonthGrid,
  getWeekdayLabels,
  startOfMonth,
  todayIsoDate,
} from '../lib/date';

interface DayCalendarDialogProps {
  open: boolean;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(dateString: string): boolean {
  if (!ISO_DATE_PATTERN.test(dateString)) {
    return false;
  }

  const date = new Date(`${dateString}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function normalizeSelectedDate(dateString: string, fallbackDate: string): string {
  return isValidIsoDate(dateString) ? dateString : fallbackDate;
}

export function DayCalendarDialog({
  open,
  selectedDate,
  onSelectDate,
  onClose,
}: DayCalendarDialogProps) {
  const today = todayIsoDate();
  const safeSelectedDate = normalizeSelectedDate(selectedDate, today);
  const selectedMonth = startOfMonth(safeSelectedDate);
  const [calendarMonth, setCalendarMonth] = useState(selectedMonth);
  const weekdayLabels = getWeekdayLabels();
  const days = useMemo(() => getMonthGrid(calendarMonth), [calendarMonth]);

  useEffect(() => {
    setCalendarMonth(selectedMonth);
  }, [selectedMonth]);

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
            const isSelected = date === safeSelectedDate;
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
