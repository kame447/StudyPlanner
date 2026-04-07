import { getUserAvatarText, getUserDisplayName } from '../lib/userProfile';
import type { User } from '../types/domain';

interface UserAvatarProps {
  user: Pick<User, 'avatar' | 'username' | 'email'>;
  small?: boolean;
}

export function UserAvatar({ user, small = false }: UserAvatarProps) {
  return (
    <div
      className={small ? 'user-avatar user-avatar-small' : 'user-avatar'}
      aria-label={getUserDisplayName(user)}
      title={getUserDisplayName(user)}
    >
      {getUserAvatarText(user)}
    </div>
  );
}
