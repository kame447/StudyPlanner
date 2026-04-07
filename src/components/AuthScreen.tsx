import { useEffect, useState } from 'react';
import type { EmailChallenge } from '../types/domain';

interface AuthScreenProps {
  challenge: EmailChallenge | null;
  notice: string;
  onRequestCode: (email: string, username: string) => Promise<void>;
  onVerifyCode: (email: string, code: string, username: string) => Promise<void>;
}

export function AuthScreen({
  challenge,
  notice,
  onRequestCode,
  onVerifyCode,
}: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (challenge) {
      setEmail(challenge.email);
      setUsername(challenge.username);
    }
  }, [challenge]);

  return (
    <main className="auth-shell">
      <section className="auth-card hero-card">
        <p className="eyebrow">Study Planner MVP</p>
        <h1>入力のしやすさを優先した勉強計画アプリ</h1>
        <p className="hero-copy">
          月で全体を見て、週で計画と実績を比べ、日で細かく直す構成です。
          MVPではメールコード認証をローカルで再現し、将来は外部認証に差し替えられるように分離しています。
        </p>

        <div className="auth-form">
          <label className="field">
            <span>ユーザーネーム</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="未入力ならメールアドレスを使います"
            />
          </label>

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
            onClick={() => void onRequestCode(email, username)}
            type="button"
          >
            認証コードを送る
          </button>
        </div>

        {notice ? <p className="inline-note">{notice}</p> : null}
      </section>

      <section className="auth-card">
        <div className="section-header">
          <div>
            <h2>メール認証</h2>
            <p>このMVPでは画面内メールボックスでコードを確認します。</p>
          </div>
        </div>

        {challenge ? (
          <>
            <div className="mailbox-preview">
              <p className="mailbox-label">表示名</p>
              <strong>{challenge.username}</strong>
              <p className="mailbox-label">送信先</p>
              <strong>{challenge.email}</strong>
              <p className="mailbox-label">MVP用コード</p>
              <div className="mailbox-code">{challenge.previewCode}</div>
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

            <button
              className="primary-button"
              onClick={() => void onVerifyCode(email, code, username)}
              type="button"
            >
              ログインする
            </button>
          </>
        ) : (
          <p className="empty-copy">
            メールアドレスを入力してコードを発行してください。
          </p>
        )}
      </section>
    </main>
  );
}
