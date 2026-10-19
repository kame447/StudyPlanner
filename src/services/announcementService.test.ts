import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { listAnnouncements, listAnnouncementDrafts, saveAnnouncementDraft, publishAnnouncement, getAnnouncementReadState, markAnnouncementRead, markAllAnnouncementsRead } from './announcementService';
const m = vi.hoisted(() => ({ uid: 'owner' as string | null, get: vi.fn(), set: vi.fn(), update: vi.fn(), getServer: vi.fn(), getDocs: vi.fn(), query: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), transaction: vi.fn() }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: m.uid ? { uid: m.uid } : null }), getFirestoreDb: () => ({}) }));
vi.mock('firebase/firestore', async (original) => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...paths: string[]) => paths.join('/'), collection: (_db: unknown, ...paths: string[]) => paths.join('/'),
  getDocFromServer: (...args: unknown[]) => m.getServer(...args), getDocsFromServer: (...args: unknown[]) => m.getDocs(...args),
  query: (...args: unknown[]) => m.query(...args), limit: (n: number) => m.limit(n), startAfter: (...args: unknown[]) => m.startAfter(...args),
  orderBy: (field: string, direction: string) => ({ field, direction }), documentId: () => '__name__', where: (...args: unknown[]) => args,
  serverTimestamp: () => 'SERVER', runTransaction: (_db: unknown, fn: unknown) => m.transaction(fn),
}));
const content = { category: 'お知らせ' as const, title: 'タイトル', body: '本文' };
const draft = { schemaVersion: 1, ...content, revision: 1, publishedRevision: 0, createdAt: new Timestamp(50, 1), updatedAt: new Timestamp(100, 9) };
const snapshot = (data?: object) => ({ exists: () => !!data, data: () => data });
beforeEach(() => { vi.clearAllMocks(); m.uid = 'owner'; m.get.mockResolvedValue(snapshot()); m.getServer.mockResolvedValue(snapshot()); m.transaction.mockImplementation((fn) => fn({ get: m.get, set: m.set, update: m.update })); });
describe('announcement repository', () => {
  it('paginates public and admin reads with an exact timestamp and ID cursor and no listener', async () => {
    m.getDocs.mockResolvedValue({ docs: Array.from({ length: 26 }, (_, i) => ({ id: `a${i}`, data: () => ({ ...draft, publishedAt: new Timestamp(100, 123456789) }) })) });
    const page = await listAnnouncements('owner');
    expect(page.items).toHaveLength(25); expect(page.nextCursor).toEqual({ id: 'a24', seconds: 100, nanoseconds: 123456789 }); expect(m.limit).toHaveBeenCalledWith(26);
    await listAnnouncements('owner', page.nextCursor); expect(m.startAfter).toHaveBeenCalledWith(new Timestamp(100, 123456789), 'a24');
    await listAnnouncementDrafts('owner'); expect(m.query).toHaveBeenLastCalledWith('announcement_drafts', { field: 'updatedAt', direction: 'desc' }, { field: '__name__', direction: 'desc' }, undefined);
  });
  it('saves only a private draft and deduplicates an identical lost-response retry', async () => {
    await saveAnnouncementDraft('owner', 'a', 0, content);
    expect(m.set).toHaveBeenCalledExactlyOnceWith('announcement_drafts/a', { ...draft, createdAt: 'SERVER', updatedAt: 'SERVER' });
    m.set.mockClear(); m.get.mockResolvedValue(snapshot(draft));
    await saveAnnouncementDraft('owner', 'a', 0, content); expect(m.set).not.toHaveBeenCalled();
    await expect(saveAnnouncementDraft('owner', 'a', 0, { ...content, title: 'different' })).rejects.toThrow('別の編集');
  });
  it('atomically publishes the verified revision and does not republish a retry', async () => {
    m.get.mockResolvedValue(snapshot(draft)); await publishAnnouncement('owner', 'a', 1);
    expect(m.set).toHaveBeenCalledExactlyOnceWith('announcements/a', { schemaVersion: 1, ...content, revision: 1, publishedAt: 'SERVER' });
    expect(m.update).toHaveBeenCalledExactlyOnceWith('announcement_drafts/a', { publishedRevision: 1 });
    m.set.mockClear(); m.get.mockResolvedValue(snapshot({ ...draft, publishedRevision: 1 })); await publishAnnouncement('owner', 'a', 1); expect(m.set).not.toHaveBeenCalled();
    await expect(publishAnnouncement('owner', 'a', 2)).rejects.toThrow('更新');
  });
  it('rejects missing, changed and mid-transaction accounts before any mutation', async () => {
    m.uid = 'other'; await expect(saveAnnouncementDraft('owner', 'a', 0, content)).rejects.toThrow('ログイン');
    m.uid = 'owner'; m.get.mockImplementation(async () => { m.uid = 'other'; return snapshot(draft); });
    await expect(publishAnnouncement('owner', 'a', 1)).rejects.toThrow('ログイン'); expect(m.set).not.toHaveBeenCalled();
  });
  it('preserves failures and rejects stale list completion after an account switch', async () => {
    m.getDocs.mockRejectedValueOnce(new Error('denied')); await expect(listAnnouncements('owner')).rejects.toThrow('denied');
    m.getDocs.mockImplementationOnce(async () => { m.uid = 'other'; return { docs: [] }; }); await expect(listAnnouncements('owner')).rejects.toThrow('ログイン');
  });
  it('loads only this page of owner receipts and advances bulk watermark without scanning announcements', async () => {
    const item = { ...content, id: 'a', revision: 1, publishedAt: { seconds: 100, nanoseconds: 9 } };
    m.getDocs.mockResolvedValue({ docs: [{ id: 'a', data: () => ({ publishedAt: new Timestamp(100, 9) }) }] });
    const read = await getAnnouncementReadState('owner', [item]);
    expect(read.items.a).toEqual(item.publishedAt); expect(m.getServer).toHaveBeenCalledWith('announcement_reads/owner'); expect(m.limit).toHaveBeenCalledWith(25);
    m.getDocs.mockClear(); await markAllAnnouncementsRead('owner', item.publishedAt);
    expect(m.set).toHaveBeenLastCalledWith('announcement_reads/owner', { through: new Timestamp(100, 9) }); expect(m.getDocs).not.toHaveBeenCalled();
    await markAnnouncementRead('owner', item); expect(m.set).toHaveBeenLastCalledWith('announcement_reads/owner/items/a', { publishedAt: new Timestamp(100, 9) });
    m.set.mockClear(); m.get.mockResolvedValue(snapshot({ through: new Timestamp(101, 0) })); await markAllAnnouncementsRead('owner', item.publishedAt); expect(m.set).not.toHaveBeenCalled();
  });
});
