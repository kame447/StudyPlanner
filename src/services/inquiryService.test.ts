import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { listInquiries, submitInquiry, recoverInquiryReceipt } from './inquiryService';

const mocks = vi.hoisted(() => ({
  uid: 'owner' as string | null,
  available: true,
  get: vi.fn(), getServer: vi.fn(), set: vi.fn(), getDocs: vi.fn(), query: vi.fn(), startAfter: vi.fn(), limit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: mocks.uid ? { uid: mocks.uid } : null }),
  getFirestoreDb: () => mocks.available ? {} : null,
}));
vi.mock('firebase/firestore', async (original) => {
  const actual = await original<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
    collection: (_db: unknown, name: string) => name,
    query: (...args: unknown[]) => mocks.query(...args),
    getDocFromServer: (...args: unknown[]) => mocks.getServer(...args),
    getDocsFromServer: (...args: unknown[]) => mocks.getDocs(...args),
    orderBy: (field: unknown, direction: string) => ({ field, direction }),
    documentId: () => '__name__',
    startAfter: (...args: unknown[]) => mocks.startAfter(...args),
    limit: (value: number) => mocks.limit(value),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    runTransaction: (_db: unknown, operation: unknown) => mocks.transaction(operation),
  };
});
const savedReceipt = () => ({ schemaVersion: 1, userId: 'owner', body: '問い合わせ内容', createdAt: new Timestamp(100, 1) });
const submission = { requestId: '12345678-1234-1234-1234-123456789abc', body: '問い合わせ内容' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uid = 'owner'; mocks.available = true;
  mocks.get.mockResolvedValue({ exists: () => false });
  mocks.getServer.mockResolvedValue({ exists: () => false });
  mocks.transaction.mockImplementation((operation) => operation({ get: mocks.get, set: mocks.set }));
});

describe('inquiry submission', () => {
  it('writes only normalized message, authenticated owner and server time', async () => {
    await expect(submitInquiry('owner', { ...submission, body: '  問い合わせ内容\n' })).resolves.toBe(submission.requestId);
    expect(mocks.set).toHaveBeenCalledWith(`support_inquiries/${submission.requestId}`, {
      schemaVersion: 1, userId: 'owner', body: submission.body, createdAt: 'SERVER_TIMESTAMP',
    });
    expect(mocks.set).toHaveBeenCalledWith('support_inquiry_limits/owner', { inquiryId: submission.requestId, submittedAt: 'SERVER_TIMESTAMP' });
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });
  it('acknowledges a saved same-content retry without another write', async () => {
    mocks.get.mockResolvedValue({ exists: () => true, data: savedReceipt });
    await expect(submitInquiry('owner', submission)).resolves.toBe(submission.requestId);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each([
    { schemaVersion: 1, userId: 'another', body: submission.body },
    { schemaVersion: 1, userId: 'owner', body: 'changed' },
  ])('never overwrites a conflicting receipt', async (saved) => {
    mocks.get.mockResolvedValue({ exists: () => true, data: () => saved });
    await expect(submitInquiry('owner', submission)).rejects.toThrow('一致');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each(['', ' \n\t ', 'あ'.repeat(2001)])('rejects invalid message length before persistence', async (body) => {
    await expect(submitInquiry('owner', { ...submission, body })).rejects.toThrow('文字');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs and unavailable database', async () => {
    await expect(submitInquiry('owner', { ...submission, requestId: '../other' })).rejects.toThrow('受付番号');
    mocks.available = false;
    await expect(submitInquiry('owner', submission)).rejects.toThrow('接続');
  });
  it('rejects unsigned and changed accounts, including changes during the transaction', async () => {
    mocks.uid = null;
    await expect(submitInquiry('owner', submission)).rejects.toThrow('ログイン');
    mocks.uid = 'another';
    await expect(submitInquiry('owner', submission)).rejects.toThrow('ログイン');
    mocks.uid = 'owner';
    mocks.get.mockImplementation(async () => { mocks.uid = 'another'; return { exists: () => false }; });
    await expect(submitInquiry('owner', submission)).rejects.toThrow('ログイン');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each(['permission-denied', 'lost response'])('reconciles %s only from a matching server receipt', async (message) => {
    mocks.transaction.mockRejectedValueOnce(new Error(message));
    mocks.getServer.mockResolvedValueOnce({ exists: () => true, data: savedReceipt });
    await expect(submitInquiry('owner', submission)).resolves.toBe(submission.requestId);
    expect(mocks.getServer).toHaveBeenCalledExactlyOnceWith(`support_inquiries/${submission.requestId}`);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 'another' }, { body: 'changed' }, { schemaVersion: 2 },
    { createdAt: 'not-a-server-timestamp' }, { email: 'unexpected' },
  ])('does not reconcile a mismatching or malformed receipt: %j', async (patch) => {
    const error = new Error('permission-denied');
    mocks.transaction.mockRejectedValueOnce(error);
    mocks.getServer.mockResolvedValueOnce({ exists: () => true, data: () => ({ ...savedReceipt(), ...patch }) });
    await expect(submitInquiry('owner', submission)).rejects.toBe(error);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('preserves commit failure when the receipt cannot be confirmed by the server', async () => {
    const error = new Error('lost response');
    mocks.transaction.mockRejectedValueOnce(error);
    mocks.getServer.mockRejectedValueOnce(new Error('offline'));
    await expect(submitInquiry('owner', submission)).rejects.toBe(error);
  });
  it('rejects an account change while reconciling a receipt', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('permission-denied'));
    mocks.getServer.mockImplementationOnce(async () => {
      mocks.uid = 'another';
      return { exists: () => true, data: savedReceipt };
    });
    await expect(submitInquiry('owner', submission)).rejects.toThrow('ログイン');
  });
  it('does not claim success when commit acknowledgement is lost, then safely recovers', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('lost response'));
    await expect(submitInquiry('owner', submission)).rejects.toThrow('lost response');
    mocks.get.mockResolvedValue({ exists: () => true, data: savedReceipt });
    await expect(submitInquiry('owner', submission)).resolves.toBe(submission.requestId);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe('bounded admin inquiry reads', () => {
  function row(index: number) {
    return { id: `receipt-${index}`, data: () => ({ schemaVersion: 1, userId: 'owner', body: 'message', createdAt: new Timestamp(100, 123456789) }) };
  }
  it('reads 26 rows once and returns a precise cursor after the 25 displayed rows', async () => {
    mocks.getDocs.mockResolvedValue({ docs: Array.from({ length: 26 }, (_, index) => row(index)) });
    const page = await listInquiries();
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toEqual({ id: 'receipt-24', seconds: 100, nanoseconds: 123456789 });
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(26);
    expect(mocks.query).toHaveBeenCalledWith('support_inquiries', { field: 'createdAt', direction: 'desc' }, { field: '__name__', direction: 'desc' }, undefined);
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
  });
  it('preserves timestamp precision and ID tie-breaker for continuation', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [row(26)] });
    const cursor = { id: 'receipt-24', seconds: 100, nanoseconds: 123456789 };
    const page = await listInquiries(cursor);
    expect(mocks.startAfter).toHaveBeenCalledExactlyOnceWith(new Timestamp(100, 123456789), cursor.id);
    expect(page.nextCursor).toBeNull();
  });
  it('propagates denial and malformed data rather than displaying a false empty inbox', async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(listInquiries()).rejects.toThrow('permission-denied');
    mocks.getDocs.mockResolvedValueOnce({ docs: [{ id: 'bad', data: () => ({ body: 'bad' }) }] });
    await expect(listInquiries()).rejects.toThrow('読み取れません');
  });
});


describe('immutable photo receipts and reload recovery', () => {
  const descriptor = { sha256: 'a'.repeat(64), contentType: 'image/png' as const, byteLength: 100, width: 10, height: 10 };
  const withPhotos = { ...submission, attachments: [descriptor] };
  const saved = () => ({ ...savedReceipt(), schemaVersion: 2, attachments: [descriptor] });
  it('stores metadata only and acknowledges exact-photo replay', async () => {
    await submitInquiry('owner', withPhotos);
    expect(mocks.set).toHaveBeenCalledWith(`support_inquiries/${submission.requestId}`, { ...saved(), createdAt: 'SERVER_TIMESTAMP' });
    mocks.set.mockClear(); mocks.get.mockResolvedValue({ exists: () => true, data: saved });
    await expect(submitInquiry('owner', withPhotos)).resolves.toBe(submission.requestId); expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects replacement photos under an existing receipt', async () => {
    mocks.get.mockResolvedValue({ exists: () => true, data: saved });
    await expect(submitInquiry('owner', { ...withPhotos, attachments: [{ ...descriptor, sha256: 'b'.repeat(64) }] })).rejects.toThrow('一致');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('recovers accepted metadata without requiring a persisted body or any write', async () => {
    mocks.getServer.mockResolvedValue({ exists: () => true, data: saved });
    await expect(recoverInquiryReceipt('owner', submission.requestId, [descriptor])).resolves.toBe(true);
    expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    await expect(recoverInquiryReceipt('owner', submission.requestId, [{ ...descriptor, sha256: 'b'.repeat(64) }])).resolves.toBe(false);
  });
  it('differentiates a missing receipt from an offline read and rejects changed ownership', async () => {
    await expect(recoverInquiryReceipt('owner', submission.requestId)).resolves.toBe(false);
    mocks.getServer.mockRejectedValueOnce(new Error('offline'));
    await expect(recoverInquiryReceipt('owner', submission.requestId)).rejects.toThrow('offline');
    mocks.uid = 'other'; await expect(recoverInquiryReceipt('owner', submission.requestId)).rejects.toThrow('ログイン');
  });
});
