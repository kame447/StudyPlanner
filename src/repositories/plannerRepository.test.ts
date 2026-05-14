import { describe, expect, it } from 'vitest';
import { createPlannerRepository } from './plannerRepository';
import type { PlannerStorageGateway } from './repositoryContracts';
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

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'plan-1',
    occurrenceDate: '2026-05-13',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: 'Math',
    subject: 'Math',
    isAlignedToPlan: false,
    note: '',
    updatedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  };
}

function createMemoryGateway(seedActuals: Actual[] = []): PlannerStorageGateway {
  const state = {
    plans: [] as Plan[],
    actuals: [...seedActuals],
    dayNotes: [] as DayNote[],
    monthEvents: [] as MonthEvent[],
    todos: [] as TodoTask[],
    studySubjects: [] as StudySubject[],
    studyMaterials: [] as StudyMaterial[],
    scheduleTemplates: [] as ScheduleTemplate[],
    timetableTerms: [] as TimetableTerm[],
    timetablePeriods: [] as TimetablePeriod[],
  };

  return {
    async readPlans() {
      return state.plans;
    },
    async writePlans(plans) {
      state.plans = [...plans];
    },
    async readActuals() {
      return state.actuals;
    },
    async writeActuals(actuals) {
      state.actuals = [...actuals];
    },
    async readDayNotes() {
      return state.dayNotes;
    },
    async writeDayNotes(dayNotes) {
      state.dayNotes = [...dayNotes];
    },
    async readMonthEvents() {
      return state.monthEvents;
    },
    async writeMonthEvents(monthEvents) {
      state.monthEvents = [...monthEvents];
    },
    async readTodos() {
      return state.todos;
    },
    async writeTodos(todos) {
      state.todos = [...await todos];
    },
    async readStudySubjects() {
      return state.studySubjects;
    },
    async writeStudySubjects(items) {
      state.studySubjects = [...await items];
    },
    async readStudyMaterials() {
      return state.studyMaterials;
    },
    async writeStudyMaterials(items) {
      state.studyMaterials = [...await items];
    },
    async readScheduleTemplates() {
      return state.scheduleTemplates;
    },
    async writeScheduleTemplates(items) {
      state.scheduleTemplates = [...await items];
    },
    async readTimetableTerms() {
      return state.timetableTerms;
    },
    async writeTimetableTerms(items) {
      state.timetableTerms = [...await items];
    },
    async readTimetablePeriods() {
      return state.timetablePeriods;
    },
    async writeTimetablePeriods(items) {
      state.timetablePeriods = [...await items];
    },
  };
}

describe('createPlannerRepository actual upsert', () => {
  it('keeps one linked actual for the same plan and occurrence date', async () => {
    const repository = createPlannerRepository(createMemoryGateway());

    await repository.upsertActual(actual());
    const savedActual = await repository.upsertActual(
      actual({
        id: 'actual-2',
        actualEndTime: '10:30',
        title: 'Updated Math',
        note: 'updated',
        updatedAt: '2026-05-13T01:00:00.000Z',
      }),
    );
    const actuals = await repository.getActuals('user-1');

    expect(actuals).toHaveLength(1);
    expect(savedActual.id).toBe('actual-1');
    expect(actuals[0]).toMatchObject({
      id: 'actual-1',
      title: 'Updated Math',
      actualEndTime: '10:30',
      note: 'updated',
    });
  });

  it('keeps linked actuals separate when plan id differs', async () => {
    const repository = createPlannerRepository(createMemoryGateway());

    await repository.upsertActual(actual({ id: 'actual-1', planId: 'plan-1' }));
    await repository.upsertActual(actual({ id: 'actual-2', planId: 'plan-2' }));

    expect(await repository.getActuals('user-1')).toHaveLength(2);
  });

  it('keeps linked actuals separate when occurrence date differs', async () => {
    const repository = createPlannerRepository(createMemoryGateway());

    await repository.upsertActual(actual({ id: 'actual-1', occurrenceDate: '2026-05-13' }));
    await repository.upsertActual(actual({ id: 'actual-2', occurrenceDate: '2026-05-14' }));

    expect(await repository.getActuals('user-1')).toHaveLength(2);
  });

  it('does not dedupe standalone actuals', async () => {
    const repository = createPlannerRepository(createMemoryGateway());

    await repository.upsertActual(actual({ id: 'actual-1', planId: null }));
    await repository.upsertActual(actual({ id: 'actual-2', planId: null }));

    expect(await repository.getActuals('user-1')).toHaveLength(2);
  });

  it('does not add a new duplicate when linked duplicates already exist', async () => {
    const repository = createPlannerRepository(
      createMemoryGateway([
        actual({ id: 'actual-old', title: 'Old', updatedAt: '2026-05-13T00:00:00.000Z' }),
        actual({ id: 'actual-new', title: 'New', updatedAt: '2026-05-13T02:00:00.000Z' }),
      ]),
    );

    const savedActual = await repository.upsertActual(
      actual({
        id: 'actual-third',
        title: 'Newest edit',
        actualEndTime: '11:00',
        updatedAt: '2026-05-13T03:00:00.000Z',
      }),
    );
    const actuals = await repository.getActuals('user-1');

    expect(savedActual.id).toBe('actual-new');
    expect(actuals).toHaveLength(1);
    expect(actuals[0]).toMatchObject({
      id: 'actual-new',
      title: 'Newest edit',
      actualEndTime: '11:00',
    });
  });

  it('dedupes linked actuals on read so reports do not double count existing duplicates', async () => {
    const repository = createPlannerRepository(
      createMemoryGateway([
        actual({ id: 'actual-old', title: 'Old', updatedAt: '2026-05-13T00:00:00.000Z' }),
        actual({ id: 'actual-new', title: 'New', updatedAt: '2026-05-13T02:00:00.000Z' }),
        actual({ id: 'standalone-1', planId: null, updatedAt: '2026-05-13T00:00:00.000Z' }),
        actual({ id: 'standalone-2', planId: null, updatedAt: '2026-05-13T00:00:00.000Z' }),
      ]),
    );

    const actuals = await repository.getActuals('user-1');

    expect(actuals.map((item) => item.id)).toEqual([
      'actual-new',
      'standalone-1',
      'standalone-2',
    ]);
  });
});
