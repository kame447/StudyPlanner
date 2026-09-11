export type AdminRoute =
  | { type: 'overview' }
  | { type: 'users' }
  | { type: 'user-detail'; userId: string }
  | { type: 'ai-api' }
  | { type: 'planning' }
  | { type: 'logs' }
  | { type: 'system' }
  | { type: 'not-found' };

export function resolveAdminRoute(path: string): AdminRoute {
  if (path === '/admin') {
    return { type: 'overview' };
  }

  if (path === '/admin/users') {
    return { type: 'users' };
  }

  if (path === '/admin/ai') {
    return { type: 'ai-api' };
  }

  if (path === '/admin/planning') {
    return { type: 'planning' };
  }

  if (path === '/admin/logs') {
    return { type: 'logs' };
  }

  if (path === '/admin/system') {
    return { type: 'system' };
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
