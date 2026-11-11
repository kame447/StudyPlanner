import { useState } from 'react';
import type { ConversationSyncUi } from '../features/weeklyPlanning/application/weeklyPlanningConversationSyncContract';
import './AiPlanningConversationSync.css';

export function AiPlanningConversationSync({ sync }: { sync?: ConversationSyncUi }) {
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  if (!sync) return null;
  const run = async (action: () => Promise<void>) => {
    if (acting) return;
    setActing(true); setActionError('');
    try { await action(); }
    catch { setActionError('操作を完了できませんでした。もう一度お試しください。'); }
    finally { setActing(false); }
  };
  if (sync.status === 'checking' || sync.status === 'disabled') return (
    <div className="ai-planning-sync" data-sync-state={sync.status}>
      <span>{sync.status === 'checking' ? '端末間同期を準備しています' : 'この環境では端末間同期を利用できません'}</span>
    </div>
  );
  if (sync.status === 'paused') return (
    <div className="ai-planning-sync" data-sync-state="paused" aria-live="polite">
      <span>この端末の同期は停止中</span>
      <button type="button" disabled={acting} onClick={() => void run(sync.enable)}>この端末の同期を再開</button>
      <details>
        <summary>停止中の保存について</summary>
        <p>この端末では会話を端末内に保存します。他端末の同期やクラウドの既存の会話は削除されません。再開時に変更が重なっていた場合は確認できます。</p>
      </details>
      {sync.message || actionError ? <p role="alert">{actionError || sync.message}</p> : null}
    </div>
  );
  const status = sync.status === 'synced' ? '同期済み' : sync.status === 'pending' ? '同期待ち'
    : sync.status === 'loading' ? '会話を復元しています' : sync.status === 'offline' ? 'オフライン'
    : sync.status === 'locked' ? '別タブで使用中' : sync.status === 'conflict' ? '会話の更新が重なりました' : '同期を確認してください';
  return <div className="ai-planning-sync" data-sync-state={sync.status} aria-live="polite">
    <span>{status}</span>
    {sync.message || actionError ? <p role={sync.status === 'error' || actionError ? 'alert' : undefined}>{actionError || sync.message}</p> : null}
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
    {['synced', 'pending', 'offline', 'error'].includes(sync.status) ? (
      <button type="button" disabled={acting} onClick={() => void run(sync.pause)}>この端末の同期を停止</button>
    ) : null}
    <details>
      <summary>同期する内容</summary>
      <p>会話・作成途中の条件・仮予定をアカウントに紐づけてFirebaseに保存します。本文は最終更新から180日を目安に削除され、同期だけで予定や実績は登録されません。</p>
    </details>
  </div>;
}
