import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryPhotoViewer } from './InquiryPhotoViewer';
import { readInquiryAttachment } from '../services/inquiryAttachmentService';
vi.mock('../services/inquiryAttachmentService', () => ({ readInquiryAttachment: vi.fn() }));
const photo = { sha256: 'a'.repeat(64), contentType: 'image/png' as const, byteLength: 10, width: 1, height: 1 };
let renderer: ReactTestRenderer;
const button = (label: string) => renderer.root.findAllByType('button').find((item) => item.children.join('') === label)!;
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-photo'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); });
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
describe('lazy private image viewer', () => {
  it('does not read until explicitly opened and revokes the private URL on close', async () => {
    vi.mocked(readInquiryAttachment).mockResolvedValue(new Blob(['photo'], { type: 'image/png' }));
    act(() => { renderer = create(<InquiryPhotoViewer receiptId={'x'.repeat(20)} slot={0} photo={photo} />); });
    expect(readInquiryAttachment).not.toHaveBeenCalled();
    await act(async () => button('写真を開く').props.onClick());
    expect(renderer.root.findByType('img').props.src).toBe('blob:private-photo');
    act(() => button('写真を閉じる').props.onClick());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo'); expect(renderer.root.findAllByType('img')).toHaveLength(0);
  });
  it('aborts and ignores a late image after close/unmount or revoked admin view', async () => {
    let resolve!: (blob: Blob) => void;
    vi.mocked(readInquiryAttachment).mockImplementation(() => new Promise((done) => { resolve = done; }));
    act(() => { renderer = create(<InquiryPhotoViewer receiptId={'x'.repeat(20)} slot={0} photo={photo} />); });
    act(() => button('写真を開く').props.onClick());
    const signal = vi.mocked(readInquiryAttachment).mock.calls[0][3];
    act(() => button('写真を閉じる').props.onClick()); expect(signal?.aborted).toBe(true);
    await act(async () => resolve(new Blob(['photo'])));
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(renderer.root.findAllByType('img')).toHaveLength(0);
  });
  it('shows failed image reads without removing the inquiry text or retrying automatically', async () => {
    vi.mocked(readInquiryAttachment).mockRejectedValue(new Error('写真の送信がまだ完了していません。'));
    act(() => { renderer = create(<InquiryPhotoViewer receiptId={'x'.repeat(20)} slot={0} photo={photo} />); });
    await act(async () => button('写真を開く').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('送信がまだ完了'); expect(readInquiryAttachment).toHaveBeenCalledTimes(1);
    expect(button('写真を再取得')).toBeTruthy();
  });
});
