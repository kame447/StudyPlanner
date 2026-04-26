import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetablePeriod,
  TimetableTerm,
  TodoTask,
  User,
} from '../types/domain';
import type {
  AuthStorageGateway,
  PlannerStorageGateway,
} from './repositoryContracts';
import {
  normalizeActualRecord,
  normalizePlanRecord,
  normalizeScheduleTemplateRecord,
  normalizeTimetablePeriodRecord,
  normalizeTimetableTermRecord,
  normalizeTodoRecord,
} from './repositoryUtils';

const STORAGE_KEYS = {
  users: 'studyplanner.users',
  session: 'studyplanner.session',
  plans: 'studyplanner.plans',
  actuals: 'studyplanner.actuals',
  dayNotes: 'studyplanner.dayNotes',
  monthEvents: 'studyplanner.monthEvents',
  todos: 'studyplanner.todos.v1',
  scheduleTemplates: 'studyplanner.scheduleTemplates.v1',
  timetableTerms: 'studyplanner.timetableTerms.v1',
  timetablePeriods: 'studyplanner.timetablePeriods.v1',
} as const;

type StoredMonthEvent = Omit<MonthEvent, 'repeatUntil' | 'excludedDates'> &
  Partial<Pick<MonthEvent, 'repeatUntil' | 'excludedDates'>>;
type StoredUser = Omit<User, 'username' | 'avatar'> &
  Partial<Pick<User, 'username' | 'avatar'>>;
type StoredTodoTask = TodoTask;
type StoredScheduleTemplate = ScheduleTemplate;
type StoredTimetableTerm = TimetableTerm;
type StoredTimetablePeriod = TimetablePeriod;

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

function normalizeUser(user: StoredUser): User {
  return {
    ...user,
    username: user.username?.trim() || user.email,
    avatar: user.avatar ?? '',
  };
}

export function createLocalAuthStorageGateway(
  storage: Storage = window.localStorage,
): AuthStorageGateway {
  return {
    async readUsers() {
      return readJson<StoredUser[]>(storage, STORAGE_KEYS.users, []).map(normalizeUser);
    },
    async writeUsers(users) {
      writeJson(storage, STORAGE_KEYS.users, users);
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
      return readJson<Plan[]>(storage, STORAGE_KEYS.plans, []).map(normalizePlanRecord);
    },
    async writePlans(plans) {
      writeJson(storage, STORAGE_KEYS.plans, plans);
    },
    async readActuals() {
      return readJson<Actual[]>(storage, STORAGE_KEYS.actuals, []).map(normalizeActualRecord);
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
    async readTodos() {
      return readJson<StoredTodoTask[]>(storage, STORAGE_KEYS.todos, []).map(
        normalizeTodoRecord,
      );
    },
    async writeTodos(todos) {
      writeJson(storage, STORAGE_KEYS.todos, await todos);
    },
    async readScheduleTemplates() {
      return readJson<StoredScheduleTemplate[]>(
        storage,
        STORAGE_KEYS.scheduleTemplates,
        [],
      ).map(normalizeScheduleTemplateRecord);
    },
    async writeScheduleTemplates(items) {
      writeJson(storage, STORAGE_KEYS.scheduleTemplates, await items);
    },
    async readTimetableTerms() {
      return readJson<StoredTimetableTerm[]>(
        storage,
        STORAGE_KEYS.timetableTerms,
        [],
      ).map(normalizeTimetableTermRecord);
    },
    async writeTimetableTerms(items) {
      writeJson(storage, STORAGE_KEYS.timetableTerms, await items);
    },
    async readTimetablePeriods() {
      return readJson<StoredTimetablePeriod[]>(
        storage,
        STORAGE_KEYS.timetablePeriods,
        [],
      ).map(normalizeTimetablePeriodRecord);
    },
    async writeTimetablePeriods(items) {
      writeJson(storage, STORAGE_KEYS.timetablePeriods, await items);
    },
  };
}
