import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { createFirebaseClassAttendanceRepository } from './firebaseClassAttendanceRepository';
const firestore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), list: vi.fn(), transaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_: unknown, ...parts: string[]) => typeof _ === 'string' ? [_, ...parts].join('/') : parts.join('/'),
  getDocsFromServer: firestore.list,
  runTransaction: firestore.transaction,
}));
const draft = { userId: 'owner', templateId: 'class', date: '2026-10-13', status: 'present' as const };
const record = { ...draft, schemaVersion: 1, createdAt: 'created', updatedAt: 'updated' };
const repository = createFirebaseClassAttendanceRepository({} as Firestore);
beforeEach(() => { vi.clearAllMocks(); firestore.transaction.mockImplementation(async (_db, action) => action({ get: firestore.get, set: firestore.set })); });

it('reads only the owner/class path and requires a confirmed server snapshot', async () => {
  firestore.list.mockResolvedValue({ docs: [{ id: draft.date, data: () => record }] });
  expect(await repository.list('owner', 'class')).toEqual([record]);
  expect(firestore.list).toHaveBeenCalledWith('class_attendance/owner/classes/class/records');
});
it('uses a transaction to check class ownership and preserve creation while correcting one date', async () => {
  firestore.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ userId: 'owner' }) })
    .mockResolvedValueOnce({ exists: () => true, data: () => record });
  const result = await repository.save({ ...draft, status: 'absent' });
  expect(firestore.get.mock.calls.map(args => args[0])).toEqual(['schedule_templates/class', 'class_attendance/owner/classes/class/records/2026-10-13']);
  expect(result).toMatchObject({ ...record, status: 'absent', createdAt: 'created', updatedAt: expect.any(String) });
  expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
  expect(result.updatedAt).not.toBe(record.updatedAt);
  expect(firestore.set).toHaveBeenCalledWith('class_attendance/owner/classes/class/records/2026-10-13', result);
});
it.each([false, true])('rejects missing/foreign class before an attendance write (exists=%s)', async exists => {
  firestore.get.mockResolvedValueOnce({ exists: () => exists, data: () => ({ userId: 'foreign' }) });
  await expect(repository.save(draft)).rejects.toThrow(); expect(firestore.set).not.toHaveBeenCalled();
});
it('propagates read denial and rejects a corrupted identity instead of presenting no history', async () => {
  firestore.list.mockRejectedValueOnce(Error('permission-denied'));
  await expect(repository.list('owner', 'class')).rejects.toThrow('permission-denied');
  firestore.list.mockResolvedValueOnce({ docs: [{ id: '2026-10-14', data: () => record }] });
  await expect(repository.list('owner', 'class')).rejects.toThrow('日付');
  firestore.list.mockResolvedValueOnce({ docs: [{ id: draft.date, data: () => ({ ...record, userId: 'foreign' }) }] });
  await expect(repository.list('owner', 'class')).rejects.toThrow();
});
