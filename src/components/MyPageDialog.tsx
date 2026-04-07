import { useEffect, useState } from 'react';
import { AVATAR_OPTIONS, getUserDisplayName } from '../lib/userProfile';
import type { ThemeMode } from '../hooks/useThemePreference';
import type { User, UserProfileDraft } from '../types/domain';
import { UserAvatar } from './UserAvatar';

interface MyPageDialogProps {
  open: boolean;
  user: User;
  themeMode: ThemeMode;
  onChangeTheme: (nextThemeMode: ThemeMode) => void;
  onSaveProfile: (draft: UserProfileDraft) => Promise<void>;
  onClose: () => void;
}

export function MyPageDialog({
  open,
  user,
  themeMode,
  onChangeTheme,
  onSaveProfile,
  onClose,
}: MyPageDialogProps) {
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState(user.avatar);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setUsername(user.username);
    setAvatar(user.avatar);
    setStatus('');
  }, [open, user.avatar, user.username]);

  if (!open) {
    return null;
  }

  async function handleSaveProfile() {
    await onSaveProfile({
      username,
      avatar,
    });
    setStatus('保存しました。');
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <div className="modal-card my-page-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>マイページ</h2>
              <p>表示名、アイコン、テーマをまとめて調整できます。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <section className="assistant-settings-card profile-hero-card">
            <div className="profile-hero">
              <UserAvatar
                user={{
                  ...user,
                  username,
                  avatar,
                }}
              />
              <div>
                <strong className="profile-name">
                  {getUserDisplayName({ username, email: user.email })}
                </strong>
                <p className="detail-note">{user.email}</p>
              </div>
            </div>
          </section>

          <section className="assistant-settings-card">
            <label className="field">
              <span>ユーザーネーム</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="未入力ならメールアドレスを使います"
              />
            </label>

            <div className="field">
              <span>アイコン</span>
              <div className="avatar-option-grid">
                <button
                  className={!avatar ? 'avatar-option active' : 'avatar-option'}
                  onClick={() => setAvatar('')}
                  type="button"
                >
                  文字
                </button>
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={avatar === option ? 'avatar-option active' : 'avatar-option'}
                    onClick={() => setAvatar(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="assistant-settings-card">
            <div className="field">
              <span>テーマ</span>
              <div className="segmented-control">
                <button
                  className={themeMode === 'light' ? 'segment active' : 'segment'}
                  onClick={() => onChangeTheme('light')}
                  type="button"
                >
                  ライト
                </button>
                <button
                  className={themeMode === 'dark' ? 'segment active' : 'segment'}
                  onClick={() => onChangeTheme('dark')}
                  type="button"
                >
                  ダーク
                </button>
              </div>
            </div>
          </section>

          <div className="row-actions">
            <button className="primary-button" onClick={() => void handleSaveProfile()} type="button">
              プロフィールを保存
            </button>
            {status ? <span className="inline-note">{status}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
