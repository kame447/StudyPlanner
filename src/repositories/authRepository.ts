import { createId } from '../lib/id';
import type { AuthRepository, AuthStorageGateway } from './repositoryContracts';
import type { User, UserProfileDraft } from '../types/domain';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string, email: string): string {
  const trimmedUsername = username.trim();
  return trimmedUsername || email;
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
  const repository: AuthRepository = {
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

      await storageGateway.registerUserWithPassword(nextUser, password);
    },
    async signInWithPassword(email, password) {
      const normalizedEmail = normalizeEmail(email);
      const passwordUserId = await storageGateway.findPasswordUserId(normalizedEmail, password);
      if (passwordUserId === null) {
        throw new Error('メールアドレスまたはパスワードが一致しません。');
      }

      const users = await storageGateway.readUsers();
      const user = users.find((item) => item.id === passwordUserId);

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

  // Only shared user-collection writers require serialization. Session revocation
  // must not wait for a profile write's delayed acknowledgement. Reads and
  // sign-in retain their existing behavior; registration writes both keys
  // synchronously from prepared snapshots before yielding.
  return {
    ...repository,
    signUpWithPassword: (...args) => storageGateway.runExclusive(
      () => repository.signUpWithPassword(...args),
    ),
    updateUserProfile: (...args) => storageGateway.runExclusive(
      () => repository.updateUserProfile(...args),
    ),
  };
}
