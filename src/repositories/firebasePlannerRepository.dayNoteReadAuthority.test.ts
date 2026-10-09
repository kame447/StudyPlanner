import type { Firestore } from 'firebase/firestore';
import { beforeEach, expect, it, vi } from 'vitest';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
const sdk = vi.hoisted(() => ({ getDocs: vi.fn(), getDocsFromServer: vi.fn() }));
vi.mock('firebase/firestore', () => ({ ...sdk,
  collection: (_db: unknown, name: string) => ({ name }), where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (collection: unknown, constraint: unknown) => ({ collection, constraint }),
}));
const repository = createFirebasePlannerRepository({} as Firestore);
const row = { id: 'note', data: () => ({ userId: 'owner', date: '2022-01-01', quickMemo: 'old note' }) };
beforeEach(() => { vi.clearAllMocks(); sdk.getDocs.mockResolvedValue({ docs: [] }); sdk.getDocsFromServer.mockResolvedValue({ docs: [row], metadata: { fromCache: false, hasPendingWrites: false } }); });
it('preserves default cache-compatible reads without requiring metadata', async () => {
  await expect(repository.getDayNotes('owner')).resolves.toEqual([]);
  expect(sdk.getDocs).toHaveBeenCalledOnce(); expect(sdk.getDocsFromServer).not.toHaveBeenCalled();
});
it('uses a confirmed owner-scoped server query only when requested', async () => {
  await expect(repository.getDayNotes('owner', { requireServer: true })).resolves.toEqual([{ id: 'note', ...row.data() }]);
  expect(sdk.getDocs).not.toHaveBeenCalled(); expect(sdk.getDocsFromServer).toHaveBeenCalledWith({ collection: { name: 'day_notes' }, constraint: { field: 'userId', op: '==', value: 'owner' } });
});
it.each([undefined, { fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }, { fromCache: false }])('rejects unconfirmed cache or pending-write metadata: %j', async metadata => {
  sdk.getDocsFromServer.mockResolvedValue({ docs: [], metadata });
  await expect(repository.getDayNotes('owner', { requireServer: true })).rejects.toThrow('確認できません'); expect(sdk.getDocs).not.toHaveBeenCalled();
});
it('accepts server-confirmed empty and rejects offline without a cache fallback', async () => {
  sdk.getDocsFromServer.mockResolvedValueOnce({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
  await expect(repository.getDayNotes('owner', { requireServer: true })).resolves.toEqual([]);
  sdk.getDocsFromServer.mockRejectedValueOnce(new Error('offline'));
  await expect(repository.getDayNotes('owner', { requireServer: true })).rejects.toThrow('offline'); expect(sdk.getDocs).not.toHaveBeenCalled();
});
