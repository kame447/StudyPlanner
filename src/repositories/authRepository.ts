import { createId } from '../lib/id';
import type { AuthRepository, AuthStorageGateway } from './repositoryContracts';
import type { User, UserProfileDraft } from '../types/domain';

interface PasswordRecord {
  email: string;
  password: string;
  userId: string;
}

const PASSWORD_STORAGE_KEY = 'studyplanner.local.passwords';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string, email: string): string {
  const trimmedUsername = username.trim();
  return trimmedUsername || email;
}

function readPasswordRecords(): PasswordRecord[] {
  try {
    const raw = window.localStorage.getItem(PASSWORD_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<PasswordRecord>[];
    return parsed.filter(
      (record): record is PasswordRecord =>
        typeof record?.email === 'string' &&
        typeof record?.password === 'string' &&
        typeof record?.userId === 'string',
    );
  } catch {
    return [];
  }
}

function writePasswordRecords(records: PasswordRecord[]): void {
  window.localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(records));
}

function applyUserProfile(user: User, draft: UserProfileDraft): User {
  return {
    ...user,
    username: draft.username.trim() || user.email,
    avatar: draft.avatar.trim(),
  };
}

export function createAuthRepository(
  storageGateway: AuthStorageGateway,
): AuthRepository {
  return {
    async signUpWithPassword(email, password, username) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);

      if (!normalizedEmail.includes('@')) {
        throw new Error('メールアドレスの形式を確認してください。');
      }

      if (password.trim().length < 6) {
        throw new Error('パスワードは6文字以上にしてください。');
      }

      const users = await storageGateway.readUsers();
      const currentUser = users.find((item) => item.email === normalizedEmail);

      if (currentUser) {
        throw new Error('このメールアドレスはすでに登録されています。');
      }

      const nextUser: User = {
        id: createId('user'),
        email: normalizedEmail,
        username: normalizedUsername,
        avatar: '',
        createdAt: new Date().toISOString(),
      };

      await storageGateway.writeUsers([...users, nextUser]);
      writePasswordRecords(
        readPasswordRecords().concat({
          email: normalizedEmail,
          password,
          userId: nextUser.id,
        }),
      );
    },
    async signInWithPassword(email, password) {
      const normalizedEmail = normalizeEmail(email);
      const passwordRecord = readPasswordRecords().find(
        (record) => record.email === normalizedEmail,
      );

      if (!passwordRecord || passwordRecord.password !== password) {
        throw new Error('メールアドレスまたはパスワードが一致しません。');
      }

      const users = await storageGateway.readUsers();
      const user = users.find((item) => item.id === passwordRecord.userId);

      if (!user) {
        throw new Error('ユーザー情報が見つかりません。');
      }

      await storageGateway.writeSessionUserId(user.id);
      return user;
    },
    async signInWithGoogle() {
      throw new Error('Firebase 設定が無いため Google ログインは使えません。');
    },
    async sendPasswordReset() {
      throw new Error('Firebase 設定が無いためパスワード再設定は使えません。');
    },
    async getCurrentUser() {
      const sessionUserId = await storageGateway.readSessionUserId();

      if (!sessionUserId) {
        return null;
      }

      const users = await storageGateway.readUsers();
      return users.find((item) => item.id === sessionUserId) ?? null;
    },
    async updateUserProfile(userId, draft) {
      const users = await storageGateway.readUsers();
      const currentUser = users.find((item) => item.id === userId);

      if (!currentUser) {
        throw new Error('ユーザー情報が見つかりません。');
      }

      const nextUser = applyUserProfile(currentUser, draft);
      await storageGateway.writeUsers(
        users.map((user) => (user.id === userId ? nextUser : user)),
      );
      return nextUser;
    },
    async signOut() {
      await storageGateway.clearSessionUserId();
    },
  };
}
