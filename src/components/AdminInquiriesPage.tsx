import { useCallback, useEffect, useRef, useState } from 'react';
import type { InquiryCursor, InquiryPage } from '../features/support/inquiry';
import { listInquiries } from '../services/inquiryService';
import '../styles/support-inquiries.css';

export function AdminInquiriesPage() {
  const [page, setPage] = useState<InquiryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const lastCursor = useRef<InquiryCursor | null>(null);
  const load = useCallback(async (cursor: InquiryCursor | null) => {
    if (pending.current) return;
    pending.current = true;
    lastCursor.current = cursor;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const next = await listInquiries(cursor);
      if (request === generation.current) setPage(next);
    } catch {
      if (request === generation.current) setError('お問い合わせを取得できませんでした。権限と接続を確認して再試行してください。');
    } finally {
      if (request === generation.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    void load(null);
    return () => { generation.current += 1; pending.current = false; };
  }, [load]);

  return (
    <main className="admin-shell admin-inquiries-page">
      <header className="admin-page-header">
        <div><span className="admin-page-eyebrow">アプリ内のお問い合わせ</span><h1>お問い合わせ</h1></div>
        <button type="button" className="ghost-button" disabled={loading} onClick={() => { void load(null); }}>最新を表示</button>
      </header>
      {loading && <p role="status">お問い合わせを読み込んでいます</p>}
      {error && <section className="panel" role="alert"><p>{error}</p><button type="button" className="ghost-button" disabled={loading} onClick={() => { void load(lastCursor.current); }}>再試行</button></section>}
      {!loading && !error && page?.items.length === 0 && <p className="panel">お問い合わせはまだありません。</p>}
      <div className="section-stack" aria-busy={loading}>
        {page?.items.map((inquiry) => (
          <article className="panel inquiry-admin-card" key={inquiry.id}>
            <header><h2>受付番号: {inquiry.id}</h2><time dateTime={inquiry.createdAt}>{new Date(inquiry.createdAt).toLocaleString('ja-JP')}</time></header>
            <p className="detail-note">ユーザーID: {inquiry.userId}</p>
            <p className="inquiry-admin-body">{inquiry.body}</p>
          </article>
        ))}
      </div>
      {page?.nextCursor && <button type="button" className="ghost-button" disabled={loading || !!error} onClick={() => { void load(page.nextCursor); }}>次の25件</button>}
    </main>
  );
}
