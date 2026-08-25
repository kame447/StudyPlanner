import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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

interface SelectionGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SELECTION_COMMIT_DELAY_MS = 220;

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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function getSelectionStyle(geometry: SelectionGeometry | null): CSSProperties | undefined {
  if (!geometry) {
    return undefined;
  }

  return {
    width: geometry.width,
    height: geometry.height,
    transform: `translate3d(${geometry.left}px, ${geometry.top}px, 0)`,
  };
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
  const [visualSelectedDate, setVisualSelectedDate] = useState(safeSelectedDate);
  const [selectionGeometry, setSelectionGeometry] = useState<SelectionGeometry | null>(null);
  const [selectionMotionReady, setSelectionMotionReady] = useState(false);
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const dayButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingCommitTimerRef = useRef<number | null>(null);
  const motionReadyFrameRef = useRef<number | null>(null);
  const weekdayLabels = getWeekdayLabels();
  const days = useMemo(() => getMonthGrid(calendarMonth), [calendarMonth]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCalendarMonth(selectedMonth);
    setVisualSelectedDate(safeSelectedDate);
    setSelectionMotionReady(false);
  }, [open, safeSelectedDate, selectedMonth]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const grid = calendarGridRef.current;
    const selectedButton = dayButtonRefs.current.get(visualSelectedDate);

    if (!grid || !selectedButton) {
      setSelectionGeometry(null);
      return;
    }

    const gridBox = grid.getBoundingClientRect();
    const buttonBox = selectedButton.getBoundingClientRect();

    setSelectionGeometry({
      left: buttonBox.left - gridBox.left,
      top: buttonBox.top - gridBox.top,
      width: buttonBox.width,
      height: buttonBox.height,
    });

    if (motionReadyFrameRef.current !== null) {
      window.cancelAnimationFrame(motionReadyFrameRef.current);
    }

    motionReadyFrameRef.current = window.requestAnimationFrame(() => {
      setSelectionMotionReady(true);
      motionReadyFrameRef.current = null;
    });
  }, [calendarMonth, days, open, visualSelectedDate]);

  useEffect(() => {
    return () => {
      if (pendingCommitTimerRef.current !== null) {
        window.clearTimeout(pendingCommitTimerRef.current);
      }
      if (motionReadyFrameRef.current !== null) {
        window.cancelAnimationFrame(motionReadyFrameRef.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  function cancelPendingSelection() {
    if (pendingCommitTimerRef.current !== null) {
      window.clearTimeout(pendingCommitTimerRef.current);
      pendingCommitTimerRef.current = null;
    }
  }

  function handleClose() {
    cancelPendingSelection();
    onClose();
  }

  function handleSelectDate(date: string) {
    cancelPendingSelection();

    const canAnimate =
      !prefersReducedMotion() &&
      date !== visualSelectedDate &&
      dayButtonRefs.current.has(date);

    setVisualSelectedDate(date);

    const commit = () => {
      pendingCommitTimerRef.current = null;
      onSelectDate(date);
      onClose();
    };

    if (!canAnimate) {
      commit();
      return;
    }

    pendingCommitTimerRef.current = window.setTimeout(commit, SELECTION_COMMIT_DELAY_MS);
  }

  return (
    <div className="overlay modal-overlay date-picker-overlay" onClick={handleClose}>
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

        <div
          className="mini-calendar-grid"
          aria-label="日付を選択"
          ref={calendarGridRef}
        >
          <span
            className={[
              'mini-calendar-selection-knob',
              selectionGeometry ? 'is-ready' : '',
              selectionMotionReady ? 'is-animated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={getSelectionStyle(selectionGeometry)}
            aria-hidden="true"
          />
          {weekdayLabels.map((label) => (
            <span key={label} className="mini-calendar-weekday">
              {label}
            </span>
          ))}
          {days.map(({ date, inCurrentMonth }) => {
            const isSelected = date === visualSelectedDate;
            const isToday = date === today;
            const tone = getCalendarDayTone(date);

            return (
              <button
                key={date}
                ref={(node) => {
                  if (node) {
                    dayButtonRefs.current.set(date, node);
                  } else {
                    dayButtonRefs.current.delete(date);
                  }
                }}
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
                onClick={() => handleSelectDate(date)}
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
          <button className="ghost-button" onClick={handleClose} type="button">
            閉じる
          </button>
          <button
            className="primary-button"
            onClick={() => handleSelectDate(today)}
            type="button"
          >
            今日
          </button>
        </div>
      </div>
    </div>
  );
}
