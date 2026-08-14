export type AdminRoute =
  | { type: 'redirect-to-users' }
  | { type: 'users' }
  | { type: 'user-detail'; userId: string }
  | { type: 'not-found' };

export function resolveAdminRoute(path: string): AdminRoute {
  if (path === '/admin') {
    return { type: 'redirect-to-users' };
  }

  if (path === '/admin/users') {
    return { type: 'users' };
  }

  const detailMatch = path.match(/^\/admin\/users\/([^/]+)$/);

  if (detailMatch?.[1]) {
    return {
      type: 'user-detail',
      userId: decodeURIComponent(detailMatch[1]),
    };
  }

  return { type: 'not-found' };
}
