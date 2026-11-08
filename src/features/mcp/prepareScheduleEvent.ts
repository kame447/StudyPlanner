import type { ScheduleEvent } from '../../domain/scheduleEvent';
import type { ScheduleOccurrencePoint } from '../../domain/scheduleOccurrence';
import { addDays } from '../../lib/date';
import { canonicalScheduleTimeZone, createScheduleRangeReader, isScheduleCalendarDate,
  ScheduleRangeReadError, type ScheduleRangeItem } from './readScheduleRange';

/** Longest title a single prepared or committed event may carry (UTF-16 code units, as `String.length`). */
export const MAX_SCHEDULE_EVENT_TITLE_LENGTH = 200;
export interface PrepareScheduleEventInput {
  title: string;
  start: ScheduleOccurrencePoint;
  end: ScheduleOccurrencePoint;
  timeZone: string;
}
export interface ScheduleEventPreview {
  status: 'unsaved_preview';
  ownerId: string;
  timeZone: string;
  event: Pick<ScheduleEvent, 'kind' | 'category' | 'busy' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime'>;
  overlaps: { kind: 'possible_duplicate' | 'time_overlap'; occurrence: ScheduleRangeItem }[];
}
export type PrepareScheduleEvent = (actorOwnerId: string, input: unknown) => Promise<ScheduleEventPreview>;

export class ScheduleEventPrepareError extends Error {
  constructor(readonly code: 'invalid_event' | 'out_of_range') {
    super(code);
    this.name = 'ScheduleEventPrepareError';
  }
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function point(value: unknown): value is ScheduleOccurrencePoint {
  return exactObject(value, ['date', 'time']) && isScheduleCalendarDate(value.date)
    && typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value.time);
}
const pointKey = (value: ScheduleOccurrencePoint) => `${value.date}T${value.time}`;

/** Stateless confirmation data only. No persistence port, preview token, approval or save authority. */
export function createScheduleEventPreparer(source: Parameters<typeof createScheduleRangeReader>[0] & {
  /** Trusted composition supplies its supported calendar period, not a caller-controlled permission. */
  range: { startDate: string; endDate: string };
}): PrepareScheduleEvent {
  const { startDate, endDate } = source.range;
  if (!isScheduleCalendarDate(startDate) || !isScheduleCalendarDate(endDate) || startDate > endDate) {
    throw new ScheduleRangeReadError('invalid_range');
  }
  const ownerId = source.ownerId;
  const timeZone = canonicalScheduleTimeZone(source.timeZone);
  const read = createScheduleRangeReader(source);
  const rangeStart = `${startDate}T00:00`;
  const rangeEnd = `${addDays(endDate, 1)}T00:00`;
  return async (actorOwnerId, input) => {
    if (!actorOwnerId || actorOwnerId !== ownerId) throw new ScheduleRangeReadError('owner_mismatch');
    if (!exactObject(input, ['title', 'start', 'end', 'timeZone']) || typeof input.title !== 'string'
      || !input.title.trim() || input.title.length > MAX_SCHEDULE_EVENT_TITLE_LENGTH || !point(input.start) || !point(input.end)
      || pointKey(input.start) >= pointKey(input.end)) throw new ScheduleEventPrepareError('invalid_event');
    if (typeof input.timeZone !== 'string') throw new ScheduleRangeReadError('invalid_time_zone');
    if (canonicalScheduleTimeZone(input.timeZone) !== timeZone) throw new ScheduleRangeReadError('time_zone_mismatch');
    if (pointKey(input.start) < rangeStart || pointKey(input.end) > rangeEnd) {
      throw new ScheduleEventPrepareError('out_of_range');
    }
    const { start, end, title } = input;
    // Use the same owner/authority/recurrence/timetable truth as read_schedule_range and the UI.
    const snapshot = await read(actorOwnerId, { startDate: start.date,
      endDate: end.time === '00:00' ? addDays(end.date, -1) : end.date, timeZone });
    const overlaps = snapshot.occurrences
      .filter(item => pointKey(item.start) < pointKey(end) && pointKey(item.end) > pointKey(start))
      .map(occurrence => ({ kind: occurrence.title === title
          && pointKey(occurrence.start) === pointKey(start) && pointKey(occurrence.end) === pointKey(end)
        ? 'possible_duplicate' as const : 'time_overlap' as const, occurrence }));
    return { status: 'unsaved_preview', ownerId, timeZone,
      event: { kind: 'general', category: 'other', busy: true, title,
        date: start.date, endDate: end.date, startTime: start.time, endTime: end.time }, overlaps };
  };
}
