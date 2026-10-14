import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ANNOUNCEMENT_CATEGORIES, announcementDate, validateAnnouncementInput, type AnnouncementDraft, type AnnouncementInput, type AnnouncementPage, type AnnouncementCursor } from '../features/announcements/announcement';
import { listAnnouncementDrafts, newAnnouncementId, publishAnnouncement, saveAnnouncementDraft } from '../services/announcementService';
import '../styles/announcements.css';
interface Editor { id: string; revision: number; input: AnnouncementInput }
const emptyInput = (): AnnouncementInput => ({ category: 'お知らせ', title: '', body: '' });
export function AdminAnnouncementsPage({ userId }: { userId: string }) {
  const [page, setPage] = useState<AnnouncementPage<AnnouncementDraft> | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [publishing, setPublishing] = useState<AnnouncementDraft | null>(null);
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
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const input = validateAnnouncementInput(editor.input);
      await saveAnnouncementDraft(userId, editor.id, editor.revision, input);
      if (active.current) { setEditor(null); setNotice('下書きを保存しました。配信するには内容を確認して公開してください。'); await load(null); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '下書きを保存できませんでした。'); }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };
  const publish = async () => {
    if (!publishing || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await publishAnnouncement(userId, publishing.id, publishing.revision);
      if (active.current) { setPublishing(null); setNotice('お知らせを公開しました。利用者のお知らせ一覧に表示されます。'); await load(null); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '公開結果を確認できませんでした。'); }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };
  const start = () => { try { setEditor({ id: newAnnouncementId(), revision: 0, input: emptyInput() }); setError(''); setNotice(''); } catch { setError('現在、お知らせに接続できません。'); } };
  return <main className="admin-shell admin-announcements-page">
    <header className="admin-page-header"><div><span className="admin-page-eyebrow">アプリ内配信</span><h1>お知らせ管理</h1></div>
      <button type="button" className="primary-button" disabled={busy || !!editor || !!publishing} onClick={start}>新しいお知らせ</button></header>
    {error && <div className="panel" role="alert"><p>{error}</p>{!editor && !publishing && <button className="ghost-button" type="button" disabled={loading} onClick={() => { void load(failedCursor.current); }}>再試行</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {editor ? <form className="panel announcement-editor" onSubmit={save} aria-busy={busy}>
      <h2>{editor.revision ? '下書きを編集' : 'お知らせを作成'}</h2>
      <label>分類<select value={editor.input.category} disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, category: event.target.value as AnnouncementInput['category'] } })}>{ANNOUNCEMENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>タイトル<input value={editor.input.title} maxLength={120} required disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, title: event.target.value } })} /></label>
      <label>本文<textarea rows={12} value={editor.input.body} maxLength={10000} required disabled={busy} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, body: event.target.value } })} /></label>
      <p className="detail-note">保存した下書きは利用者には見えません。公開済みのお知らせも、再公開するまでは以前の内容が表示されます。</p>
      <div className="announcement-admin-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? '保存中…' : '下書きを保存'}</button><button className="ghost-button" type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>キャンセル</button></div>
    </form> : publishing ? <section className="panel announcement-editor" aria-labelledby="publish-title">
      <h2 id="publish-title">公開内容の確認</h2><span className="announcement-category">{publishing.category}</span><h3>{publishing.title}</h3><p className="announcement-body">{publishing.body}</p>
      <p>ログインしているすべての利用者へ公開します。再公開した場合は未読のお知らせとして表示されます。</p>
      <div className="announcement-admin-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => { void publish(); }}>{busy ? '公開中…' : 'この内容で公開'}</button><button className="ghost-button" type="button" disabled={busy} onClick={() => { setPublishing(null); setError(''); }}>キャンセル</button></div>
    </section> : <>
      <button type="button" className="ghost-button" disabled={loading || busy} onClick={() => { void load(null); }}>最新を表示</button>
      {loading && <p role="status">お知らせを読み込んでいます</p>}
      {!loading && !error && !page?.items.length && <p>お知らせはまだありません。</p>}
      <div className="section-stack">{page?.items.map((draft) => <article key={draft.id} className="panel announcement-admin-card">
        <div className="announcement-meta"><span className="announcement-category">{draft.category}</span><time>{announcementDate(draft.updatedAt)}</time></div><h2>{draft.title}</h2>
        <p>{draft.publishedRevision === draft.revision ? '公開済み' : draft.publishedRevision ? '未公開の変更あり' : '下書き'}</p>
        <div className="announcement-admin-actions"><button type="button" className="ghost-button" disabled={loading} onClick={() => { setEditor({ id: draft.id, revision: draft.revision, input: { category: draft.category, title: draft.title, body: draft.body } }); setError(''); setNotice(''); }}>編集</button>
          <button type="button" className="primary-button" disabled={loading || draft.publishedRevision === draft.revision} onClick={() => { setPublishing(draft); setError(''); setNotice(''); }}>公開内容を確認</button></div>
      </article>)}</div>
      {page?.nextCursor && <button type="button" className="ghost-button" disabled={loading || !!error} onClick={() => { void load(page.nextCursor); }}>次の25件</button>}
    </>}
  </main>;
}
