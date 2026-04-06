import type { Actual, DayNote, Plan, User } from '../types/domain';

const USERS_KEY = 'studyplanner.users';
const AUTH_CODES_KEY = 'studyplanner.authCodes';
const SESSION_KEY = 'studyplanner.session';
const PLANS_KEY = 'studyplanner.plans';
const ACTUALS_KEY = 'studyplanner.actuals';
const DAY_NOTES_KEY = 'studyplanner.dayNotes';

export interface PendingCode {
  email: string;
  code: string;
  expiresAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key);

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const localStorageStore = {
  readUsers() {
    return readJson<User[]>(USERS_KEY, []);
  },
  writeUsers(users: User[]) {
    writeJson(USERS_KEY, users);
  },
  readPendingCodes() {
    return readJson<PendingCode[]>(AUTH_CODES_KEY, []);
  },
  writePendingCodes(codes: PendingCode[]) {
    writeJson(AUTH_CODES_KEY, codes);
  },
  readSessionUserId() {
    return window.localStorage.getItem(SESSION_KEY);
  },
  writeSessionUserId(userId: string) {
    window.localStorage.setItem(SESSION_KEY, userId);
  },
  clearSessionUserId() {
    window.localStorage.removeItem(SESSION_KEY);
  },
  readPlans() {
    return readJson<Plan[]>(PLANS_KEY, []);
  },
  writePlans(plans: Plan[]) {
    writeJson(PLANS_KEY, plans);
  },
  readActuals() {
    return readJson<Actual[]>(ACTUALS_KEY, []);
  },
  writeActuals(actuals: Actual[]) {
    writeJson(ACTUALS_KEY, actuals);
  },
  readDayNotes() {
    return readJson<DayNote[]>(DAY_NOTES_KEY, []);
  },
  writeDayNotes(dayNotes: DayNote[]) {
    writeJson(DAY_NOTES_KEY, dayNotes);
  },
};
