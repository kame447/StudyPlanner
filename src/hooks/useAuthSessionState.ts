import { useCallback, useState } from 'react';
import {
  getDevTestLoginEmail,
  isDevTestLoginEmail,
  isDevTestLoginEnabled,
} from '../lib/devAuthShortcut';
import { authRepository } from '../repositories';
import type { EmailChallenge, User, UserProfileDraft } from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UseAuthSessionStateOptions {
  showNotice: ShowNotice;
}

interface UseAuthSessionStateResult {
  booting: boolean;
  user: User | null;
  challenge: EmailChallenge | null;
  bootstrapSession: (
    loadPlannerData: (userId: string) => Promise<void>,
  ) => Promise<void>;
  requestCode: (email: string, username: string) => Promise<User | null>;
  verifyCode: (
    email: string,
    code: string,
    username: string,
  ) => Promise<User | null>;
  saveUserProfile: (draft: UserProfileDraft) => Promise<void>;
  signOut: () => Promise<void>;
  resetChallenge: () => void;
}

export function useAuthSessionState({
  showNotice,
}: UseAuthSessionStateOptions): UseAuthSessionStateResult {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);

  const bootstrapSession = useCallback(
    async (loadPlannerData: (userId: string) => Promise<void>) => {
      setBooting(true);

      try {
        const currentUser = await authRepository.getCurrentUser();

        if (!currentUser) {
          return;
        }

        setUser(currentUser);
        await loadPlannerData(currentUser.id);
      } catch (error) {
        showNotice(
          error instanceof Error
            ? error.message
            : 'セッションの復元に失敗しました。',
          'error',
        );
      } finally {
        setBooting(false);
      }
    },
    [showNotice],
  );

  const requestCode = useCallback(
    async (email: string, username: string) => {
      try {
        if (isDevTestLoginEnabled() && isDevTestLoginEmail(email)) {
          const previewChallenge = await authRepository.requestEmailCode(
            getDevTestLoginEmail(),
            username || getDevTestLoginEmail(),
          );

          if (!previewChallenge.previewCode) {
            throw new Error('開発用テストログインのコードを発行できませんでした。');
          }

          const currentUser = await authRepository.verifyEmailCode(
            previewChallenge.email,
            previewChallenge.previewCode,
            previewChallenge.username,
          );

          setUser(currentUser);
          setChallenge(null);
          showNotice('開発用テストアカウントでログインしました。', 'success');
          return currentUser;
        }

        const nextChallenge = await authRepository.requestEmailCode(email, username);
        setChallenge(nextChallenge);
        showNotice(
          nextChallenge.delivery === 'email'
            ? '認証コードをメールで送信しました。受信トレイを確認してください。'
            : '認証コードを発行しました。MVP用メールボックスを確認してください。',
        );
        return null;
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : '認証コードを発行できませんでした。',
          'error',
        );
        return null;
      }
    },
    [showNotice],
  );

  const verifyCode = useCallback(
    async (email: string, code: string, username: string) => {
      try {
        const currentUser = await authRepository.verifyEmailCode(email, code, username);
        setUser(currentUser);
        setChallenge(null);
        showNotice('ログインしました。', 'success');
        return currentUser;
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : 'ログインに失敗しました。',
          'error',
        );
        return null;
      }
    },
    [showNotice],
  );

  const saveUserProfile = useCallback(
    async (draft: UserProfileDraft) => {
      if (!user) {
        return;
      }

      try {
        const nextUser = await authRepository.updateUserProfile(user.id, draft);
        setUser(nextUser);
        showNotice('プロフィールを更新しました。', 'success');
      } catch (error) {
        showNotice(
          error instanceof Error
            ? error.message
            : 'プロフィールを更新できませんでした。',
          'error',
        );
      }
    },
    [showNotice, user],
  );

  const signOut = useCallback(async () => {
    await authRepository.signOut();
    setUser(null);
    setChallenge(null);
    showNotice('ログアウトしました。');
  }, [showNotice]);

  const resetChallenge = useCallback(() => {
    setChallenge(null);
  }, []);

  return {
    booting,
    user,
    challenge,
    bootstrapSession,
    requestCode,
    verifyCode,
    saveUserProfile,
    signOut,
    resetChallenge,
  };
}
