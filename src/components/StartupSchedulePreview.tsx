import { useEffect, useState } from 'react';
import { toIsoDate } from '../lib/date';
import { startupTiming } from '../lib/startupTiming';
import type { StartupSchedulePreview as Preview } from '../lib/startupSchedulePreview';
import '../styles/startup-schedule-preview.css';

export function StartupSchedulePreview({ snapshot, failed }: { snapshot: Preview | null; failed: boolean }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const now = new Date(clock);
  const expired = snapshot && (clock < snapshot.savedAt || clock - snapshot.savedAt > 24 * 60 * 60 * 1000);
  const today = toIsoDate(now);
  const rows = (expired ? [] : snapshot?.rows ?? []).filter(row => row.date >= today).slice(0, 8);
  useEffect(() => {
    if (!snapshot) return;
    const frame = requestAnimationFrame(() => startupTiming.markOnce('cached-schedule-visible'));
    return () => cancelAnimationFrame(frame);
  }, [snapshot]);
  return <main className="startup-schedule-preview section-stack" aria-label="前回取得した予定" aria-busy={!failed}>
    <header className="section-stack"><p className="eyebrow">Laplans</p><h1>前回取得した予定</h1>
      <p role="status">{expired ? '前回の予定の表示期限が切れました' : failed ? '最新の予定を確認できませんでした' : '最新の予定に更新しています…'}</p>
      <p>確認が終わるまで、予定の変更・AI操作はお待ちください</p>
      {snapshot ? <small>取得日時：{new Date(snapshot.savedAt).toLocaleString('ja-JP')} · 表示は前回取得分の一部です</small> : null}
    </header>
    {rows.length ? <ol className="section-stack">{rows.map((row, index) => <li className="panel section-stack" key={index}>
      <time>{row.date === today ? '今日' : row.date.slice(5).replace('-', '/')}　{row.startTime}–{row.endTime}</time>
      <strong>{row.title}</strong>{row.subject ? <span>{row.subject}</span> : null}
    </li>)}</ol> : <p>端末に保存された範囲には直近の予定がありません。最新の予定を確認しています。</p>}
    {failed || expired ? <button type="button" className="primary-button" onClick={() => window.location.reload()}>再読み込み</button> : null}
  </main>;
}
