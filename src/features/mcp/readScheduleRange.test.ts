import { describe, expect, it, vi } from 'vitest';
import { createScheduleOccurrenceProjection } from '../../domain/scheduleOccurrence';
import { createLocalScheduleEventAuthority } from '../../repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../repositories/localStorageGateway';
import { createPlannerRepository } from '../../repositories/plannerRepository';
import { createScheduleEventBackedPlannerRepository } from '../../repositories/scheduleEventAuthorityRepository';
import type { MonthEvent, Plan, ScheduleTemplate, TimetableTerm } from '../../types/domain';
import { createScheduleRangeReader } from './readScheduleRange';

const OWNER = 'owner-a';
const stamp = '2026-11-01T00:00:00.000Z';
const range = { startDate: '2026-11-02', endDate: '2026-11-02', timeZone: 'Asia/Tokyo' };
const plan = (changes: Partial<Plan> = {}): Plan => ({ id: 'study', seriesId: 'study', userId: OWNER,
  title: '数学', subject: '数学', date: '2026-11-02', startTime: '10:00', endTime: '11:00',
  repeat: 'none', repeatUntil: null, recurrenceRules: [], excludedDates: [], type: 'study', memo: '',
  createdAt: stamp, updatedAt: stamp, ...changes });
const event = (changes: Partial<MonthEvent> = {}): MonthEvent => ({ id: 'seminar', userId: OWNER,
  title: 'ゼミ', date: '2026-11-02', startTime: '13:00', endTime: '15:00', repeat: 'none', repeatUntil: null,
  excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: stamp, updatedAt: stamp, ...changes });
const term: TimetableTerm = { id: 'term', userId: OWNER, year: 2026, kind: 'custom', label: '秋',
  startDate: '2026-11-01', endDate: '2026-11-30', isActive: true, createdAt: stamp, updatedAt: stamp };
const template: ScheduleTemplate = { id: 'class', userId: OWNER, title: '情報学', subject: '情報',
  type: 'school-event', weekday: 'mon', startTime: '09:00', endTime: '10:00', termId: term.id,
  periodNumber: 1, classroom: 'A101', memo: '', active: true, createdAt: stamp, updatedAt: stamp };

function source() {
  return { ownerId: OWNER, timeZone: range.timeZone,
    authority: { getScheduleSnapshot: vi.fn(async (_owner: string) => ({ plans: [plan()], monthEvents: [] as MonthEvent[] })) },
    timetable: { getScheduleTemplates: vi.fn(async (_owner: string): Promise<ScheduleTemplate[]> => []),
      getTimetableTerms: vi.fn(async (_owner: string): Promise<TimetableTerm[]> => []) } };
}

describe('headless owner schedule range reader', () => {
  it('reads the admitted canonical repository, matches the UI occurrence truth and writes nothing', async () => {
    const values = new Map<string, string>();
    const storage: Storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(key) ?? null, setItem: vi.fn((key, value) => { values.set(key, value); }),
      removeItem: key => { values.delete(key); }, clear: () => values.clear() };
    const gateway = createLocalPlannerStorageGateway(storage);
    const authority = createLocalScheduleEventAuthority(gateway, storage);
    // Migration is completed explicitly outside the read capability.
    await authority.ensureMigrated(OWNER, async () => ({ plans: [plan()], monthEvents: [event()] }));
    await gateway.writePlans([plan({ title: 'stale legacy title', startTime: '20:00', endTime: '21:00' })]);
    const ui = createScheduleEventBackedPlannerRepository(createPlannerRepository(gateway), authority);
    const before = [...values.entries()];
    const reader = createScheduleRangeReader({ ownerId: OWNER, timeZone: range.timeZone, authority, timetable: ui });
    const result = await reader(OWNER, range);
    expect(result.occurrences.map(item => item.title)).toEqual(['数学', 'ゼミ']);
    const snapshot = await ui.getScheduleSnapshot(OWNER);
    const projected = createScheduleOccurrenceProjection({ ownerId: OWNER, ...range, ...snapshot });
    expect(result.occurrences.map(item => item.id)).toEqual(projected.occurrences.map(item => item.id));
    expect(result.occurrences[0]).toMatchObject({ start: { date: range.startDate, time: '10:00' }, end: { date: range.endDate, time: '11:00' } });
    expect([...values.entries()]).toEqual(before);
  });

  it('passes timetable terms/templates into the same occurrence projection', async () => {
    const ports = source();
    ports.timetable.getScheduleTemplates.mockResolvedValue([template]);
    ports.timetable.getTimetableTerms.mockResolvedValue([term]);
    const result = await createScheduleRangeReader(ports)(OWNER, range);
    expect(result.occurrences.map(item => item.title)).toEqual(['情報学', '数学']);
    expect(ports.authority.getScheduleSnapshot).toHaveBeenCalledWith(OWNER);
    expect(ports.timetable.getScheduleTemplates).toHaveBeenCalledWith(OWNER);
    expect(ports.timetable.getTimetableTerms).toHaveBeenCalledWith(OWNER);
  });

  it('keeps recurrence and the inclusive end date without implementing another recurrence engine', async () => {
    const ports = source();
    ports.authority.getScheduleSnapshot.mockResolvedValue({ plans: [plan({ repeat: 'weekly' })], monthEvents: [] });
    const result = await createScheduleRangeReader(ports)(OWNER, { ...range, endDate: '2026-11-09' });
    expect(result.occurrences.map(item => item.start.date)).toEqual(['2026-11-02', '2026-11-09']);
  });

  it('rejects a different actor before any repository access', async () => {
    const ports = source();
    await expect(createScheduleRangeReader(ports)('other-owner', range)).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
    expect(ports.timetable.getScheduleTemplates).not.toHaveBeenCalled();
  });

  it.each(['plan', 'event', 'template', 'term'])('fails closed for foreign %s data instead of returning a partial calendar', async kind => {
    const ports = source();
    if (kind === 'plan') ports.authority.getScheduleSnapshot.mockResolvedValue({ plans: [plan({ userId: 'foreign' })], monthEvents: [] });
    if (kind === 'event') ports.authority.getScheduleSnapshot.mockResolvedValue({ plans: [plan()], monthEvents: [event({ userId: 'foreign' })] });
    if (kind === 'template') ports.timetable.getScheduleTemplates.mockResolvedValue([{ ...template, userId: 'foreign' }]);
    if (kind === 'term') ports.timetable.getTimetableTerms.mockResolvedValue([{ ...term, userId: 'foreign' }]);
    await expect(createScheduleRangeReader(ports)(OWNER, range)).rejects.toMatchObject({ code: 'owner_mismatch' });
  });

  it.each([
    { ...range, startDate: '2026-02-30' }, { ...range, endDate: '2026-11-01' },
    { ...range, ownerId: 'foreign' }, { ...range, startDate: '明日' },
  ])('rejects invalid structured dates/ranges or extra owner arguments before reading: %j', async input => {
    const ports = source();
    await expect(createScheduleRangeReader(ports)(OWNER, input)).rejects.toMatchObject({ code: 'invalid_range' });
    expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
  });

  it.each([{ timeZone: 'not/a-zone', code: 'invalid_time_zone' }, { timeZone: 'America/New_York', code: 'time_zone_mismatch' }])(
    'rejects an invalid or different owner time zone: $timeZone', async ({ timeZone, code }) => {
      const ports = source();
      await expect(createScheduleRangeReader(ports)(OWNER, { ...range, timeZone })).rejects.toMatchObject({ code });
      expect(ports.authority.getScheduleSnapshot).not.toHaveBeenCalled();
    });

  it('preserves owner-local clock points across a daylight-saving boundary, without inventing a UTC offset', async () => {
    const ports = source();
    ports.timeZone = 'America/New_York';
    ports.authority.getScheduleSnapshot.mockResolvedValue({ plans: [plan({ date: '2026-11-01', startTime: '01:30', endTime: '02:30' })], monthEvents: [] });
    const result = await createScheduleRangeReader(ports)(OWNER, { startDate: '2026-11-01', endDate: '2026-11-01', timeZone: ports.timeZone });
    expect(result.timeZone).toBe('America/New_York');
    expect(result.occurrences[0]).toMatchObject({ start: { date: '2026-11-01', time: '01:30' }, end: { date: '2026-11-01', time: '02:30' } });
  });

  it('propagates repository failure rather than claiming the calendar is empty', async () => {
    const ports = source();
    ports.authority.getScheduleSnapshot.mockRejectedValue(new Error('unavailable'));
    await expect(createScheduleRangeReader(ports)(OWNER, range)).rejects.toThrow('unavailable');
  });
});
