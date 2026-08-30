import { describe, expect, it } from 'vitest';
import { resolveAdminRoute } from './adminRoutes';

describe('admin route resolution', () => {
  it('resolves the admin root as overview', () => {
    expect(resolveAdminRoute('/admin')).toEqual({ type: 'overview' });
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
