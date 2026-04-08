import type { User as SupabaseAuthUser, SupabaseClient } from '@supabase/supabase-js';
import type { User } from '../types/domain';
import type { AuthRepository } from './repositoryContracts';

interface ProfileRow {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  created_at: string;
}

interface PendingProfileRecord {
  email: string;
  username: string;
  expiresAt: string;
}

const PENDING_PROFILE_KEY = 'studyplanner.supabase.pending-profile';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string, email: string): string {
  const trimmedUsername = username.trim();
  return trimmedUsername || email;
}

function mapProfileRowToUser(row: ProfileRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username.trim() || row.email,
    avatar: row.avatar ?? '',
    createdAt: row.created_at,
  };
}

function normalizeErrorMessage(
  fallbackMessage: string,
  error: { message?: string | null } | null,
): string {
  const message = error?.message?.trim();
  return message || fallbackMessage;
}

function readPendingProfile(): PendingProfileRecord | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_PROFILE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingProfileRecord>;

    if (
      typeof parsed.email !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }

    return {
      email: normalizeEmail(parsed.email),
      username: parsed.username.trim(),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function writePendingProfile(record: PendingProfileRecord): void {
  window.sessionStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(record));
}

function clearPendingProfile(): void {
  window.sessionStorage.removeItem(PENDING_PROFILE_KEY);
}

async function getProfileById(
  supabaseClient: SupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(normalizeErrorMessage('プロフィールを取得できませんでした。', error));
  }

  return (data as ProfileRow | null) ?? null;
}

async function upsertProfile(
  supabaseClient: SupabaseClient,
  profile: ProfileRow,
): Promise<ProfileRow> {
  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(profile)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(normalizeErrorMessage('プロフィールを保存できませんでした。', error));
  }

  return data as ProfileRow;
}

async function ensureProfile(
  supabaseClient: SupabaseClient,
  authUser: SupabaseAuthUser,
  fallbackUsername: string,
  avatar = '',
): Promise<User> {
  const existingProfile = await getProfileById(supabaseClient, authUser.id);
  const email = authUser.email?.trim().toLowerCase() || existingProfile?.email || '';

  if (!email) {
    throw new Error('ユーザーのメールアドレスを取得できませんでした。');
  }

  const nextProfile = await upsertProfile(supabaseClient, {
    id: authUser.id,
    email,
    username:
      existingProfile?.username?.trim() ||
      normalizeUsername(fallbackUsername, email),
    avatar: existingProfile?.avatar ?? avatar,
    created_at: existingProfile?.created_at || authUser.created_at || new Date().toISOString(),
  });

  return mapProfileRowToUser(nextProfile);
}

export function createSupabaseAuthRepository(
  supabaseClient: SupabaseClient,
): AuthRepository {
  return {
    async requestEmailCode(email, username) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);

      if (!normalizedEmail.includes('@')) {
        throw new Error('メールアドレスの形式を確認してください。');
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await supabaseClient.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          data: {
            username: normalizedUsername,
          },
        },
      });

      if (error) {
        throw new Error(
          normalizeErrorMessage('認証コードを送信できませんでした。', error),
        );
      }

      writePendingProfile({
        email: normalizedEmail,
        username: normalizedUsername,
        expiresAt,
      });

      return {
        email: normalizedEmail,
        username: normalizedUsername,
        expiresAt,
        delivery: 'email',
      };
    },
    async verifyEmailCode(email, code, username) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedUsername = normalizeUsername(username, normalizedEmail);
      const trimmedCode = code.trim();
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: normalizedEmail,
        token: trimmedCode,
        type: 'email',
      });

      if (error) {
        throw new Error(normalizeErrorMessage('ログインに失敗しました。', error));
      }

      const authUser = data.user ?? data.session?.user;

      if (!authUser) {
        throw new Error('ユーザー情報を取得できませんでした。');
      }

      const pendingProfile = readPendingProfile();
      const user = await ensureProfile(
        supabaseClient,
        authUser,
        pendingProfile?.email === normalizedEmail
          ? pendingProfile.username
          : normalizedUsername,
      );

      clearPendingProfile();
      return user;
    },
    async getCurrentUser() {
      const { data, error } = await supabaseClient.auth.getUser();

      if (error) {
        throw new Error(normalizeErrorMessage('セッションを確認できませんでした。', error));
      }

      if (!data.user) {
        return null;
      }

      return ensureProfile(
        supabaseClient,
        data.user,
        data.user.user_metadata.username as string | undefined ?? data.user.email ?? '',
      );
    },
    async updateUserProfile(userId, draft) {
      const { data, error } = await supabaseClient.auth.getUser();

      if (error) {
        throw new Error(normalizeErrorMessage('セッションを確認できませんでした。', error));
      }

      if (!data.user || data.user.id !== userId) {
        throw new Error('ユーザー情報が見つかりません。');
      }

      const currentProfile = await getProfileById(supabaseClient, userId);
      const email = data.user.email?.trim().toLowerCase() || currentProfile?.email || '';

      if (!email) {
        throw new Error('メールアドレスを取得できませんでした。');
      }

      const nextProfile = await upsertProfile(supabaseClient, {
        id: userId,
        email,
        username: normalizeUsername(draft.username, email),
        avatar: draft.avatar.trim(),
        created_at: currentProfile?.created_at || data.user.created_at || new Date().toISOString(),
      });

      return mapProfileRowToUser(nextProfile);
    },
    async signOut() {
      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        throw new Error(normalizeErrorMessage('ログアウトに失敗しました。', error));
      }

      clearPendingProfile();
    },
  };
}
