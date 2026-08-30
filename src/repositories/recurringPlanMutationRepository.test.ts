import { describe, expect, it } from 'vitest';
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
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
import { createPlannerRepository } from './plannerRepository';
import type { PlannerStorageGateway } from './repositoryContracts';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'series-1', userId: 'user-1', title: 'Math', subject: 'Math',
    date: '2026-09-01', startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1', userId: 'user-1', planId: 'plan-1', occurrenceDate: '2026-09-01',
    actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '',
    updatedAt: '2026-09-01T10:00:00.000Z', ...overrides,
  };
}

function mutation(overrides: Partial<RecurringPlanMutation> = {}): RecurringPlanMutation {
  return { planUpserts: [], planDeletes: [], actualUpserts: [], actualDeletes: [], ...overrides };
}

function createGateway(seed: { plans?: Plan[]; actuals?: Actual[]; failActualWrite?: boolean }) {
  const state = {
    plans: [...(seed.plans ?? [])], actuals: [...(seed.actuals ?? [])], dayNotes: [] as DayNote[],
    monthEvents: [] as MonthEvent[], todos: [] as TodoTask[], studySubjects: [] as StudySubject[],
    studyMaterials: [] as StudyMaterial[], scheduleTemplates: [] as ScheduleTemplate[],
    timetableTerms: [] as TimetableTerm[], timetablePeriods: [] as TimetablePeriod[],
  };
  let failActualWrite = seed.failActualWrite ?? false;
  const gateway: PlannerStorageGateway = {
    async readPlans() { return state.plans; },
    async writePlans(items) { state.plans = [...items]; },
    async readActuals() { return state.actuals; },
    async writeActuals(items) {
      if (failActualWrite) { failActualWrite = false; throw new Error('actual write failed'); }
      state.actuals = [...items];
    },
    async readDayNotes() { return state.dayNotes; }, async writeDayNotes(items) { state.dayNotes = [...items]; },
    async readMonthEvents() { return state.monthEvents; }, async writeMonthEvents(items) { state.monthEvents = [...items]; },
    async readTodos() { return state.todos; }, async writeTodos(items) { state.todos = [...await items]; },
    async readStudySubjects() { return state.studySubjects; }, async writeStudySubjects(items) { state.studySubjects = [...await items]; },
    async readStudyMaterials() { return state.studyMaterials; }, async writeStudyMaterials(items) { state.studyMaterials = [...await items]; },
    async readScheduleTemplates() { return state.scheduleTemplates; }, async writeScheduleTemplates(items) { state.scheduleTemplates = [...await items]; },
    async readTimetableTerms() { return state.timetableTerms; }, async writeTimetableTerms(items) { state.timetableTerms = [...await items]; },
    async readTimetablePeriods() { return state.timetablePeriods; }, async writeTimetablePeriods(items) { state.timetablePeriods = [...await items]; },
  };
  return { state, gateway };
}

describe('planner repository recurring mutation boundary', () => {
  it('applies Plan and Actual changes through one repository operation', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({
      planUpserts: [plan({ title: 'Updated' })],
      actualUpserts: [actual({ planId: 'plan-2' })],
    }));
    expect(state.plans[0]?.title).toBe('Updated');
    expect(state.actuals[0]?.planId).toBe('plan-2');
  });

  it('rolls Plan storage back when the following Actual write fails', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked], failActualWrite: true });
    const repository = createPlannerRepository(gateway);
    await expect(repository.applyRecurringPlanMutation('user-1', mutation({
      planUpserts: [plan({ title: 'Should rollback' })], actualDeletes: [linked],
    }))).rejects.toThrow('actual write failed');
    expect(state.plans).toEqual([source]);
    expect(state.actuals).toEqual([linked]);
  });

  it('cascades a Plan delete to every raw linked Actual, including duplicates', async () => {
    const source = plan();
    const duplicateA = actual({ id: 'a1' });
    const duplicateB = actual({ id: 'a2' });
    const unrelated = actual({ id: 'other', planId: 'other-plan' });
    const { state, gateway } = createGateway({ plans: [source], actuals: [duplicateA, duplicateB, unrelated] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({ planDeletes: [source] }));
    expect(state.plans).toEqual([]);
    expect(state.actuals).toEqual([unrelated]);
  });

  it('preserves a rebound Actual when its old Plan is deleted in the same mutation', async () => {
    const source = plan();
    const linked = actual();
    const rebound = actual({ planId: 'replacement-plan' });
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({
      planDeletes: [source], actualUpserts: [rebound],
    }));
    expect(state.actuals).toEqual([rebound]);
  });

  it('rejects any cross-owner mutation before writing', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await expect(repository.applyRecurringPlanMutation('user-1', mutation({
      planDeletes: [plan({ id: 'foreign', userId: 'user-2' })],
    }))).rejects.toThrow('another user');
    expect(state.plans).toEqual([source]);
    expect(state.actuals).toEqual([linked]);
  });
});
