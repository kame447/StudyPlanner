import { useEffect, useRef, useState } from 'react';
import { accountDeletionProvider, deleteAccount } from '../services/accountDeletionService';
import { clearAccountLocalData } from '../services/accountDeletionLocalData';

interface Props {
  uid: string;
  retry?: boolean;
  onClose(): void;
  onCompleted(): Promise<void>;
  onSignOut?(): Promise<void>;
}

export function AccountDeletionDialog({ uid, retry = false, onClose, onCompleted, onSignOut }: Props) {
  const [provider, setProvider] = useState<'password' | 'google' | 'unavailable' | null>(null);
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'confirm' | 'busy' | 'retry' | 'completed'>(retry ? 'retry' : 'confirm');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(retry);
  const busy = useRef(false);
  const cloudCompleted = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let current = true;
    void accountDeletionProvider().then(value => { if (current) setProvider(value); }).catch(() => { if (current) setProvider('unavailable'); });
    dialogRef.current?.focus();
    return () => { current = false; };
  }, []);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setPhase('busy'); setError('');
    try {
      const result = cloudCompleted.current ? { status: 'completed' as const } : await deleteAccount(uid, password);
      setPassword('');
      if (result.status === 'completed') {
        cloudCompleted.current = true; setLocked(true);
        await clearAccountLocalData(uid);
        setPhase('completed');
        await onCompleted();
        return;
      }
      if (!(result.status === 'failed' && ['authentication', 'admin_forbidden'].includes(result.reason))) setLocked(true);
      setPhase('retry');
      setError(result.status === 'reauth_required' ? 'もう一度、本人確認をしてください。'
        : result.status === 'failed' && result.reason === 'authentication' ? '本人確認ができませんでした。もう一度お試しください。'
        : result.status === 'failed' && result.reason === 'admin_forbidden' ? '管理者アカウントの退会はお問い合わせください。'
        : '退会を完了できませんでした。もう一度お試しください。');
    } catch {
      setPhase('retry'); setError('退会を完了できませんでした。もう一度お試しください。');
    } finally { busy.current = false; }
  }

  return <div className="overlay modal-overlay" style={{ zIndex: 10000 }}>
    <section ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="account-deletion-title"
      style={{ width: 'min(100%, 28rem)', maxHeight: '90dvh', overflowY: 'auto' }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !locked && !busy.current) onClose();
        if (event.key === 'Tab') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
          if (!controls.length) { event.preventDefault(); return; }
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <form className="section-stack" onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <h2 id="account-deletion-title">退会する</h2>
        <p>アカウントと学習データを削除します。この操作は取り消せません。</p>
        {provider === 'password' && !cloudCompleted.current ? <label className="field">パスワード
          <input autoComplete="current-password" type="password" value={password} required disabled={phase === 'busy'}
            onChange={event => setPassword(event.target.value)} />
        </label> : null}
        {error ? <p role="alert">{error}</p> : null}
        {phase === 'busy' || phase === 'completed' ? <p role="status">{phase === 'completed' ? '退会が完了しました' : '削除しています…'}</p> : null}
        {provider === 'unavailable' ? <p role="alert">本人確認を利用できません。ログインし直してください。</p> : null}
        <div className="inline-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {locked && onSignOut ? <button className="ghost-button" type="button" disabled={phase === 'busy'} onClick={() => { void onSignOut(); }}>ログアウト</button> : null}
          {!locked ? <button ref={cancelRef} className="ghost-button" type="button" disabled={phase === 'busy'} onClick={onClose}>キャンセル</button> : null}
          <button className="ghost-button danger" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', minHeight: 44 }} type="submit" disabled={phase === 'busy' || phase === 'completed' || !provider || provider === 'unavailable'}>
            {phase === 'retry' ? 'もう一度試す' : provider === 'google' ? 'Googleで本人確認して退会する' : '退会する'}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
