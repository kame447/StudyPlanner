import { describe, expect, it } from 'vitest';
import type { PlannerStorageGateway } from './repositoryContracts';
import { createPlannerRepository } from './plannerRepository';
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

type FailureKey =
  | 'plans'
  | 'actuals'
  | 'todos'
  | 'subjects'
  | 'materials'
  | 'templates'
  | 'terms'
  | 'periods';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '数学',
    subject: '数学',
    date: '2026-08-31',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T01:00:00.000Z',
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'plan-1',
    occurrenceDate: '2026-08-31',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: '数学',
    subject: '数学',
    isAlignedToPlan: true,
    note: '',
    updatedAt: '2026-08-31T01:00:00.000Z',
    ...overrides,
  };
}

function todo(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: 'todo-1',
    userId: 'user-1',
    title: '数学の課題',
    subject: '数学',
    type: 'study',
    estimatedMinutes: 60,
    dueDate: null,
    memo: '',
    status: 'scheduled',
    scheduledPlanId: 'plan-1',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T01:00:00.000Z',
    ...overrides,
  };
}

function subject(overrides: Partial<StudySubject> = {}): StudySubject {
  return {
    id: 'subject-1',
    userId: 'user-1',
    name: '数学',
    color: '#111111',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: 'user-1',
    name: '問題集',
    subjectId: 'subject-1',
    subjectName: '数学',
    color: '#111111',
    aliases: [],
    status: 'active',
    paceEnabled: true,
    progressUnit: 'page',
    totalUnits: 100,
    currentUnit: 10,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

function term(overrides: Partial<TimetableTerm> = {}): TimetableTerm {
  return {
    id: 'term-1',
    userId: 'user-1',
    year: 2026,
    kind: 'firstHalf',
    label: '2026年 前期',
    startDate: '2026-04-01',
    endDate: '2026-09-30',
    usesAlternatingWeeks: false,
    alternatingWeekAnchorDate: null,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

function period(overrides: Partial<TimetablePeriod> = {}): TimetablePeriod {
  return {
    id: 'period-1',
    userId: 'user-1',
    termId: 'term-1',
    periodNumber: 1,
    label: '1限',
    startTime: '09:00',
    endTime: '10:30',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

function memoryGateway(seed: {
  plans?: Plan[];
  actuals?: Actual[];
  todos?: TodoTask[];
  subjects?: StudySubject[];
  materials?: StudyMaterial[];
  templates?: ScheduleTemplate[];
  terms?: TimetableTerm[];
  periods?: TimetablePeriod[];
} = {}) {
  const state = {
    plans: [...(seed.plans ?? [])],
    actuals: [...(seed.actuals ?? [])],
    dayNotes: [] as DayNote[],
    monthEvents: [] as MonthEvent[],
    todos: [...(seed.todos ?? [])],
    subjects: [...(seed.subjects ?? [])],
    materials: [...(seed.materials ?? [])],
    templates: [...(seed.templates ?? [])],
    terms: [...(seed.terms ?? [])],
    periods: [...(seed.periods ?? [])],
  };
  let failure: FailureKey | null = null;
  const fail = (key: FailureKey) => {
    if (failure !== key) return;
    failure = null;
    throw new Error(`forced ${key} failure`);
  };

  const gateway: PlannerStorageGateway = {
    async readPlans() { return state.plans; },
    async writePlans(value) { fail('plans'); state.plans = [...value]; },
    async readActuals() { return state.actuals; },
    async writeActuals(value) { fail('actuals'); state.actuals = [...value]; },
    async readDayNotes() { return state.dayNotes; },
    async writeDayNotes(value) { state.dayNotes = [...value]; },
    async readMonthEvents() { return state.monthEvents; },
    async writeMonthEvents(value) { state.monthEvents = [...value]; },
    async readTodos() { return state.todos; },
    async writeTodos(value) { fail('todos'); state.todos = [...await value]; },
    async readStudySubjects() { return state.subjects; },
    async writeStudySubjects(value) { fail('subjects'); state.subjects = [...await value]; },
    async readStudyMaterials() { return state.materials; },
    async writeStudyMaterials(value) { fail('materials'); state.materials = [...await value]; },
    async readScheduleTemplates() { return state.templates; },
    async writeScheduleTemplates(value) { fail('templates'); state.templates = [...await value]; },
    async readTimetableTerms() { return state.terms; },
    async writeTimetableTerms(value) { fail('terms'); state.terms = [...await value]; },
    async readTimetablePeriods() { return state.periods; },
    async writeTimetablePeriods(value) { fail('periods'); state.periods = [...await value]; },
  };

  return {
    gateway,
    state,
    failOnce(key: FailureKey) {
      failure = key;
    },
  };
}

describe('planner cross-entity mutation consistency', () => {
  it('durably restores linked Actuals and Todo after Plan delete Undo', async () => {
    const originalPlan = plan();
    const originalActual = actual();
    const originalTodo = todo();
    const memory = memoryGateway({
      plans: [originalPlan],
      actuals: [originalActual],
      todos: [originalTodo],
    });
    const repository = createPlannerRepository(memory.gateway);

    await repository.deletePlanWithDependents({
      userId: 'user-1',
      plan: originalPlan,
      todo: todo({ status: 'open', scheduledPlanId: null }),
    });

    expect(await repository.getPlans('user-1')).toEqual([]);
    expect(await repository.getActuals('user-1')).toEqual([]);
    expect((await repository.getTodos('user-1'))[0]).toMatchObject({
      status: 'open',
      scheduledPlanId: null,
    });

    await repository.restorePlanWithDependents({
      plan: originalPlan,
      actuals: [originalActual],
      todo: originalTodo,
    });

    expect(await repository.getPlans('user-1')).toEqual([originalPlan]);
    expect(await repository.getActuals('user-1')).toEqual([originalActual]);
    expect(await repository.getTodos('user-1')).toEqual([originalTodo]);
  });

  it('rolls Plan Undo restoration back when dependent Actual persistence fails', async () => {
    const originalPlan = plan();
    const originalActual = actual();
    const originalTodo = todo();
    const deletedTodo = todo({ status: 'open', scheduledPlanId: null });
    const memory = memoryGateway({ todos: [deletedTodo] });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('actuals');

    await expect(repository.restorePlanWithDependents({
      plan: originalPlan,
      actuals: [originalActual],
      todo: originalTodo,
    })).rejects.toThrow('forced actuals failure');

    expect(memory.state.plans).toEqual([]);
    expect(memory.state.actuals).toEqual([]);
    expect(memory.state.todos).toEqual([deletedTodo]);
  });

  it('rolls Plan deletion back when dependent Actual persistence fails', async () => {
    const originalPlan = plan();
    const originalActual = actual();
    const originalTodo = todo();
    const memory = memoryGateway({
      plans: [originalPlan],
      actuals: [originalActual],
      todos: [originalTodo],
    });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('actuals');

    await expect(repository.deletePlanWithDependents({
      userId: 'user-1',
      plan: originalPlan,
      todo: todo({ status: 'open', scheduledPlanId: null }),
    })).rejects.toThrow('forced actuals failure');

    expect(memory.state.plans).toEqual([originalPlan]);
    expect(memory.state.actuals).toEqual([originalActual]);
    expect(memory.state.todos).toEqual([originalTodo]);
  });

  it('rolls Actual persistence back when material progress persistence fails', async () => {
    const originalMaterial = material();
    const memory = memoryGateway({ materials: [originalMaterial] });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('materials');

    await expect(repository.upsertActualWithMaterialProgress({
      actual: actual(),
      materials: [material({
        currentUnit: 20,
        updatedAt: '2026-08-31T02:00:00.000Z',
      })],
    })).rejects.toThrow('forced materials failure');

    expect(memory.state.actuals).toEqual([]);
    expect(memory.state.materials).toEqual([originalMaterial]);
  });

  it('rolls Subject rename back when dependent Material persistence fails', async () => {
    const originalSubject = subject();
    const originalMaterial = material();
    const memory = memoryGateway({
      subjects: [originalSubject],
      materials: [originalMaterial],
    });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('materials');

    await expect(repository.upsertStudySubjectWithMaterials({
      subject: subject({ name: '数学IA', color: '#222222' }),
      materials: [material({ subjectName: '数学IA', color: '#222222' })],
    })).rejects.toThrow('forced materials failure');

    expect(memory.state.subjects).toEqual([originalSubject]);
    expect(memory.state.materials).toEqual([originalMaterial]);
  });

  it('rolls timetable writes back when a later collection write fails', async () => {
    const originalTerm = term();
    const originalPeriod = period();
    const memory = memoryGateway({ terms: [originalTerm], periods: [originalPeriod] });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('periods');

    await expect(repository.applyTimetableMutation({
      userId: 'user-1',
      termUpserts: [term({
        label: '前期',
        updatedAt: '2026-08-31T02:00:00.000Z',
      })],
      termDeletes: [],
      templateUpserts: [],
      templateDeletes: [],
      periodUpserts: [period({ label: '第1時限' })],
      periodDeletes: [],
    })).rejects.toThrow('forced periods failure');

    expect(memory.state.terms).toEqual([originalTerm]);
    expect(memory.state.periods).toEqual([originalPeriod]);
  });

  it('rejects cross-owner records before timetable persistence', async () => {
    const originalTerm = term();
    const memory = memoryGateway({ terms: [originalTerm] });
    const repository = createPlannerRepository(memory.gateway);

    await expect(repository.applyTimetableMutation({
      userId: 'user-1',
      termUpserts: [term({ id: 'foreign', userId: 'user-2' })],
      termDeletes: [],
      templateUpserts: [],
      templateDeletes: [],
      periodUpserts: [],
      periodDeletes: [],
    })).rejects.toThrow('所有者が一致しません');

    expect(memory.state.terms).toEqual([originalTerm]);
  });

  it('rolls a new Plan back when Todo scheduling persistence fails', async () => {
    const originalTodo = todo({ status: 'open', scheduledPlanId: null });
    const memory = memoryGateway({ todos: [originalTodo] });
    const repository = createPlannerRepository(memory.gateway);
    memory.failOnce('todos');

    await expect(repository.scheduleTodoPlan({
      plan: plan(),
      todo: todo(),
    })).rejects.toThrow('forced todos failure');

    expect(memory.state.plans).toEqual([]);
    expect(memory.state.todos).toEqual([originalTodo]);
  });
});
