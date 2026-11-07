import { createScheduleOccurrenceProjection, type ScheduleOccurrence } from '../../domain/scheduleOccurrence';
import type { PlannerRepository } from '../../repositories/repositoryContracts';
import type { ScheduleEventAuthorityRepository } from '../../repositories/scheduleEventAuthorityRepository';

export interface ScheduleRangeInput {
  startDate: string;
  endDate: string;
  timeZone: string;
}

export type ScheduleRangeItem = Pick<ScheduleOccurrence, 'id' | 'title' | 'subject' | 'category' | 'busy' | 'start' | 'end'>;
export interface ScheduleRangeResult extends ScheduleRangeInput { occurrences: ScheduleRangeItem[] }
export type ReadScheduleRange = (actorOwnerId: string, input: unknown) => Promise<ScheduleRangeResult>;

export class ScheduleRangeReadError extends Error {
  constructor(readonly code: 'owner_mismatch' | 'invalid_range' | 'invalid_time_zone' | 'time_zone_mismatch' | 'source_unavailable') {
    super(code);
    this.name = 'ScheduleRangeReadError';
  }
}

function canonicalTimeZone(value: string): string {
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new ScheduleRangeReadError('invalid_time_zone'); }
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A capability for an already-admitted canonical owner; never pass the migration-triggering UI facade. */
export function createScheduleRangeReader(source: {
  ownerId: string;
  timeZone: string;
  authority: Pick<ScheduleEventAuthorityRepository, 'getScheduleSnapshot'>;
  timetable: Pick<PlannerRepository, 'getScheduleTemplates' | 'getTimetableTerms'>;
}): ReadScheduleRange {
  const timeZone = canonicalTimeZone(source.timeZone);
  return async (actorOwnerId, input) => {
    if (!actorOwnerId || actorOwnerId !== source.ownerId) throw new ScheduleRangeReadError('owner_mismatch');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ScheduleRangeReadError('invalid_range');
    const query = input as Record<string, unknown>;
    if (Object.keys(query).length !== 3 || Object.keys(query).some(key => !['startDate', 'endDate', 'timeZone'].includes(key))
      || !calendarDate(query.startDate) || !calendarDate(query.endDate) || query.startDate > query.endDate) {
      throw new ScheduleRangeReadError('invalid_range');
    }
    if (typeof query.timeZone !== 'string') throw new ScheduleRangeReadError('invalid_time_zone');
    if (canonicalTimeZone(query.timeZone) !== timeZone) throw new ScheduleRangeReadError('time_zone_mismatch');
    const [snapshot, scheduleTemplates, timetableTerms] = await Promise.all([
      source.authority.getScheduleSnapshot(actorOwnerId),
      source.timetable.getScheduleTemplates(actorOwnerId), source.timetable.getTimetableTerms(actorOwnerId),
    ]);
    // Repository identity is a distinct trust boundary. Never silently omit foreign records and report partial success.
    if ([...snapshot.plans, ...snapshot.monthEvents, ...scheduleTemplates, ...timetableTerms]
      .some(record => record.userId !== actorOwnerId)) throw new ScheduleRangeReadError('owner_mismatch');
    const projection = createScheduleOccurrenceProjection({ ownerId: actorOwnerId,
      startDate: query.startDate, endDate: query.endDate, ...snapshot, scheduleTemplates, timetableTerms });
    if (projection.issues.length) throw new ScheduleRangeReadError('source_unavailable');
    return { startDate: query.startDate, endDate: query.endDate, timeZone,
      occurrences: projection.occurrences.map(({ id, title, subject, category, busy, start, end }) =>
        ({ id, title, subject, category, busy, start, end })) };
  };
}
