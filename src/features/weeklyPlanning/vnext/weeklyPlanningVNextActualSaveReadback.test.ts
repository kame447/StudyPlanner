import { describe, expect, it, vi } from 'vitest';
import { vnextActualRecordId } from './weeklyPlanningVNextStudyRecords';
import { readAndClassifyActualSave, type ActualSaveIntentRecord, type ConfirmedActual } from './weeklyPlanningVNextActualSaveReadback';

const OWNER = 'owner-a';
const subjects = ['数学', '英語', '国語', '化学', '物理', '生物'];
const attempted: ActualSaveIntentRecord[] = subjects.map((subject, index) => {
  const occurrenceDate = `2026-10-${26 + index}`;
  return { id: vnextActualRecordId(OWNER, occurrenceDate, subject), occurrenceDate, subject, minutes: 30 + index * 5 };
});
const saved = (record: ActualSaveIntentRecord): ConfirmedActual => ({
  id: record.id, userId: OWNER, occurrenceDate: record.occurrenceDate, subject: record.subject,
  actualDurationMinutes: record.minutes,
});

describe('owner-bound actual save server readback', () => {
  it.each([
    { label: 'zero documents', rows: [] as ConfirmedActual[], status: 'not_saved', confirmed: 0, unresolved: 6, conflicts: 0 },
    { label: 'all six matching documents', rows: attempted.map(saved), status: 'saved', confirmed: 6, unresolved: 0, conflicts: 0 },
    { label: 'three matching documents', rows: attempted.slice(0, 3).map(saved), status: 'partial', confirmed: 3, unresolved: 3, conflicts: 0 },
    { label: 'one different minute value', rows: attempted.map((record, index) => ({ ...saved(record),
      actualDurationMinutes: index === 5 ? record.minutes + 10 : record.minutes })), status: 'partial', confirmed: 5, unresolved: 1, conflicts: 1 },
  ] as const)('classifies $label from a confirmed server read', async ({ rows, status, confirmed, unresolved, conflicts }) => {
    const readConfirmed = vi.fn(async () => ({ fromCache: false, hasPendingWrites: false, records: rows }));
    const result = await readAndClassifyActualSave({ ownerId: OWNER, attempted, readConfirmed });
    expect(readConfirmed).toHaveBeenCalledExactlyOnceWith(OWNER, attempted.map(record => record.id));
    expect(result.status).toBe(status);
    expect(result.confirmedIds).toEqual(attempted.slice(0, confirmed).map(record => record.id));
    expect(result.unconfirmedRecords).toEqual(attempted.slice(confirmed));
    expect(result.conflictingIds).toEqual(conflicts ? [attempted[5].id] : []);
    expect(result.confirmedIds).toHaveLength(confirmed);
    expect(result.unconfirmedRecords).toHaveLength(unresolved);
  });

  it('refuses foreign IDs before reading and foreign documents after reading', async () => {
    const readConfirmed = vi.fn(async () => ({ fromCache: false, hasPendingWrites: false, records: [] }));
    await expect(readAndClassifyActualSave({ ownerId: OWNER, attempted: [{ ...attempted[0],
      id: vnextActualRecordId('other-owner', attempted[0].occurrenceDate, attempted[0].subject) }], readConfirmed })).rejects.toThrow('owner');
    expect(readConfirmed).not.toHaveBeenCalled();
    await expect(readAndClassifyActualSave({ ownerId: OWNER, attempted,
      readConfirmed: async () => ({ fromCache: false, hasPendingWrites: false,
        records: [{ ...saved(attempted[0]), userId: 'other-owner' }] }) })).rejects.toThrow('owner');
  });

  it.each([{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }])
  ('does not certify a cached or locally pending snapshot', async metadata => {
    await expect(readAndClassifyActualSave({ ownerId: OWNER, attempted,
      readConfirmed: async () => ({ ...metadata, records: attempted.map(saved) }) })).rejects.toThrow('unconfirmed');
  });
});
