import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
  TimetablePeriod,
  TimetableTerm,
  TodoTask,
} from '../types/domain';
import type {
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
  plans: 'studyplanner.plans',
  actuals: 'studyplanner.actuals',
  dayNotes: 'studyplanner.dayNotes',
  monthEvents: 'studyplanner.monthEvents',
  todos: 'studyplanner.todos.v1',
  studySubjects: 'studyplanner.studySubjects.v1',
  studyMaterials: 'studyplanner.studyMaterials.v1',
  scheduleTemplates: 'studyplanner.scheduleTemplates.v1',
  timetableTerms: 'studyplanner.timetableTerms.v1',
  timetablePeriods: 'studyplanner.timetablePeriods.v1',
} as const;

type StoredMonthEvent = Omit<MonthEvent, 'repeatUntil' | 'excludedDates'> &
  Partial<Pick<MonthEvent, 'repeatUntil' | 'excludedDates'>>;
type StoredTodoTask = TodoTask;
type StoredStudySubject = StudySubject;
type StoredStudyMaterial = StudyMaterial;
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

export { createLocalAuthStorageGateway } from './localAuthStorageGateway';

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
    async readStudySubjects() {
      return readJson<StoredStudySubject[]>(
        storage,
        STORAGE_KEYS.studySubjects,
        [],
      );
    },
    async writeStudySubjects(items) {
      writeJson(storage, STORAGE_KEYS.studySubjects, await items);
    },
    async readStudyMaterials() {
      return readJson<StoredStudyMaterial[]>(
        storage,
        STORAGE_KEYS.studyMaterials,
        [],
      );
    },
    async writeStudyMaterials(items) {
      writeJson(storage, STORAGE_KEYS.studyMaterials, await items);
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
