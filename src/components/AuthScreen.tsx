import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { NoticeState } from '../hooks/useNoticeState';
import { LaplanceLogo } from './LaplanceLogo';
import { AuthStarfield } from './AuthStarfield';
import '../styles/auth-entry.css';

type AuthIntent = 'sign-in' | 'sign-up';

interface AuthScreenProps {
  notice: NoticeState | null;
  onDismissNotice: () => void;
  onSignUpWithPassword: (
    email: string,
    password: string,
    username: string,
  ) => Promise<boolean>;
  onSignInWithPassword: (email: string, password: string) => Promise<void>;
  onSignInWithGoogle: () => Promise<void>;
  onSendPasswordReset: (email: string) => Promise<void>;
}

export function AuthScreen({
  notice,
  onDismissNotice,
  onSignUpWithPassword,
  onSignInWithPassword,
  onSignInWithGoogle,
  onSendPasswordReset,
}: AuthScreenProps) {
  const [intent, setIntent] = useState<AuthIntent>('sign-in');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  useEffect(() => {
    setPassword('');
    setPasswordConfirm('');
    setLocalError(null);
  }, [intent]);

  const requestTitle = intent === 'sign-up' ? '新規会員登録' : 'ログイン';
  const requestButtonLabel =
    intent === 'sign-up' ? '登録して確認メールを送る' : 'ログインする';

  function handleModeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextIntent = event.key === 'Home' ? 'sign-in'
      : event.key === 'End' ? 'sign-up'
      : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? intent === 'sign-in' ? 'sign-up' : 'sign-in'
        : null;
    if (!nextIntent) return;
    event.preventDefault();
    setIntent(nextIntent);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-intent="${nextIntent}"]`)?.focus();
  }

  async function handlePrimaryAction() {
    setLocalError(null);

    if (intent === 'sign-up') {
      if (password !== passwordConfirm) {
        setLocalError('パスワード確認が一致していません。');
        return;
      }

      const didRegister = await onSignUpWithPassword(email, password, username);

      if (didRegister) {
        setIntent('sign-in');
        setPassword('');
        setPasswordConfirm('');
      }

      return;
    }

    await onSignInWithPassword(email, password);
  }

  return (
    <main className="auth-shell auth-entry-shell">
      {notice ? (
        <div className={`app-toast-layer ${notice.placement ?? 'top'}`} aria-live="polite">
          <div className={`app-notice app-toast ${notice.tone}`}>
            <span>{notice.text}</span>
            {notice.actionLabel && notice.onAction ? (
              <button
                className="app-toast-action"
                onClick={() => {
                  void notice.onAction?.();
                }}
                type="button"
              >
                {notice.actionLabel}
              </button>
            ) : null}
            <button
              className="app-toast-close"
              onClick={onDismissNotice}
              type="button"
              aria-label="通知を閉じる"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <section className="auth-entry" aria-labelledby={`${formId}-heading`}>
        <h1 id={`${formId}-heading`} className="auth-entry-heading">{requestTitle}</h1>
        <div className="auth-entry-brand">
          <LaplanceLogo />
        </div>

        <div className="auth-entry-content">
          <div className="auth-entry-modes" role="tablist" aria-label="認証モード">
            {(['sign-in', 'sign-up'] as const).map(mode => <button
              key={mode}
              id={`${formId}-${mode}`}
              className="auth-entry-mode"
              data-intent={mode}
              onClick={() => setIntent(mode)}
              onKeyDown={handleModeKeyDown}
              type="button"
              role="tab"
              aria-selected={intent === mode}
              aria-controls={`${formId}-panel`}
              tabIndex={intent === mode ? 0 : -1}
            >
              {mode === 'sign-in' ? 'ログイン' : '新規会員登録'}
            </button>)}
          </div>

          <div id={`${formId}-panel`} role="tabpanel" aria-labelledby={`${formId}-${intent}`}>
            <form
              className="auth-form"
              aria-label={requestTitle}
              onSubmit={(event) => {
                event.preventDefault();
                void handlePrimaryAction();
              }}
            >
              {intent === 'sign-up' ? (
                <label className="field">
                  <span>ユーザーネーム <small>任意</small></span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    name="username"
                    autoComplete="nickname"
                    placeholder="未入力ならメールアドレス"
                  />
                </label>
              ) : null}

              <label className="field">
                <span>メールアドレス</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>

              <label className="field">
                <span>パスワード</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={intent === 'sign-in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={intent === 'sign-up' ? '6文字以上' : 'パスワードを入力'}
                />
              </label>

              {intent === 'sign-up' ? (
                <label className="field">
                  <span>パスワード確認</span>
                  <input
                    type="password"
                    name="passwordConfirmation"
                    autoComplete="new-password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="もう一度入力"
                  />
                </label>
              ) : null}

              {localError ? <p className="auth-entry-error" role="alert">{localError}</p> : null}

              <button className="auth-entry-submit" type="submit">
                {requestButtonLabel}
              </button>

              {intent === 'sign-in' ? (
                <>
                  <button
                    className="auth-entry-reset"
                    onClick={() => void onSendPasswordReset(email)}
                    type="button"
                  >
                    パスワードを再設定
                  </button>
                  <div className="auth-entry-divider" aria-hidden="true">または</div>
                  <button
                    className="auth-entry-google"
                    onClick={() => void onSignInWithGoogle()}
                    type="button"
                  >
                    Googleでログイン
                  </button>
                </>
              ) : <p className="auth-entry-hint">登録後、確認メールをお送りします。</p>}
            </form>
          </div>
        </div>
        <nav className="auth-entry-legal" aria-label="利用に関する情報">
          <a href="/terms">利用規約</a>
          <a href="/privacy">プライバシーポリシー</a>
        </nav>
      </section>
      <AuthStarfield />
    </main>
  );
}
