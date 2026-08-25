import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useExitMotion } from '../hooks/useExitMotion';
import { todayIsoDate } from '../lib/date';
import { buildMonthGrid } from '../lib/monthViewProjection';
import { MonthDaySheet } from './MonthDaySheet';
import { MonthEventDialog } from './MonthEventDialog';
import { MonthGridPanel } from './MonthGridPanel';
import type { Actual, MonthEvent, MonthEventDraft, Plan } from '../types/domain';

interface MonthViewProps {
  monthDate: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  createRequestId?: number;
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
  createRequestId = 0,
  onSelectDate,
  onSaveMonthEvent,
  onDeleteMonthEvent,
}: MonthViewProps) {
  const [eventModalDate, setEventModalDate] = useState<string | null>(null);
  const [eventModalInitialEventId, setEventModalInitialEventId] = useState<string | null>(null);
  const [daySheetDate, setDaySheetDate] = useState<string | null>(null);
  const { isExiting: isEventModalClosing, requestExit: requestCloseMonthEventEditor } =
    useExitMotion(() => {
      setEventModalDate(null);
      setEventModalInitialEventId(null);
    });
  const grid = useMemo(() => buildMonthGrid(monthDate).cells, [monthDate]);
  const gridIndexByDate = useMemo(
    () => new Map(grid.map((cell, index) => [cell.date, index])),
    [grid],
  );
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusSelectedCell = useRef(false);
  const pendingCellClickTimeout = useRef<number | null>(null);
  const lastCellClick = useRef<{ date: string; at: number } | null>(null);
  const lastCreateRequestId = useRef(createRequestId);
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
  }, [monthDate, selectedDate]);

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
    requestCloseMonthEventEditor();
  }

  useEffect(() => {
    if (createRequestId <= 0 || createRequestId === lastCreateRequestId.current) {
      return;
    }

    lastCreateRequestId.current = createRequestId;
    openMonthEventEditor(selectedDate);
  }, [createRequestId, selectedDate]);

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

      if (eventModalDate || daySheetDate) {
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
  }, [daySheetDate, eventModalDate, moveSelectionByKeyboard, selectedDate]);

  useEffect(() => {
    return () => {
      if (pendingCellClickTimeout.current !== null) {
        window.clearTimeout(pendingCellClickTimeout.current);
      }

      lastCellClick.current = null;
    };
  }, []);

  return (
    <section className="panel schedule-month-view">
      <div className="schedule-month-static-grid">
        <MonthGridPanel
          monthDate={monthDate}
          isCurrent
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
      </div>

      <MonthDaySheet
        openDate={daySheetDate}
        monthEvents={monthEvents}
        onCreate={(date) => openMonthEventEditor(date)}
        onEdit={(event) => openMonthEventEditor(daySheetDate ?? event.date, event.id)}
        onClose={() => setDaySheetDate(null)}
      />

      {eventModalDate
        ? createPortal(
            <div
              className={`month-event-dialog-motion ${
                isEventModalClosing ? 'is-closing' : 'is-open'
              }`}
            >
              <MonthEventDialog
                openDate={eventModalDate}
                userId={userId}
                monthEvents={monthEvents}
                initialEventId={eventModalInitialEventId}
                onSave={onSaveMonthEvent}
                onDelete={onDeleteMonthEvent}
                onClose={closeMonthEventEditor}
              />
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
