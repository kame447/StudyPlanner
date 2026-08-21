import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { formatMonthLabel, startOfWeek, todayIsoDate } from '../lib/date';
import { buildMonthGrid } from '../lib/monthViewProjection';
import { useMonthPager } from '../hooks/useMonthPager';
import { MonthDaySheet } from './MonthDaySheet';
import { MonthEventDialog } from './MonthEventDialog';
import { MonthGridPanel } from './MonthGridPanel';
import { MonthPickerDialog } from './MonthPickerDialog';
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
  const [eventModalInitialEventId, setEventModalInitialEventId] = useState<string | null>(null);
  const [daySheetDate, setDaySheetDate] = useState<string | null>(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const pager = useMonthPager({
    monthDate,
    disabled: Boolean(eventModalDate || daySheetDate || isMonthPickerOpen),
    onChangeMonth,
  });
  const { weeks, cells: grid } = useMemo(
    () => buildMonthGrid(pager.activeMonthDate),
    [pager.activeMonthDate],
  );
  const selectedWeek = startOfWeek(selectedDate);
  const gridIndexByDate = useMemo(
    () => new Map(grid.map((cell, index) => [cell.date, index])),
    [grid],
  );
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusSelectedCell = useRef(false);
  const pendingCellClickTimeout = useRef<number | null>(null);
  const lastCellClick = useRef<{ date: string; at: number } | null>(null);
  const todayDate = todayIsoDate();

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
  }, [selectedDate, pager.activeMonthDate]);

  const moveSelectionByKeyboard = useCallback(
    (currentDate: string, offset: number) => {
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
    },
    [grid, gridIndexByDate, onSelectDate],
  );

  function openMonthEventEditor(date: string, initialEventId: string | null = null) {
    onSelectDate(date);
    setDaySheetDate(null);
    setEventModalInitialEventId(initialEventId);
    setEventModalDate(date);
  }

  function closeMonthEventEditor() {
    setEventModalDate(null);
    setEventModalInitialEventId(null);
  }

  function handleCellClick(date: string) {
    if (pager.suppressNextCellClick.current) {
      pager.suppressNextCellClick.current = false;
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
      setDaySheetDate(date);
      pendingCellClickTimeout.current = null;
      lastCellClick.current = null;
    }, 240);
  }

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (eventModalDate || daySheetDate || isMonthPickerOpen) {
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
  }, [daySheetDate, eventModalDate, isMonthPickerOpen, moveSelectionByKeyboard, selectedDate]);

  useEffect(() => {
    return () => {
      if (pendingCellClickTimeout.current !== null) {
        window.clearTimeout(pendingCellClickTimeout.current);
      }

      lastCellClick.current = null;
    };
  }, []);

  return (
    <section className="panel swipe-view schedule-month-view">
      <div className="view-header-stack month-legacy-header">
        <div>
          <div className="view-titlebar month-view-titlebar">
            <h2>Monthly</h2>
            <div className="view-title-actions print-hide month-view-title-actions">
              <div className="nav-actions view-title-nav month-view-title-nav">
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => pager.animateMonthChange(-1)}
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
                  {formatMonthLabel(pager.activeMonthDate)}
                </button>
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => pager.animateMonthChange(1)}
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
                  date.startsWith(pager.activeMonthDate.slice(0, 7)),
                ) ?? week.startDate;
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
        ref={pager.pagerViewportRef}
        onPointerDown={pager.handlePagerPointerDown}
        onPointerMove={pager.handlePagerPointerMove}
        onPointerUp={pager.finishPagerDrag}
        onPointerCancel={pager.finishPagerDrag}
      >
        <div
          className={[
            'month-pager-track',
            pager.pagerTransitionEnabled ? 'is-animated' : 'is-dragging',
          ]
            .filter(Boolean)
            .join(' ')}
          onTransitionEnd={pager.handlePagerTransitionEnd}
          style={{ transform: pager.pagerTransform }}
        >
          {pager.visibleMonths.map((visibleMonthDate, panelIndex) => (
            <MonthGridPanel
              key={visibleMonthDate}
              monthDate={visibleMonthDate}
              isCurrent={panelIndex === pager.activeMonthIndex}
              selectedDate={selectedDate}
              todayDate={todayDate}
              plans={plans}
              actuals={actuals}
              monthEvents={monthEvents}
              registerCellRef={registerCellRef}
              onCellClick={handleCellClick}
              onMoveSelection={moveSelectionByKeyboard}
              onOpenMonthEventEditor={(date) => openMonthEventEditor(date)}
            />
          ))}
        </div>
      </div>

      <MonthDaySheet
        openDate={daySheetDate}
        monthEvents={monthEvents}
        onCreate={(date) => openMonthEventEditor(date)}
        onEdit={(event) => openMonthEventEditor(event.date, event.id)}
        onClose={() => setDaySheetDate(null)}
      />

      <MonthEventDialog
        openDate={eventModalDate}
        userId={userId}
        monthEvents={monthEvents}
        initialEventId={eventModalInitialEventId}
        onSave={onSaveMonthEvent}
        onDelete={onDeleteMonthEvent}
        onClose={closeMonthEventEditor}
      />

      <MonthPickerDialog
        open={isMonthPickerOpen}
        activeMonthDate={pager.activeMonthDate}
        onSelectMonth={onChangeMonth}
        onClose={() => setIsMonthPickerOpen(false)}
      />
    </section>
  );
}
