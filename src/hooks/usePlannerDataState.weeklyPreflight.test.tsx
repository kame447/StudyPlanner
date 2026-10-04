import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository, PlannerStorageGateway } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
import type { Actual, DayNote, MonthEvent, Plan, ScheduleTemplate, StudyMaterial, StudySubject, TimetablePeriod, TimetableTerm, TodoTask } from '../types/domain';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { clearWeeklyPlanningSessionRuntime } from '../features/weeklyPlanning/planning/weeklyPlanningSessionRuntime';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const DATE = '2026-10-04'; const STAMP = `${DATE}T00:00:00.000Z`;
const plan = (id: string): Plan => ({ id, seriesId: id, userId: 'owner', title: id, subject: '数学', date: DATE,
  startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
  type: 'study', memo: '', createdAt: STAMP, updatedAt: STAMP });
const actual = (id: string, planId: string | null): Actual => ({ id, userId: 'owner', planId, occurrenceDate: DATE,
  actualStartTime: '09:00', actualEndTime: '10:00', title: id, subject: '数学', note: '元の記録', updatedAt: STAMP });
const A = plan('a'); const B = plan('b');
const AA = actual('actual-a', A.id); const AB = actual('actual-b', B.id); const STANDALONE = actual('standalone', null);
const TODO: TodoTask = { id: 'todo-b', userId: 'owner', title: 'todo-b', subject: '数学', type: 'study', estimatedMinutes: null,
  dueDate: null, memo: '', status: 'open', scheduledPlanId: null, createdAt: STAMP, updatedAt: STAMP };
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let harnessOwner: string | null = 'owner';
function Harness() {
  state = usePlannerDataState({ userId: harnessOwner, showNotice });
  application = useWeeklyPlanningApplication({ userId:harnessOwner, selectedDate:state.selectedDate,
    plans:state.plans, actuals:state.actuals, studyMaterials:state.studyMaterials,
    monthEvents:state.monthEvents, scheduleTemplates:state.scheduleTemplates, timetableTerms:state.timetableTerms,
    plannerDataAvailability:state.plannerDataAvailability, isPlannerDataSnapshotCurrent:state.isPlannerDataSnapshotCurrent,
    saveWeeklyApprovedPlan: async () => A,
  });
  return null;
}
function collection<T>(initial: T[]) {
  let value = structuredClone(initial);
  return { read: vi.fn(async () => structuredClone(value)), write: vi.fn(async (next: T[] | PromiseLike<T[]>) => { value = structuredClone(await next); }) };
}
async function mount(includeLinkedRecord = true) {
  harnessOwner = 'owner';
  const plans = collection([A, B]); const actuals = collection([AA, ...(includeLinkedRecord ? [AB] : []), STANDALONE]); const todos = collection([TODO]);
  const dayNotes = collection<DayNote>([]); const monthEvents = collection<MonthEvent>([]);
  const subjects = collection<StudySubject>([]); const materials = collection<StudyMaterial>([]);
  const templates = collection<ScheduleTemplate>([]); const terms = collection<TimetableTerm>([]); const periods = collection<TimetablePeriod>([]);
  const gateway: PlannerStorageGateway = {
    readPlans: plans.read, writePlans: plans.write, readActuals: actuals.read, writeActuals: actuals.write,
    readTodos: todos.read, writeTodos: todos.write, readDayNotes: dayNotes.read, writeDayNotes: dayNotes.write,
    readMonthEvents: monthEvents.read, writeMonthEvents: monthEvents.write,
    readStudySubjects: subjects.read, writeStudySubjects: subjects.write,
    readStudyMaterials: materials.read, writeStudyMaterials: materials.write,
    readScheduleTemplates: templates.read, writeScheduleTemplates: templates.write,
    readTimetableTerms: terms.read, writeTimetableTerms: terms.write, readTimetablePeriods: periods.read, writeTimetablePeriods: periods.write,
  };
  boundary.repository = createPlannerRepository(gateway);
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return { plans, actuals, todos, materials, subjects, dayNotes, monthEvents, templates, terms, periods };
}
function unmount() { act(() => renderer?.unmount()); renderer = undefined; }
afterEach(unmount);
const mocks = vi.hoisted(() => ({ load: vi.fn(), execute: vi.fn() }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningRuntimeModule', async () => ({...await vi.importActual('../features/weeklyPlanning/application/weeklyPlanningRuntimeModule'), loadWeeklyPlanningRuntimeModule:mocks.load}));
vi.mock('../features/weeklyPlanning/weeklyPlanningTurnExecutor', async () => ({...await vi.importActual('../features/weeklyPlanning/weeklyPlanningTurnExecutor'), executeWeeklyPlanningTurn:mocks.execute}));
let application: WeeklyPlanningApplication;
let restoreWindow: undefined | (() => void);
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED','false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  restoreWindow=installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  mocks.load.mockReset().mockResolvedValue({});
  mocks.execute.mockReset().mockResolvedValue({state:createInitialPlanningIntakeState(),message:'processed',draftCandidates:[]});
});
afterEach(() => { restoreWindow?.(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(['view', 'open-editor', 'open-close-editor'])('real data hook %s rerender does not invalidate a pending preflight or submission', async mode => {
  await mount(); const retained=application; const guard=state.isPlannerDataSnapshotCurrent;
  const pending=createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let preparation!:ReturnType<typeof application.prepareTurn>; let submission!:ReturnType<typeof application.submitTurn>;
  await act(async()=> { preparation=retained.prepareTurn(); submission=retained.submitTurn('harmless UI rerender'); });
  await act(async()=> { if(mode==='view') state.setViewMode('day'); else state.openCreatePlan(); });
  if(mode==='open-close-editor') await act(async()=>state.closePlanEditor());
  expect(state.isPlannerDataSnapshotCurrent).toBe(guard); expect(application).not.toBe(retained);
  await act(async()=> {pending.resolve({}); await expect(preparation).resolves.toEqual({ready:true}); expect((await submission).accepted).toBe(true);});
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it('real full refresh invalidates pending callbacks and current render sends newly accepted arrays', async()=> {
  const store=await mount(); const retained=application;
  const pending=createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let preparation!:ReturnType<typeof application.prepareTurn>; let submission!:ReturnType<typeof application.submitTurn>;
  await act(async()=> { preparation=retained.prepareTurn(); submission=retained.submitTurn('old arrays'); });
  await store.actuals.write([{...AA,id:'fresh-actual',note:'current'}]);
  await act(async()=> { await state.loadPlannerData('owner'); });
  await act(async()=> {pending.resolve({}); await expect(preparation).resolves.toEqual({ready:false,reason:'planner-data-changed'}); await expect(submission).resolves.toEqual({accepted:false,draftCandidates:[],rejectionReason:'planner-data-changed'});});
  expect(mocks.execute).not.toHaveBeenCalled();
  const currentActuals=state.actuals; const currentMaterials=state.studyMaterials;
  await act(async()=> {expect((await application.submitTurn('current arrays')).accepted).toBe(true);});
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0][0].actuals).toBe(currentActuals);
  expect(mocks.execute.mock.calls[0][0].studyMaterials).toBe(currentMaterials);
});
