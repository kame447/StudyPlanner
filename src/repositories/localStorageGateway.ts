import type { Actual, DayNote, MonthEvent, Plan, User } from '../types/domain';
import type {
  AuthCodeRecord,
  AuthStorageGateway,
  PlannerStorageGateway,
} from './repositoryContracts';

const STORAGE_KEYS = {
  users: 'studyplanner.users',
  authCodes: 'studyplanner.authCodes',
  session: 'studyplanner.session',
  plans: 'studyplanner.plans',
  actuals: 'studyplanner.actuals',
  dayNotes: 'studyplanner.dayNotes',
  monthEvents: 'studyplanner.monthEvents',
} as const;

type StoredMonthEvent = Omit<MonthEvent, 'repeatUntil' | 'excludedDates'> &
  Partial<Pick<MonthEvent, 'repeatUntil' | 'excludedDates'>>;

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  const raw = storage.getItem(key);

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(storage: Storage, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value));
}

function normalizeMonthEvent(monthEvent: StoredMonthEvent): MonthEvent {
  return {
    ...monthEvent,
    repeatUntil: monthEvent.repeatUntil ?? null,
    excludedDates: [...new Set(monthEvent.excludedDates ?? [])].filter(
      (date) => typeof date === 'string' && date.length > 0,
    ),
  };
}

export function createLocalAuthStorageGateway(
  storage: Storage = window.localStorage,
): AuthStorageGateway {
  return {
    async readUsers() {
      return readJson<User[]>(storage, STORAGE_KEYS.users, []);
    },
    async writeUsers(users) {
      writeJson(storage, STORAGE_KEYS.users, users);
    },
    async readPendingCodes() {
      return readJson<AuthCodeRecord[]>(storage, STORAGE_KEYS.authCodes, []);
    },
    async writePendingCodes(codes) {
      writeJson(storage, STORAGE_KEYS.authCodes, codes);
    },
    async readSessionUserId() {
      return storage.getItem(STORAGE_KEYS.session);
    },
    async writeSessionUserId(userId) {
      storage.setItem(STORAGE_KEYS.session, userId);
    },
    async clearSessionUserId() {
      storage.removeItem(STORAGE_KEYS.session);
    },
  };
}

export function createLocalPlannerStorageGateway(
  storage: Storage = window.localStorage,
): PlannerStorageGateway {
  return {
    async readPlans() {
      return readJson<Plan[]>(storage, STORAGE_KEYS.plans, []);
    },
    async writePlans(plans) {
      writeJson(storage, STORAGE_KEYS.plans, plans);
    },
    async readActuals() {
      return readJson<Actual[]>(storage, STORAGE_KEYS.actuals, []);
    },
    async writeActuals(actuals) {
      writeJson(storage, STORAGE_KEYS.actuals, actuals);
    },
    async readDayNotes() {
      return readJson<DayNote[]>(storage, STORAGE_KEYS.dayNotes, []);
    },
    async writeDayNotes(dayNotes) {
      writeJson(storage, STORAGE_KEYS.dayNotes, dayNotes);
    },
    async readMonthEvents() {
      return readJson<StoredMonthEvent[]>(storage, STORAGE_KEYS.monthEvents, []).map(
        normalizeMonthEvent,
      );
    },
    async writeMonthEvents(monthEvents) {
      writeJson(storage, STORAGE_KEYS.monthEvents, monthEvents);
    },
  };
}
