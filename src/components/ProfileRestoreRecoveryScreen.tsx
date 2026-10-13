import { useThemePreference } from '../hooks/useThemePreference';
import { useEffect } from 'react';
import { LaplanceLogo } from './LaplanceLogo';
import { useRootStartupReady } from './RootStartupReadyContext';
import { useStartupContentVisible } from './StartupSurface';

export function ProfileRestoreRecoveryScreen({ retrying, onRetry, onReady }: {
  retrying: boolean;
  onRetry: () => Promise<void>;
  onReady: () => void;
}) {
  useThemePreference();
  const markRootStartupReady = useRootStartupReady();
  const visible = useStartupContentVisible();
  useEffect(() => { markRootStartupReady?.(); }, [markRootStartupReady]);
  useEffect(() => { if (visible) onReady(); }, [onReady, visible]);

  return (
    <main className="auth-shell auth-shell-modern" data-testid="profile-restore-recovery" aria-busy={retrying}>
      <section className="auth-card auth-main-card" aria-labelledby="profile-restore-heading">
        <div className="auth-brand-header"><LaplanceLogo /></div>
        <div className="auth-stage-card">
          <div className="auth-stage-header">
            <div>
              <h2 id="profile-restore-heading">プロフィールを読み込めませんでした</h2>
              <p>ログインは維持されています。</p>
            </div>
          </div>
          <div className="auth-form">
            {retrying ? <p role="status">プロフィールと学習データを確認しています。</p> : null}
            <button className="primary-button" type="button" disabled={retrying} onClick={() => void onRetry()}>
              {retrying ? '読み込み中...' : 'もう一度読み込む'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
