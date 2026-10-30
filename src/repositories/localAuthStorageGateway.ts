import { UserFacingError } from '../lib/userFacingError';
import type { User } from '../types/domain';
import type { AuthStorageGateway } from './repositoryContracts';

const USERS_KEY = 'studyplanner.users';
const SESSION_KEY = 'studyplanner.session';
const PASSWORDS_KEY = 'studyplanner.local.passwords';
interface PasswordRecord { email: string; password: string; userId: string }
type StoredUser = Omit<User, 'username' | 'avatar'> & Partial<Pick<User, 'username' | 'avatar'>>;

// One realm/module instance and exact Storage object only. Not cross-tab or crash atomic.
const operations = new WeakMap<Storage, Promise<void>>();

export function createLocalAuthStorageGateway(storage: Storage = window.localStorage): AuthStorageGateway {
  function parseUsers(raw: string | null): User[] {
    let users: StoredUser[];
    try { users = raw ? JSON.parse(raw) as StoredUser[] : []; } catch { users = []; }
    return users.map(user => ({ ...user, username: user.username?.trim() || user.email, avatar: user.avatar ?? '' }));
  }
  function parsePasswordRecords(raw: string | null): PasswordRecord[] {
    try {
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<PasswordRecord>[];
      return parsed.filter((record): record is PasswordRecord => typeof record?.email === 'string'
        && typeof record?.password === 'string' && typeof record?.userId === 'string');
    } catch { return []; }
  }
  return {
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      const result = (operations.get(storage) ?? Promise.resolve()).then(operation);
      operations.set(storage, result.then(() => undefined, () => undefined));
      return result;
    },
    async readUsers() { return parseUsers(storage.getItem(USERS_KEY)); },
    async writeUsers(users) { storage.setItem(USERS_KEY, JSON.stringify(users)); },
    async readSessionUserId() { return storage.getItem(SESSION_KEY); },
    async writeSessionUserId(userId) { storage.setItem(SESSION_KEY, userId); },
    async clearSessionUserId() { storage.removeItem(SESSION_KEY); },
    async findPasswordUserId(email, password) {
      try {
        const record = parsePasswordRecords(storage.getItem(PASSWORDS_KEY)).find(row => row.email === email);
        return record && record.password === password ? record.userId : null;
      } catch { return null; }
    },
    async registerUserWithPassword(user, password) {
      // Snapshot before any write; unavailable storage must not become a blank identity source.
      const previous = new Map([[USERS_KEY, storage.getItem(USERS_KEY)], [PASSWORDS_KEY, storage.getItem(PASSWORDS_KEY)]]);
      const nextUsers = JSON.stringify([...parseUsers(previous.get(USERS_KEY) ?? null), user]);
      const nextPasswords = JSON.stringify([...parsePasswordRecords(previous.get(PASSWORDS_KEY) ?? null), { email: user.email, password, userId: user.id }]);
      try {
        storage.setItem(USERS_KEY, nextUsers);
        storage.setItem(PASSWORDS_KEY, nextPasswords);
      } catch (error) {
        let recoveryFailed = false;
        for (const [key, raw] of previous) {
          try {
            if (storage.getItem(key) === raw) continue;
            if (raw === null) storage.removeItem(key); else storage.setItem(key, raw);
          } catch { recoveryFailed = true; }
        }
        if (recoveryFailed) throw new UserFacingError('新規登録に失敗し、保存状態の復元にも失敗しました。');
        throw error;
      }
    },
  };
}
