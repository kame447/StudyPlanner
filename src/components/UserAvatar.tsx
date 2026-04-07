import { isImageAvatar } from '../lib/avatarImage';
import { getUserAvatarText, getUserDisplayName } from '../lib/userProfile';
import type { User } from '../types/domain';

interface UserAvatarProps {
  user: Pick<User, 'avatar' | 'username' | 'email'>;
  small?: boolean;
}

export function UserAvatar({ user, small = false }: UserAvatarProps) {
  const displayName = getUserDisplayName(user);

  return (
    <div
      className={small ? 'user-avatar user-avatar-small' : 'user-avatar'}
      aria-label={displayName}
      title={displayName}
    >
      {isImageAvatar(user.avatar) ? (
        <img
          src={user.avatar}
          alt={`${displayName}のプロフィール画像`}
          className="user-avatar-image"
        />
      ) : (
        getUserAvatarText(user)
      )}
    </div>
  );
}
