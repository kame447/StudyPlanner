import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createAvatarDataUrl, isImageAvatar } from '../lib/avatarImage';
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
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

export function MyPageDialog({
  open,
  user,
  themeMode,
  onChangeTheme,
  onSaveProfile,
  onSignOut,
  onClose,
}: MyPageDialogProps) {
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState(user.avatar);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setUsername(user.username);
    setAvatar(user.avatar);
    setStatus('');
    setStatusTone('info');
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
    setStatusTone('info');
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus('画像を処理しています...');
    setStatusTone('info');

    try {
      const avatarDataUrl = await createAvatarDataUrl(file);
      setAvatar(avatarDataUrl);
      setStatus('写真を読み込みました。保存すると反映されます。');
      setStatusTone('info');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '写真を読み込めませんでした。',
      );
      setStatusTone('error');
    } finally {
      event.target.value = '';
    }
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
              <div className="avatar-upload-row">
                <button
                  className="ghost-button"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  写真を選ぶ
                </button>
                {isImageAvatar(avatar) ? (
                  <button
                    className="ghost-button"
                    onClick={() => setAvatar('')}
                    type="button"
                  >
                    写真を外す
                  </button>
                ) : null}
                <input
                  ref={fileInputRef}
                  className="hidden-file-input"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarFileChange}
                  type="file"
                />
              </div>
              <p className="detail-note">
                写真は自動で正方形に整えて小さめに保存します。
              </p>
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
            <button className="ghost-button danger" onClick={() => void onSignOut()} type="button">
              ログアウト
            </button>
            {status ? (
              <span className={statusTone === 'error' ? 'inline-error' : 'inline-note'}>
                {status}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
