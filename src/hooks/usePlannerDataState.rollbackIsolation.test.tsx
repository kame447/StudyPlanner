import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository, PlannerStorageGateway } from '../repositories/repositoryContracts';
import { createPlanDraftFromPlan } from '../domain/planner';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
import type { Actual, ActualDraft, DayNote, MonthEvent, Plan, ScheduleTemplate, StudyMaterial, StudySubject, TimetablePeriod, TimetableTerm, TodoTask } from '../types/domain';

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
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
function collection<T>(initial: T[]) {
  let value = structuredClone(initial);
  return { read: async () => structuredClone(value), write: async (next: T[] | PromiseLike<T[]>) => { value = structuredClone(await next); } };
}
async function mount(includeLinkedRecord = true) {
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
  return { plans, actuals, todos };
}
function unmount() { act(() => renderer?.unmount()); renderer = undefined; }
afterEach(unmount);
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, entered: false };
}
function hold(method: keyof PlannerRepository, gate: ReturnType<typeof deferred>) {
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    gate.entered = true;
    await gate.promise;
    return original(...args);
  } };
}
const operations = ['move', 'plan-update', 'plan-create', 'standalone', 'link', 'actual-delete', 'schedule-todo',
  'linked-update', 'linked-create', 'plan-delete'] as const;
type Operation = typeof operations[number];
function methodFor(operation: Operation): keyof PlannerRepository {
  if (operation === 'schedule-todo') return 'scheduleTodoPlan';
  if (operation === 'plan-delete') return 'deletePlanWithDependents';
  if (operation === 'move' || operation === 'plan-update' || operation === 'plan-create') return 'upsertPlan';
  if (operation === 'link') return 'upsertActual';
  if (operation === 'actual-delete') return 'deleteActual';
  return 'upsertActualWithMaterialProgress';
}
function startOther(operation: Operation) {
  const draft: ActualDraft = { userId: 'owner', planId: null, occurrenceDate: DATE, actualStartTime: '10:00', actualEndTime: '11:00',
    title: '保存した内容', subject: '数学', isAlignedToPlan: false, note: '保存したメモ', materialProgressUpdates: [] };
  switch (operation) {
    case 'move': return state.movePlanOccurrence(B, { date: DATE, startTime: '12:00', endTime: '13:00' });
    case 'plan-update': case 'plan-create': return state.savePlanDraft({ ...createPlanDraftFromPlan(B), title: '保存した予定' }, operation === 'plan-update' ? B.id : undefined);
    case 'standalone': return state.saveStandaloneActual(draft, STANDALONE.id);
    case 'link': return state.linkStandaloneActualToPlan(STANDALONE, B);
    case 'actual-delete': return state.deleteActual(STANDALONE);
    case 'schedule-todo': return state.scheduleTodoAsPlan(TODO, createPlanDraftFromPlan(B));
    case 'linked-update': return state.saveActual(B, { ...draft, planId: B.id }, AB.id);
    case 'linked-create': return state.saveActual(B, { ...draft, planId: B.id, occurrenceDate: '2026-10-05' });
    case 'plan-delete': return state.deletePlan(B);
  }
}
const normalize = <T extends { id: string }>(rows: T[]) => structuredClone(rows).sort((a, b) => a.id.localeCompare(b.id));
async function expectPersistedProjection(context: string) {
  expect({ plans: normalize(state.plans), actuals: normalize(state.actuals), todos: normalize(state.todos) }, context).toEqual({
    plans: normalize(await boundary.repository.getPlans('owner')),
    actuals: normalize(await boundary.repository.getActuals('owner')),
    todos: normalize(await boundary.repository.getTodos('owner')),
  });
}

// Exhaust the small outcome/order space: 16 executions per operation, not random sampling.
it.each(operations)('isolates deletion from overlapping %s across outcomes, completion and start order', async operation => {
  for (const aSuccess of [false, true]) for (const bSuccess of [false, true]) {
    for (const aSettlesFirst of [false, true]) for (const aStartsFirst of [false, true]) {
      await mount(operation !== 'link');
      const gateA = deferred(); const gateB = deferred();
      const originalDelete = boundary.repository.deletePlanWithDependents;
      boundary.repository.deletePlanWithDependents = async mutation => {
        const gate = mutation.plan.id === A.id ? gateA : gateB;
        gate.entered = true;
        await gate.promise;
        return originalDelete(mutation);
      };
      if (operation !== 'plan-delete') hold(methodFor(operation), gateB);
      let doneA!: Promise<unknown>; let doneB!: Promise<unknown>;
      const beginA = async () => { await act(async () => { doneA = state.deletePlan(A).catch(error => error); }); };
      const beginB = async () => { await act(async () => { doneB = startOther(operation).catch(error => error); }); };
      if (aStartsFirst) { await beginA(); await beginB(); } else { await beginB(); await beginA(); }
      expect(gateA.entered).toBe(true); expect(gateB.entered).toBe(true);
      expect(state.plans.some(row => row.id === A.id)).toBe(false);
      expect(state.actuals.some(row => row.id === AA.id)).toBe(false);
      const settle = async (isA: boolean) => {
        const gate = isA ? gateA : gateB; const success = isA ? aSuccess : bSuccess;
        const failure = new Error(isA ? 'A failed' : 'B failed');
        await act(async () => {
          if (success) gate.resolve(); else gate.reject(failure);
          const result = await (isA ? doneA : doneB);
          if (!success) expect(result).toBe(failure);
          else if (!isA && operation === 'schedule-todo') expect(result).toMatchObject({ userId: 'owner', sourceType: 'todo', sourceId: TODO.id });
          else expect(result).toBeUndefined();
        });
      };
      await settle(aSettlesFirst); await settle(!aSettlesFirst);
      await expectPersistedProjection(JSON.stringify({ operation, aSuccess, bSuccess, aSettlesFirst, aStartsFirst }));
      unmount();
    }
  }
});

it('does not restore a stale deletion snapshot after same-owner authoritative refresh', async () => {
  const storage = await mount(); const gate = deferred(); hold('deletePlanWithDependents', gate);
  let done!: Promise<unknown>;
  await act(async () => { done = state.deletePlan(A).catch(error => error); });
  await storage.plans.write([{ ...B, title: '最新の予定' }]); await storage.actuals.write([{ ...AB, note: '最新の記録' }]);
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { gate.reject(new Error('old deletion')); await done; });
  await expectPersistedProjection('refresh supersedes the pending deletion');
});

it('retains a completed delete Undo while an unrelated plan save fails', async () => {
  await mount(); const gate = deferred(); hold('upsertPlan', gate);
  let done!: Promise<unknown>;
  await act(async () => { done = startOther('plan-update').catch(error => error); });
  await act(async () => { await state.deletePlan(A); });
  const undo = showNotice.mock.calls.find(call => call[0] === '削除しました')?.[2]?.onAction;
  expect(undo).toBeTypeOf('function');
  await act(async () => { await undo!(); });
  await act(async () => { gate.reject(new Error('B failed')); await done; });
  await expectPersistedProjection('durable Undo survives unrelated rollback');
  expect(state.plans.some(row => row.id === A.id)).toBe(true);
  expect(state.actuals.some(row => row.id === AA.id)).toBe(true);
});

it('isolates a linked save from the optimistic link it was opened from', async () => {
  for (const linkSuccess of [false, true]) for (const saveSuccess of [false, true]) for (const linkFirst of [false, true]) {
    await mount(false);
    const linkGate = deferred(); const saveGate = deferred();
    hold('upsertActual', linkGate); hold('upsertActualWithMaterialProgress', saveGate);
    let linkDone!: Promise<unknown>; let saveDone!: Promise<unknown>;
    await act(async () => { linkDone = state.linkStandaloneActualToPlan(STANDALONE, B).catch(error => error); });
    const linked = state.actuals.find(record => record.id === STANDALONE.id)!;
    expect(linked.planId).toBe(B.id);
    const draft: ActualDraft = { userId: 'owner', planId: B.id, occurrenceDate: DATE, actualStartTime: '12:00', actualEndTime: '13:00',
      title: '紐づけ後の編集', subject: '数学', isAlignedToPlan: false, note: '新しい入力', materialProgressUpdates: [] };
    await act(async () => { saveDone = state.saveActual(B, draft, linked.id).catch(error => error); });
    expect(linkGate.entered).toBe(true); expect(saveGate.entered).toBe(true);
    const settle = async (isLink: boolean) => {
      const gate = isLink ? linkGate : saveGate; const success = isLink ? linkSuccess : saveSuccess;
      const failure = new Error(isLink ? 'link failed' : 'save failed');
      await act(async () => {
        if (success) gate.resolve(); else gate.reject(failure);
        const result = await (isLink ? linkDone : saveDone);
        if (success) expect(result).toBeUndefined(); else expect(result).toBe(failure);
      });
    };
    await settle(linkFirst); await settle(!linkFirst);
    await expectPersistedProjection(JSON.stringify({ linkSuccess, saveSuccess, linkFirst }));
    unmount();
  }
});
