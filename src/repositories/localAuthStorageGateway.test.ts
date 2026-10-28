import { afterEach, expect, it, vi } from 'vitest';
import { createAuthRepository } from './authRepository';
import { createLocalAuthStorageGateway } from './localStorageGateway';
import { MemoryStorage } from './localPersistenceConcurrency.testUtils';

// Synthetic in-memory fixtures only. No browser storage or real credentials.
const EMAIL = 'synthetic-owner@example.test';
const PASSWORD = 'synthetic-test-only';
const PASSWORD_KEY = 'studyplanner.local.passwords';
afterEach(() => { vi.unstubAllGlobals(); });

it('restores failed registration and allows retry through a fresh repository', async () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  const gateway = createLocalAuthStorageGateway(storage);
  const repository = createAuthRepository(gateway);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === PASSWORD_KEY) throw Error('synthetic quota failure');
    setItem(key, value);
  };
  await expect(repository.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic')).rejects.toThrow('synthetic quota failure');
  expect(await gateway.readUsers()).toEqual([]);
  expect(storage.getItem('studyplanner.users')).toBeNull();
  expect(storage.getItem(PASSWORD_KEY)).toBeNull();
  storage.setItem = setItem;
  const fresh = createAuthRepository(createLocalAuthStorageGateway(storage));
  await fresh.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic');
  expect((await fresh.signInWithPassword(EMAIL, PASSWORD)).email).toBe(EMAIL);
});

it('keeps credentials and users in the injected Storage without touching global Storage', async () => {
  const injected = new MemoryStorage();
  const globalStorage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: globalStorage });
  const gateway = createLocalAuthStorageGateway(injected);
  const repository = createAuthRepository(gateway);
  await repository.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic');
  expect(await gateway.readUsers()).toHaveLength(1);
  expect(injected.getItem(PASSWORD_KEY)).not.toBeNull();
  expect(globalStorage.length).toBe(0);
  // Changing the ambient browser must not change the injected identity source.
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
  expect((await repository.signInWithPassword(EMAIL, PASSWORD)).email).toBe(EMAIL);
});

it.each(['users-before', 'users-after', 'passwords-after'] as const)('restores exact prior bytes after %s write failure', async fault => {
  const storage = new MemoryStorage();
  const usersRaw = '[  ]';
  const passwordsRaw = ' [ ] ';
  storage.setItem('studyplanner.users', usersRaw);
  storage.setItem(PASSWORD_KEY, passwordsRaw);
  const setItem = storage.setItem.bind(storage);
  const failure = Error('synthetic write failure');
  let failed = false;
  storage.setItem = (key, value) => {
    const match = !failed && key === (fault.startsWith('users') ? 'studyplanner.users' : PASSWORD_KEY);
    if (match) {
      failed = true;
      if (!fault.endsWith('before')) setItem(key, value);
      throw failure;
    }
    setItem(key, value);
  };
  const repo = createAuthRepository(createLocalAuthStorageGateway(storage));
  await expect(repo.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic')).rejects.toBe(failure);
  expect(storage.getItem('studyplanner.users')).toBe(usersRaw);
  expect(storage.getItem(PASSWORD_KEY)).toBe(passwordsRaw);
  await repo.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic');
  expect((await repo.signInWithPassword(EMAIL, PASSWORD)).email).toBe(EMAIL);
});

it('reports compensation failure explicitly and releases subsequent operations', async () => {
  const storage = new MemoryStorage();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === PASSWORD_KEY) throw Error('synthetic password write failure'); setItem(key, value); };
  storage.removeItem = () => { throw Error('synthetic recovery failure'); };
  const repo = createAuthRepository(createLocalAuthStorageGateway(storage));
  await expect(repo.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic')).rejects.toThrow('保存状態の復元にも失敗');
  // Failure remains explicit; no automatic claiming of an already-orphaned identity.
  await expect(repo.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic')).rejects.toThrow('すでに登録');
  expect(await repo.getCurrentUser()).toBeNull();
});

it.each([false, true])('serializes same-Storage gateways, same email=%s', async sameEmail => {
  const storage = new MemoryStorage();
  const a = createAuthRepository(createLocalAuthStorageGateway(storage));
  const b = createAuthRepository(createLocalAuthStorageGateway(storage));
  const result = await Promise.allSettled([
    a.signUpWithPassword(EMAIL, PASSWORD, 'A'),
    b.signUpWithPassword(sameEmail ? EMAIL : 'synthetic-other@example.test', PASSWORD, 'B'),
  ]);
  expect(result.map(row => row.status)).toEqual(['fulfilled', sameEmail ? 'rejected' : 'fulfilled']);
  expect(await createLocalAuthStorageGateway(storage).readUsers()).toHaveLength(sameEmail ? 1 : 2);
  if (!sameEmail) expect((await b.signInWithPassword('synthetic-other@example.test', PASSWORD)).username).toBe('B');
});

it('preserves a concurrent profile edit and registration across two gateways', async () => {
  const storage = new MemoryStorage();
  const first = createAuthRepository(createLocalAuthStorageGateway(storage));
  const second = createAuthRepository(createLocalAuthStorageGateway(storage));
  await first.signUpWithPassword(EMAIL, PASSWORD, 'Before');
  const user = await first.signInWithPassword(EMAIL, PASSWORD);
  await Promise.all([
    first.updateUserProfile(user.id, { username: 'After', avatar: 'synthetic-avatar' }),
    second.signUpWithPassword('synthetic-other@example.test', PASSWORD, 'Other'),
  ]);
  const users = await createLocalAuthStorageGateway(storage).readUsers();
  expect(users).toHaveLength(2);
  expect(users.find(row => row.id === user.id)?.username).toBe('After');
  expect((await second.getCurrentUser())?.username).toBe('After');
  await second.signOut();
  expect(await first.getCurrentUser()).toBeNull();
});

it('does not block an independent Storage while one repository operation is pending', async () => {
  const firstStorage = new MemoryStorage();
  const firstGateway = createLocalAuthStorageGateway(firstStorage);
  const read = firstGateway.readUsers;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  firstGateway.readUsers = async () => { await gate; return read(); };
  const first = createAuthRepository(firstGateway);
  const pending = first.signUpWithPassword(EMAIL, PASSWORD, 'A');
  const independent = createAuthRepository(createLocalAuthStorageGateway(new MemoryStorage()));
  await independent.signUpWithPassword(EMAIL, PASSWORD, 'Independent');
  expect((await independent.signInWithPassword(EMAIL, PASSWORD)).username).toBe('Independent');
  release();
  await pending;
});

it('prepares registration from the captured credential snapshot without a destructive second read', async () => {
  const storage = new MemoryStorage();
  const repo = createAuthRepository(createLocalAuthStorageGateway(storage));
  await repo.signUpWithPassword(EMAIL, PASSWORD, 'Existing');
  const getItem = storage.getItem.bind(storage);
  let credentialReads = 0;
  storage.getItem = key => {
    if (key === PASSWORD_KEY && ++credentialReads > 1) throw Error('synthetic transient read failure');
    return getItem(key);
  };
  await repo.signUpWithPassword('synthetic-other@example.test', PASSWORD, 'Other');
  expect(credentialReads).toBe(1);
  storage.getItem = getItem;
  expect((await repo.signInWithPassword(EMAIL, PASSWORD)).username).toBe('Existing');
  expect((await repo.signInWithPassword('synthetic-other@example.test', PASSWORD)).username).toBe('Other');
});

it('leaves both identity collections unchanged when the credential snapshot is unavailable', async () => {
  const storage = new MemoryStorage();
  const repo = createAuthRepository(createLocalAuthStorageGateway(storage));
  await repo.signUpWithPassword(EMAIL, PASSWORD, 'Existing');
  const getItem = storage.getItem.bind(storage);
  const usersBefore = getItem('studyplanner.users');
  const passwordsBefore = getItem(PASSWORD_KEY);
  const failure = Error('synthetic snapshot read failure');
  storage.getItem = key => { if (key === PASSWORD_KEY) throw failure; return getItem(key); };
  await expect(repo.signUpWithPassword('synthetic-other@example.test', PASSWORD, 'Other')).rejects.toBe(failure);
  expect(getItem('studyplanner.users')).toBe(usersBefore);
  expect(getItem(PASSWORD_KEY)).toBe(passwordsBefore);
  storage.getItem = getItem;
  expect((await repo.signInWithPassword(EMAIL, PASSWORD)).username).toBe('Existing');
  await repo.signUpWithPassword('synthetic-other@example.test', PASSWORD, 'Other');
  expect((await repo.signInWithPassword('synthetic-other@example.test', PASSWORD)).username).toBe('Other');
});

it('still restores credentials when restoring the user collection fails', async () => {
  const storage = new MemoryStorage();
  const passwordsBefore = ' [ ] ';
  storage.setItem(PASSWORD_KEY, passwordsBefore);
  const setItem = storage.setItem.bind(storage);
  let failed = false;
  storage.setItem = (key, value) => {
    setItem(key, value);
    if (key === PASSWORD_KEY && !failed) {
      failed = true;
      throw Error('synthetic write failure after side effect');
    }
  };
  storage.removeItem = () => { throw Error('synthetic user recovery failure'); };
  const repo = createAuthRepository(createLocalAuthStorageGateway(storage));
  await expect(repo.signUpWithPassword(EMAIL, PASSWORD, 'Synthetic')).rejects.toThrow('保存状態の復元にも失敗');
  expect(storage.getItem(PASSWORD_KEY)).toBe(passwordsBefore);
  await expect(repo.signInWithPassword(EMAIL, PASSWORD)).rejects.toThrow('一致しません');
  expect(await repo.getCurrentUser()).toBeNull();
});

it('keeps signup email fallback and profile username/avatar normalization', async () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  const repository = createAuthRepository(createLocalAuthStorageGateway(storage));
  await repository.signUpWithPassword('  Synthetic-Owner@Example.Test ', PASSWORD, '   ');
  const user = await repository.signInWithPassword(EMAIL, PASSWORD);
  expect(user.username).toBe(EMAIL);
  const edited = await repository.updateUserProfile(user.id, { username: '  New Name  ', avatar: '  icon  ' });
  expect(edited).toMatchObject({ username: 'New Name', avatar: 'icon', email: EMAIL });
  expect(await repository.updateUserProfile(user.id, { username: ' ', avatar: '' }))
    .toMatchObject({ username: EMAIL, avatar: '' });
});
