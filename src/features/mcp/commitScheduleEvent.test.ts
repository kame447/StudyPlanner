import { describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../../domain/scheduleOccurrence';
import { createLocalScheduleEventAuthority } from '../../repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../repositories/localStorageGateway';
import type { MonthEvent } from '../../types/domain';
import { createScheduleEventCommitter, type ScheduleEventCommitAudit } from './commitScheduleEvent';
import { createScheduleRangeReader } from './readScheduleRange';

const OWNER = 'owner-a';
const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
const candidate = { title: 'ゼミ', start: { date: '2026-11-09', time: '14:00' },
  end: { date: '2026-11-09', time: '15:00' }, timeZone: 'Asia/Tokyo' };
const input = { ...candidate, idempotencyKey: 'request-0001' };
const existing = (changes: Partial<MonthEvent> = {}): MonthEvent => ({ id: 'existing', userId: OWNER, title: '別の予定',
  date: candidate.start.date, startTime: '14:30', endTime: '16:00', repeat: 'none', repeatUntil: null, excludedDates: [],
  url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '', ...changes });

async function harness(events: MonthEvent[] = [], options: { dailyLimit?: number; now?: () => string; audit?: (entry: ScheduleEventCommitAudit) => void } = {}) {
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: key => { values.delete(key); }, clear: () => values.clear() };
  const authority = createLocalScheduleEventAuthority(createLocalPlannerStorageGateway(storage), storage);
  await authority.ensureMigrated(OWNER, async () => ({ plans: [], monthEvents: events }));
  const timetable = { getScheduleTemplates: async () => [], getTimetableTerms: async () => [] };
  const rawUpsert = authority.upsertMonthEvent.bind(authority);
  const rawSnapshot = authority.getScheduleSnapshot.bind(authority);
  const upsert = vi.spyOn(authority, 'upsertMonthEvent');
  const commit = createScheduleEventCommitter({ ownerId: OWNER, timeZone: candidate.timeZone, range, authority, timetable,
    now: () => '2026-11-08T00:00:00.000Z', audit: () => undefined, ...options });
  const read = createScheduleRangeReader({ ownerId: OWNER, timeZone: candidate.timeZone, authority, timetable });
  const day = () => read(OWNER, { startDate: candidate.start.date, endDate: candidate.start.date, timeZone: candidate.timeZone });
  return { authority, commit, upsert, rawUpsert, rawSnapshot, day, timetable, storage, values };
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

  describe('daily limit and audit', () => {
    const at = (iso: string) => ({ now: () => iso });
    const key = (n: number) => ({ ...input, idempotencyKey: `request-${String(n).padStart(4, '0')}`,
      start: { date: '2026-11-09', time: `${String(8 + n).padStart(2, '0')}:00` }, end: { date: '2026-11-09', time: `${String(8 + n).padStart(2, '0')}:30` } });

    it('saves up to the limit, then refuses without saving and says why', async () => {
      const h = await harness([], { dailyLimit: 2 });
      expect((await h.commit(OWNER, key(1))).status).toBe('saved');
      expect((await h.commit(OWNER, key(2))).status).toBe('saved');
      h.upsert.mockClear();
      await expect(h.commit(OWNER, key(3))).rejects.toMatchObject({ code: 'daily_limit_exceeded',
        message: expect.stringContaining('at most 2 events can be saved per day') });
      expect(h.upsert).not.toHaveBeenCalled();
      expect((await h.authority.getMonthEvents(OWNER)).filter(event => event.id.startsWith('mcp-'))).toHaveLength(2);
    });

    it('does not count a resend of an already saved event, even at the limit', async () => {
      const h = await harness([], { dailyLimit: 1 });
      await h.commit(OWNER, key(1));
      expect((await h.commit(OWNER, key(1))).status).toBe('already_saved');
      await expect(h.commit(OWNER, key(2))).rejects.toMatchObject({ code: 'daily_limit_exceeded' });
    });

    it('does not count events the owner made in the UI, nor rejected duplicates', async () => {
      const h = await harness([existing({ id: 'manual-1', title: '手動', startTime: '08:00', endTime: '08:10' })], { dailyLimit: 1 });
      expect((await h.commit(OWNER, key(1))).status).toBe('saved');
    });

    it('resets at the owner-local midnight, not UTC midnight (Asia/Tokyo)', async () => {
      // 2026-11-08T14:59Z is 23:59 in Tokyo; 15:00Z is already the next local day.
      let now = '2026-11-08T14:59:00.000Z';
      const h = await harness([], { dailyLimit: 1, now: () => now });
      await h.commit(OWNER, key(1));
      await expect(h.commit(OWNER, key(2))).rejects.toMatchObject({ code: 'daily_limit_exceeded' });
      now = '2026-11-08T15:00:00.000Z';
      expect((await h.commit(OWNER, key(2))).status).toBe('saved');
    });

    it('rejects an invalid limit instead of silently disabling it', async () => {
      await expect(harness([], { dailyLimit: 0 })).rejects.toMatchObject({ code: 'invalid_commit' });
      await expect(harness([], { dailyLimit: 1.5 })).rejects.toMatchObject({ code: 'invalid_commit' });
    });

    it('uses a default limit of 20', async () => {
      const h = await harness([], at('2026-11-08T00:00:00.000Z'));
      const keys = Array.from({ length: 21 }, (_, n) => ({ ...input, idempotencyKey: `request-${String(n).padStart(4, '0')}`,
        start: { date: '2026-11-09', time: `${String(Math.floor(n / 2)).padStart(2, '0')}:${n % 2 ? '30' : '00'}` },
        end: { date: '2026-11-09', time: `${String(Math.floor(n / 2)).padStart(2, '0')}:${n % 2 ? '59' : '29'}` } }));
      for (const request of keys.slice(0, 20)) expect((await h.commit(OWNER, request)).status).toBe('saved');
      await expect(h.commit(OWNER, keys[20])).rejects.toMatchObject({ code: 'daily_limit_exceeded' });
    });

    it('audits each attempt with ids, outcome, reason and time, and never the title, key or memo', async () => {
      const entries: ScheduleEventCommitAudit[] = [];
      const h = await harness([existing({ title: 'ゼミ', startTime: '09:00', endTime: '09:30', memo: 'secret memo' })],
        { dailyLimit: 1, audit: entry => entries.push(entry) });
      const saved = await h.commit(OWNER, key(2));
      await h.commit(OWNER, key(2));
      await expect(h.commit(OWNER, { ...key(1), title: 'ゼミ', start: { date: '2026-11-09', time: '09:00' }, end: { date: '2026-11-09', time: '09:30' } }))
        .rejects.toBeTruthy();
      await expect(h.commit(OWNER, key(3))).rejects.toMatchObject({ code: 'daily_limit_exceeded' });
      await expect(h.commit(OWNER, { ...input, idempotencyKey: 'x' })).rejects.toMatchObject({ code: 'invalid_commit' });
      await expect(h.commit('other', key(1))).rejects.toMatchObject({ code: 'owner_mismatch' });
      expect(entries.map(({ outcome, reason }) => [outcome, reason])).toEqual([['saved', 'saved'], ['duplicate', 'idempotent_resend'],
        ['duplicate', 'possible_duplicate'], ['rejected', 'daily_limit_exceeded'], ['rejected', 'invalid_commit'], ['rejected', 'owner_mismatch']]);
      expect(entries[0]).toEqual({ event: 'mcp_schedule_commit', ownerId: OWNER, eventId: saved.event.id, outcome: 'saved',
        reason: 'saved', at: '2026-11-08T00:00:00.000Z' });
      expect(entries[4].eventId).toBeNull();
      const text = JSON.stringify(entries);
      for (const secret of ['ゼミ', 'request-0002', 'secret memo', candidate.timeZone]) expect(text).not.toContain(secret);
    });

    it('a failing audit sink does not change or block the commit result', async () => {
      const h = await harness([], { audit: () => { throw new Error('sink down'); } });
      expect((await h.commit(OWNER, input)).status).toBe('saved');
      await expect(h.commit(OWNER, { ...input, idempotencyKey: 'bad key!' })).rejects.toMatchObject({ code: 'invalid_commit' });
    });

    it('writes the default audit line in the Worker log format without sensitive fields', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const h = await harness([], { audit: undefined });
      await h.commit(OWNER, input);
      expect(info).toHaveBeenCalledWith('[MCP Schedule Commit] audit', expect.objectContaining({ outcome: 'saved', ownerId: OWNER }));
      expect(JSON.stringify(info.mock.calls)).not.toContain('ゼミ');
      info.mockRestore();
    });

    it('does not exceed the limit when commits run concurrently, even with slow reads and writes', async () => {
      const h = await harness([], { dailyLimit: 2 });
      const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      h.upsert.mockImplementation(async event => { await pause(20); return h.rawUpsert(event); });
      vi.spyOn(h.authority, 'getScheduleSnapshot').mockImplementation(async owner => { await pause(1); return h.rawSnapshot(owner); });
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map(n => h.commit(OWNER, key(n))));
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(2);
      expect(results.filter(item => item.status === 'rejected' && (item.reason as { code: string }).code === 'daily_limit_exceeded')).toHaveLength(3);
      expect((await h.authority.getMonthEvents(OWNER)).filter(event => event.id.startsWith('mcp-'))).toHaveLength(2);
    });

    it('saves a concurrently resent request once, and a failed commit does not block the next one', async () => {
      const h = await harness();
      const results = await Promise.all([h.commit(OWNER, input), h.commit(OWNER, input)]);
      expect(results.map(item => item.status).sort()).toEqual(['already_saved', 'saved']);
      expect(h.upsert).toHaveBeenCalledTimes(1);
      await expect(h.commit(OWNER, { ...input, idempotencyKey: 'bad key!' })).rejects.toMatchObject({ code: 'invalid_commit' });
      expect((await h.commit(OWNER, key(2))).status).toBe('saved');
    });
  });
});
