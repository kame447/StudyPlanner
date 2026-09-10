import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrence,
} from '../domain/scheduleOccurrence';
import { addDays } from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRangeForDate,
  sortMonthEvents,
} from '../lib/monthEvents';
import type {
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';

const ACCENT_CLASSES = ['mint', 'violet', 'blue', 'amber', 'pink'];
const WEEKDAY_LABELS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const CLOSE_ANIMATION_MS = 280;

function formatHeading(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

interface MonthDaySheetProps {
  openDate: string | null;
  userId?: string;
  plans?: Plan[];
  monthEvents: MonthEvent[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  onCreate: (date: string) => void;
  onEdit: (event: MonthEvent) => void;
  onOpenDay?: (date: string) => void;
  onClose: () => void;
}

interface MonthDaySheetEntry {
  id: string;
  title: string;
  timeLabel: string;
  monthEvent: MonthEvent | null;
  openDayBacked: boolean;
}

function formatOccurrenceTimeForDate(
  occurrence: ScheduleOccurrence,
  date: string,
): string {
  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDays(date, 1)}T00:00`;
  const occurrenceStart = `${occurrence.start.date}T${occurrence.start.time}`;
  const occurrenceEnd = `${occurrence.end.date}T${occurrence.end.time}`;

  if (occurrenceEnd <= dayStart || occurrenceStart >= dayEnd) {
    return '';
  }

  const startTime = occurrence.start.date === date ? occurrence.start.time : '00:00';
  const endTime = occurrence.end.date === date ? occurrence.end.time : '24:00';
  if (startTime === '00:00' && endTime === '24:00') return '終日';
  if (startTime === '00:00') return `〜${endTime}`;
  if (endTime === '24:00') return `${startTime}〜`;
  return `${startTime}-${endTime}`;
}

function buildEntries(params: {
  renderedDate: string;
  userId?: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms: TimetableTerm[];
}): MonthDaySheetEntry[] {
  const ownerId = params.userId?.trim();
  if (!ownerId) {
    return sortMonthEvents(
      params.monthEvents.filter((event) =>
        doesMonthEventOccurOnDate(event, params.renderedDate),
      ),
    ).map((event) => ({
      id: event.id,
      title: event.title,
      timeLabel: formatMonthEventTimeRangeForDate(event, params.renderedDate),
      monthEvent: event,
      openDayBacked: false,
    }));
  }

  const monthEventById = new Map(
    params.monthEvents.map((event) => [event.id, event]),
  );
  const projection = createScheduleOccurrenceProjection({
    ownerId,
    startDate: params.renderedDate,
    endDate: params.renderedDate,
    plans: params.plans,
    monthEvents: params.monthEvents,
    scheduleTemplates: params.scheduleTemplates,
    timetableTermId: params.timetableTermId,
    timetableTerm: params.timetableTerm,
    timetableTerms: params.timetableTerms,
  });

  return projection.occurrences
    .filter((occurrence) => occurrence.category !== 'study')
    .map((occurrence): MonthDaySheetEntry | null => {
      if (occurrence.source.backingKind === 'month-event') {
        const monthEvent = monthEventById.get(occurrence.source.backingId);
        if (!monthEvent) return null;
        return {
          id: occurrence.id,
          title: occurrence.title,
          timeLabel: formatOccurrenceTimeForDate(occurrence, params.renderedDate),
          monthEvent,
          openDayBacked: false,
        };
      }

      if (
        occurrence.source.backingKind === 'plan' ||
        occurrence.source.backingKind === 'timetable-template'
      ) {
        return {
          id: occurrence.id,
          title: occurrence.title,
          timeLabel: formatOccurrenceTimeForDate(occurrence, params.renderedDate),
          monthEvent: null,
          openDayBacked: true,
        };
      }

      return null;
    })
    .filter((entry): entry is MonthDaySheetEntry => Boolean(entry))
    .sort((left, right) =>
      left.timeLabel.localeCompare(right.timeLabel) ||
      left.title.localeCompare(right.title, 'ja'),
    );
}

export function MonthDaySheet({
  openDate,
  userId,
  plans = [],
  monthEvents,
  scheduleTemplates = [],
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  onCreate,
  onEdit,
  onOpenDay,
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

  const entries = useMemo(
    () =>
      renderedDate
        ? buildEntries({
            renderedDate,
            userId,
            plans,
            monthEvents,
            scheduleTemplates,
            timetableTermId,
            timetableTerm,
            timetableTerms,
          })
        : [],
    [
      monthEvents,
      plans,
      renderedDate,
      scheduleTemplates,
      timetableTerm,
      timetableTermId,
      timetableTerms,
      userId,
    ],
  );

  if (!renderedDate) return null;

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
          {entries.length > 0 ? (
            entries.map((entry, index) => (
              <button
                className={`month-day-sheet-event ${ACCENT_CLASSES[index % ACCENT_CLASSES.length]}`}
                key={entry.id}
                onClick={() => {
                  if (entry.monthEvent) {
                    onEdit(entry.monthEvent);
                    return;
                  }
                  if (entry.openDayBacked) {
                    onOpenDay?.(renderedDate);
                  }
                }}
                type="button"
                disabled={isClosing}
              >
                <span className="month-day-sheet-time">
                  <strong>{entry.timeLabel}</strong>
                </span>
                <span className="month-day-sheet-bar" aria-hidden="true" />
                <strong className="month-day-sheet-title">{entry.title}</strong>
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
