import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';
import type { MonthEvent } from '../types/domain';

const ACCENT_CLASSES = ['mint', 'violet', 'blue', 'amber', 'pink'];
const WEEKDAY_LABELS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const CLOSE_ANIMATION_MS = 280;

function formatHeading(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

function isAllDay(event: MonthEvent): boolean {
  return event.startTime === '00:00' && (event.endTime === '24:00' || event.endTime === '23:59');
}

interface MonthDaySheetProps {
  openDate: string | null;
  monthEvents: MonthEvent[];
  onCreate: (date: string) => void;
  onEdit: (event: MonthEvent) => void;
  onClose: () => void;
}

export function MonthDaySheet({
  openDate,
  monthEvents,
  onCreate,
  onEdit,
  onClose,
}: MonthDaySheetProps) {
  const [renderedDate, setRenderedDate] = useState<string | null>(openDate);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (openDate) {
      setRenderedDate(openDate);
      setIsClosing(false);
      return;
    }

    if (!renderedDate) return;

    setIsClosing(true);
    const closeTimer = setTimeout(() => {
      setRenderedDate(null);
      setIsClosing(false);
    }, CLOSE_ANIMATION_MS);

    return () => clearTimeout(closeTimer);
  }, [openDate, renderedDate]);

  if (!renderedDate) return null;

  const events = sortMonthEvents(
    monthEvents.filter((event) => doesMonthEventOccurOnDate(event, renderedDate)),
  );
  const sheetState = isClosing ? 'is-closing' : 'is-open';

  return (
    <div
      className={`overlay month-day-sheet-overlay ${sheetState}`}
      data-state={isClosing ? 'closing' : 'open'}
      onClick={isClosing ? undefined : onClose}
    >
      <section
        className="month-day-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${formatHeading(renderedDate)}の予定`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="month-day-sheet-handle" aria-hidden="true" />
        <header className="month-day-sheet-header">
          <button
            className="month-day-sheet-close"
            onClick={onClose}
            type="button"
            aria-label="閉じる"
            disabled={isClosing}
          >
            <X aria-hidden="true" size={21} />
          </button>
          <h2>{formatHeading(renderedDate)}</h2>
          <button
            className="month-day-sheet-add"
            onClick={() => onCreate(renderedDate)}
            type="button"
            aria-label="予定を追加"
            disabled={isClosing}
          >
            <Plus aria-hidden="true" size={28} />
          </button>
        </header>

        <div className="month-day-sheet-list">
          {events.length > 0 ? (
            events.map((event, index) => (
              <button
                className={`month-day-sheet-event ${ACCENT_CLASSES[index % ACCENT_CLASSES.length]}`}
                key={event.id}
                onClick={() => onEdit(event)}
                type="button"
                disabled={isClosing}
              >
                <span className="month-day-sheet-time">
                  {isAllDay(event) ? (
                    <strong>終日</strong>
                  ) : (
                    <>
                      <strong>{event.startTime}</strong>
                      <small>{event.endTime}</small>
                    </>
                  )}
                </span>
                <span className="month-day-sheet-bar" aria-hidden="true" />
                <strong className="month-day-sheet-title">{event.title}</strong>
              </button>
            ))
          ) : (
            <button
              className="month-day-sheet-empty"
              onClick={() => onCreate(renderedDate)}
              type="button"
              disabled={isClosing}
            >
              この日の予定はありません。タップして追加
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
