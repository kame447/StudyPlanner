import { useEffect, useState } from 'react';
import type { NoticeState } from '../hooks/useNoticeState';

type AuthIntent = 'sign-in' | 'sign-up';

interface AuthScreenProps {
  notice: NoticeState | null;
  onDismissNotice: () => void;
  accessGateEnabled: boolean;
  accessGateUnlocked: boolean;
  onUnlockAccessGate: (key: string) => boolean;
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
  accessGateEnabled,
  accessGateUnlocked,
  onUnlockAccessGate,
  onSignUpWithPassword,
  onSignInWithPassword,
  onSignInWithGoogle,
  onSendPasswordReset,
}: AuthScreenProps) {
  const [intent, setIntent] = useState<AuthIntent>('sign-up');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setPasswordConfirm('');
    setLocalError(null);
  }, [intent]);

  const requestTitle = intent === 'sign-up' ? '新規会員登録' : 'ログイン';
  const requestDescription =
    intent === 'sign-up'
      ? '最初にメールアドレスとパスワードを登録し、確認メールを1回だけ送ります。'
      : '登録済みのメールアドレスとパスワードでログインします。';
  const requestButtonLabel =
    intent === 'sign-up' ? '登録して確認メールを送る' : 'ログインする';

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

  function handleAccessUnlock() {
    setLocalError(null);

    if (!onUnlockAccessGate(accessKey)) {
      setLocalError('閲覧キーが一致しません。');
      return;
    }

    setAccessKey('');
  }

  return (
    <main className="auth-shell auth-shell-modern">
      {notice ? (
        <div className="app-toast-layer" aria-live="polite">
          <div className={`app-notice app-toast ${notice.tone}`}>
            <span>{notice.text}</span>
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

      <section className="auth-card auth-main-card">
        <div className="auth-stage-card">
          <div className="auth-stage-header">
            <div>
              <h2>
                {accessGateEnabled && !accessGateUnlocked ? '限定公開キー' : requestTitle}
              </h2>
              <p>
                {accessGateEnabled && !accessGateUnlocked
                  ? '共有されたキーを一度だけ入力すると、この端末でログイン画面へ進めます。'
                  : requestDescription}
              </p>
            </div>
          </div>

          {accessGateEnabled && !accessGateUnlocked ? (
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleAccessUnlock();
              }}
            >
              <label className="field">
                <span>閲覧キー</span>
                <input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="共有されたキーを入力"
                />
              </label>

              {localError ? <p className="inline-error">{localError}</p> : null}

              <button
                className="primary-button"
                type="submit"
              >
                キーを確認して進む
              </button>
            </form>
          ) : (
            <>
              <div className="auth-mode-tabs" role="tablist" aria-label="認証モード">
                <button
                  className={
                    intent === 'sign-up' ? 'auth-mode-tab active' : 'auth-mode-tab'
                  }
                  onClick={() => setIntent('sign-up')}
                  type="button"
                >
                  新規会員登録
                </button>
                <button
                  className={
                    intent === 'sign-in' ? 'auth-mode-tab active' : 'auth-mode-tab'
                  }
                  onClick={() => setIntent('sign-in')}
                  type="button"
                >
                  ログイン
                </button>
              </div>

              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handlePrimaryAction();
                }}
              >
                {intent === 'sign-up' ? (
                  <label className="field">
                    <span>ユーザーネーム</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="未入力ならメールアドレスを使います"
                    />
                  </label>
                ) : null}

                <label className="field">
                  <span>メールアドレス</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>

                <label className="field">
                  <span>パスワード</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="6文字以上"
                  />
                </label>

                {intent === 'sign-up' ? (
                  <label className="field">
                    <span>パスワード確認</span>
                    <input
                      type="password"
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      placeholder="もう一度入力"
                    />
                  </label>
                ) : null}

                {localError ? <p className="inline-error">{localError}</p> : null}

                <button
                  className="primary-button"
                  type="submit"
                >
                  {requestButtonLabel}
                </button>

                {intent === 'sign-in' ? (
                  <div className="row-actions">
                    <button
                      className="ghost-button"
                      onClick={() => void onSendPasswordReset(email)}
                      type="button"
                    >
                      パスワードを再設定
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => void onSignInWithGoogle()}
                      type="button"
                    >
                      Googleでログイン
                    </button>
                  </div>
                ) : null}
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
