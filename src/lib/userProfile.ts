import type { User } from '../types/domain';

export const AVATAR_OPTIONS = ['📚', '✏️', '🧠', '🌱', '🚀', '☕', '🦉', '🌙'] as const;

export function getUserDisplayName(user: Pick<User, 'username' | 'email'>): string {
  return user.username.trim() || user.email;
}

export function getUserAvatarText(user: Pick<User, 'avatar' | 'username' | 'email'>): string {
  const avatar = user.avatar.trim();

  if (avatar) {
    return avatar;
  }

  const displayName = getUserDisplayName(user).trim();
  return displayName ? displayName.slice(0, 1).toUpperCase() : '?';
}
