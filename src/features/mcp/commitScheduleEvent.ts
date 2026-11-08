import type { MonthEvent } from '../../types/domain';
import type { ScheduleEventAuthorityRepository } from '../../repositories/scheduleEventAuthorityRepository';
import { ScheduleEventPrepareError, createScheduleEventPreparer, type PrepareScheduleEvent, type ScheduleEventPreview } from './prepareScheduleEvent';
import { ScheduleRangeReadError, canonicalScheduleTimeZone } from './readScheduleRange';

export type CommitScheduleEventResult = {
  status: 'saved' | 'already_saved';
  ownerId: string;
  timeZone: string;
  event: Pick<MonthEvent, 'id' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime'>;
};
export type CommitScheduleEvent = (actorOwnerId: string, input: unknown) => Promise<CommitScheduleEventResult>;

export type ScheduleEventCommitErrorCode = 'invalid_commit' | 'idempotency_conflict' | 'possible_duplicate'
  | 'time_overlap' | 'daily_limit_exceeded' | 'save_outcome_unknown';
export class ScheduleEventCommitError extends Error {
  constructor(readonly code: ScheduleEventCommitErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ScheduleEventCommitError';
  }
}

/** One line per commit attempt. Identifiers and a reason only: never the title, memo, key or any credential. */
export interface ScheduleEventCommitAudit {
  event: 'mcp_schedule_commit';
  ownerId: string;
  /** null while the request was rejected before an event id existed (malformed input, owner mismatch). */
  eventId: string | null;
  outcome: 'saved' | 'duplicate' | 'rejected';
  reason: string;
  at: string;
}
/** Matches the Worker's `[Tag] message` + structured-fields console format. */
export const logScheduleEventCommitAudit = (entry: ScheduleEventCommitAudit) => console.info('[MCP Schedule Commit] audit', entry);
/** A person saves a handful of events a day by chat; this bounds a runaway agent to a small, reviewable batch. */
export const DEFAULT_MCP_COMMIT_DAILY_LIMIT = 20;

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
  /** Saved events per owner-local day; resends of an already saved event are not counted. */
  dailyLimit?: number;
  /** A failing sink never changes the commit result. */
  audit?: (entry: ScheduleEventCommitAudit) => void;
}): CommitScheduleEvent {
  const limit = source.dailyLimit ?? DEFAULT_MCP_COMMIT_DAILY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new ScheduleEventCommitError('invalid_commit', 'dailyLimit must be a positive integer');
  const zone = canonicalScheduleTimeZone(source.timeZone);
  const localDay = (iso: string) => {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(time) : null;
  };
  const audit = source.audit ?? logScheduleEventCommitAudit;
  const prepare: PrepareScheduleEvent = createScheduleEventPreparer(source);
  const find = async (id: string) => (await source.authority.getScheduleSnapshot(source.ownerId))
    .monthEvents.find(event => event.id === id && event.userId === source.ownerId);
  const commit = async (actorOwnerId: string, input: unknown, context: { eventId: string | null; reason: string }) => {
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
    context.eventId = wanted.id;
    const result = (status: CommitScheduleEventResult['status']): CommitScheduleEventResult => ({ status,
      ownerId: actorOwnerId, timeZone: preview.timeZone, event: { id: wanted.id, title: wanted.title, date: wanted.date,
        endDate: wanted.endDate, startTime: wanted.startTime, endTime: wanted.endTime } });
    const existing = await find(wanted.id);
    if (existing) {
      if (!sameEvent(existing, wanted)) throw new ScheduleEventCommitError('idempotency_conflict');
      context.reason = 'idempotent_resend';
      return result('already_saved');
    }
    if (preview.overlaps.some(item => item.kind === 'possible_duplicate')) throw new ScheduleEventCommitError('possible_duplicate');
    if (preview.overlaps.length && acceptOverlaps !== true) throw new ScheduleEventCommitError('time_overlap');
    // Counted from this owner's already saved MCP events in canonical state (no new store); after the resend and
    // duplicate checks above, so neither of those consumes the allowance.
    const today = localDay(now);
    const savedToday = (await source.authority.getScheduleSnapshot(actorOwnerId)).monthEvents
      .filter(event => event.userId === actorOwnerId && event.id.startsWith('mcp-') && localDay(event.createdAt) === today).length;
    if (savedToday >= limit) {
      throw new ScheduleEventCommitError('daily_limit_exceeded',
        `at most ${limit} events can be saved per day (owner time zone ${zone}); nothing was saved, try again tomorrow`);
    }
    let saved: MonthEvent | undefined;
    try {
      await source.authority.upsertMonthEvent(wanted);
      saved = await find(wanted.id);
    } catch {
      // A failed write may still have landed, and a failed read-back proves nothing; report neither as saved.
      try { saved = await find(wanted.id); } catch { saved = undefined; }
    }
    if (!saved || !sameEvent(saved, wanted)) throw new ScheduleEventCommitError('save_outcome_unknown');
    context.reason = 'saved';
    return result('saved');
  };
  return async (actorOwnerId, input) => {
    const context = { eventId: null as string | null, reason: 'unknown_error' };
    const emit = (outcome: ScheduleEventCommitAudit['outcome']) => {
      try { audit({ event: 'mcp_schedule_commit', ownerId: actorOwnerId, eventId: context.eventId, outcome, reason: context.reason, at: source.now() }); }
      catch { /* auditing must not alter or block the commit result */ }
    };
    try {
      const result = await commit(actorOwnerId, input, context);
      emit(result.status === 'saved' ? 'saved' : 'duplicate');
      return result;
    } catch (error) {
      context.reason = error instanceof ScheduleEventCommitError ? error.code
        : error instanceof ScheduleRangeReadError || error instanceof ScheduleEventPrepareError ? error.code : 'save_unavailable';
      emit(context.reason === 'possible_duplicate' ? 'duplicate' : 'rejected');
      throw error;
    }
  };
}
