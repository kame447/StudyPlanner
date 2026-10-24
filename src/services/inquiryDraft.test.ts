import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InquiryDraft } from './inquiryDraft';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { submitInquiry, recoverInquiryReceipt } from './inquiryService';
import { uploadInquiryAttachments, type PreparedInquiryAttachment } from './inquiryAttachmentService';
vi.mock('./inquiryService', () => ({ submitInquiry: vi.fn(), recoverInquiryReceipt: vi.fn() }));
vi.mock('./inquiryAttachmentService', () => ({ uploadInquiryAttachments: vi.fn() }));
const photo: PreparedInquiryAttachment = { file: new File(['bytes'], 'photo.png', { type: 'image/png' }), descriptor: { sha256: 'a'.repeat(64), contentType: 'image/png', byteLength: 5, width: 1, height: 1 } };
const owner = { id: 'owner', requiresEmailVerification: false };
let auth: ReturnType<typeof createFakeAuthSession>;
let draft: InquiryDraft;
let values: Map<string, string>;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); values = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.mocked(submitInquiry).mockImplementation(async (_userId, submission) => submission.requestId);
  vi.mocked(recoverInquiryReceipt).mockResolvedValue(true);
  vi.mocked(uploadInquiryAttachments).mockResolvedValue();
  auth = createFakeAuthSession(); draft = new InquiryDraft(auth.session); auth.emit(owner);
  draft.setBody('private text'); draft.setPhotos([photo]);
});
afterEach(() => { draft.dispose(); vi.unstubAllGlobals(); });
describe('owner-scoped inquiry draft and receipt recovery', () => {
  it('separates accepted text from failed images and retries only fixed image slots', async () => {
    vi.mocked(uploadInquiryAttachments).mockRejectedValueOnce(new Error('offline'));
    await draft.send();
    expect(draft.getSnapshot().phase).toBe('upload-failed');
    expect(draft.getSnapshot().body).toBe('');
    const receipt = draft.getSnapshot().marker!.receipt;
    expect(draft.getSnapshot().photos[0].file).toBe(photo.file);
    await draft.upload();
    expect(submitInquiry).toHaveBeenCalledTimes(1);
    expect(uploadInquiryAttachments).toHaveBeenNthCalledWith(2, 'owner', receipt, [photo]);
    expect(draft.getSnapshot().phase).toBe('sent');
  });
  it('retains draft files with no listeners during navigation and clears on logout even while hidden', () => {
    const stop = draft.subscribe(() => {}); stop();
    expect(draft.getSnapshot().photos[0].file).toBe(photo.file);
    auth.emit(null); auth.emit(owner);
    expect(draft.getSnapshot().photos).toEqual([]); expect(draft.getSnapshot().body).toBe('');
  });
  it('writes only receipt metadata, recovers after reload, and requires exact same images', async () => {
    vi.mocked(uploadInquiryAttachments).mockRejectedValueOnce(new Error('offline'));
    await draft.send();
    const receipt = draft.getSnapshot().marker!.receipt;
    expect([...values.values()].join('')).not.toContain('private text');
    expect([...values.values()].join('')).not.toContain('photo.png');
    draft.dispose(); draft = new InquiryDraft(auth.session); auth.emit(owner); await tick();
    expect(draft.getSnapshot().phase).toBe('needs-files');
    expect(draft.getSnapshot().photos).toEqual([]);
    draft.restorePhotos([{ ...photo, descriptor: { ...photo.descriptor, sha256: 'b'.repeat(64) } }]);
    expect(draft.getSnapshot().photos).toEqual([]);
    draft.restorePhotos([photo]); await draft.upload();
    expect(draft.getSnapshot().phase).toBe('sent');
    expect(submitInquiry).toHaveBeenCalledTimes(1);
    expect(recoverInquiryReceipt).toHaveBeenCalledWith('owner', receipt, [photo.descriptor]);
  });
  it('lets a missing receipt retry re-entered text under the same ID without an automatic send', async () => {
    vi.mocked(submitInquiry).mockRejectedValueOnce(new Error('lost ack'));
    await draft.send(); const receipt = draft.getSnapshot().marker!.receipt;
    draft.dispose(); draft = new InquiryDraft(auth.session);
    vi.mocked(recoverInquiryReceipt).mockResolvedValue(false); auth.emit(owner); await tick();
    expect(draft.getSnapshot().phase).toBe('restore-input'); expect(submitInquiry).toHaveBeenCalledTimes(1);
    draft.setBody('re-entered text'); await draft.send();
    expect(vi.mocked(submitInquiry).mock.calls[1][1].requestId).toBe(receipt);
    expect(draft.getSnapshot().phase).toBe('needs-files');
  });
  it('shows a late immutable receipt if re-entered text conflicts, without creating a second receipt', async () => {
    vi.mocked(submitInquiry).mockRejectedValueOnce(new Error('lost ack'));
    await draft.send(); const receipt = draft.getSnapshot().marker!.receipt;
    draft.dispose(); draft = new InquiryDraft(auth.session);
    vi.mocked(recoverInquiryReceipt).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    auth.emit(owner); await tick(); draft.setBody('different re-entered text');
    vi.mocked(submitInquiry).mockRejectedValueOnce(new Error('immutable body conflict'));
    await draft.send(); expect(draft.getSnapshot().phase).toBe('needs-files');
    expect(draft.getSnapshot().marker!.receipt).toBe(receipt); expect(draft.getSnapshot().body).toBe('');
    expect(vi.mocked(submitInquiry).mock.calls[1][1].requestId).toBe(receipt);
  });
  it('keeps partial reselection and orders files into the original immutable slots', async () => {
    const second = { ...photo, descriptor: { ...photo.descriptor, sha256: 'b'.repeat(64) } };
    draft.setPhotos([photo, second]); vi.mocked(uploadInquiryAttachments).mockRejectedValueOnce(new Error('offline'));
    await draft.send(); draft.dispose(); draft = new InquiryDraft(auth.session); auth.emit(owner); await tick();
    draft.restorePhotos([second]); expect(draft.getSnapshot().phase).toBe('needs-files'); expect(draft.getSnapshot().photos).toEqual([second]);
    draft.restorePhotos([second, photo]); expect(draft.getSnapshot().phase).toBe('upload-failed'); expect(draft.getSnapshot().photos).toEqual([photo, second]);
  });
  it('coalesces repeated receipt confirmation clicks during the same pending read', async () => {
    vi.mocked(uploadInquiryAttachments).mockRejectedValueOnce(new Error('offline')); await draft.send();
    draft.dispose(); draft = new InquiryDraft(auth.session);
    let finish!: (value: boolean) => void;
    vi.mocked(recoverInquiryReceipt).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    auth.emit(owner); void draft.recover(); void draft.recover();
    expect(recoverInquiryReceipt).toHaveBeenCalledTimes(1);
    finish(true); await tick(); expect(draft.getSnapshot().phase).toBe('needs-files');
  });
  it('drops late receipt acknowledgement on owner change without uploading old images', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(submitInquiry).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const send = draft.send(); auth.emit(null); auth.emit(owner); resolve('x'.repeat(20)); await send;
    expect(uploadInquiryAttachments).not.toHaveBeenCalled(); expect(values.size).toBe(0);
    expect(draft.getSnapshot().phase).toBe('editing'); expect(draft.getSnapshot().photos).toEqual([]);
  });
  it('drops late photo acknowledgement and metadata on owner switch', async () => {
    let resolve!: () => void;
    vi.mocked(uploadInquiryAttachments).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const send = draft.send(); await tick(); auth.emit({ ...owner, id: 'other' }); resolve(); await send;
    expect(draft.getSnapshot().userId).toBe('other'); expect(values.size).toBe(0); expect(draft.getSnapshot().phase).toBe('editing');
  });
  it('blocks duplicate clicks and permits a new receipt only after explicit completion action', async () => {
    await Promise.all([draft.send(), draft.send()]); expect(submitInquiry).toHaveBeenCalledTimes(1);
    const first = draft.getSnapshot().marker!.receipt;
    draft.startAnother(); draft.setBody('second'); await draft.send();
    expect(draft.getSnapshot().marker!.receipt).not.toBe(first);
  });
  it('continues text submission when session storage throws', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } });
    draft.setPhotos([]); await draft.send(); expect(draft.getSnapshot().phase).toBe('sent');
  });
});
