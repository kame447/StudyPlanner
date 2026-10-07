import { startupTiming } from '../lib/startupTiming';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRootManagedAuthentication } from '../components/RootManagedAuthenticationContext';
import { useRootStartupReady } from '../components/RootStartupReadyContext';
import { authRepository } from '../repositories';
import type { User, UserProfileDraft } from '../types/domain';
import type { ShowNotice } from './useNoticeState';

interface UseAuthSessionStateOptions {
  showNotice: ShowNotice;
  expectedUserId?: string;
  onBootstrapSettled?: () => void;
}

type SignInResult = User | null | undefined;

export class ProfileSaveScopeExpiredError extends Error {
  constructor() {
    super('ログイン状態または画面が切り替わったため、保存結果を現在の画面に反映できませんでした。保存結果を確認してください。');
    this.name = 'ProfileSaveScopeExpiredError';
  }
}

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
  onBootstrapSettled,
}: UseAuthSessionStateOptions): UseAuthSessionStateResult {
  const bootstrapGeneration = useRef(0);
  useEffect(() => () => { bootstrapGeneration.current += 1; }, []);
  const rootManagedAuthentication = useRootManagedAuthentication();
  const markRootStartupReady = useRootStartupReady();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // Save-result applicability is separate from startup orchestration. Retiring
  // a save must never prevent an in-flight bootstrap from settling its UI.
  const profileSaveGeneration = useRef(0);
  const profileSaveOwner = useRef<{ userId: string } | null>(null);
  const invalidateProfileSaves = useCallback(() => { profileSaveGeneration.current += 1; }, []);
  const profileUserId = user?.id;
  useLayoutEffect(() => {
    const owner = profileUserId && (!expectedUserId || expectedUserId === profileUserId)
      ? { userId: profileUserId } : null;
    profileSaveOwner.current = owner;
    return () => {
      if (profileSaveOwner.current === owner) profileSaveOwner.current = null;
      invalidateProfileSaves();
    };
  }, [profileUserId, expectedUserId, invalidateProfileSaves]);

  const bootstrapSession = useCallback(
    async (loadPlannerData: (userId: string) => Promise<void>) => {
      const generation = ++bootstrapGeneration.current;
      invalidateProfileSaves();
      setBooting(true);
      const finishBootstrap = startupTiming.begin('bootstrap');
      let startupOutcome: 'success' | 'error' = 'success';
      const notifySettled = () => {
        try { onBootstrapSettled?.(); } catch { /* Optional cleanup cannot alter bootstrap. */ }
      };

      try {
        const currentUser = await startupTiming.measure('profile', () => authRepository.getCurrentUser());
        if (generation !== bootstrapGeneration.current) return;
        invalidateProfileSaves();
        if (currentUser && expectedUserId && currentUser.id !== expectedUserId) {
          // Live Firebase identity can move ahead of the root's committed session.
          // Wait for that root transition; never load B under A's consent boundary.
          notifySettled();
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
        notifySettled();
        markRootStartupReady?.();
      }
    },
    [expectedUserId, invalidateProfileSaves, markRootStartupReady, onBootstrapSettled, showNotice],
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
        invalidateProfileSaves();

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
    [invalidateProfileSaves, rootManagedAuthentication, showNotice],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      const currentUser = await authRepository.signInWithGoogle();
      invalidateProfileSaves();

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
  }, [invalidateProfileSaves, rootManagedAuthentication, showNotice]);

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
        throw new Error('ログイン状態を確認できませんでした。');
      }
      const owner = profileSaveOwner.current;
      const generation = profileSaveGeneration.current;
      const isCurrent = () => Boolean(owner && owner.userId === user.id
        && profileSaveOwner.current === owner && profileSaveGeneration.current === generation);
      if (!isCurrent()) throw new ProfileSaveScopeExpiredError();

      try {
        const nextUser = await authRepository.updateUserProfile(user.id, draft);
        if (!isCurrent()) throw new ProfileSaveScopeExpiredError();
        setUser(current => isCurrent() && current?.id === user.id ? nextUser : current);
        if (!isCurrent()) throw new ProfileSaveScopeExpiredError();
        showNotice('プロフィールを更新しました。', 'success');
      } catch (error) {
        if (!isCurrent()) throw new ProfileSaveScopeExpiredError();
        showNotice(
          error instanceof Error
            ? error.message
            : 'プロフィールを更新できませんでした。',
          'error',
        );
        throw error;
      }
    },
    [showNotice, user],
  );

  const signOut = useCallback(async () => {
    bootstrapGeneration.current += 1;
    invalidateProfileSaves();
    await authRepository.signOut();
    invalidateProfileSaves();
    setUser(null);
    showNotice('ログアウトしました。');
  }, [invalidateProfileSaves, showNotice]);

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
