import { describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../../domain/scheduleOccurrence';
import { createLocalScheduleEventAuthority } from '../../repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../repositories/localStorageGateway';
import type { MonthEvent } from '../../types/domain';
import { createScheduleEventCommitter } from './commitScheduleEvent';
import { createScheduleRangeReader } from './readScheduleRange';

const OWNER = 'owner-a';
const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
const candidate = { title: 'ゼミ', start: { date: '2026-11-09', time: '14:00' },
  end: { date: '2026-11-09', time: '15:00' }, timeZone: 'Asia/Tokyo' };
const input = { ...candidate, idempotencyKey: 'request-0001' };
const existing = (changes: Partial<MonthEvent> = {}): MonthEvent => ({ id: 'existing', userId: OWNER, title: '別の予定',
  date: candidate.start.date, startTime: '14:30', endTime: '16:00', repeat: 'none', repeatUntil: null, excludedDates: [],
  url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '', ...changes });

async function harness(events: MonthEvent[] = []) {
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: key => { values.delete(key); }, clear: () => values.clear() };
  const authority = createLocalScheduleEventAuthority(createLocalPlannerStorageGateway(storage), storage);
  await authority.ensureMigrated(OWNER, async () => ({ plans: [], monthEvents: events }));
  const timetable = { getScheduleTemplates: async () => [], getTimetableTerms: async () => [] };
  const upsert = vi.spyOn(authority, 'upsertMonthEvent');
  const commit = createScheduleEventCommitter({ ownerId: OWNER, timeZone: candidate.timeZone, range, authority, timetable,
    now: () => '2026-11-08T00:00:00.000Z' });
  const read = createScheduleRangeReader({ ownerId: OWNER, timeZone: candidate.timeZone, authority, timetable });
  const day = () => read(OWNER, { startDate: candidate.start.date, endDate: candidate.start.date, timeZone: candidate.timeZone });
  return { authority, commit, upsert, day, timetable, storage, values };
}

describe('commit_schedule_event application adapter', () => {
  it('saves through the existing authority write and the same canonical read shows it, as the UI projection does', async () => {
    const h = await harness();
    expect((await h.day()).occurrences).toEqual([]);
    const result = await h.commit(OWNER, input);
    expect(result).toMatchObject({ status: 'saved', ownerId: OWNER, event: { title: 'ゼミ', date: '2026-11-09', startTime: '14:00', endTime: '15:00' } });
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const after = await h.day();
    expect(after.occurrences).toMatchObject([{ title: 'ゼミ', start: candidate.start, end: candidate.end, busy: true }]);
    const snapshot = await h.authority.getScheduleSnapshot(OWNER);
    const projection = createScheduleOccurrenceProjection({ ownerId: OWNER, ...range, ...snapshot, scheduleTemplates: [], timetableTerms: [] });
    expect(projection.occurrences.filter(item => item.title === 'ゼミ')).toHaveLength(1);
  });

  it('is idempotent: a resend, even after another device edited nothing else, does not add or rewrite the event', async () => {
    const h = await harness();
    const first = await h.commit(OWNER, input);
    const again = await h.commit(OWNER, input);
    expect(again).toMatchObject({ status: 'already_saved', event: first.event });
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect((await h.authority.getMonthEvents(OWNER)).filter(event => event.title === 'ゼミ')).toHaveLength(1);
  });

  it('does not overwrite a later edit when the same request is resent', async () => {
    const h = await harness();
    const first = await h.commit(OWNER, input);
    const saved = (await h.authority.getMonthEvents(OWNER)).find(event => event.id === first.event.id)!;
    await h.authority.upsertMonthEvent({ ...saved, memo: 'edited in the UI', updatedAt: 'later' });
    h.upsert.mockClear();
    expect((await h.commit(OWNER, input)).status).toBe('already_saved');
    expect(h.upsert).not.toHaveBeenCalled();
    expect((await h.authority.getMonthEvents(OWNER)).find(event => event.id === first.event.id)?.memo).toBe('edited in the UI');
  });

  it('refuses a key reused for a different event', async () => {
    const h = await harness();
    await h.commit(OWNER, input);
    await expect(h.commit(OWNER, { ...input, start: { date: '2026-11-09', time: '16:00' }, end: { date: '2026-11-09', time: '17:00' } }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect((await h.authority.getMonthEvents(OWNER)).filter(event => event.title === 'ゼミ')).toHaveLength(1);
  });

  it('re-checks canonical state at commit: duplicates never save, overlaps need explicit acceptance', async () => {
    const duplicate = await harness([existing({ title: 'ゼミ', startTime: '14:00', endTime: '15:00' })]);
    await expect(duplicate.commit(OWNER, { ...input, acceptOverlaps: true })).rejects.toMatchObject({ code: 'possible_duplicate' });
    expect(duplicate.upsert).not.toHaveBeenCalled();
    const overlap = await harness([existing()]);
    await expect(overlap.commit(OWNER, input)).rejects.toMatchObject({ code: 'time_overlap' });
    expect(overlap.upsert).not.toHaveBeenCalled();
    expect((await overlap.commit(OWNER, { ...input, acceptOverlaps: true })).status).toBe('saved');
    expect((await overlap.day()).occurrences).toHaveLength(2);
  });

  it('sees an event another device added after prepare (no cached approval)', async () => {
    const h = await harness();
    await h.authority.upsertMonthEvent(existing({ title: 'ゼミ', startTime: '14:00', endTime: '15:00' }));
    await expect(h.commit(OWNER, input)).rejects.toMatchObject({ code: 'possible_duplicate' });
  });

  it('rejects other owners and foreign data before any write, and does not save out of the allowed period or in another zone', async () => {
    const h = await harness();
    await expect(h.commit('other', input)).rejects.toMatchObject({ code: 'owner_mismatch' });
    await expect(h.commit(OWNER, { ...input, start: { date: '2026-10-31', time: '23:00' } })).rejects.toMatchObject({ code: 'out_of_range' });
    await expect(h.commit(OWNER, { ...input, timeZone: 'America/New_York' })).rejects.toMatchObject({ code: 'time_zone_mismatch' });
    const upsert = vi.fn();
    const foreign = createScheduleEventCommitter({ ownerId: OWNER, timeZone: candidate.timeZone, range, now: () => '',
      authority: { getScheduleSnapshot: async () => ({ plans: [], monthEvents: [existing({ userId: 'foreign' })] }), upsertMonthEvent: upsert },
      timetable: h.timetable });
    await expect(foreign(OWNER, input)).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(h.upsert).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
  });

  it.each([null, [], { ...input, idempotencyKey: undefined }, { ...input, idempotencyKey: 'short' }, { ...input, idempotencyKey: 'has space in key' },
    { ...input, acceptOverlaps: 'yes' }, { ...input, ownerId: 'other' }, { ...input, id: 'chosen-id' }, { ...input, revision: 1 },
  ])('rejects a malformed or authority-bearing request before reads or writes: %j', async bad => {
    const h = await harness();
    await expect(h.commit(OWNER, bad)).rejects.toMatchObject({ code: 'invalid_commit' });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('never reports saved when the write fails and the event is absent; a retry with the same key then saves once', async () => {
    const h = await harness();
    h.upsert.mockRejectedValueOnce(new Error('network'));
    await expect(h.commit(OWNER, input)).rejects.toMatchObject({ code: 'save_outcome_unknown' });
    expect((await h.day()).occurrences).toEqual([]);
    expect((await h.commit(OWNER, input)).status).toBe('saved');
    expect((await h.authority.getMonthEvents(OWNER)).filter(event => event.title === 'ゼミ')).toHaveLength(1);
  });

  it('resolves a write whose response was lost: the event landed, the retry reports already_saved without a second write', async () => {
    const h = await harness();
    const real = h.authority.upsertMonthEvent.bind(h.authority);
    h.upsert.mockImplementationOnce(async event => { await real(event); throw new Error('response lost'); });
    // The write landed, so the verified read-back (not the thrown error) decides the result.
    expect((await h.commit(OWNER, input)).status).toBe('saved');
    h.upsert.mockClear();
    expect((await h.commit(OWNER, input)).status).toBe('already_saved');
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('does not claim saved when the read-back is unavailable', async () => {
    const h = await harness();
    const read = vi.spyOn(h.authority, 'getScheduleSnapshot');
    h.upsert.mockImplementationOnce(async event => {
      read.mockRejectedValue(new Error('read failed')); return event;
    });
    await expect(h.commit(OWNER, input)).rejects.toMatchObject({ code: 'save_outcome_unknown' });
  });
});
