import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  formatMonthLabel,
  getMonthWeeks,
  getWeekdayLabel,
} from '../lib/date';
import type { ViewMode } from '../types/domain';
import { MonthPickerDialog } from './MonthPickerDialog';

const SCHEDULE_VIEW_OPTIONS: ReadonlyArray<{ mode: ViewMode; label: string }> = [
  { mode: 'month', label: '月' },
  { mode: 'week', label: '週' },
  { mode: 'day', label: '日' },
  { mode: 'todo', label: 'Todo' },
];

const DAY_STRIP_RADIUS = 45;

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

function dateDistanceInDays(left: string, right: string): number {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86_400_000);
}

function buildDateForMonth(sourceDate: string, monthDate: string): string {
  const year = Number(monthDate.slice(0, 4));
  const month = Number(monthDate.slice(5, 7));
  const requestedDay = Number(sourceDate.slice(8, 10));
  const maxDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(requestedDay, 1), maxDay);

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

interface ScheduleDayStripProps {
  selectedDate: string;
  onChangeDay: (date: string) => void;
}

function ScheduleDayStrip({ selectedDate, onChangeDay }: ScheduleDayStripProps) {
  const [rangeAnchor, setRangeAnchor] = useState(selectedDate);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const hasCenteredOnceRef = useRef(false);
  const dates = useMemo(
    () =>
      Array.from({ length: DAY_STRIP_RADIUS * 2 + 1 }, (_, index) =>
        addDays(rangeAnchor, index - DAY_STRIP_RADIUS),
      ),
    [rangeAnchor],
  );

  useEffect(() => {
    if (Math.abs(dateDistanceInDays(rangeAnchor, selectedDate)) > DAY_STRIP_RADIUS - 8) {
      setRangeAnchor(selectedDate);
    }
  }, [rangeAnchor, selectedDate]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const strip = stripRef.current;
      const item = itemRefs.current.get(selectedDate);

      if (!strip || !item) {
        return;
      }

      const targetLeft = item.offsetLeft - strip.clientWidth / 2 + item.offsetWidth / 2;
      strip.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: hasCenteredOnceRef.current ? 'smooth' : 'auto',
      });
      hasCenteredOnceRef.current = true;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [dates, selectedDate]);

  return (
    <div ref={stripRef} className="schedule-day-strip" aria-label="日付を選択">
      {dates.map((date) => {
        const selected = date === selectedDate;
        const weekday = getWeekdayLabel(date);
        const className = [
          selected ? 'active' : '',
          weekday === '土' ? 'is-saturday' : '',
          weekday === '日' ? 'is-sunday' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={date}
            ref={(node) => {
              if (node) itemRefs.current.set(date, node);
              else itemRefs.current.delete(date);
            }}
            className={className}
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
  );
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
  const [isPeriodPickerOpen, setIsPeriodPickerOpen] = useState(false);
  const heading =
    viewMode === 'month'
      ? formatMonthLabel(monthDate)
      : viewMode === 'week'
        ? formatWeekHeading(selectedDate)
        : viewMode === 'day'
          ? formatDayHeading(selectedDate)
          : 'Todo';
  const pickerMonthDate =
    viewMode === 'month' ? monthDate : `${selectedDate.slice(0, 7)}-01`;

  function movePeriod(direction: -1 | 1) {
    if (viewMode === 'month') {
      onChangeMonth(addMonths(monthDate, direction));
      return;
    }

    if (viewMode === 'week') {
      onChangeWeek(addDays(selectedDate, direction * 7));
      return;
    }

    if (viewMode === 'day') {
      onChangeDay(addDays(selectedDate, direction));
    }
  }

  function handleSelectMonth(nextMonthDate: string) {
    if (viewMode === 'month') {
      onChangeMonth(nextMonthDate);
      return;
    }

    const nextDate = buildDateForMonth(selectedDate, nextMonthDate);

    if (viewMode === 'week') {
      onChangeWeek(nextDate);
      return;
    }

    if (viewMode === 'day') {
      onChangeDay(nextDate);
    }
  }

  return (
    <>
      <div className="schedule-toolbar print-hide">
        <div className="schedule-toolbar-row">
          <div className="schedule-period-control">
            {viewMode !== 'todo' ? (
              <button
                className="schedule-period-step"
                onClick={() => movePeriod(-1)}
                type="button"
                aria-label="前の期間へ"
              >
                <ChevronLeft aria-hidden="true" size={18} />
              </button>
            ) : null}

            <button
              className="schedule-period-picker-trigger"
              disabled={viewMode === 'todo'}
              onClick={() => setIsPeriodPickerOpen(true)}
              type="button"
              aria-label={viewMode === 'todo' ? 'Todo' : `${heading}を変更`}
            >
              <CalendarDays aria-hidden="true" size={22} />
              <strong>{heading}</strong>
              {viewMode !== 'todo' ? (
                <ChevronDown className="schedule-period-chevron" aria-hidden="true" size={17} />
              ) : null}
            </button>

            {viewMode !== 'todo' ? (
              <button
                className="schedule-period-step"
                onClick={() => movePeriod(1)}
                type="button"
                aria-label="次の期間へ"
              >
                <ChevronRight aria-hidden="true" size={18} />
              </button>
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
          <ScheduleDayStrip selectedDate={selectedDate} onChangeDay={onChangeDay} />
        ) : null}
      </div>

      <MonthPickerDialog
        open={isPeriodPickerOpen}
        activeMonthDate={pickerMonthDate}
        onSelectMonth={handleSelectMonth}
        onClose={() => setIsPeriodPickerOpen(false)}
      />
    </>
  );
}
