import {
  collection,
  doc,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  type QueryConstraint,
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

export async function submitInquiry(userId: string, input: InquirySubmission): Promise<string> {
  const submission = validateInquirySubmission(input);
  requireOwner(userId);
  const db = requireDatabase();
  const reference = doc(db, COLLECTION, submission.requestId);
  const cooldown = doc(db, 'support_inquiry_limits', userId);
  await runTransaction(db, async (transaction) => {
    requireOwner(userId);
    const existing = await transaction.get(reference);
    if (existing.exists()) {
      const saved = existing.data();
      if (saved.schemaVersion !== 1 || saved.userId !== userId || saved.body !== submission.body) {
        throw new Error('受付番号と送信内容が一致しません。');
      }
      return;
    }
    // Reading the gate makes simultaneous new submissions conflict and retry safely.
    await transaction.get(cooldown);
    requireOwner(userId);
    transaction.set(cooldown, { inquiryId: submission.requestId, submittedAt: serverTimestamp() });
    transaction.set(reference, {
      schemaVersion: 1,
      userId,
      body: submission.body,
      createdAt: serverTimestamp(),
    });
  });
  return submission.requestId;
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
    if (value.schemaVersion !== 1 || typeof value.userId !== 'string'
      || typeof value.body !== 'string' || !(value.createdAt instanceof Timestamp)) {
      throw new Error('お問い合わせのデータを読み取れませんでした。');
    }
    return {
      id: row.id,
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
