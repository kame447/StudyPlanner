import { useCallback, useState } from 'react';
import { useRootManagedAuthentication } from '../components/RootManagedAuthenticationContext';
import { authRepository } from '../repositories';
import type { User, UserProfileDraft } from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UseAuthSessionStateOptions {
  showNotice: ShowNotice;
}

type SignInResult = User | null | undefined;

interface UseAuthSessionStateResult {
  booting: boolean;
  user: User | null;
  bootstrapSession: (
    loadPlannerData: (userId: string) => Promise<void>,
  ) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    username: string,
  ) => Promise<boolean>;
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
  signInWithGoogle: () => Promise<SignInResult>;
  sendPasswordReset: (email: string) => Promise<void>;
  saveUserProfile: (draft: UserProfileDraft) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuthSessionState({
  showNotice,
}: UseAuthSessionStateOptions): UseAuthSessionStateResult {
  const rootManagedAuthentication = useRootManagedAuthentication();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const bootstrapSession = useCallback(
    async (loadPlannerData: (userId: string) => Promise<void>) => {
      setBooting(true);

      try {
        const currentUser = await authRepository.getCurrentUser();

        if (!currentUser) {
          setUser(null);
          return;
        }

        setUser(currentUser);

        try {
          await loadPlannerData(currentUser.id);
        } catch (error) {
          showNotice(
            error instanceof Error
              ? error.message
              : '学習データの読み込みに失敗しました。',
            'error',
          );
        }
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

  const signUpWithPassword = useCallback(
    async (email: string, password: string, username: string) => {
      try {
        await authRepository.signUpWithPassword(email, password, username);
        showNotice(
          '確認メールを送信しました。メール内のリンクを開いてからログインしてください。',
          'success',
        );
        return true;
      } catch (error) {
        showNotice(
          error instanceof Error ? error.message : '新規登録に失敗しました。',
          'error',
        );
        return false;
      }
    },
    [showNotice],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      try {
        const currentUser = await authRepository.signInWithPassword(email, password);

        if (rootManagedAuthentication) {
          showNotice('ログインしました。', 'success');
          return undefined;
        }

        setUser(currentUser);
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
    [rootManagedAuthentication, showNotice],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      const currentUser = await authRepository.signInWithGoogle();

      if (rootManagedAuthentication) {
        showNotice('Googleでログインしました。', 'success');
        return undefined;
      }

      setUser(currentUser);
      showNotice('Googleでログインしました。', 'success');
      return currentUser;
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : 'Googleログインに失敗しました。',
        'error',
      );
      return null;
    }
  }, [rootManagedAuthentication, showNotice]);

  const sendPasswordReset = useCallback(
    async (email: string) => {
      try {
        await authRepository.sendPasswordReset(email);
        showNotice(
          'パスワード再設定メールを送信しました。受信トレイを確認してください。',
          'success',
        );
      } catch (error) {
        showNotice(
          error instanceof Error
            ? error.message
            : 'パスワード再設定メールを送信できませんでした。',
          'error',
        );
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
    showNotice('ログアウトしました。');
  }, [showNotice]);

  return {
    booting,
    user,
    bootstrapSession,
    signUpWithPassword,
    signInWithPassword,
    signInWithGoogle,
    sendPasswordReset,
    saveUserProfile,
    signOut,
  };
}
