import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, plan, event } from '../repositories/localPersistenceConcurrency.testUtils';
import { addDays, toIsoDate } from './date';
import { clearStartupSchedulePreviews, createStartupSchedulePreview, readStartupSchedulePreview, saveStartupSchedulePreview } from './startupSchedulePreview';
const now = new Date('2026-10-06T23:50:00+09:00');
const today = toIsoDate(now);
const source = () => ({ ownerId: 'owner', plans: [plan({ date: today, memo: 'PRIVATE MEMO', repeat: 'daily', repeatUntil: addDays(today, 7) })],
  monthEvents: [event({ date: today, endDate: today })], scheduleTemplates: [], timetableTerms: [] });
let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('window', { localStorage: storage }); saveStartupSchedulePreview(source(), now); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('startup schedule display cache', () => {
  it('stores only bounded display fields and preserves actual dates across midnight', () => {
    const preview = readStartupSchedulePreview('owner', new Date(now.getTime() + 3600000))!;
    expect(preview.rows.some(row => row.date === addDays(today, 1))).toBe(true);
    expect(preview.rows.some(row => row.title === 'Original event')).toBe(true);
    const serialized = storage.getItem('studyplanner.startup-schedule.v1:owner')!;
    expect(serialized).not.toContain('PRIVATE MEMO'); expect(serialized).not.toContain('recurrenceRules');
    expect(Object.keys(preview.rows[0]).sort()).toEqual(['date', 'endTime', 'startTime', 'subject', 'title']);
    expect(readStartupSchedulePreview('different', now)).toBeNull();
  });
  it.each(['expired', 'future', 'version', 'owner', 'shape', 'oversize', 'invalid-date'])('rejects %s snapshots without failing startup', reason => {
    const value: any = createStartupSchedulePreview(source(), now);
    if (reason === 'expired') value.savedAt -= 86400001;
    if (reason === 'future') value.savedAt += 1;
    if (reason === 'version') value.version = 2;
    if (reason === 'owner') value.ownerId = 'another';
    if (reason === 'shape') value.rows = [null];
    if (reason === 'oversize') value.extra = 'あ'.repeat(40000);
    if (reason === 'invalid-date') value.rows[0].date = '2026-02-31';
    storage.setItem('studyplanner.startup-schedule.v1:owner', JSON.stringify(value));
    expect(readStartupSchedulePreview('owner', now)).toBeNull();
  });
  it('clears only startup copies and revokes readable but non-removable copies', () => {
    storage.setItem('unrelated', 'keep');
    const remove = vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('read only'); });
    clearStartupSchedulePreviews();
    expect(readStartupSchedulePreview('owner', now)).toBeNull();
    saveStartupSchedulePreview({ ...source(), ownerId: 'another' }, now);
    expect(readStartupSchedulePreview('owner', now)).toBeNull();
    expect(storage.getItem('studyplanner.startup-schedule.disabled')).toBe('1');
    remove.mockRestore();
    saveStartupSchedulePreview({ ...source(), ownerId: 'another' }, now);
    expect(readStartupSchedulePreview('owner', now)).toBeNull();
    expect(readStartupSchedulePreview('another', now)).not.toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });
  it('ignores foreign-owner records and tolerates storage getter/write failures', () => {
    expect(createStartupSchedulePreview({ ...source(), plans: [plan({ userId: 'foreign', date: today })], monthEvents: [] }, now).rows).toEqual([]);
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
    expect(() => saveStartupSchedulePreview(source(), now)).not.toThrow();
    expect(() => clearStartupSchedulePreviews()).not.toThrow();
    expect(readStartupSchedulePreview('owner', now)).toBeNull();
  });
});
