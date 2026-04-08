import { useEffect, useState } from 'react';
import type { NoticeState } from '../hooks/useNoticeState';
import type { EmailChallenge } from '../types/domain';

type AuthIntent = 'sign-in' | 'sign-up';

interface AuthScreenProps {
  challenge: EmailChallenge | null;
  notice: NoticeState | null;
  onDismissNotice: () => void;
  onRequestCode: (email: string, username: string) => Promise<void>;
  onVerifyCode: (email: string, code: string, username: string) => Promise<void>;
  onResetChallenge: () => void;
}

export function AuthScreen({
  challenge,
  notice,
  onDismissNotice,
  onRequestCode,
  onVerifyCode,
  onResetChallenge,
}: AuthScreenProps) {
  const [intent, setIntent] = useState<AuthIntent>('sign-up');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (challenge) {
      setEmail(challenge.email);
      setUsername(challenge.username);
      setCode('');
    }
  }, [challenge]);

  const requestTitle =
    intent === 'sign-up' ? '新規会員登録' : 'ログイン';
  const requestDescription =
    intent === 'sign-up'
      ? '最初にユーザーネームとメールアドレスを登録して、認証コードを受け取ります。'
      : '登録済みのメールアドレスで認証コードを受け取り、そのままログインします。';
  const requestButtonLabel =
    intent === 'sign-up' ? '登録用コードを受け取る' : 'ログインコードを受け取る';

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

      <section className="auth-card auth-aside-card">
        <p className="eyebrow">Study Planner</p>
        <h1>学習の流れを崩さずに入れるための認証画面</h1>
        <p className="hero-copy">
          GitHub の「登録時だけ追加情報を求める」流れと、Notion や Slack の
          「メール起点で短く進める」導線を参考に、ログインと新規登録を分けています。
        </p>

        <div className="auth-highlight-list">
          <article className="auth-highlight-card">
            <strong>1. 用途を選ぶ</strong>
            <p>ログインと新規会員登録を最初に分けて、入力項目を減らします。</p>
          </article>
          <article className="auth-highlight-card">
            <strong>2. メールで確認</strong>
            <p>次の段で認証コードだけ入力するので、流れが混ざりません。</p>
          </article>
          <article className="auth-highlight-card">
            <strong>3. そのまま利用開始</strong>
            <p>ログイン後はユーザーネーム表示で継続しやすくしています。</p>
          </article>
        </div>
      </section>

      <section className="auth-card auth-main-card">
        <div className="auth-mode-tabs" role="tablist" aria-label="認証モード">
          <button
            className={intent === 'sign-up' ? 'auth-mode-tab active' : 'auth-mode-tab'}
            onClick={() => setIntent('sign-up')}
            type="button"
          >
            新規会員登録
          </button>
          <button
            className={intent === 'sign-in' ? 'auth-mode-tab active' : 'auth-mode-tab'}
            onClick={() => setIntent('sign-in')}
            type="button"
          >
            ログイン
          </button>
        </div>

        <div className="auth-stage-card">
          <div className="auth-stage-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>{requestTitle}</h2>
              <p>{requestDescription}</p>
            </div>
          </div>

          <div className="auth-form">
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

            <button
              className="primary-button"
              onClick={() =>
                void onRequestCode(email, intent === 'sign-up' ? username : email)
              }
              type="button"
            >
              {requestButtonLabel}
            </button>
          </div>
        </div>

        <div className="auth-stage-card auth-stage-card-secondary">
          <div className="auth-stage-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>認証コードの入力</h2>
              <p>
                {challenge
                  ? challenge.delivery === 'email'
                    ? 'メールで届いた認証コードを入力してください。'
                    : 'MVP用の確認コードを入力してください。'
                  : '先に上のステップで認証コードを発行してください。'}
              </p>
            </div>
          </div>

          {challenge ? (
            <div className="section-stack">
              <div className="mailbox-preview">
                <div className="auth-summary-grid">
                  <div>
                    <p className="mailbox-label">送信先</p>
                    <strong>{challenge.email}</strong>
                  </div>
                  <div>
                    <p className="mailbox-label">表示名</p>
                    <strong>{challenge.username}</strong>
                  </div>
                </div>

                {challenge.delivery === 'preview' && challenge.previewCode ? (
                  <>
                    <p className="mailbox-label">MVP用コード</p>
                    <div className="mailbox-code">{challenge.previewCode}</div>
                  </>
                ) : (
                  <p className="detail-note">
                    メール本文に届いた 6 桁コードをこの下へ入力してください。
                  </p>
                )}

                <p className="mailbox-expire">
                  有効期限: {new Date(challenge.expiresAt).toLocaleTimeString('ja-JP')}
                </p>
              </div>

              <label className="field">
                <span>認証コード</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="6桁コード"
                />
              </label>

              <div className="row-actions">
                <button
                  className="ghost-button"
                  onClick={onResetChallenge}
                  type="button"
                >
                  メールを入力し直す
                </button>
                <button
                  className="primary-button"
                  onClick={() => void onVerifyCode(email, code, username || email)}
                  type="button"
                >
                  ログインする
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              コード送信後、この欄が有効になります。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
