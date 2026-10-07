import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { Image, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { createAvatarDataUrl, isImageAvatar } from '../lib/avatarImage';
import { AVATAR_OPTIONS, getUserDisplayName } from '../lib/userProfile';
import type { User, UserProfileDraft } from '../types/domain';
import { UserAvatar } from './UserAvatar';

interface MyPageDialogProps {
  open: boolean;
  user: User;
  onSaveProfile: (draft: UserProfileDraft) => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

export function MyPageDialog({
  open,
  user,
  onSaveProfile,
  onSignOut,
  onClose,
}: MyPageDialogProps) {
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState(user.avatar);
  const [isAvatarSectionOpen, setIsAvatarSectionOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const session = useRef<object | null>(null);
  const selection = useRef<object | null>(null);
  const pendingPhoto = useRef<object | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isAdmin } = useAdminStatus(open ? user.id : null);

  useLayoutEffect(() => {
    session.current = null;
    selection.current = null;
    pendingPhoto.current = null;
    setIsProcessingPhoto(false);
    if (!open) {
      return;
    }

    session.current = {};
    setUsername(user.username);
    setAvatar(user.avatar);
    setIsAvatarSectionOpen(false);
    setStatus('');
    setStatusTone('info');
    return () => {
      session.current = null;
      selection.current = null;
      pendingPhoto.current = null;
    };
  }, [open, user.id, user.avatar, user.username]);

  if (!open) {
    return null;
  }

  async function handleSaveProfile() {
    const owner = session.current;
    const choice = selection.current;
    if (!owner || pendingPhoto.current) return;
    await onSaveProfile({
      username,
      avatar,
    });
    if (session.current !== owner || selection.current !== choice) return;
    setStatus('保存しました。');
    setStatusTone('info');
  }

  function handleClose() {
    session.current = null;
    selection.current = null;
    pendingPhoto.current = null;
    onClose();
  }

  function selectAvatar(value: string) {
    if (!session.current) return;
    selection.current = {};
    pendingPhoto.current = null;
    setIsProcessingPhoto(false);
    setAvatar(value);
    setStatus('');
    setStatusTone('info');
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    const owner = session.current;
    if (!file || !owner) {
      return;
    }

    // Clear synchronously so an older completion cannot clear a newer input.
    event.target.value = '';
    const choice = {};
    selection.current = choice;
    pendingPhoto.current = choice;
    setIsProcessingPhoto(true);
    const isCurrent = () => session.current === owner && selection.current === choice;
    setStatus('画像を処理しています...');
    setStatusTone('info');

    try {
      const avatarDataUrl = await createAvatarDataUrl(file);
      if (!isCurrent()) return;
      setAvatar(avatarDataUrl);
      setStatus('写真を読み込みました。保存すると反映されます。');
      setStatusTone('info');
    } catch (error) {
      if (!isCurrent()) return;
      setStatus(
        error instanceof Error ? error.message : '写真を読み込めませんでした。',
      );
      setStatusTone('error');
    } finally {
      if (isCurrent() && pendingPhoto.current === choice) {
        pendingPhoto.current = null;
        setIsProcessingPhoto(false);
      }
    }
  }

  function getAvatarSummary(): string {
    if (isImageAvatar(avatar)) {
      return '写真';
    }

    return avatar.trim() || '文字';
  }

  return (
    <div className="overlay modal-overlay" onClick={handleClose}>
      <div className="modal-card my-page-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>マイページ</h2>
              <p>表示名とアイコンを編集できます。</p>
            </div>
            <button className="ghost-button" onClick={handleClose} type="button">
              閉じる
            </button>
          </div>

          <section className="assistant-settings-card profile-hero-card">
            <strong className="settings-field-label">
              <UserIcon aria-hidden="true" size={20} strokeWidth={1.9} />
              ユーザー情報
            </strong>
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

            <div className="field collapsible-field">
              <button
                className="collapsible-toggle"
                onClick={() => setIsAvatarSectionOpen((current) => !current)}
                type="button"
              >
                <span className="collapsible-toggle-copy">
                  <span className="settings-field-label">
                    <Image aria-hidden="true" size={20} strokeWidth={1.9} />
                    アイコン
                  </span>
                  <strong>{getAvatarSummary()}</strong>
                </span>
                <span className="collapsible-toggle-summary" aria-hidden="true">
                  {isAvatarSectionOpen ? '閉じる' : '変更'}
                </span>
              </button>

              {isAvatarSectionOpen ? (
                <div className="collapsible-panel">
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
                        onClick={() => selectAvatar('')}
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
                      onClick={() => selectAvatar('')}
                      aria-pressed={!avatar}
                      type="button"
                    >
                      文字
                    </button>
                    {AVATAR_OPTIONS.map((option) => (
                      <button
                        key={option}
                        className={avatar === option ? 'avatar-option active' : 'avatar-option'}
                        onClick={() => selectAvatar(option)}
                        aria-pressed={avatar === option}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <div className="row-actions">
            <button className="primary-button" onClick={() => void handleSaveProfile()} type="button" disabled={isProcessingPhoto}>
              プロフィールを保存
            </button>
            {isAdmin ? (
              <button
                className="ghost-button"
                onClick={() => {
                  handleClose();
                  window.location.assign('/admin/users');
                }}
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.9} />
                管理者画面
              </button>
            ) : null}
            <button className="ghost-button danger" onClick={() => void onSignOut()} type="button">
              <LogOut aria-hidden="true" size={20} strokeWidth={1.9} />
              ログアウト
            </button>
            {status ? (
              <span role="status" className={statusTone === 'error' ? 'inline-error' : 'inline-note'}>
                {status}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
