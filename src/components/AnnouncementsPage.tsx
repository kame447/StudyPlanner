import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  announcementDate, isAnnouncementUnread, mergeAnnouncementReadState, type Announcement, type AnnouncementCursor,
  type AnnouncementReadState,
} from '../features/announcements/announcement';
import { getAnnouncementReadState, listAnnouncements, markAllAnnouncementsRead, markAnnouncementRead } from '../services/announcementService';
import '../styles/announcements.css';

interface Props { userId: string; detailId: string | null; onOpenDetail: (id: string) => void; onBack: () => void }
export function AnnouncementsPage({ userId, detailId, onOpenDetail, onBack }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Announcement[]>([]);
  const [cursor, setCursor] = useState<AnnouncementCursor | null>(null);
  const [read, setRead] = useState<AnnouncementReadState>({ through: null, items: {} });
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [readError, setReadError] = useState('');
  const active = useRef(true); const loadingRef = useRef(false); const savingRef = useRef(false);
  const failedCursor = useRef<AnnouncementCursor | null>(null);
  const load = useCallback(async (after: AnnouncementCursor | null) => {
    if (loadingRef.current) return;
    loadingRef.current = true; failedCursor.current = after; setLoading(true); setError('');
    try {
      const page = await listAnnouncements(userId, after);
      const receipts = await getAnnouncementReadState(userId, page.items);
      if (!active.current) return;
      setItems((previous) => after ? [...previous.filter((item) => !page.items.some((next) => next.id === item.id)), ...page.items] : page.items);
      setRead((previous) => mergeAnnouncementReadState(previous, receipts));
      setCursor(page.nextCursor);
    } catch { if (active.current) setError('お知らせを取得できませんでした。接続を確認して再試行してください。'); }
    finally { if (active.current) { setLoading(false); loadingRef.current = false; } }
  }, [userId]);
  useLayoutEffect(() => {
    const element = dialog.current;
    active.current = true; element?.showModal(); void load(null);
    return () => { active.current = false; element?.close(); };
  }, [load]);
  useLayoutEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('.announcements-back')?.focus({ preventScroll: true });
  }, [detailId]);
  const detail = items.find((item) => item.id === detailId);
  const markRead = useCallback(async (item: Announcement) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setReadError('');
    try {
      await markAnnouncementRead(userId, item);
      if (active.current) setRead((previous) => mergeAnnouncementReadState(previous, { through: null, items: { [item.id]: item.publishedAt } }));
    } catch { if (active.current) setReadError('既読を保存できませんでした。'); }
    finally { if (active.current) { savingRef.current = false; setSaving(false); } }
  }, [userId]);
  useEffect(() => { setReadError(''); }, [detailId]);
  useEffect(() => { if (detail && !saving && !readError && isAnnouncementUnread(detail, read)) void markRead(detail); }, [detail, markRead, saving, readError]);
  const markAll = async () => {
    if (savingRef.current || !items.length) return;
    savingRef.current = true; setSaving(true); setReadError('');
    const through = items[0].publishedAt;
    try { await markAllAnnouncementsRead(userId, through); if (active.current) setRead((previous) => mergeAnnouncementReadState(previous, { through, items: {} })); }
    catch { if (active.current) setReadError('既読を保存できませんでした。'); }
    finally { if (active.current) { savingRef.current = false; setSaving(false); } }
  };
  const unread = items.some((item) => isAnnouncementUnread(item, read));
  return createPortal(<dialog ref={dialog} className="announcements-page" aria-labelledby="announcements-title" onCancel={(event) => { event.preventDefault(); onBack(); }}>
    <div className="announcements-content">
      <header className="announcements-header">
        <button type="button" className="announcements-back" aria-label={detailId ? 'お知らせ一覧へ戻る' : 'ホームへ戻る'} onClick={onBack}><ArrowLeft aria-hidden="true" size={23} /></button>
        <h1 id="announcements-title">{detailId ? 'お知らせ' : 'お知らせ一覧'}</h1>
        {!detailId && <button type="button" className="announcements-read-all" disabled={loading || saving || !unread} onClick={() => { void markAll(); }}>すべて既読</button>}
      </header>
      {loading && <p role="status">お知らせを読み込んでいます</p>}
      {error && <section role="alert"><p>{error}</p><button className="ghost-button" type="button" disabled={loading} onClick={() => { void load(failedCursor.current); }}>再試行</button></section>}
      {readError && <section role="alert"><p>{readError}</p><button className="ghost-button" type="button" disabled={saving} onClick={() => { if (detail) void markRead(detail); else void markAll(); }}>既読を再試行</button></section>}
      {detailId ? detail ? <article className="announcement-detail">
        <div className="announcement-meta"><span className="announcement-category">{detail.category}</span><time>{announcementDate(detail.publishedAt)}</time></div>
        <h2>{detail.title}</h2><p className="announcement-body">{detail.body}</p>
      </article> : !loading && !error && <p>このお知らせは一覧から開き直してください。</p>
        : <>
          {!loading && !error && !items.length && <p className="announcements-empty">お知らせはまだありません。</p>}
          <ul className="announcement-list" aria-busy={loading}>{items.map((item) => <li key={item.id}>
            <button type="button" className="announcement-row" onClick={() => onOpenDetail(item.id)}>
              <span className="announcement-meta"><span className="announcement-category">{item.category}</span><time>{announcementDate(item.publishedAt)}</time></span>
              <span className="announcement-title">{isAnnouncementUnread(item, read) && <span className="announcement-unread" role="img" aria-label="未読" />}<span>{item.title}</span></span>
            </button>
          </li>)}</ul>
          {cursor && <button type="button" className="ghost-button announcements-more" disabled={loading || !!error} onClick={() => { void load(cursor); }}>もっと見る</button>}
        </>}
    </div>
  </dialog>, document.body);
}
