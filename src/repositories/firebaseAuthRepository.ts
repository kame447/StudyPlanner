import { UserFacingError } from '../lib/userFacingError';
import { observeStartupDocument } from './observeStartupDocument';
import type { Auth, User as FirebaseAuthUser } from 'firebase/auth';
import {
  browserLocalPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import type { FieldValue, Firestore } from 'firebase/firestore';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createGoogleProvider } from '../lib/firebaseClient';
import type { User } from '../types/domain';
import type { AuthRepository } from './repositoryContracts';

interface ProfileDoc {
  id: string;
  email: string;
  username: string;
  avatar: string;
  createdAt: string;
}

type ProfileWriteDoc = ProfileDoc & {
  registeredAt?: FieldValue;
};

let localPersistencePromise: Promise<void> | null = null;

async function ensureLocalAuthPersistence(auth: Auth): Promise<void> {
  if (!localPersistencePromise) {
    localPersistencePromise = setPersistence(auth, browserLocalPersistence).catch(
      (error) => {
        localPersistencePromise = null;
        throw error;
      },
    );
  }

  await localPersistencePromise;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string, email: string): string {
  const trimmedUsername = username.trim();
  return trimmedUsername || email;
}

function authErrorMessage(fallbackMessage: string, error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'このメールアドレスはすでに登録されています。ログインするか、パスワードを再設定してください。';
    case 'auth/invalid-email': return 'メールアドレスの形式を確認してください。';
    case 'auth/weak-password': return 'パスワードは6文字以上にしてください。';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'メールアドレスまたはパスワードを確認してください。忘れた場合はパスワードを再設定できます。';
    case 'auth/user-disabled': return 'このアカウントは利用できません。管理者にお問い合わせください。';
    case 'auth/too-many-requests': return `操作が集中しています。しばらく待ってから操作してください。${fallbackMessage}`;
    case 'auth/network-request-failed': return `通信できませんでした。通信状況を確認してください。${fallbackMessage}`;
    case 'auth/popup-blocked': return 'ログイン画面を開けませんでした。ブラウザでポップアップを許可してから、もう一度お試しください。';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'ログインをキャンセルしました。続ける場合はもう一度Googleログインを選んでください。';
    case 'auth/requires-recent-login': return '安全のため、ログインし直してからもう一度操作してください。';
    default: return fallbackMessage;
  }
}

function mapProfileDocToUser(profile: ProfileDoc): User {
  return {
    id: profile.id,
    email: profile.email,
    username: profile.username.trim() || profile.email,
    avatar: profile.avatar,
    createdAt: profile.createdAt,
  };
}

async function waitForAuthUser(auth: Auth): Promise<FirebaseAuthUser | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function getProfileById(
  firestoreDb: Firestore,
  userId: string,
): Promise<ProfileDoc | null> {
  const snapshot = await getDoc(doc(firestoreDb, 'profiles', userId));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as ProfileDoc;
}

async function upsertProfile(
  firestoreDb: Firestore,
  profile: ProfileWriteDoc,
): Promise<ProfileDoc> {
  await setDoc(doc(firestoreDb, 'profiles', profile.id), profile, {
    merge: true,
  });
  return profile;
}

async function ensureProfile(
  firestoreDb: Firestore,
  authUser: FirebaseAuthUser,
  fallbackUsername: string,
): Promise<User> {
  const existingProfile = await getProfileById(firestoreDb, authUser.uid);
  const email = authUser.email?.trim().toLowerCase() || existingProfile?.email || '';

  if (!email) {
    throw new UserFacingError('ユーザーのメールアドレスを取得できませんでした。');
  }

  const createdAt = existingProfile?.createdAt
    || authUser.metadata.creationTime
    || new Date().toISOString();
  const nextProfile: ProfileDoc = {
    id: authUser.uid,
    email,
    username:
      existingProfile?.username?.trim() ||
      authUser.displayName?.trim() ||
      normalizeUsername(fallbackUsername, email),
    avatar: existingProfile?.avatar ?? '',
    createdAt,
  };
  const unchanged = existingProfile && Object.entries(nextProfile).every(
    ([key, value]) => existingProfile[key as keyof ProfileDoc] === value,
  );
  // Restoring an unchanged profile is a read, not a login heartbeat. Avoid a
  // redundant write acknowledgement before the planner can start loading.
  if (!unchanged) {
    try {
      await upsertProfile(firestoreDb, {
        ...nextProfile,
        ...(!existingProfile ? { registeredAt: serverTimestamp() } : {}),
      });
    } catch (error) {
      // Rules refuse profile writes once account deletion has started (#917);
      // signing in must still reach the deletion retry instead of failing.
      if ((error as { code?: string }).code !== 'permission-denied'
        || !(await getDoc(doc(firestoreDb, 'account_deletions', authUser.uid))).exists()) throw error;
    }
  }

  return mapProfileDocToUser(nextProfile);
}

function isPasswordLogin(user: FirebaseAuthUser): boolean {
  return user.providerData.some((provider) => provider.providerId === 'password');
}

export function createFirebaseAuthRepository(
  firebaseAuth: Auth,
  firestoreDb: Firestore,
): AuthRepository {
  return {
    async reauthenticate(password) {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error('ログインし直してください。');
      // The current sign-in provider determines the credential challenge.
      const token = await user.getIdTokenResult();
      if (token.signInProvider === 'google.com') {
        await reauthenticateWithPopup(user, createGoogleProvider());
      } else if (token.signInProvider === 'password' && user.email && password) {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else {
        throw new Error('パスワードを入力してください。');
      }
    },
    async signUpWithPassword(email, password, username) {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);
        const normalizedEmail = normalizeEmail(email);
        const normalizedUsername = normalizeUsername(username, normalizedEmail);

        if (!normalizedEmail.includes('@')) {
          throw new UserFacingError('メールアドレスの形式を確認してください。');
        }

        if (password.trim().length < 6) {
          throw new UserFacingError('パスワードは6文字以上にしてください。');
        }

        const credential = await createUserWithEmailAndPassword(
          firebaseAuth,
          normalizedEmail,
          password,
        );

        await updateProfile(credential.user, {
          displayName: normalizedUsername,
        });
        await ensureProfile(firestoreDb, credential.user, normalizedUsername);
        await sendEmailVerification(credential.user);
        await firebaseSignOut(firebaseAuth);
      } catch (error) {
        throw new UserFacingError(
          authErrorMessage('登録の完了を確認できませんでした。確認メールの受信状況やログイン状態を確認してください。', error),
        );
      }
    },
    async signInWithPassword(email, password) {
      const normalizedEmail = normalizeEmail(email);

      try {
        await ensureLocalAuthPersistence(firebaseAuth);
        const credential = await signInWithEmailAndPassword(
          firebaseAuth,
          normalizedEmail,
          password,
        );

        if (isPasswordLogin(credential.user) && !credential.user.emailVerified) {
          // An expired, lost or never-sent link must not lock the account out:
          // a password-proven login is the only place to send a fresh one.
          let resent = true;
          try {
            await sendEmailVerification(credential.user);
          } catch {
            resent = false;
          }
          await firebaseSignOut(firebaseAuth);
          throw new UserFacingError(resent
            ? 'メール確認がまだ完了していません。確認メールを再送しました。新しいメールのリンクを開いてからログインしてください。'
            : 'メール確認がまだ完了していません。受信トレイの確認リンクを開いてからログインしてください。リンクの期限が切れた場合は、しばらく待ってからもう一度ログインすると確認メールを再送します。',
          );
        }

        return await ensureProfile(
          firestoreDb,
          credential.user,
          credential.user.displayName || normalizedEmail,
        );
      } catch (error) {
        throw new UserFacingError(
          authErrorMessage('ログインを完了できませんでした。通信状況を確認して、もう一度お試しください。', error),
        );
      }
    },
    async signInWithGoogle() {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);
        const credential = await signInWithPopup(
          firebaseAuth,
          createGoogleProvider(),
        );

        return await ensureProfile(
          firestoreDb,
          credential.user,
          credential.user.displayName || credential.user.email || '',
        );
      } catch (error) {
        throw new UserFacingError(
          authErrorMessage(
            'Googleログインに失敗しました。',
            error,
          ),
        );
      }
    },
    async sendPasswordReset(email) {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail.includes('@')) {
          throw new UserFacingError('メールアドレスの形式を確認してください。');
        }

        await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      } catch (error) {
        throw new UserFacingError(
          authErrorMessage(
            'パスワード再設定メールを送信できませんでした。',
            error),
        );
      }
    },
    observeStartupProfile(expectedOwner, scope) {
      const eligible = () => {
        const user = firebaseAuth.currentUser;
        return scope.isCurrent() && Boolean(user && user.uid === expectedOwner
          && (!isPasswordLogin(user) || user.emailVerified));
      };
      return observeStartupDocument({ reference: doc(firestoreDb, 'profiles', expectedOwner),
        scope: { isCurrent: eligible, onInvalidate: dispose => scope.onInvalidate(dispose) },
        phase: 'profile-observation', stopPhase: 'profile-observer-stop' });
    },
    async getCurrentUser() {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);

        const authUser = await waitForAuthUser(firebaseAuth);

        if (!authUser) {
          return null;
        }

        if (isPasswordLogin(authUser) && !authUser.emailVerified) {
          await firebaseSignOut(firebaseAuth);
          return null;
        }

        return await ensureProfile(
          firestoreDb,
          authUser,
          authUser.displayName || authUser.email || '',
        );
      } catch (error) {
        throw new UserFacingError(authErrorMessage(
          'ログイン状態を確認できませんでした。通信状況を確認して再読み込みしてください。', error));
      }
    },
    async updateUserProfile(userId, draft) {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);

        const authUser = await waitForAuthUser(firebaseAuth);

        if (!authUser || authUser.uid !== userId) {
          throw new UserFacingError('ユーザー情報が見つかりません。');
        }

        const currentProfile = await getProfileById(firestoreDb, userId);
        const email = authUser.email?.trim().toLowerCase() || currentProfile?.email || '';

        if (!email) {
          throw new UserFacingError('メールアドレスを取得できませんでした。');
        }

        const nextUsername = normalizeUsername(draft.username, email);

        await updateProfile(authUser, {
          displayName: nextUsername,
        });

        const createdAt = currentProfile?.createdAt
          || authUser.metadata.creationTime
          || new Date().toISOString();
        const nextProfile = await upsertProfile(firestoreDb, {
          id: userId,
          email,
          username: nextUsername,
          avatar: draft.avatar.trim(),
          createdAt,
          ...(!currentProfile ? { registeredAt: serverTimestamp() } : {}),
        });

        return mapProfileDocToUser(nextProfile);
      } catch (error) {
        throw new UserFacingError(authErrorMessage(
          'プロフィールの更新結果を確認できませんでした。再読み込みして内容を確認してください。', error));
      }
    },
    async signOut() {
      try {
        await ensureLocalAuthPersistence(firebaseAuth);
        await firebaseSignOut(firebaseAuth);
      } catch (error) {
        throw new UserFacingError(authErrorMessage(
          'ログアウトを完了できませんでした。通信状況を確認して、もう一度お試しください。', error));
      }
    },
  };
}
