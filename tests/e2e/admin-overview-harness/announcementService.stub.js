const params = new URLSearchParams(location.search);
const now = { seconds: 1791910800, nanoseconds: 1 };
let publications = Array.from({ length: 26 }, (_, i) => ({ id: `announcement-${i}`, revision: 1, category: i % 2 ? 'その他' : '不具合', title: i === 0 ? '【解消】朝の時間帯の通信障害につきまして' : `お知らせ ${i + 1}`, body: '問題は解消しました。\nご協力ありがとうございました。<script>実行しない本文</script>', publishedAt: { ...now, seconds: now.seconds - i * 60 } }));
let drafts = publications.map((item) => ({ ...item, updatedAt: item.publishedAt, publishedRevision: 1 }));
const owners = new Map(); let failures = 0;
const readState = (owner) => { if (!owners.has(owner)) owners.set(owner, { through: null, items: {} }); return owners.get(owner); };
window.__announcementReads = []; window.__announcementWrites = [];
const page = (items, cursor) => ({ items: cursor ? items.slice(25) : items.slice(0, 25), nextCursor: !cursor && items.length > 25 ? { ...now, id: items[24].id } : null });
export async function listAnnouncements(owner, cursor = null) {
  window.__announcementReads.push({ owner, cursor });
  if (params.get('state') === 'error' && failures++ < 2) throw new Error('offline');
  return page(params.get('state') === 'empty' ? [] : params.get('state') === 'single' ? publications.slice(0, 1) : publications, cursor);
}
export async function getAnnouncementReadState(owner) { const read = readState(owner); return { through: read.through, items: { ...read.items } }; }
export async function markAnnouncementRead(owner, item) {
  window.__announcementWrites.push({ owner, id: item.id });
  if (params.get('state') === 'read-error' && !failures++) throw new Error('offline');
  readState(owner).items[item.id] = item.publishedAt;
}
export async function markAllAnnouncementsRead(owner, value) { window.__announcementWrites.push({ owner, through: value }); readState(owner).through = value; }
export const newAnnouncementId = () => 'new-announcement';
export async function listAnnouncementDrafts(_owner, cursor = null) { return page(drafts, cursor); }
export async function saveAnnouncementDraft(owner, id, revision, input) {
  window.__announcementWrites.push({ owner, id, input, revision });
  const saved = drafts.find((item) => item.id === id);
  if ((saved?.revision ?? 0) !== revision) throw new Error('別の編集が保存されています。');
  drafts = [{ id, ...input, revision: revision + 1, publishedRevision: saved?.publishedRevision ?? 0, updatedAt: now }, ...drafts.filter((item) => item.id !== id)];
}
export async function publishAnnouncement(owner, id, revision) {
  window.__announcementWrites.push({ owner, id, publish: revision });
  const draft = drafts.find((item) => item.id === id);
  publications = [{ ...draft, publishedAt: now }, ...publications.filter((item) => item.id !== id)];
  draft.publishedRevision = revision;
}
window.__announcementPublicationTitles = () => publications.map((item) => item.title);
