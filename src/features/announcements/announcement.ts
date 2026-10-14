export const ANNOUNCEMENT_PAGE_SIZE = 25;
export const ANNOUNCEMENT_CATEGORIES = ['お知らせ', 'アップデート', '不具合', 'メンテナンス', 'その他'] as const;
export type AnnouncementCategory = typeof ANNOUNCEMENT_CATEGORIES[number];
export interface AnnouncementTime { seconds: number; nanoseconds: number }
export interface AnnouncementInput { category: AnnouncementCategory; title: string; body: string }
export interface Announcement extends AnnouncementInput { id: string; revision: number; publishedAt: AnnouncementTime }
export interface AnnouncementDraft extends AnnouncementInput {
  id: string; revision: number; publishedRevision: number; updatedAt: AnnouncementTime;
}
export interface AnnouncementCursor extends AnnouncementTime { id: string }
export interface AnnouncementPage<T> { items: T[]; nextCursor: AnnouncementCursor | null }
export interface AnnouncementReadState { through: AnnouncementTime | null; items: Record<string, AnnouncementTime> }
export function compareAnnouncementTime(a: AnnouncementTime, b: AnnouncementTime): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}
export function mergeAnnouncementReadState(current: AnnouncementReadState, incoming: AnnouncementReadState): AnnouncementReadState {
  const latest = (a: AnnouncementTime | null, b: AnnouncementTime | null) => !a ? b : !b || compareAnnouncementTime(a, b) >= 0 ? a : b;
  const items = { ...current.items };
  for (const [id, value] of Object.entries(incoming.items)) items[id] = latest(items[id] ?? null, value)!;
  return { through: latest(current.through, incoming.through), items };
}
export function isAnnouncementUnread(item: Announcement, read: AnnouncementReadState): boolean {
  return (!read.through || compareAnnouncementTime(item.publishedAt, read.through) > 0)
    && (!read.items[item.id] || compareAnnouncementTime(item.publishedAt, read.items[item.id]) > 0);
}
export function announcementDate(time: AnnouncementTime): string {
  return new Date(time.seconds * 1000 + time.nanoseconds / 1e6).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
export function validateAnnouncementInput(input: AnnouncementInput): AnnouncementInput {
  const title = input.title.trim(); const body = input.body.trim();
  if (!ANNOUNCEMENT_CATEGORIES.includes(input.category)) throw new Error('分類を選択してください。');
  if (!title || title.length > 120) throw new Error('タイトルは1〜120文字で入力してください。');
  if (!body || body.length > 10000) throw new Error('本文は1〜10,000文字で入力してください。');
  return { category: input.category, title, body };
}
