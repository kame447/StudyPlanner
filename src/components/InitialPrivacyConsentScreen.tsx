import { useState } from 'react';
import { StudyPlannerLogo } from './StudyPlannerLogo';

interface InitialPrivacyConsentScreenProps {
  unavailable: boolean;
  error: string;
  onAccept: () => Promise<boolean>;
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function InitialPrivacyConsentScreen({
  unavailable,
  error,
  onAccept,
  onRetry,
  onSignOut,
}: InitialPrivacyConsentScreenProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  async function accept() {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setLocalError('');
    try {
      const accepted = await onAccept();
      if (!accepted) {
        setLocalError('同意内容を保存できませんでした。もう一度お試しください。');
      }
    } catch (caught) {
      setLocalError(
        caught instanceof Error && caught.message.trim()
          ? caught.message.trim()
          : '同意内容を保存できませんでした。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell auth-shell-modern">
      <section className="auth-card auth-main-card">
        <div className="auth-brand-header">
          <StudyPlannerLogo />
        </div>

        <div className="auth-stage-card">
          <div className="auth-stage-header">
            <div>
              <h2>初回利用の確認</h2>
              <p>
                この確認はアカウントごとに一度だけ行います。同意済みの場合、次回以降のログインでは表示しません。
              </p>
            </div>
          </div>

          {unavailable ? (
            <div className="auth-form">
              <p className="inline-error">
                {error || '同意状況を確認できませんでした。通信状態を確認してください。'}
              </p>
              <button
                className="primary-button"
                onClick={() => void onRetry()}
                type="button"
              >
                もう一度確認する
              </button>
              <button
                className="ghost-button"
                onClick={() => void onSignOut()}
                type="button"
              >
                ログアウトする
              </button>
            </div>
          ) : (
            <div className="auth-form">
              <div className="panel section-stack">
                <strong>週間計画機能で保存する情報</strong>
                <p>
                  週間計画で入力した会話、AIの回答、作成途中の条件、仮予定、処理結果を、個別最適化、品質改善、不具合調査のために保存します。
                </p>
                <p>
                  アカウント番号は記録本文へ直接保存せず、メールアドレスや電話番号などは保存前に除去します。記録は原則180日で削除します。
                </p>
                <p>
                  調査権限を持つ担当者が必要な場合に限って閲覧し、閲覧操作は記録します。削除を希望する場合はお問い合わせから申請できます。
                </p>
              </div>

              <label className="field">
                <span>
                  <input
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    type="checkbox"
                  />{' '}
                  上記のデータ保存と利用目的を確認し、同意します。
                </span>
              </label>

              <p className="auth-legal-note">
                詳細は<a href="/terms">利用規約</a>および
                <a href="/privacy">プライバシーポリシー</a>をご確認ください。
              </p>

              {localError || error ? (
                <p className="inline-error">{localError || error}</p>
              ) : null}

              <button
                className="primary-button"
                disabled={!confirmed || submitting}
                onClick={() => void accept()}
                type="button"
              >
                {submitting ? '保存中...' : '同意して利用を開始する'}
              </button>
              <button
                className="ghost-button"
                disabled={submitting}
                onClick={() => void onSignOut()}
                type="button"
              >
                同意せずログアウトする
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
