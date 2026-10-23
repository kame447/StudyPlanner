import { syntheticPhotoFixture } from './inquiryAttachmentService.stub.js';

const saved = new Map(JSON.parse(sessionStorage.getItem('fixture.inquiry.receipts') || '[]'));
const queryParams = new URLSearchParams(window.location.search);
window.__inquirySubmissions = [];
window.__inquiryReads = [];
export async function submitInquiry(userId, submission) {
  window.__inquirySubmissions.push({ userId, ...submission });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const existing = saved.get(submission.requestId);
  if (existing && (existing.userId !== userId || existing.body !== submission.body)) throw new Error('Fixture: immutable receipt conflict');
  if (!existing) saved.set(submission.requestId, { userId, ...submission });
  sessionStorage.setItem('fixture.inquiry.receipts', JSON.stringify([...saved]));
  if (queryParams.get('state') === 'retry' && window.__inquirySubmissions.length === 1) {
    throw new Error('Fixture: commit succeeded but acknowledgement was lost');
  }
  return submission.requestId;
}
export async function recoverInquiryReceipt(userId, receipt, attachments) {
  const value = saved.get(receipt);
  return !!value && value.userId === userId && JSON.stringify(value.attachments) === JSON.stringify(attachments);
}
export async function listInquiries(cursor = null) {
  window.__inquiryReads.push(cursor);
  if (queryParams.get('state') === 'error' && window.__inquiryReads.length === 1) throw new Error('Fixture: unavailable');
  if (queryParams.get('state') === 'empty') return { items: [], nextCursor: null };
  const photo = queryParams.has('photos') ? (await syntheticPhotoFixture()).descriptor : null;
  return {
    items: Array.from({ length: cursor ? 1 : 25 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + (cursor ? 25 : 0)).padStart(12, '0')}`,
      userId: 'authenticated-owner-id',
      body: index === 0 ? '予定の保存について\n保存ボタンを押した後、元の画面に戻りました。\n' + '長いお問い合わせ内容'.repeat(30) : `お問い合わせ ${index + 1}`,
      createdAt: '2026-10-13T06:00:00.123Z',
      ...(photo && index === 0 ? { attachments: [photo] } : {}),
    })),
    nextCursor: cursor ? null : { id: '00000000-0000-0000-0000-000000000024', seconds: 100, nanoseconds: 123 },
  };
}
