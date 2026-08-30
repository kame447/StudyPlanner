import { describe, expect, it } from 'vitest';
import { resolveAdminRoute } from './adminRoutes';

describe('admin route resolution', () => {
  it('resolves the admin root as overview', () => {
    expect(resolveAdminRoute('/admin')).toEqual({ type: 'overview' });
  });

  it('resolves the analytics top-level routes', () => {
    expect(resolveAdminRoute('/admin/ai')).toEqual({ type: 'ai-api' });
    expect(resolveAdminRoute('/admin/planning')).toEqual({ type: 'planning' });
    expect(resolveAdminRoute('/admin/logs')).toEqual({ type: 'logs' });
  });

  it('keeps the legacy trace URL as a compatibility route to Logs', () => {
    expect(resolveAdminRoute('/admin/weekly-planning-traces')).toEqual({ type: 'logs' });
  });

  it('resolves the user list and decoded user detail routes', () => {
    expect(resolveAdminRoute('/admin/users')).toEqual({ type: 'users' });
    expect(resolveAdminRoute('/admin/users/user%40example.com')).toEqual({
      type: 'user-detail',
      userId: 'user@example.com',
    });
  });

  it('rejects extra path segments instead of partially matching them', () => {
    expect(resolveAdminRoute('/admin/users/user-1/report')).toEqual({
      type: 'not-found',
    });
    expect(resolveAdminRoute('/admin/unknown')).toEqual({ type: 'not-found' });
  });
});
