import {
  collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy,
  query, runTransaction, serverTimestamp, startAfter, Timestamp, where,
  type DocumentData, type QueryConstraint,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import {
  ANNOUNCEMENT_PAGE_SIZE, compareAnnouncementTime, validateAnnouncementInput,
  type Announcement, type AnnouncementCursor, type AnnouncementDraft, type AnnouncementInput,
  type AnnouncementPage, type AnnouncementReadState, type AnnouncementTime,
} from '../features/announcements/announcement';

function database() {
  const db = getFirestoreDb();
  if (!db) throw new Error('現在、お知らせに接続できません。');
  return db;
}
function requireOwner(userId: string) {
  if (!userId || getFirebaseAuth()?.currentUser?.uid !== userId) throw new Error('ログイン状態が変わりました。');
}
function time(value: unknown): AnnouncementTime {
  if (!(value instanceof Timestamp)) throw new Error('お知らせの日時を読み取れませんでした。');
  return { seconds: value.seconds, nanoseconds: value.nanoseconds };
}
const timestamp = (value: AnnouncementTime) => new Timestamp(value.seconds, value.nanoseconds);
function decode(id: string, value: DocumentData) {
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.title !== 'string' || typeof value.body !== 'string') throw new Error('お知らせを読み取れませんでした。');
  return { id, ...validateAnnouncementInput(value as AnnouncementInput), revision: value.revision as number };
}
async function list<T>(userId: string, name: string, field: string, cursor: AnnouncementCursor | null, convert: (id: string, value: DocumentData) => T): Promise<AnnouncementPage<T>> {
  requireOwner(userId);
  const constraints: QueryConstraint[] = [orderBy(field, 'desc'), orderBy(documentId(), 'desc')];
  if (cursor) constraints.push(startAfter(timestamp(cursor), cursor.id));
  constraints.push(limit(ANNOUNCEMENT_PAGE_SIZE + 1));
  const snapshot = await getDocsFromServer(query(collection(database(), name), ...constraints));
  requireOwner(userId);
  const rows = snapshot.docs.slice(0, ANNOUNCEMENT_PAGE_SIZE); const last = rows[rows.length - 1];
  return { items: rows.map((row) => convert(row.id, row.data())), nextCursor: snapshot.docs.length > ANNOUNCEMENT_PAGE_SIZE && last ? { id: last.id, ...time(last.data()[field]) } : null };
}
export function listAnnouncements(userId: string, cursor: AnnouncementCursor | null = null) {
  return list<Announcement>(userId, 'announcements', 'publishedAt', cursor, (id, value) => ({ ...decode(id, value), publishedAt: time(value.publishedAt) }));
}
export function listAnnouncementDrafts(userId: string, cursor: AnnouncementCursor | null = null) {
  return list<AnnouncementDraft>(userId, 'announcement_drafts', 'updatedAt', cursor, (id, value) => {
    const content = decode(id, value);
    if (!Number.isSafeInteger(value.publishedRevision) || value.publishedRevision < 0 || value.publishedRevision > content.revision) throw new Error('下書きを読み取れませんでした。');
    return { ...content, publishedRevision: value.publishedRevision as number, updatedAt: time(value.updatedAt) };
  });
}
export function newAnnouncementId(): string { return doc(collection(database(), 'announcement_drafts')).id; }
export async function saveAnnouncementDraft(userId: string, id: string, expectedRevision: number, input: AnnouncementInput): Promise<void> {
  requireOwner(userId); const body = validateAnnouncementInput(input); const db = database();
  const reference = doc(db, 'announcement_drafts', id);
  await runTransaction(db, async (transaction) => {
    requireOwner(userId); const saved = await transaction.get(reference); const value = saved.data();
    // Identical retry after a lost acknowledgement does not create another revision.
    if (value?.revision === expectedRevision + 1 && value.title === body.title && value.body === body.body && value.category === body.category) return;
    if ((value?.revision ?? 0) !== expectedRevision) throw new Error('別の編集が保存されています。一覧を更新してから開き直してください。');
    requireOwner(userId);
    transaction.set(reference, {
      schemaVersion: 1, ...body, revision: expectedRevision + 1, publishedRevision: value?.publishedRevision ?? 0,
      createdAt: value?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
  requireOwner(userId);
}
export async function publishAnnouncement(userId: string, id: string, expectedRevision: number): Promise<void> {
  requireOwner(userId); const db = database(); const draft = doc(db, 'announcement_drafts', id);
  const publication = doc(db, 'announcements', id);
  await runTransaction(db, async (transaction) => {
    requireOwner(userId); const saved = await transaction.get(draft); const value = saved.data();
    if (!value || value.revision !== expectedRevision) throw new Error('下書きが更新されています。一覧を更新して内容を確認してください。');
    if (value.publishedRevision === value.revision) return;
    const content = validateAnnouncementInput(value as AnnouncementInput);
    requireOwner(userId);
    transaction.set(publication, { schemaVersion: 1, ...content, revision: value.revision, publishedAt: serverTimestamp() });
    transaction.update(draft, { publishedRevision: value.revision });
  });
  requireOwner(userId);
}
export async function getAnnouncementReadState(userId: string, items: Announcement[]): Promise<AnnouncementReadState> {
  requireOwner(userId); const db = database();
  const [summary, receipts] = await Promise.all([
    getDocFromServer(doc(db, 'announcement_reads', userId)),
    items.length ? getDocsFromServer(query(collection(db, 'announcement_reads', userId, 'items'),
      where(documentId(), 'in', items.slice(0, ANNOUNCEMENT_PAGE_SIZE).map((item) => item.id)), limit(ANNOUNCEMENT_PAGE_SIZE))) : null,
  ]);
  requireOwner(userId);
  return { through: summary.exists() ? time(summary.data().through) : null,
    items: Object.fromEntries((receipts?.docs ?? []).map((row) => [row.id, time(row.data().publishedAt)])) };
}
export async function markAnnouncementRead(userId: string, item: Announcement): Promise<void> {
  requireOwner(userId); const db = database(); const ref = doc(db, 'announcement_reads', userId, 'items', item.id);
  await runTransaction(db, async (transaction) => {
    requireOwner(userId); const saved = await transaction.get(ref);
    if (saved.exists() && compareAnnouncementTime(time(saved.data().publishedAt), item.publishedAt) >= 0) return;
    requireOwner(userId); transaction.set(ref, { publishedAt: timestamp(item.publishedAt) });
  });
  requireOwner(userId);
}
export async function markAllAnnouncementsRead(userId: string, through: AnnouncementTime): Promise<void> {
  requireOwner(userId); const db = database(); const ref = doc(db, 'announcement_reads', userId);
  await runTransaction(db, async (transaction) => {
    requireOwner(userId); const saved = await transaction.get(ref);
    if (saved.exists() && compareAnnouncementTime(time(saved.data().through), through) >= 0) return;
    requireOwner(userId); transaction.set(ref, { through: timestamp(through) });
  });
  requireOwner(userId);
}
