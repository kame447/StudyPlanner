import { afterEach, describe, expect, it, vi } from 'vitest';
const pending = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../lib/firebaseClient', () => ({ getFirestoreDb: () => ({}), getFirebaseAuth: () => null }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDocFromServer: pending.read }));
vi.mock('../repositories', () => ({ authRepository: {} }));
import { accountClientWritesPaused, resumeAccountClientWrites } from './accountDeletionClientState';
import { createAccountDeletionService, hasPendingAccountDeletion } from './accountDeletionService';

afterEach(() => { resumeAccountClientWrites('A'); });

function fixture() {
  const user = { uid: 'A', getIdToken: vi.fn().mockResolvedValue('recent-token') };
  const deps = { getSession: vi.fn(() => user as typeof user | null), reauthenticate: vi.fn().mockResolvedValue(undefined),
    endpoint: () => 'https://worker.test/account/delete', request: vi.fn<typeof fetch>(),
    authAccountGone: vi.fn().mockResolvedValue(false) };
  return { user, deps, run: createAccountDeletionService(deps) };
}
const response = (status: number, body: object) => new Response(JSON.stringify(body), { status });

describe('account deletion client', () => {
  it('reauthenticates, refreshes its token and resumes bounded work until explicit completion', async () => {
    const { deps, user, run } = fixture();
    deps.request.mockResolvedValueOnce(response(202, { status: 'in_progress' })).mockResolvedValueOnce(response(200, { status: 'completed' }));
    expect(await run('A', 'password')).toEqual({ status: 'completed' });
    expect(deps.reauthenticate).toHaveBeenCalledWith('password');
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(deps.request.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"confirm":"delete-my-account"}',
      headers: { Authorization: 'Bearer recent-token' } });
  });
  it('bounds repeated in-progress responses and lets the same job be retried', async () => {
    const { deps, run } = fixture();
    deps.request.mockImplementation(async () => response(202, { status: 'in_progress' }));
    expect(await run('A')).toEqual({ status: 'in_progress' });
    expect(deps.request).toHaveBeenCalledTimes(200);
  });
  it.each([
    [401, { errorCode: 'account_deletion_reauth_required' }, { status: 'reauth_required' }],
    [403, { errorCode: 'account_deletion_admin_forbidden' }, { status: 'failed', reason: 'admin_forbidden' }],
    [401, {}, { status: 'failed', reason: 'request' }],
    [503, { retryable: true }, { status: 'failed', reason: 'request' }],
    [200, { status: 'in_progress' }, { status: 'failed', reason: 'request' }],
  ])('handles %s without inferring success', async (status, body, expected) => {
    const { deps, run } = fixture(); deps.request.mockResolvedValue(response(status, body));
    expect(await run('A')).toEqual(expected);
  });
  it('does not issue a deletion when authentication fails or the owner changes', async () => {
    const { deps, run } = fixture();
    deps.reauthenticate.mockRejectedValueOnce(new Error('wrong password'));
    expect(await run('A')).toEqual({ status: 'failed', reason: 'authentication' });
    deps.reauthenticate.mockImplementationOnce(async () => { deps.getSession.mockReturnValue(null); });
    expect(await run('A')).toEqual({ status: 'failed', reason: 'session_changed' });
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('never reports success from Auth absence without a completion record', async () => {
    const { deps, run } = fixture();
    deps.request.mockResolvedValueOnce(response(401, { errorCode: 'account_deletion_auth_required' }));
    deps.authAccountGone.mockResolvedValueOnce(true);
    expect(await run('A')).toEqual({ status: 'failed', reason: 'unconfirmed' });
    deps.reauthenticate.mockRejectedValueOnce(new Error('user not found'));
    deps.authAccountGone.mockResolvedValueOnce(true);
    expect(await run('A')).toEqual({ status: 'failed', reason: 'unconfirmed' });
  });
  it('treats a lost completion response as retryable uncertainty', async () => {
    const { deps, run } = fixture(); deps.request.mockRejectedValue(new TypeError('network'));
    expect(await run('A')).toEqual({ status: 'failed', reason: 'request' });
  });
});

it('detects an owner tombstone on sign-in and pauses client writes before presenting retry', async () => {
  pending.read.mockResolvedValue({ exists: () => true, data: () => ({ status: 'deleting' }) });
  expect(await hasPendingAccountDeletion('A')).toBe(true);
  expect(pending.read).toHaveBeenCalledWith({ collection: 'account_deletions', id: 'A' });
  expect(accountClientWritesPaused('A')).toBe(true);
  pending.read.mockResolvedValue({ exists: () => false });
  expect(await hasPendingAccountDeletion('B')).toBe(false);
});
