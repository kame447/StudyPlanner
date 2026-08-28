export type AdminRoute =
  | { type: 'overview' }
  | { type: 'users' }
  | { type: 'user-detail'; userId: string }
  | { type: 'not-found' };

export function resolveAdminRoute(path: string): AdminRoute {
  if (path === '/admin') {
    return { type: 'overview' };
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
