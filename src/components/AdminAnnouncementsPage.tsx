import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ANNOUNCEMENT_CATEGORIES, announcementDate, validateAnnouncementInput, type AnnouncementDraft, type AnnouncementInput, type AnnouncementPage, type AnnouncementCursor } from '../features/announcements/announcement';
import { listAnnouncementDrafts, newAnnouncementId, publishAnnouncement, saveAnnouncementDraft } from '../services/announcementService';
import '../styles/announcements.css';
interface Editor { id: string; revision: number; input: AnnouncementInput; savedInput: AnnouncementInput | null }
const sameInput = (a: AnnouncementInput | null, b: AnnouncementInput) => a?.category === b.category && a.title === b.title && a.body === b.body;
const emptyInput = (): AnnouncementInput => ({ category: 'お知らせ', title: '', body: '' });
export function AdminAnnouncementsPage({ userId }: { userId: string }) {
  const [page, setPage] = useState<AnnouncementPage<AnnouncementDraft> | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const active = useRef(true); const pending = useRef(false); const loadingRef = useRef(false);
  const failedCursor = useRef<AnnouncementCursor | null>(null);
  const load = useCallback(async (cursor: AnnouncementCursor | null) => {
    if (loadingRef.current) return;
    loadingRef.current = true; failedCursor.current = cursor; setLoading(true); setError('');
    try { const next = await listAnnouncementDrafts(userId, cursor); if (active.current) setPage(next); }
    catch { if (active.current) setError('一覧を取得できませんでした。権限と接続を確認してください。'); }
    finally { if (active.current) { setLoading(false); loadingRef.current = false; } }
  }, [userId]);
  useEffect(() => { active.current = true; void load(null); return () => { active.current = false; }; }, [load]);
  const save = async (event: FormEvent, mode: 'draft' | 'publish' = 'draft') => {
    event.preventDefault(); if (!active.current || !editor || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const input = validateAnnouncementInput(editor.input);
      let revision = editor.revision;
      if (!sameInput(editor.savedInput, input)) {
        await saveAnnouncementDraft(userId, editor.id, revision, input);
        // The saved draft is private. Do not begin publication after this owner
        // page has been closed or replaced while the acknowledgement was pending.
        if (!active.current) return;
        revision += 1;
        setEditor({ ...editor, revision, input, savedInput: input });
      }
      if (mode === 'publish') await publishAnnouncement(userId, editor.id, revision);
      if (active.current) {
        setEditor(null);
        setNotice(mode === 'publish' ? 'お知らせを公開しました。利用者のお知らせ一覧に表示されます。' : '下書きを保存しました。公開は行っていません。');
        await load(null);
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '保存・公開の結果を確認できませんでした。'); }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };
  const start = () => { try { setEditor({ id: newAnnouncementId(), revision: 0, input: emptyInput(), savedInput: null }); setError(''); setNotice(''); } catch { setError('現在、お知らせに接続できません。'); } };
  return <main className="admin-shell admin-announcements-page">
    <header className="admin-page-header"><div><span className="admin-page-eyebrow">アプリ内配信</span><h1>お知らせ管理</h1></div>
      <button type="button" className="primary-button" disabled={busy || !!editor} onClick={start}>新しいお知らせ</button></header>
    {error && <div className="panel" role="alert"><p>{error}</p>{!editor && <button className="ghost-button" type="button" disabled={loading} onClick={() => { void load(failedCursor.current); }}>再試行</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {editor ? <form className="panel announcement-editor" onSubmit={(event) => { void save(event); }} aria-busy={busy}>
      <h2>{editor.revision ? 'お知らせを編集' : 'お知らせを作成'}</h2>
      <label>分類<select value={editor.input.category} disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, category: event.target.value as AnnouncementInput['category'] } })}>{ANNOUNCEMENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>タイトル<input value={editor.input.title} maxLength={120} required disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, title: event.target.value } })} /></label>
      <label>本文<textarea rows={12} value={editor.input.body} maxLength={10000} required disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, body: event.target.value } })} /></label>
      <p className="detail-note">「公開」はログイン中のすべての利用者に表示されます。下書き保存では、公開済みの内容は変更されません。</p>
      <div className="announcement-admin-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={(event) => { void save(event, 'publish'); }}>{busy ? '処理中…' : '公開'}</button>
        <button className="ghost-button" type="submit" disabled={busy}>下書きを保存</button>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>キャンセル</button>
      </div>
    </form> : <>
      <button type="button" className="ghost-button" disabled={loading || busy} onClick={() => { void load(null); }}>最新を表示</button>
      {loading && <p role="status">お知らせを読み込んでいます</p>}
      {!loading && !error && !page?.items.length && <p>お知らせはまだありません。</p>}
      <div className="section-stack">{page?.items.map((draft) => <article key={draft.id} className="panel announcement-admin-card">
        <div className="announcement-meta"><span className="announcement-category">{draft.category}</span><time>{announcementDate(draft.updatedAt)}</time></div><h2>{draft.title}</h2>
        <p>{draft.publishedRevision === draft.revision ? '公開済み' : draft.publishedRevision ? '未公開の変更あり' : '下書き'}</p>
        <div className="announcement-admin-actions"><button type="button" className="ghost-button" disabled={loading} onClick={() => { setEditor({ id: draft.id, revision: draft.revision, input: { category: draft.category, title: draft.title, body: draft.body }, savedInput: { category: draft.category, title: draft.title, body: draft.body } }); setError(''); setNotice(''); }}>編集</button>
</div>
      </article>)}</div>
      {page?.nextCursor && <button type="button" className="ghost-button" disabled={loading || !!error} onClick={() => { void load(page.nextCursor); }}>次の25件</button>}
    </>}
  </main>;
}
