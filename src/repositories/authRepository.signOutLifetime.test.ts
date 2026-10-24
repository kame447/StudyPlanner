import { expect, it } from 'vitest';
import { createAuthRepository } from './authRepository';
import { createLocalAuthStorageGateway } from './localStorageGateway';
import { MemoryStorage, deferred, microtasks } from './localPersistenceConcurrency.testUtils';

it('clears the session without waiting for an already-persisted profile acknowledgement', async () => {
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.users', JSON.stringify([{ id: 'synthetic-owner', email: 'synthetic@example.test', username: 'Before', avatar: '', createdAt: '2026-10-20T00:00:00Z' }]));
  storage.setItem('studyplanner.session', 'synthetic-owner');
  const gateway = createLocalAuthStorageGateway(storage);
  const writeUsers = gateway.writeUsers;
  const entered = deferred();
  const acknowledgement = deferred();
  gateway.writeUsers = async users => {
    await writeUsers(users);
    entered.resolve();
    await acknowledgement.promise;
  };
  const repository = createAuthRepository(gateway);
  const profile = repository.updateUserProfile('synthetic-owner', { username: 'After', avatar: '' });
  await entered.promise;
  let signedOut = false;
  const logout = repository.signOut().then(() => { signedOut = true; });
  try {
    await microtasks();
    expect(signedOut).toBe(true);
    expect(storage.getItem('studyplanner.session')).toBeNull();
  } finally {
    acknowledgement.resolve();
    await Promise.all([profile, logout]);
  }
  expect(await repository.getCurrentUser()).toBeNull();
  expect((await gateway.readUsers())[0].username).toBe('After');
});

it('keeps signup behind a pending profile mutation across same-Storage gateways', async () => {
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.users', JSON.stringify([{ id: 'synthetic-owner', email: 'synthetic@example.test', username: 'Before', avatar: '', createdAt: '2026-10-20T00:00:00Z' }]));
  const gateway = createLocalAuthStorageGateway(storage);
  const writeUsers = gateway.writeUsers;
  const entered = deferred();
  const release = deferred();
  gateway.writeUsers = async users => {
    entered.resolve();
    await release.promise;
    await writeUsers(users);
  };
  const first = createAuthRepository(gateway);
  const second = createAuthRepository(createLocalAuthStorageGateway(storage));
  const profile = first.updateUserProfile('synthetic-owner', { username: 'After', avatar: '' });
  await entered.promise;
  let registered = false;
  const signup = second.signUpWithPassword('synthetic-new@example.test', 'synthetic-test-only', 'New')
    .then(() => { registered = true; });
  try {
    await microtasks();
    expect(registered).toBe(false);
  } finally {
    release.resolve();
    await Promise.all([profile, signup]);
  }
  const users = await gateway.readUsers();
  expect(users).toHaveLength(2);
  expect(users.find(user => user.id === 'synthetic-owner')?.username).toBe('After');
  expect((await second.signInWithPassword('synthetic-new@example.test', 'synthetic-test-only')).username).toBe('New');
});
