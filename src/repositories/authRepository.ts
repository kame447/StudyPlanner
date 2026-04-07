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

function buildCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    async requestEmailCode(email, username) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);

      if (!normalizedEmail.includes('@')) {
        throw new Error('メールアドレスの形式を確認してください。');
      }

      const code = buildCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const pendingCodes = (await storageGateway
        .readPendingCodes()
      ).filter((item) => item.email !== normalizedEmail);

      pendingCodes.push({
        email: normalizedEmail,
        username: normalizedUsername,
        code,
        expiresAt,
      });

      await storageGateway.writePendingCodes(pendingCodes);

      return {
        email: normalizedEmail,
        username: normalizedUsername,
        expiresAt,
        previewCode: code,
      };
    },
    async verifyEmailCode(email, code, username) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);
      const trimmedCode = code.trim();
      const pendingCodes = await storageGateway.readPendingCodes();
      const challenge = pendingCodes.find((item) => item.email === normalizedEmail);

      if (!challenge) {
        throw new Error('認証コードを先に発行してください。');
      }

      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        throw new Error('認証コードの有効期限が切れています。再送してください。');
      }

      if (challenge.code !== trimmedCode) {
        throw new Error('認証コードが一致しません。');
      }

      const users = await storageGateway.readUsers();
      let user = users.find((item) => item.email === normalizedEmail);

      if (!user) {
        user = {
          id: createId('user'),
          email: normalizedEmail,
          username: challenge.username || normalizedUsername,
          avatar: '',
          createdAt: new Date().toISOString(),
        };
        await storageGateway.writeUsers([...users, user]);
      }

      await storageGateway.writeSessionUserId(user.id);
      await storageGateway.writePendingCodes(
        pendingCodes.filter((item) => item.email !== normalizedEmail),
      );

      return user;
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
