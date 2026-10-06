import { startupTiming } from '../lib/startupTiming';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRootManagedAuthentication } from '../components/RootManagedAuthenticationContext';
import { useRootStartupReady } from '../components/RootStartupReadyContext';
import { authRepository } from '../repositories';
import type { User, UserProfileDraft } from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UseAuthSessionStateOptions {
  showNotice: ShowNotice;
  expectedUserId?: string;
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
  expectedUserId,
}: UseAuthSessionStateOptions): UseAuthSessionStateResult {
  const bootstrapGeneration = useRef(0);
  useEffect(() => () => { bootstrapGeneration.current += 1; }, []);
  const rootManagedAuthentication = useRootManagedAuthentication();
  const markRootStartupReady = useRootStartupReady();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const bootstrapSession = useCallback(
    async (loadPlannerData: (userId: string) => Promise<void>) => {
      const generation = ++bootstrapGeneration.current;
      setBooting(true);
      const finishBootstrap = startupTiming.begin('bootstrap');
      let startupOutcome: 'success' | 'error' = 'success';

      try {
        const currentUser = await startupTiming.measure('profile', () => authRepository.getCurrentUser());
        if (generation !== bootstrapGeneration.current) return;
        if (currentUser && expectedUserId && currentUser.id !== expectedUserId) {
          // Live Firebase identity can move ahead of the root's committed session.
          // Wait for that root transition; never load B under A's consent boundary.
          bootstrapGeneration.current += 1;
          return;
        }

        if (!currentUser) {
          setUser(null);
          return;
        }

        setUser(currentUser);

        try {
          await loadPlannerData(currentUser.id);
        } catch (error) {
          if (generation !== bootstrapGeneration.current) return;
          startupOutcome = 'error';
          showNotice(
            error instanceof Error
              ? error.message
              : '学習データの読み込みに失敗しました。',
            'error',
          );
        }
      } catch (error) {
        if (generation !== bootstrapGeneration.current) return;
        startupOutcome = 'error';
        showNotice(
          error instanceof Error
            ? error.message
            : 'セッションの復元に失敗しました。',
          'error',
        );
      } finally {
        finishBootstrap(generation === bootstrapGeneration.current ? startupOutcome : 'cancelled');
        if (generation !== bootstrapGeneration.current) return;
        setBooting(false);
        markRootStartupReady?.();
      }
    },
    [expectedUserId, markRootStartupReady, showNotice],
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
    bootstrapGeneration.current += 1;
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
