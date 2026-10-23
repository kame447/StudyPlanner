// Only external authentication/role delivery is synthetic. Other harness pages
// keep the same denied access they have without a Firebase configuration.
const entryHarness = window.location.pathname.endsWith('/admin-entry.html');
let allowed = entryHarness;
let user = entryHarness ? { id: 'admin-entry-owner', requiresEmailVerification: false } : null;
const roleListeners = new Set();
const authListeners = new Set();
let signOutCalls = 0;
export function subscribeAdminStatus(_owner, listener) {
  roleListeners.add(listener); listener(allowed);
  return () => roleListeners.delete(listener);
}
export const adminEntryAuth = {
  available: true,
  getCurrentUser: () => user,
  subscribe(listener) { authListeners.add(listener); listener(user); return () => authListeners.delete(listener); },
  async signOut() { signOutCalls += 1; control.signOut(); },
};
const control = {
  setAccess(next) { allowed = next; for (const listener of roleListeners) listener(allowed); },
  signOut() {
    user = null; localStorage.removeItem('studyplanner.session');
    for (const listener of authListeners) listener(null);
  },
  snapshot: () => ({ signOutCalls, roleSubscriptions: roleListeners.size, authSubscriptions: authListeners.size }),
};
if (entryHarness) window.__adminEntryAccess = control;
