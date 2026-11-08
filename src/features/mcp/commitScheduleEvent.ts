import type { MonthEvent } from '../../types/domain';
import type { ScheduleEventAuthorityRepository } from '../../repositories/scheduleEventAuthorityRepository';
import { createScheduleEventPreparer, type PrepareScheduleEvent, type ScheduleEventPreview } from './prepareScheduleEvent';
import { ScheduleRangeReadError } from './readScheduleRange';

export type CommitScheduleEventResult = {
  status: 'saved' | 'already_saved';
  ownerId: string;
  timeZone: string;
  event: Pick<MonthEvent, 'id' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime'>;
};
export type CommitScheduleEvent = (actorOwnerId: string, input: unknown) => Promise<CommitScheduleEventResult>;

export class ScheduleEventCommitError extends Error {
  constructor(readonly code: 'invalid_commit' | 'idempotency_conflict' | 'possible_duplicate' | 'time_overlap' | 'save_outcome_unknown') {
    super(code);
    this.name = 'ScheduleEventCommitError';
  }
}

const KEY = /^[A-Za-z0-9._:-]{8,128}$/u;
const FIELDS = ['title', 'start', 'end', 'timeZone', 'idempotencyKey'];

async function eventId(ownerId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ownerId}\n${key}`));
  return `mcp-${[...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
const sameEvent = (saved: MonthEvent, wanted: MonthEvent) => saved.userId === wanted.userId && saved.title === wanted.title
  && saved.date === wanted.date && (saved.endDate ?? saved.date) === wanted.endDate
  && saved.startTime === wanted.startTime && saved.endTime === wanted.endTime && saved.repeat === 'none';

/**
 * Saves one general event through the existing ScheduleEvent authority write (the path the UI uses).
 * The prepare result is never trusted: every call re-reads canonical state for duplicates and overlaps.
 * The client's idempotency key fixes the event id, so a resend finds its own record instead of adding another.
 * "saved" is reported only after the event is read back; an unverifiable outcome is never reported as saved.
 */
export function createScheduleEventCommitter(source: Parameters<typeof createScheduleEventPreparer>[0] & {
  authority: Pick<ScheduleEventAuthorityRepository, 'getScheduleSnapshot' | 'upsertMonthEvent'>;
  now: () => string;
}): CommitScheduleEvent {
  const prepare: PrepareScheduleEvent = createScheduleEventPreparer(source);
  const find = async (id: string) => (await source.authority.getScheduleSnapshot(source.ownerId))
    .monthEvents.find(event => event.id === id && event.userId === source.ownerId);
  return async (actorOwnerId, input) => {
    if (!actorOwnerId || actorOwnerId !== source.ownerId) throw new ScheduleRangeReadError('owner_mismatch');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ScheduleEventCommitError('invalid_commit');
    const { idempotencyKey, acceptOverlaps, ...candidate } = input as Record<string, unknown>;
    if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)
      || (acceptOverlaps !== undefined && typeof acceptOverlaps !== 'boolean')
      || Object.keys(input).some(key => ![...FIELDS, 'acceptOverlaps'].includes(key))) {
      throw new ScheduleEventCommitError('invalid_commit');
    }
    // Validates the candidate and reads current canonical state; the result is only a fresh check, not authority.
    const preview: ScheduleEventPreview = await prepare(actorOwnerId, candidate);
    const now = source.now();
    const wanted: MonthEvent = { id: await eventId(actorOwnerId, idempotencyKey), userId: actorOwnerId,
      title: preview.event.title, date: preview.event.date, endDate: preview.event.endDate,
      startTime: preview.event.startTime, endTime: preview.event.endTime, repeat: 'none', repeatUntil: null,
      excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now };
    const result = (status: CommitScheduleEventResult['status']): CommitScheduleEventResult => ({ status,
      ownerId: actorOwnerId, timeZone: preview.timeZone, event: { id: wanted.id, title: wanted.title, date: wanted.date,
        endDate: wanted.endDate, startTime: wanted.startTime, endTime: wanted.endTime } });
    const existing = await find(wanted.id);
    if (existing) {
      if (!sameEvent(existing, wanted)) throw new ScheduleEventCommitError('idempotency_conflict');
      return result('already_saved');
    }
    if (preview.overlaps.some(item => item.kind === 'possible_duplicate')) throw new ScheduleEventCommitError('possible_duplicate');
    if (preview.overlaps.length && acceptOverlaps !== true) throw new ScheduleEventCommitError('time_overlap');
    let saved: MonthEvent | undefined;
    try {
      await source.authority.upsertMonthEvent(wanted);
      saved = await find(wanted.id);
    } catch {
      // A failed write may still have landed, and a failed read-back proves nothing; report neither as saved.
      try { saved = await find(wanted.id); } catch { saved = undefined; }
    }
    if (!saved || !sameEvent(saved, wanted)) throw new ScheduleEventCommitError('save_outcome_unknown');
    return result('saved');
  };
}
