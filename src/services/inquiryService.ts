import { isInquiryAttachmentList, sameInquiryAttachments, type InquiryAttachment } from '../../shared/inquiryAttachments';
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  type QueryConstraint,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import {
  INQUIRY_PAGE_SIZE,
  validateInquirySubmission,
  type InquiryCursor,
  type InquiryPage,
  type InquirySubmission,
} from '../features/support/inquiry';

const COLLECTION = 'support_inquiries';

function requireDatabase() {
  const db = getFirestoreDb();
  if (!db) throw new Error('現在、お問い合わせに接続できません。');
  return db;
}

function requireOwner(userId: string) {
  if (!userId || getFirebaseAuth()?.currentUser?.uid !== userId) {
    throw new Error('ログイン状態が変わりました。ログインし直してください。');
  }
}

function matchesReceipt(saved: DocumentData, userId: string, submission: InquirySubmission): boolean {
  const hasPhotos = submission.attachments !== undefined;
  return Object.keys(saved).length === (hasPhotos ? 5 : 4) && saved.schemaVersion === (hasPhotos ? 2 : 1)
    && saved.userId === userId && saved.body === submission.body && saved.createdAt instanceof Timestamp
    && (!hasPhotos || (isInquiryAttachmentList(saved.attachments) && sameInquiryAttachments(saved.attachments, submission.attachments)));
}

export async function submitInquiry(userId: string, input: InquirySubmission): Promise<string> {
  const submission = validateInquirySubmission(input);
  requireOwner(userId);
  const db = requireDatabase();
  const reference = doc(db, COLLECTION, submission.requestId);
  const cooldown = doc(db, 'support_inquiry_limits', userId);
  try {
    await runTransaction(db, async (transaction) => {
      requireOwner(userId);
      const existing = await transaction.get(reference);
      if (existing.exists()) {
        const saved = existing.data();
        if (!matchesReceipt(saved, userId, submission)) {
          throw new Error('受付番号と送信内容が一致しません。');
        }
        return;
      }
      // Read the gate so simultaneous new submissions share a transaction precondition.
      await transaction.get(cooldown);
      requireOwner(userId);
      transaction.set(cooldown, { inquiryId: submission.requestId, submittedAt: serverTimestamp() });
      transaction.set(reference, {
        schemaVersion: submission.attachments ? 2 : 1,
        ...(submission.attachments ? { attachments: submission.attachments } : {}),
        userId,
        body: submission.body,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    requireOwner(userId);
    // Rules can deny the losing same-ID commit before Firestore retries its stale
    // transaction. Only a matching, server-confirmed immutable receipt is success.
    const saved = await getDocFromServer(reference).catch(() => { throw error; });
    requireOwner(userId);
    if (!saved.exists() || !matchesReceipt(saved.data(), userId, submission)) throw error;
  }
  requireOwner(userId);
  return submission.requestId;
}

// Read-only reconciliation after reload. Never creates or rewrites a receipt.
export async function recoverInquiryReceipt(userId: string, receiptId: string, attachments?: InquiryAttachment[]): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(receiptId)) throw new Error('受付番号が無効です。');
  requireOwner(userId);
  const saved = await getDocFromServer(doc(requireDatabase(), COLLECTION, receiptId));
  requireOwner(userId);
  if (!saved.exists()) return false;
  const data = saved.data();
  return typeof data.body === 'string' && matchesReceipt(data, userId, { requestId: receiptId, body: data.body, ...(attachments ? { attachments } : {}) });
}

// Firestore Rules independently require an enabled administrator and a bounded query.
export async function listInquiries(cursor: InquiryCursor | null = null): Promise<InquiryPage> {
  const db = requireDatabase();
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc')];
  if (cursor) {
    constraints.push(startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id));
  }
  constraints.push(limit(INQUIRY_PAGE_SIZE + 1));
  const snapshot = await getDocsFromServer(query(collection(db, COLLECTION), ...constraints));
  const rows = snapshot.docs.slice(0, INQUIRY_PAGE_SIZE);
  const items = rows.map((row) => {
    const value = row.data();
    if (![1, 2].includes(value.schemaVersion)
      || (value.schemaVersion === 2 && !isInquiryAttachmentList(value.attachments))
      || typeof value.userId !== 'string'
      || typeof value.body !== 'string' || !(value.createdAt instanceof Timestamp)) {
      throw new Error('お問い合わせのデータを読み取れませんでした。');
    }
    return {
      id: row.id,
      ...(value.schemaVersion === 2 ? { attachments: value.attachments } : {}),
      userId: value.userId,
      body: value.body,
      createdAt: value.createdAt.toDate().toISOString(),
    };
  });
  const lastRow = rows[rows.length - 1];
  const lastTimestamp = lastRow?.data().createdAt as Timestamp | undefined;
  return {
    items,
    nextCursor: snapshot.docs.length > INQUIRY_PAGE_SIZE && lastRow && lastTimestamp
      ? { id: lastRow.id, seconds: lastTimestamp.seconds, nanoseconds: lastTimestamp.nanoseconds }
      : null,
  };
}
