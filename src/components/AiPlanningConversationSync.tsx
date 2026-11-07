import { useState } from 'react';
import type { ConversationSyncUi } from '../features/weeklyPlanning/application/weeklyPlanningConversationSyncContract';
import './AiPlanningConversationSync.css';

export function AiPlanningConversationSync({ sync }: { sync?: ConversationSyncUi }) {
  const [offering, setOffering] = useState(false);
  const [acting, setActing] = useState(false);
  if (!sync) return null;
  const run = async (action: () => Promise<void>) => {
    if (acting) return;
    setActing(true);
    try { await action(); } finally { setActing(false); }
  };
  if (sync.status === 'disabled' || sync.status === 'checking') return (
    <div className="ai-planning-sync" data-sync-state={sync.status}>
      {offering ? <div role="region" aria-label="会話の端末間同期への同意">
        <p>このアカウントの会話・作成途中の条件・仮予定をFirebaseに保存し、別端末で復元します。本文は最終更新から180日を目安に削除します。同期だけで予定や実績が登録されることはありません。</p>
        <button type="button" disabled={acting} onClick={() => void run(sync.enable)}>同意して同期する</button>
        <button type="button" disabled={acting} onClick={() => setOffering(false)}>今はしない</button>
      </div> : <button type="button" disabled={sync.status === 'checking'} onClick={() => setOffering(true)}>端末間同期を有効にする</button>}
    </div>
  );
  const status = sync.status === 'synced' ? '同期済み' : sync.status === 'pending' ? '同期待ち'
    : sync.status === 'loading' ? '会話を復元しています' : sync.status === 'offline' ? 'オフライン'
    : sync.status === 'locked' ? '別タブで使用中' : sync.status === 'conflict' ? '会話の更新が重なりました' : '同期を確認してください';
  return <div className="ai-planning-sync" data-sync-state={sync.status} aria-live="polite">
    <span>{status}</span>
    {sync.message ? <p role={sync.status === 'error' ? 'alert' : undefined}>{sync.message}</p> : null}
    {sync.status === 'conflict' ? <div role="region" aria-label="会話の同期競合">
      <p>{sync.remoteDeleted ? '別端末で削除された会話です。内容を確認してから削除を反映してください。'
        : '両方の内容を保持しています。どちらの内容で続けるか選んでください。'}</p>
      <details><summary>両方の内容を確認</summary>
        <h4>この端末</h4><pre>{sync.localText || '会話本文なし'}</pre>
        <h4>別端末</h4><pre>{sync.remoteDeleted ? '削除済み' : sync.remoteText || '会話本文なし'}</pre>
      </details>
      {!sync.remoteDeleted ? <button type="button" disabled={acting} onClick={() => {
        if (window.confirm('この端末の内容を共有します。確認した別端末の内容を置き換えますか？')) void run(() => sync.resolve('local'));
      }}>この端末の内容で続ける</button> : null}
      <button type="button" disabled={acting} onClick={() => {
        if (window.confirm('この端末の未同期内容を置き換えます。別端末の内容を使いますか？')) void run(() => sync.resolve('remote'));
      }}>{sync.remoteDeleted ? '削除を反映する' : '別端末の内容で続ける'}</button>
    </div> : sync.status !== 'loading' ? <button type="button" disabled={acting} onClick={() => void run(sync.retry)}>
      {sync.status === 'synced' ? '会話を更新' : '同期を再試行'}
    </button> : null}
  </div>;
}
