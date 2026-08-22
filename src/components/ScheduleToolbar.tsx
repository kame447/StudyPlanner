import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const INITIAL_DAY_STRIP_BUFFER = 35;
const DAY_STRIP_EXTENSION_SIZE = 28;
const DAY_STRIP_EDGE_THRESHOLD_PX = 360;

interface DayStripWindow {
  start: string;
  end: string;
}

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

function createDayStripWindow(centerDate: string): DayStripWindow {
  return {
    start: addDays(centerDate, -INITIAL_DAY_STRIP_BUFFER),
    end: addDays(centerDate, INITIAL_DAY_STRIP_BUFFER),
  };
}

function buildDayStripDates(window: DayStripWindow): string[] {
  const distance = dateDistanceInDays(window.start, window.end);
  if (!Number.isFinite(distance) || distance < 0) {
    return [window.start];
  }

  return Array.from({ length: distance + 1 }, (_, index) =>
    addDays(window.start, index),
  );
}

function getMonthBoundaryLabel(dateString: string): string | null {
  const date = parseDate(dateString);
  if (Number.isNaN(date.getTime()) || date.getDate() !== 1) {
    return null;
  }

  return date.getMonth() === 0
    ? `${date.getFullYear()}年 1月`
    : `${date.getMonth() + 1}月`;
}

function setScrollLeftImmediately(element: HTMLDivElement, left: number) {
  const previousScrollBehavior = element.style.scrollBehavior;
  element.style.scrollBehavior = 'auto';
  element.scrollLeft = Math.max(0, left);
  element.style.scrollBehavior = previousScrollBehavior;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface ScheduleDayStripProps {
  selectedDate: string;
  onChangeDay: (date: string) => void;
}

function ScheduleDayStrip({ selectedDate, onChangeDay }: ScheduleDayStripProps) {
  const [dateWindow, setDateWindow] = useState<DayStripWindow>(() =>
    createDayStripWindow(selectedDate),
  );
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const hasPositionedInitiallyRef = useRef(false);
  const lastPositionedDateRef = useRef<string | null>(null);
  const extensionDirectionRef = useRef<'prepend' | 'append' | null>(null);
  const pendingPrependRef = useRef<{
    scrollLeft: number;
    scrollWidth: number;
  } | null>(null);
  const dates = useMemo(() => buildDayStripDates(dateWindow), [dateWindow]);

  useLayoutEffect(() => {
    if (selectedDate >= dateWindow.start && selectedDate <= dateWindow.end) {
      return;
    }

    pendingPrependRef.current = null;
    extensionDirectionRef.current = null;
    hasPositionedInitiallyRef.current = false;
    lastPositionedDateRef.current = null;
    setDateWindow(createDayStripWindow(selectedDate));
  }, [dateWindow.end, dateWindow.start, selectedDate]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const pendingPrepend = pendingPrependRef.current;
    if (!strip || !pendingPrepend) {
      return;
    }

    const addedWidth = strip.scrollWidth - pendingPrepend.scrollWidth;
    setScrollLeftImmediately(
      strip,
      pendingPrepend.scrollLeft + Math.max(0, addedWidth),
    );
    pendingPrependRef.current = null;
    extensionDirectionRef.current = null;
  }, [dateWindow.start]);

  useLayoutEffect(() => {
    if (extensionDirectionRef.current === 'append') {
      extensionDirectionRef.current = null;
    }
  }, [dateWindow.end]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const item = itemRefs.current.get(selectedDate);
    if (!strip || !item || pendingPrependRef.current) {
      return;
    }

    if (
      hasPositionedInitiallyRef.current &&
      lastPositionedDateRef.current === selectedDate
    ) {
      return;
    }

    const targetLeft = Math.max(
      0,
      item.offsetLeft - strip.clientWidth / 2 + item.offsetWidth / 2,
    );

    if (!hasPositionedInitiallyRef.current) {
      setScrollLeftImmediately(strip, targetLeft);
      hasPositionedInitiallyRef.current = true;
    } else {
      strip.scrollTo({
        left: targetLeft,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }

    lastPositionedDateRef.current = selectedDate;
  }, [dates, selectedDate]);

  function extendStripIfNeeded() {
    const strip = stripRef.current;
    if (
      !strip ||
      !hasPositionedInitiallyRef.current ||
      extensionDirectionRef.current
    ) {
      return;
    }

    const rightDistance =
      strip.scrollWidth - strip.clientWidth - strip.scrollLeft;

    if (strip.scrollLeft <= DAY_STRIP_EDGE_THRESHOLD_PX) {
      pendingPrependRef.current = {
        scrollLeft: strip.scrollLeft,
        scrollWidth: strip.scrollWidth,
      };
      extensionDirectionRef.current = 'prepend';
      setDateWindow((current) => ({
        ...current,
        start: addDays(current.start, -DAY_STRIP_EXTENSION_SIZE),
      }));
      return;
    }

    if (rightDistance <= DAY_STRIP_EDGE_THRESHOLD_PX) {
      extensionDirectionRef.current = 'append';
      setDateWindow((current) => ({
        ...current,
        end: addDays(current.end, DAY_STRIP_EXTENSION_SIZE),
      }));
    }
  }

  return (
    <div
      ref={stripRef}
      className="schedule-day-strip"
      aria-label="日付を選択"
      onScroll={extendStripIfNeeded}
    >
      {dates.map((date) => {
        const selected = date === selectedDate;
        const weekday = getWeekdayLabel(date);
        const monthBoundaryLabel = getMonthBoundaryLabel(date);
        const className = [
          selected ? 'active' : '',
          weekday === '土' ? 'is-saturday' : '',
          weekday === '日' ? 'is-sunday' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <Fragment key={date}>
            {monthBoundaryLabel ? (
              <div className="schedule-day-month-boundary" aria-hidden="true">
                <span>ここから</span>
                <strong>{monthBoundaryLabel}</strong>
              </div>
            ) : null}
            <button
              ref={(node) => {
                if (node) itemRefs.current.set(date, node);
                else itemRefs.current.delete(date);
              }}
              className={className}
              onClick={() => onChangeDay(date)}
              type="button"
              aria-current={selected ? 'date' : undefined}
              aria-label={formatDayHeading(date)}
            >
              <span>{weekday}</span>
              <strong>{dayNumber(date)}</strong>
            </button>
          </Fragment>
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
