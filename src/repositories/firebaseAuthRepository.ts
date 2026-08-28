import type { Auth, User as FirebaseAuthUser } from 'firebase/auth';
import {
  browserLocalPersistence,
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

function normalizeErrorMessage(
  fallbackMessage: string,
  error: { message?: string | null } | null,
): string {
  const message = error?.message?.trim();
  return message || fallbackMessage;
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
    throw new Error('ユーザーのメールアドレスを取得できませんでした。');
  }

  const createdAt = existingProfile?.createdAt
    || authUser.metadata.creationTime
    || new Date().toISOString();
  const nextProfile = await upsertProfile(firestoreDb, {
    id: authUser.uid,
    email,
    username:
      existingProfile?.username?.trim() ||
      authUser.displayName?.trim() ||
      normalizeUsername(fallbackUsername, email),
    avatar: existingProfile?.avatar ?? '',
    createdAt,
    ...(!existingProfile ? { registeredAt: serverTimestamp() } : {}),
  });

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
    async signUpWithPassword(email, password, username) {
      await ensureLocalAuthPersistence(firebaseAuth);

      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);

      if (!normalizedEmail.includes('@')) {
        throw new Error('メールアドレスの形式を確認してください。');
      }

      if (password.trim().length < 6) {
        throw new Error('パスワードは6文字以上にしてください。');
      }

      try {
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
        throw new Error(
          normalizeErrorMessage('新規登録に失敗しました。', error as { message?: string | null }),
        );
      }
    },
    async signInWithPassword(email, password) {
      await ensureLocalAuthPersistence(firebaseAuth);

      const normalizedEmail = normalizeEmail(email);

      try {
        const credential = await signInWithEmailAndPassword(
          firebaseAuth,
          normalizedEmail,
          password,
        );

        if (isPasswordLogin(credential.user) && !credential.user.emailVerified) {
          await firebaseSignOut(firebaseAuth);
          throw new Error(
            'メール確認がまだ完了していません。受信トレイの確認リンクを開いてからログインしてください。',
          );
        }

        return ensureProfile(
          firestoreDb,
          credential.user,
          credential.user.displayName || normalizedEmail,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('ログインに失敗しました。', error as { message?: string | null }),
        );
      }
    },
    async signInWithGoogle() {
      await ensureLocalAuthPersistence(firebaseAuth);

      try {
        const credential = await signInWithPopup(
          firebaseAuth,
          createGoogleProvider(),
        );

        return ensureProfile(
          firestoreDb,
          credential.user,
          credential.user.displayName || credential.user.email || '',
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            'Googleログインに失敗しました。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async sendPasswordReset(email) {
      await ensureLocalAuthPersistence(firebaseAuth);

      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail.includes('@')) {
        throw new Error('メールアドレスの形式を確認してください。');
      }

      try {
        await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            'パスワード再設定メールを送信できませんでした。',
            error as { message?: string | null }),
        );
      }
    },
    async getCurrentUser() {
      await ensureLocalAuthPersistence(firebaseAuth);

      const authUser = await waitForAuthUser(firebaseAuth);

      if (!authUser) {
        return null;
      }

      if (isPasswordLogin(authUser) && !authUser.emailVerified) {
        await firebaseSignOut(firebaseAuth);
        return null;
      }

      return ensureProfile(
        firestoreDb,
        authUser,
        authUser.displayName || authUser.email || '',
      );
    },
    async updateUserProfile(userId, draft) {
      await ensureLocalAuthPersistence(firebaseAuth);

      const authUser = await waitForAuthUser(firebaseAuth);

      if (!authUser || authUser.uid !== userId) {
        throw new Error('ユーザー情報が見つかりません。');
      }

      const currentProfile = await getProfileById(firestoreDb, userId);
      const email = authUser.email?.trim().toLowerCase() || currentProfile?.email || '';

      if (!email) {
        throw new Error('メールアドレスを取得できませんでした。');
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
    },
    async signOut() {
      await ensureLocalAuthPersistence(firebaseAuth);
      await firebaseSignOut(firebaseAuth);
    },
  };
}
