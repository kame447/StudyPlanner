import { describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../../domain/scheduleOccurrence';
import { scheduleEventFromMonthEvent, scheduleEventToMonthEvent } from '../../domain/scheduleEvent';
import { createLocalScheduleEventAuthority } from '../../repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../repositories/localStorageGateway';
import type { MonthEvent, Plan } from '../../types/domain';
import { createScheduleEventPreparer } from './prepareScheduleEvent';

const OWNER = 'owner-a';
const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
const candidate = { title: 'ゼミ', start: { date: '2026-11-09', time: '14:00' },
  end: { date: '2026-11-09', time: '15:00' }, timeZone: 'Asia/Tokyo' };
const event = (changes: Partial<MonthEvent> = {}): MonthEvent => ({ id: 'seminar', userId: OWNER,
  title: candidate.title, date: candidate.start.date, startTime: '14:00', endTime: '15:00',
  repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: 'private memo', checklist: [],
  locationTags: [], createdAt: '', updatedAt: '', ...changes });
function source(events: MonthEvent[] = []) {
  return { ownerId: OWNER, timeZone: candidate.timeZone, range,
    authority: { getScheduleSnapshot: vi.fn(async (_owner: string) => ({ plans: [] as Plan[], monthEvents: events })) },
    timetable: { getScheduleTemplates: vi.fn(async (_owner: string) => []),
      getTimetableTerms: vi.fn(async (_owner: string) => []) } };
}

describe('single-event unsaved schedule preview', () => {
  it('returns a canonical-compatible general-event summary without modifying admitted storage, even on retry', async () => {
    const values = new Map<string, string>();
    const storage: Storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(key) ?? null, setItem: vi.fn((key, value) => { values.set(key, value); }),
      removeItem: vi.fn(key => { values.delete(key); }), clear: () => values.clear() };
    const authority = createLocalScheduleEventAuthority(createLocalPlannerStorageGateway(storage), storage);
    await authority.ensureMigrated(OWNER, async () => ({ plans: [], monthEvents: [event()] }));
    const before = [...values.entries()];
    vi.mocked(storage.setItem).mockClear();
    const prepare = createScheduleEventPreparer({ ...source(), authority });
    const preview = await prepare(OWNER, candidate);
    expect(preview).toMatchObject({ status: 'unsaved_preview', ownerId: OWNER, timeZone: candidate.timeZone,
      event: { kind: 'general', category: 'other', busy: true, title: candidate.title,
        date: candidate.start.date, endDate: candidate.end.date, startTime: '14:00', endTime: '15:00' },
      overlaps: [{ kind: 'possible_duplicate' }] });
    expect(await prepare(OWNER, candidate)).toEqual(preview);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    expect([...values.entries()]).toEqual(before);
    expect(preview).not.toHaveProperty('previewId'); expect(preview).not.toHaveProperty('approved');
    expect(JSON.stringify(preview)).not.toContain('private memo');
    // The preview's candidate fields preserve the existing canonical/UI occurrence roundtrip.
    const canonical = scheduleEventFromMonthEvent({ ...event(), ...preview.event });
    const projected = createScheduleOccurrenceProjection({ ownerId: OWNER, ...range, plans: [],
      monthEvents: [scheduleEventToMonthEvent(canonical)!] });
    expect(projected.occurrences[0]).toMatchObject({ title: candidate.title, start: candidate.start, end: candidate.end });
  });

  it('distinguishes an exact title/time duplicate candidate from temporal overlaps, retains busy=false, and excludes adjacent intervals', async () => {
    const ports = source([event(), event({ id: 'other', title: '別の予定', startTime: '14:30', endTime: '16:00' }),
      event({ id: 'free', title: '締切', busy: false }), event({ id: 'before', startTime: '13:00', endTime: '14:00' }),
      event({ id: 'after', startTime: '15:00', endTime: '16:00' })]);
    const result = await createScheduleEventPreparer(ports)(OWNER, candidate);
    expect(result.overlaps).toHaveLength(3);
    expect(result.overlaps.filter(item => item.kind === 'possible_duplicate')).toHaveLength(1);
    expect(result.overlaps.find(item => item.occurrence.title === '別の予定')?.kind).toBe('time_overlap');
    expect(result.overlaps.find(item => item.occurrence.title === '締切')?.occurrence.busy).toBe(false);
  });

  it('checks expanded recurring occurrences rather than source dates', async () => {
    const result = await createScheduleEventPreparer(source([event({ date: '2026-11-02', repeat: 'weekly' })]))(OWNER, candidate);
    expect(result.overlaps).toMatchObject([{ kind: 'possible_duplicate', occurrence: { start: candidate.start } }]);
  });

  it('reports no overlaps for an empty, successfully read calendar', async () => {
    expect((await createScheduleEventPreparer(source())(OWNER, candidate)).overlaps).toEqual([]);
  });

  it('reads again on each prepare, so another-device change is reflected without a cached approval', async () => {
    const ports = source();
    const prepare = createScheduleEventPreparer(ports);
    expect((await prepare(OWNER, candidate)).overlaps).toEqual([]);
    ports.authority.getScheduleSnapshot.mockResolvedValueOnce({ plans: [], monthEvents: [event()] });
    expect((await prepare(OWNER, candidate)).overlaps).toMatchObject([{ kind: 'possible_duplicate' }]);
    expect(ports.authority.getScheduleSnapshot).toHaveBeenCalledTimes(2);
  });

  it('uses normalized overnight endpoints and permits the exclusive midnight end of the allowed period', async () => {
    const overnight = { ...candidate, start: { date: range.endDate, time: '23:00' },
      end: { date: '2026-12-01', time: '00:00' } };
    const result = await createScheduleEventPreparer(source([event({ date: range.endDate, startTime: '23:30', endTime: '24:00' })]))(OWNER, overnight);
    expect(result.event).toMatchObject({ date: range.endDate, endDate: '2026-12-01', startTime: '23:00', endTime: '00:00' });
    expect(result.overlaps).toMatchObject([{ occurrence: { end: overnight.end } }]);
  });

  it.each([
    { ...candidate, start: { date: '2026-10-31', time: '23:00' } },
    { ...candidate, end: { date: '2026-12-01', time: '00:01' } },
  ])('rejects an interval outside the trusted supported period before any reads: %j', async input => {
    const ports = source();
    await expect(createScheduleEventPreparer(ports)(OWNER, input)).rejects.toMatchObject({ code: 'out_of_range' });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
  });

  it.each([null, [], { ...candidate, title: '  ' }, { ...candidate, title: 4 },
    { ...candidate, start: { date: '2026-02-30', time: '14:00' } },
    { ...candidate, start: { date: '来週月曜', time: '14:00' } },
    { ...candidate, start: { ...candidate.start, time: '14:60' } },
    { ...candidate, end: { ...candidate.end, time: '24:00' } },
    { ...candidate, end: candidate.start }, { ...candidate, end: { ...candidate.end, time: '13:00' } },
    { ...candidate, ownerId: 'other' }, { ...candidate, approved: true }, { ...candidate, revision: 1 },
    { ...candidate, start: { ...candidate.start, offset: '+09:00' } }, { ...candidate, repeat: 'weekly' },
  ])('rejects malformed, semantic, or authority-bearing input before reads: %j', async input => {
    const ports = source();
    await expect(createScheduleEventPreparer(ports)(OWNER, input)).rejects.toMatchObject({ code: 'invalid_event' });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
  });

  it.each([{ timeZone: 0, code: 'invalid_time_zone' }, { timeZone: 'invalid', code: 'invalid_time_zone' },
    { timeZone: 'America/New_York', code: 'time_zone_mismatch' }])('rejects a mismatched or invalid zone: $timeZone', async ({ timeZone, code }) => {
    const ports = source();
    await expect(createScheduleEventPreparer(ports)(OWNER, { ...candidate, timeZone })).rejects.toMatchObject({ code });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
  });

  it('rejects other actors before I/O and refuses foreign source data', async () => {
    const ports = source([event({ userId: 'foreign' })]);
    const prepare = createScheduleEventPreparer(ports);
    await expect(prepare('other', candidate)).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
    await expect(prepare(OWNER, candidate)).rejects.toMatchObject({ code: 'owner_mismatch' });
  });

  it('does not return an apparently clear preview when authority read fails', async () => {
    const ports = source();
    ports.authority.getScheduleSnapshot.mockRejectedValue(new Error('unavailable'));
    await expect(createScheduleEventPreparer(ports)(OWNER, candidate)).rejects.toThrow('unavailable');
  });

  it.each([{ startDate: '2026-11-30', endDate: '2026-11-01' }, { ...range, endDate: 'invalid' }])(
    'rejects invalid composition ranges without admitting a capability: %j', invalid => {
      expect(() => createScheduleEventPreparer({ ...source(), range: invalid })).toThrow('invalid_range');
    });
});
