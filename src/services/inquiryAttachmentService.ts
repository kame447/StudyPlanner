import {
  INQUIRY_ATTACHMENT_LIMIT, INQUIRY_ATTACHMENT_MAX_BYTES, INQUIRY_ATTACHMENT_PATH,
  inspectInquiryImage, inquiryImageDigest, type InquiryAttachment,
} from '../../shared/inquiryAttachments';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth } from '../lib/firebaseClient';

export interface PreparedInquiryAttachment {
  file: File;
  descriptor: InquiryAttachment;
}

function endpoint(suffix: string): string {
  const proxy = getCloudflareAiProxyUrl();
  if (!proxy) throw new Error('写真の添付は準備中です。本文のみ送信できます。');
  // The configured endpoint may name the chat route; all support routes belong to
  // that same Worker origin, never to a client-supplied URL or R2 public endpoint.
  return new URL(`${INQUIRY_ATTACHMENT_PATH}/${suffix}`, proxy).toString();
}

export async function inquiryAttachmentsAvailable(): Promise<boolean> {
  try {
    const response = await fetch(endpoint('capabilities'), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return response.ok && (await response.json() as { available?: boolean }).available === true;
  } catch { return false; }
}

export async function prepareInquiryAttachments(files: File[]): Promise<PreparedInquiryAttachment[]> {
  if (files.length > INQUIRY_ATTACHMENT_LIMIT) throw new Error('写真は3枚まで添付できます。');
  const prepared: PreparedInquiryAttachment[] = [];
  for (const file of files) {
    if (file.size <= 0 || file.size > INQUIRY_ATTACHMENT_MAX_BYTES) throw new Error('写真は1枚5MB以内にしてください。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const descriptor = { ...inspectInquiryImage(bytes, file.type), sha256: await inquiryImageDigest(bytes) };
    prepared.push({ file, descriptor });
  }
  return prepared;
}

async function attachmentRequest(suffix: string, init: RequestInit, expectedOwner?: string): Promise<Response> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user || (expectedOwner !== undefined && user.uid !== expectedOwner)) throw new Error('ログイン状態が変わりました。');
  const token = await user.getIdToken();
  if (getFirebaseAuth()?.currentUser !== user) throw new Error('ログイン状態が変わりました。');
  const response = await fetch(endpoint(suffix), {
    ...init, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(60_000),
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (getFirebaseAuth()?.currentUser !== user) throw new Error('ログイン状態が変わりました。');
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(value.error || '写真を送受信できませんでした。再試行してください。');
  }
  return response;
}

export async function uploadInquiryAttachments(userId: string, receiptId: string, photos: PreparedInquiryAttachment[]): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(receiptId) || photos.length > INQUIRY_ATTACHMENT_LIMIT) throw new Error('写真の受付番号が無効です。');
  // Sequential, fixed receipt slots keep memory bounded. Successful slots are
  // idempotent on retry; a failure never creates a second inquiry or new key.
  for (const [slot, photo] of photos.entries()) {
    const response = await attachmentRequest(`${receiptId}/${slot}`, {
      method: 'PUT', headers: { 'Content-Type': photo.descriptor.contentType }, body: photo.file,
    }, userId);
    if ((await response.json() as { uploaded?: boolean }).uploaded !== true) throw new Error('写真の送信結果を確認できませんでした。');
  }
}

export async function readInquiryAttachment(receiptId: string, slot: number, descriptor: InquiryAttachment, signal?: AbortSignal): Promise<Blob> {
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(receiptId) || !Number.isInteger(slot) || slot < 0 || slot >= INQUIRY_ATTACHMENT_LIMIT) throw new Error('写真の受付番号が無効です。');
  const user = getFirebaseAuth()?.currentUser;
  const response = await attachmentRequest(`${receiptId}/${slot}`, { method: 'GET', signal });
  if (response.headers.get('Content-Type') !== descriptor.contentType) throw new Error('写真の形式を確認できませんでした。');
  const blob = await response.blob();
  if (getFirebaseAuth()?.currentUser !== user) throw new Error('ログイン状態が変わりました。');
  if (blob.size !== descriptor.byteLength) throw new Error('写真のサイズを確認できませんでした。');
  return blob;
}
