import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirebaseAuthIdentityClient } from './firebaseAuthIdentityClient';

const env = {
  FIREBASE_PROJECT_ID: 'test-project', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.test',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'AQ==',
};
const user = { localId: 'victim-uid', email: 'victim@example.test', emailVerified: true };

function fixture(payload: unknown = { users: [user] }, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload, { status }));
  const observer = { beforeSubrequest: vi.fn() };
  const provider = { getToken: vi.fn(async () => 'synthetic-token'), subrequestObserver: observer };
  const client = new FirebaseAuthIdentityClient(env, provider, fetcher);
  return { client, fetcher, provider, observer };
}

afterEach(() => vi.unstubAllGlobals());

describe('Firebase Auth server identity lookup', () => {
  it('looks up verified email using project-scoped server OAuth, without an end-user token', async () => {
    const { client, fetcher, observer } = fixture();
    expect(await client.lookupByEmail('  VICTIM@example.test  ')).toEqual([{ firebaseUid: user.localId, email: user.email }]);
    expect(fetcher).toHaveBeenCalledWith('https://identitytoolkit.googleapis.com/v1/projects/test-project/accounts:lookup', {
      method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [user.email] }),
    });
    expect(observer.beforeSubrequest).toHaveBeenCalledWith('identity_toolkit');
  });

  it.each([false, undefined])('never promotes an unverified Auth email: verified=%s', async emailVerified => {
    const { client } = fixture({ users: [{ ...user, emailVerified }] });
    expect(await client.lookupByEmail(user.email)).toEqual([]);
    expect(await client.lookupByUids([user.localId])).toEqual([{ firebaseUid: user.localId, email: '' }]);
  });

  it('does not match a different verified address', async () => {
    const { client } = fixture();
    expect(await client.lookupByEmail('different@example.test')).toEqual([]);
  });

  it.each([{}, { users: [] }])('accepts an empty successful Auth result: %j', async payload => {
    expect(await fixture(payload).client.lookupByEmail(user.email)).toEqual([]);
  });

  it('looks up all selected UIDs in one bounded request', async () => {
    const users = Array.from({ length: 5 }, (_, index) => ({ ...user, localId: `uid-${index}` }));
    const { client, fetcher, provider } = fixture({ users });
    await client.lookupByUids(users.map(user => user.localId));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(provider.getToken).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ localId: users.map(user => user.localId) });
    await expect(client.lookupByUids([...users.map(user => user.localId), 'uid-5'])).rejects.toThrow('observability_auth_identity_lookup_failed');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not access credentials when the selected UID set is empty', async () => {
    const { client, provider, fetcher } = fixture();
    expect(await client.lookupByUids([])).toEqual([]);
    expect(provider.getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects records belonging to UIDs outside the requested batch', async () => {
    await expect(fixture().client.lookupByUids(['other-uid'])).rejects.toThrow('observability_auth_identity_lookup_failed');
  });

  it.each([null, [], { users: null }, { users: {} }, { users: [{}] },
    { users: [{ ...user, emailVerified: 'true' }] }, { users: [{ ...user, email: null }] },
    { users: [{ ...user, email: '' }] }, { users: [{ ...user, localId: '' }] },
    { users: [user, user] }, { users: Array.from({ length: 6 }, (_, index) => ({ ...user, localId: `uid-${index}` })) },
  ])('rejects malformed or oversized Auth responses: %j', async payload => {
    await expect(fixture(payload).client.lookupByEmail(user.email)).rejects.toThrow('observability_auth_identity_lookup_failed');
  });

  it.each([403, 500])('fails explicitly on Auth status %s without exposing the response body', async status => {
    const { client } = fixture({ error: { message: 'private email/token sentinel' } }, status);
    await expect(client.lookupByEmail(user.email)).rejects.toThrow(/^observability_auth_identity_lookup_failed$/);
  });

  it.each(['credential', 'network', 'json', 'project'])('sanitizes %s failures', async failure => {
    const { client, provider, fetcher } = fixture();
    if (failure === 'credential') provider.getToken.mockRejectedValue(new Error('private credential sentinel'));
    if (failure === 'network') fetcher.mockRejectedValue(new Error('private network sentinel'));
    if (failure === 'json') fetcher.mockResolvedValue(new Response('private malformed JSON'));
    const selected = failure === 'project' ? new FirebaseAuthIdentityClient({ ...env, FIREBASE_PROJECT_ID: '' }, provider, fetcher) : client;
    await expect(selected.lookupByEmail(user.email)).rejects.toThrow(/^observability_auth_identity_lookup_failed$/);
  });

  it('reuses one narrowly scoped OAuth token across Auth requests', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: async () => ({}), sign: async () => new ArrayBuffer(0) } });
    const scopes: string[] = [];
    const observer = { beforeSubrequest: vi.fn() };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        const assertion = (init?.body as URLSearchParams).get('assertion')!;
        scopes.push(JSON.parse(atob(assertion.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).scope);
        return Response.json({ access_token: 'scoped-token', expires_in: 3600 });
      }
      return Response.json({ users: [user] });
    });
    const client = new FirebaseAuthIdentityClient(env, undefined, fetcher, observer);
    await client.lookupByEmail(user.email);
    await client.lookupByUids([user.localId]);
    expect(scopes).toEqual(['https://www.googleapis.com/auth/identitytoolkit']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(observer.beforeSubrequest.mock.calls).toEqual([['oauth_token'], ['identity_toolkit'], ['identity_toolkit']]);
  });
});
