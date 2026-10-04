import { createLocalScheduleEventAuthority } from '../repositories/localScheduleEventAuthority';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerStorageGateway } from '../repositories/repositoryContracts';
import { createScheduleEventBackedPlannerRepository } from '../repositories/scheduleEventAuthorityRepository';
import type {
  Actual, DayNote, MonthEvent, Plan, ScheduleTemplate, StudyMaterial, StudySubject,
  TimetablePeriod, TimetableTerm, TodoTask,
} from '../types/domain';

function collection<T>(initial: T[] = []) {
  let value = structuredClone(initial);
  return {
    read: async () => structuredClone(value),
    write: async (next: T[] | PromiseLike<T[]>) => { value = structuredClone(await next); },
  };
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

/** Real repository variants share only their storage setup, never the assertions. */
export function createMonthEventRecoveryRepository(mode: 'legacy' | 'canonical', initialActuals: Actual[] = []) {
  const plans = collection<Plan>();
  const actuals = collection(initialActuals);
  const todos = collection<TodoTask>();
  const dayNotes = collection<DayNote>();
  const monthEvents = collection<MonthEvent>();
  const subjects = collection<StudySubject>();
  const materials = collection<StudyMaterial>();
  const templates = collection<ScheduleTemplate>();
  const terms = collection<TimetableTerm>();
  const periods = collection<TimetablePeriod>();
  const gateway: PlannerStorageGateway = {
    readPlans: plans.read, writePlans: plans.write,
    readActuals: actuals.read, writeActuals: actuals.write,
    readTodos: todos.read, writeTodos: todos.write,
    readDayNotes: dayNotes.read, writeDayNotes: dayNotes.write,
    readMonthEvents: monthEvents.read, writeMonthEvents: monthEvents.write,
    readStudySubjects: subjects.read, writeStudySubjects: subjects.write,
    readStudyMaterials: materials.read, writeStudyMaterials: materials.write,
    readScheduleTemplates: templates.read, writeScheduleTemplates: templates.write,
    readTimetableTerms: terms.read, writeTimetableTerms: terms.write,
    readTimetablePeriods: periods.read, writeTimetablePeriods: periods.write,
  };
  const legacy = createPlannerRepository(gateway);
  const repository = mode === 'legacy' ? legacy : createScheduleEventBackedPlannerRepository(
    legacy, createLocalScheduleEventAuthority(gateway, new MemoryStorage()),
  );
  // Canonical tests must seed/inspect the same durable ScheduleEvent authority
  // that the hook reads, rather than changing its superseded legacy collection.
  const monthStorage = mode === 'legacy' ? monthEvents : {
    read: () => repository.getMonthEvents('owner'),
    write: async (next: MonthEvent[]) => {
      for (const event of await repository.getMonthEvents('owner')) await repository.deleteMonthEvent('owner', event.id);
      for (const event of next) await repository.upsertMonthEvent(event);
    },
  };
  return { repository, storage: { actuals, materials, monthEvents: monthStorage } };
}
