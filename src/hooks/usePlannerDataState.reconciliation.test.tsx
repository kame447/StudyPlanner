import { StrictMode, Suspense, startTransition, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository, PlannerStorageGateway } from '../repositories/repositoryContracts';
import { createPlanDraftFromPlan, createEmptyDayNoteDraft, createEmptyMonthEventDraft, createMonthEventFromDraft } from '../domain/planner';
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
let harnessOwner: string | null = 'owner';
let renderedReady = false;
function Harness() {
  state = usePlannerDataState({ userId: harnessOwner, showNotice });
  renderedReady = state.isPlannerDataSnapshotCurrent();
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


it.each(['standalone','linked-update','link'] as const)('review pre-existing late canonical %s response after newer authoritative refresh', async operation => {
  const storage=await mount(operation!=='link'); const persisted=deferred(); const response=deferred();
  const method=methodFor(operation); const original=boundary.repository[method] as (...args:unknown[])=>Promise<unknown>;
  boundary.repository={...boundary.repository,[method]:async(...args:unknown[])=>{const result=await original(...args);persisted.resolve();await response.promise;return result;}};
  let done!:Promise<unknown>; await act(async()=>{done=startOther(operation).catch(e=>e);});
  await persisted.promise;
  const records=await storage.actuals.read(); const targetId=operation==='linked-update'?AB.id:STANDALONE.id;
  await storage.actuals.write(records.map(record=>record.id===targetId?{...record,note:'NEWER AUTHORITATIVE CONTENT'}:record));
  await act(async()=>{await state.loadPlannerData('owner');});
  expect(state.actuals.find(record=>record.id===targetId)?.note).toBe('NEWER AUTHORITATIVE CONTENT');
  await act(async()=>{response.resolve();expect(await done).toBeUndefined();});
  await expectPersistedProjection('late canonical response must not replace newer authoritative refresh');
});

const progressMaterial: StudyMaterial = { id: 'material', userId: 'owner', name: 'Book', subjectId: 'math', subjectName: 'Math', paceEnabled: true, progressUnit: 'problem', currentUnit: 10, totalUnits: 100, createdAt: STAMP, updatedAt: STAMP };
const draftFor = (planId: string | null = null, note = 'OLD ACK'): ActualDraft => ({ userId:'owner', planId, occurrenceDate:DATE, actualStartTime:'10:00', actualEndTime:'11:00', title:'Record', subject:'Math', isAlignedToPlan:false, note, materialProgressUpdates:[] });
function holdFirstResponse(method: keyof PlannerRepository) {
  const persisted = deferred(), response = deferred();
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  let count = 0;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    const first = ++count === 1; const saved = await original(...args);
    if (first) { persisted.resolve(); await response.promise; }
    return saved;
  } };
  return { persisted, response };
}

it('audit material progress acknowledgment after successful refresh', async () => {
  const storage = await mount(); await storage.materials.write([progressMaterial]);
  await act(async () => { await state.loadPlannerData('owner'); });
  const {persisted,response} = holdFirstResponse('upsertActualWithMaterialProgress');
  let done!: Promise<void>;
  await act(async () => { done = state.saveStandaloneActual({...draftFor(), materialProgressUpdates:[{materialId:'material',deltaUnits:5}]}); });
  await persisted.promise;
  expect((await storage.materials.read())[0].currentUnit).toBe(15);
  await storage.materials.write([{...progressMaterial,currentUnit:37,name:'Newer Book'}]);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.studyMaterials[0].currentUnit).toBe(37);
  await act(async () => { response.resolve(); await done; });
  expect(state.studyMaterials).toEqual(await storage.materials.read());
});

it('audit failed refresh does not revoke an otherwise valid acknowledgment', async () => {
  await mount(); const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');
  let done!: Promise<void>; await act(async()=>{done=state.saveStandaloneActual(draftFor(),STANDALONE.id);});
  await persisted.promise;
  const original=boundary.repository.getPlans; boundary.repository.getPlans=async()=>{throw new Error('read failure');};
  await act(async()=>{await expect(state.loadPlannerData('owner')).rejects.toThrow('read failure');});
  boundary.repository.getPlans=original;
  await act(async()=>{response.resolve();await done;});
  await expectPersistedProjection('failed reads have not replaced the acknowledged state');
});

it('audit canonical ID acknowledgment after newer authoritative refresh', async () => {
  const storage=await mount(false);
  await storage.actuals.write([AA,STANDALONE,{...AB,id:'canonical'}]);
  const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');
  let done!:Promise<void>;await act(async()=>{done=state.saveActual(B,draftFor(B.id));});
  await persisted.promise;
  await storage.actuals.write((await storage.actuals.read()).map(row=>row.id==='canonical'?{...row,note:'NEW CANONICAL CONTENT'}:row));
  await act(async()=>{await state.loadPlannerData('owner');});
  expect(state.actuals.filter(row=>row.planId===B.id)).toEqual([expect.objectContaining({id:'canonical',note:'NEW CANONICAL CONTENT'})]);
  await act(async()=>{response.resolve();await done;});
  await expectPersistedProjection('late provisional-ID operation cannot overwrite current canonical ID content');
});

it.each([false,true])('audit late acknowledgment preserves newer post-refresh operation success=%s',async success=>{
  const storage=await mount();const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');
  let oldDone!:Promise<void>;await act(async()=>{oldDone=state.saveStandaloneActual(draftFor(),STANDALONE.id);});
  await persisted.promise;
  await storage.actuals.write((await storage.actuals.read()).map(row=>row.id===STANDALONE.id?{...row,note:'REFRESHED'}:row));
  await act(async()=>{await state.loadPlannerData('owner');});
  const gate=deferred();hold('upsertActualWithMaterialProgress',gate);let newDone!:Promise<unknown>;
  await act(async()=>{newDone=state.saveStandaloneActual(draftFor(null,'NEW PENDING'),STANDALONE.id).catch(e=>e);});
  expect(state.actuals.find(row=>row.id===STANDALONE.id)?.note).toBe('NEW PENDING');
  await act(async()=>{response.resolve();await oldDone;});
  expect(state.actuals.find(row=>row.id===STANDALONE.id)?.note).toBe('NEW PENDING');
  await act(async()=>{if(success)gate.resolve();else gate.reject(new Error('new failed'));await newDone;});
  await expectPersistedProjection('late pre-refresh result cannot erase a newer optimistic operation or its refreshed rollback base');
});

it('audit superseded load and newer failed load do not revoke acknowledgment',async()=>{
  await mount();const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');
  let saving!:Promise<void>;await act(async()=>{saving=state.saveStandaloneActual(draftFor(),STANDALONE.id);});await persisted.promise;
  const original=boundary.repository.getPlans;const loadGate=deferred();let calls=0;
  boundary.repository.getPlans=async(owner)=>{if(++calls===1){const saved=await original(owner);await loadGate.promise;return saved;}throw new Error('newer load failed');};
  let oldLoad!:Promise<void>;await act(async()=>{oldLoad=state.loadPlannerData('owner');});
  await act(async()=>{await expect(state.loadPlannerData('owner')).rejects.toThrow('newer load failed');});
  await act(async()=>{loadGate.resolve();await oldLoad;});boundary.repository.getPlans=original;
  await act(async()=>{response.resolve();await saving;});
  await expectPersistedProjection('neither attempted load installed a newer snapshot');
});

it.each(['standalone','linked-update','link'] as const)('audit before-write refresh %s then persistence succeeds', async operation=>{
  await mount(operation!=='link');const gate=deferred();hold(methodFor(operation),gate);
  let done!:Promise<unknown>;await act(async()=>{done=startOther(operation);});
  expect(gate.entered).toBe(true);
  await act(async()=>{await state.loadPlannerData('owner');});
  await act(async()=>{gate.resolve();expect(await done).toBeUndefined();});
  await expectPersistedProjection('the successful write happened after the accepted snapshot');
});

it('audit before-write refresh material then persistence succeeds',async()=>{
  const storage=await mount();await storage.materials.write([progressMaterial]);await act(async()=>{await state.loadPlannerData('owner');});
  const gate=deferred();hold('upsertActualWithMaterialProgress',gate);let done!:Promise<void>;
  await act(async()=>{done=state.saveStandaloneActual({...draftFor(),materialProgressUpdates:[{materialId:'material',deltaUnits:5}]});});
  expect(gate.entered).toBe(true);await act(async()=>{await state.loadPlannerData('owner');});
  expect(state.studyMaterials[0].currentUnit).toBe(10);
  await act(async()=>{gate.resolve();await done;});
  expect((await storage.materials.read())[0].currentUnit).toBe(15);
  expect(state.studyMaterials).toEqual(await storage.materials.read());
  await expectPersistedProjection('the new Actual and material committed after refresh');
});

it('audit reload race newer write settles before reconciliation read returns',async()=>{
  const storage=await mount();const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');
  let oldDone!:Promise<void>;await act(async()=>{oldDone=state.saveStandaloneActual(draftFor(),STANDALONE.id);});await persisted.promise;
  await storage.actuals.write((await storage.actuals.read()).map(row=>row.id===STANDALONE.id?{...row,note:'REFRESHED'}:row));
  await act(async()=>{await state.loadPlannerData('owner');});
  const original=boundary.repository.getActuals;const readEntered=deferred(),readResponse=deferred();let first=true;
  boundary.repository.getActuals=async(owner)=>{const snapshot=await original(owner);if(first){first=false;readEntered.resolve();await readResponse.promise;}return snapshot;};
  await act(async()=>{response.resolve();});await readEntered.promise;
  await act(async()=>{await state.saveStandaloneActual(draftFor(null,'NEWER PERSISTED WRITE'),STANDALONE.id);});
  expect(state.actuals.find(row=>row.id===STANDALONE.id)?.note).toBe('NEWER PERSISTED WRITE');
  await act(async()=>{readResponse.resolve();await oldDone;});
  await expectPersistedProjection('a reconciliation read started before a newer write must not overwrite it');
});

it('audit reload obsolete failure cannot mark newer accepted load stale',async()=>{
  const storage=await mount();const {persisted,response}=holdFirstResponse('upsertActualWithMaterialProgress');let done!:Promise<void>;
  await act(async()=>{done=state.saveStandaloneActual(draftFor(),STANDALONE.id);});await persisted.promise;
  await act(async()=>{await state.loadPlannerData('owner');});
  const original=boundary.repository.getActuals;const readEntered=deferred(),readResponse=deferred();let first=true;
  boundary.repository.getActuals=async(owner)=>{if(first){first=false;readEntered.resolve();await readResponse.promise;throw new Error('old failed read');}return original(owner);};
  await act(async()=>{response.resolve();});await readEntered.promise;
  await storage.actuals.write((await storage.actuals.read()).map(row=>row.id===STANDALONE.id?{...row,note:'NEWER LOAD'}:row));
  await act(async()=>{await state.loadPlannerData('owner');});showNotice.mockClear();
  await act(async()=>{readResponse.resolve();await expect(done).resolves.toBeUndefined();});
  expect(state.plannerDataAvailability.status).toBe('ready');await expectPersistedProjection('obsolete failure must be silent');expect(showNotice).not.toHaveBeenCalled();
});

async function staleActualAcknowledgment(includeLinkedRecord = true) {
  const storage = await mount(includeLinkedRecord);
  const { persisted, response } = holdFirstResponse('upsertActualWithMaterialProgress');
  let done!: Promise<void>;
  await act(async () => { done = state.saveStandaloneActual(draftFor(), STANDALONE.id); });
  await persisted.promise;
  await storage.actuals.write((await storage.actuals.read()).map(row => row.id === STANDALONE.id ? { ...row, note: 'REFRESHED' } : row));
  await act(async () => { await state.loadPlannerData('owner'); });
  return { storage, response, done };
}
function holdNextActualRead(failure = false) {
  const original = boundary.repository.getActuals;
  const entered = deferred(), response = deferred();
  let reads = 0;
  boundary.repository.getActuals = async owner => {
    const saved = await original(owner);
    if (++reads === 1) {
      entered.resolve();
      await response.promise;
      if (failure) throw new Error('obsolete snapshot failure');
    }
    return saved;
  };
  return { entered, response, reads: () => reads };
}

it.each([false, true])('controller drops read with a newer failed mutation while old read failure=%s', async failure => {
  const old = await staleActualAcknowledgment();
  const read = holdNextActualRead(failure);
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  const gate = deferred(); hold('upsertActualWithMaterialProgress', gate);
  let newer!: Promise<unknown>;
  await act(async () => { newer = state.saveStandaloneActual(draftFor(null, 'PENDING'), STANDALONE.id).catch(e => e); });
  expect(state.actuals.find(row => row.id === STANDALONE.id)?.note).toBe('PENDING');
  await act(async () => { gate.reject(new Error('write failed')); await newer; });
  showNotice.mockClear();
  await act(async () => { read.response.resolve(); });
  expect(read.reads()).toBe(2);
  expect(showNotice).not.toHaveBeenCalled();
  await expectPersistedProjection('rejected operation changes settlement revision too');
});

it('controller waits for pending Undo before replacing Actuals', async () => {
  const old = await staleActualAcknowledgment();
  await act(async () => { await state.deletePlan(A); });
  const undo = showNotice.mock.calls.find(call => call[0] === '削除しました')?.[2]?.onAction;
  const gate = deferred(); hold('restorePlanWithDependents', gate);
  let undone!: Promise<unknown>;
  await act(async () => { undone = Promise.resolve(undo!()); });
  const readActuals = vi.spyOn(boundary.repository, 'getActuals');
  await act(async () => { old.response.resolve(); await old.done; });
  expect(readActuals).not.toHaveBeenCalled();
  await act(async () => { gate.resolve(); await undone; });
  expect(readActuals).toHaveBeenCalledTimes(1);
  await expectPersistedProjection('Undo enrolls a separate mutation lifetime');
});

it('controller invalidates in-flight read when Undo starts and settles', async () => {
  const old = await staleActualAcknowledgment();
  await act(async () => { await state.deletePlan(A); });
  const undo = showNotice.mock.calls.find(call => call[0] === '削除しました')?.[2]?.onAction;
  const read = holdNextActualRead();
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  await act(async () => { await undo!(); });
  expect(state.actuals.some(row => row.id === AA.id)).toBe(true);
  await act(async () => { read.response.resolve(); });
  expect(read.reads()).toBe(2);
  await expectPersistedProjection('completed Undo cannot be erased by a pre-Undo Actual snapshot');
});

it('controller waits for pending material writer before replacing material progress', async () => {
  const old = await staleActualAcknowledgment();
  await old.storage.materials.write([progressMaterial]);
  await act(async () => { await state.loadPlannerData('owner'); });
  const gate = deferred(); hold('deleteStudyMaterial', gate);
  let deleted!: Promise<void>;
  await act(async () => { deleted = state.deleteStudyMaterial(progressMaterial); });
  const reads = vi.spyOn(boundary.repository, 'getStudyMaterials');
  await act(async () => { old.response.resolve(); await old.done; });
  expect(reads).not.toHaveBeenCalled();
  await act(async () => { gate.resolve(); await deleted; });
  expect(state.studyMaterials).toEqual([]);
  expect(reads).toHaveBeenCalledTimes(1);
});

it.each([false, true])('controller owner reset discards old read failure=%s', async failure => {
  const old = await staleActualAcknowledgment();
  const read = holdNextActualRead(failure);
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  await act(async () => { state.resetPlannerData(); });
  showNotice.mockClear();
  await act(async () => { read.response.resolve(); });
  expect(state.actuals).toEqual([]);
  expect(state.studyMaterials).toEqual([]);
  expect(state.plannerDataAvailability.status).toBe('idle');
  expect(showNotice).not.toHaveBeenCalled();
  expect(read.reads()).toBe(1);
});

it('controller targeted read does not call or mutate timetable normalization', async () => {
  const old = await staleActualAcknowledgment();
  const getPlans = vi.spyOn(boundary.repository, 'getPlans');
  const getTodos = vi.spyOn(boundary.repository, 'getTodos');
  const normalizeTimetable = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  const getActuals = vi.spyOn(boundary.repository, 'getActuals');
  const getMaterials = vi.spyOn(boundary.repository, 'getStudyMaterials');
  await act(async () => { old.response.resolve(); await old.done; });
  expect(getPlans).not.toHaveBeenCalled(); expect(getTodos).not.toHaveBeenCalled(); expect(normalizeTimetable).not.toHaveBeenCalled();
  expect(getActuals).toHaveBeenCalledTimes(1); expect(getMaterials).toHaveBeenCalledTimes(1);
});

it.each([false, true])('controller read is dropped while the newer operation remains pending success=%s', async success => {
  const old = await staleActualAcknowledgment();
  const read = holdNextActualRead();
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  const gate = deferred(); hold('upsertActualWithMaterialProgress', gate);
  let newer!: Promise<unknown>;
  await act(async () => { newer = state.saveStandaloneActual(draftFor(null, 'PENDING'), STANDALONE.id).catch(e => e); });
  await act(async () => { read.response.resolve(); });
  expect(read.reads()).toBe(1);
  expect(state.actuals.find(row => row.id === STANDALONE.id)?.note).toBe('PENDING');
  await act(async () => { if (success) gate.resolve(); else gate.reject(new Error('not saved')); await newer; });
  expect(read.reads()).toBe(2);
  await expectPersistedProjection('active operations must prevent publication and retry until settled');
});

it.each([false, true])('controller account switch discards old read failure=%s', async failure => {
  const old = await staleActualAcknowledgment();
  const read = holdNextActualRead(failure);
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  const otherActual = { ...STANDALONE, id: 'other-record', userId: 'other', note: 'OTHER OWNER' };
  await old.storage.actuals.write([...await old.storage.actuals.read(), otherActual]);
  await act(async () => { harnessOwner = 'other'; renderer!.update(<Harness />); });
  await act(async () => { await state.loadPlannerData('other'); });
  showNotice.mockClear();
  await act(async () => { read.response.resolve(); });
  expect(state.actuals).toEqual([otherActual]);
  expect(state.plannerDataAvailability.ownerId).toBe('other');
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(showNotice).not.toHaveBeenCalled();
});

it('a retained initial auth load callback survives mutation-scope recreation without a false reconciliation loop', async () => {
  await mount();
  unmount();
  harnessOwner = null;
  await act(async () => { renderer = create(<Harness />); });
  const retainedLoad = state.loadPlannerData;
  const getActuals = vi.spyOn(boundary.repository, 'getActuals');
  const getMaterials = vi.spyOn(boundary.repository, 'getStudyMaterials');
  const gate = deferred();
  hold('getPlans', gate);
  let load!: Promise<void>;
  await act(async () => {
    harnessOwner = 'owner';
    renderer!.update(<Harness />);
    load = retainedLoad('owner');
  });
  expect(state.plannerDataAvailability.status).toBe('loading');
  await act(async () => { gate.resolve(); await load; });
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
  expect(getActuals).toHaveBeenCalledTimes(1);
  expect(getMaterials).toHaveBeenCalledTimes(1);
  expect(state.actuals).toEqual(await boundary.repository.getActuals('owner'));
});

it('retained ready hook snapshot is blocked while pending and remains expired after repair returns ready', async () => {
  await mount();
  const retainedGuard = state.isPlannerDataSnapshotCurrent;
  const retainedStatus = state.plannerDataAvailability;
  const gate = deferred(); hold('upsertActualWithMaterialProgress', gate);
  let done!: Promise<void>;
  await act(async () => { done = state.saveStandaloneActual(draftFor(), STANDALONE.id); });
  expect(retainedGuard()).toBe(true);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(retainedStatus.status).toBe('ready');
  expect(state.plannerDataAvailability.status).toBe('stale');
  expect(retainedGuard()).toBe(false);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  const staleGuard = state.isPlannerDataSnapshotCurrent;
  const fullStamp = state.plannerDataAvailability.lastSuccessfulAt;
  await act(async () => { gate.resolve(); await done; });
  expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', lastSuccessfulAt: fullStamp });
  expect(retainedGuard()).toBe(false);
  expect(staleGuard()).toBe(false);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
});

async function failedTargetRead() {
  const old = await staleActualAcknowledgment();
  const getActuals = boundary.repository.getActuals;
  const read = vi.spyOn(boundary.repository, 'getActuals').mockRejectedValue(new Error('offline'));
  const fullStamp = state.plannerDataAvailability.lastSuccessfulAt;
  await act(async () => { old.response.resolve(); await expect(old.done).resolves.toBeUndefined(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(state.plannerDataRecovery).toEqual({ ownerId: 'owner', reason: 'actual-material', phase: 'failed', canRetry: true });
  return { ...old, read, getActuals, fullStamp };
}

it('stable target failure remains latched across a successful ordinary save until one explicit duplicate-safe retry', async () => {
  const failed = await failedTargetRead();
  const plans = vi.spyOn(boundary.repository, 'getPlans');
  const todos = vi.spyOn(boundary.repository, 'getTodos');
  const timetable = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  failed.read.mockImplementation(failed.getActuals);
  await act(async () => { await state.saveStandaloneActual(draftFor(null, 'NEXT SAVE'), STANDALONE.id); });
  expect(failed.read).toHaveBeenCalledTimes(1);
  expect(state.plannerDataAvailability.status).toBe('stale');
  expect(state.plannerDataRecovery?.canRetry).toBe(true);
  const writes = failed.storage.actuals.write.mock.calls.length;
  const retry = state.retryPlannerData;
  await act(async () => { await Promise.all([retry(), retry(), retry()]); });
  expect(failed.read).toHaveBeenCalledTimes(2);
  expect(plans).not.toHaveBeenCalled();
  expect(todos).not.toHaveBeenCalled();
  expect(timetable).not.toHaveBeenCalled();
  expect(failed.storage.actuals.write).toHaveBeenCalledTimes(writes);
  expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', lastSuccessfulAt: failed.fullStamp });
  expect(state.plannerDataRecovery).toBeNull();
  expect(state.actuals).toEqual(await failed.storage.actuals.read());
});

it('successful targeted repair leaves failed full health stale and the full success timestamp unchanged', async () => {
  const old = await staleActualAcknowledgment();
  const fullStamp = state.plannerDataAvailability.lastSuccessfulAt;
  const getPlans = boundary.repository.getPlans;
  const plans = vi.spyOn(boundary.repository, 'getPlans').mockRejectedValueOnce(new Error('full unavailable'));
  await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('full unavailable'); });
  plans.mockImplementation(getPlans);
  const reads = vi.spyOn(boundary.repository, 'getActuals');
  await act(async () => { old.response.resolve(); await old.done; });
  expect(reads).toHaveBeenCalledTimes(1);
  expect(state.actuals).toEqual(await old.storage.actuals.read());
  expect(state.plannerDataAvailability).toMatchObject({ status: 'stale', lastSuccessfulAt: fullStamp });
  expect(state.plannerDataRecovery).toEqual({ ownerId: 'owner', reason: 'full-read', phase: 'failed', canRetry: true });
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  const retry = state.retryPlannerData;
  plans.mockClear(); reads.mockClear();
  await act(async () => { await Promise.all([retry(), retry(), retry()]); });
  expect(plans).toHaveBeenCalledTimes(1);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['reset', 'owner change', 'A-B-A', 'unmount'] as const)('retained explicit retry cannot issue reads after %s', async expiry => {
  const failed = await failedTargetRead();
  const retry = state.retryPlannerData;
  failed.read.mockImplementation(failed.getActuals);
  if (expiry === 'reset') await act(async () => { state.resetPlannerData(); });
  else if (expiry === 'unmount') unmount();
  else {
    await act(async () => { harnessOwner = 'other'; renderer!.update(<Harness />); });
    await act(async () => { await state.loadPlannerData('other'); });
    if (expiry === 'A-B-A') {
      await act(async () => { harnessOwner = 'owner'; renderer!.update(<Harness />); });
      await act(async () => { await state.loadPlannerData('owner'); });
    }
  }
  failed.read.mockClear();
  const plans = vi.spyOn(boundary.repository, 'getPlans');
  showNotice.mockClear();
  const before = state;
  await act(async () => { await retry(); });
  expect(failed.read).not.toHaveBeenCalled();
  expect(plans).not.toHaveBeenCalled();
  expect(showNotice).not.toHaveBeenCalled();
  expect(state).toBe(before);
});

it.each([false, true])('unmount suppresses in-flight target completion and notices, failure=%s', async failure => {
  const old = await staleActualAcknowledgment();
  const read = holdNextActualRead(failure);
  await act(async () => { old.response.resolve(); await old.done; });
  await read.entered.promise;
  unmount();
  showNotice.mockClear();
  const before = state;
  await act(async () => { read.response.resolve(); });
  expect(read.reads()).toBe(1);
  expect(showNotice).not.toHaveBeenCalled();
  expect(state).toBe(before);
});

it.each(['reset', 'owner change', 'A-B-A', 'unmount'] as const)('retained full retry cannot issue reads after %s', async expiry => {
  await mount();
  const getPlans = boundary.repository.getPlans;
  const plans = vi.spyOn(boundary.repository, 'getPlans').mockRejectedValueOnce(new Error('full unavailable'));
  await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('full unavailable'); });
  const retry = state.retryPlannerData;
  plans.mockImplementation(getPlans);
  if (expiry === 'reset') await act(async () => { state.resetPlannerData(); });
  else if (expiry === 'unmount') unmount();
  else {
    await act(async () => { harnessOwner = 'other'; renderer!.update(<Harness />); });
    await act(async () => { await state.loadPlannerData('other'); });
    if (expiry === 'A-B-A') {
      await act(async () => { harnessOwner = 'owner'; renderer!.update(<Harness />); });
      await act(async () => { await state.loadPlannerData('owner'); });
    }
  }
  plans.mockClear();
  const actuals = vi.spyOn(boundary.repository, 'getActuals');
  showNotice.mockClear();
  const before = state;
  await act(async () => { await retry(); });
  expect(plans).not.toHaveBeenCalled();
  expect(actuals).not.toHaveBeenCalled();
  expect(showNotice).not.toHaveBeenCalled();
  expect(state).toBe(before);
});

it.each(operations.flatMap(operation => [false, true].map(success => ({ operation, success }))))(
  'keeps reconciliation pending for the entire $operation mutation, success=$success',
  async ({ operation, success }) => {
    const old = await staleActualAcknowledgment(operation !== 'link');
    const gate = deferred();
    hold(methodFor(operation), gate);
    const write = vi.spyOn(boundary.repository, methodFor(operation));
    let mutation!: Promise<unknown>;
    await act(async () => { mutation = startOther(operation).catch(error => error); });
    expect(gate.entered).toBe(true);
    const actualReads = vi.spyOn(boundary.repository, 'getActuals');
    const materialReads = vi.spyOn(boundary.repository, 'getStudyMaterials');
    const plans = vi.spyOn(boundary.repository, 'getPlans');
    const todos = vi.spyOn(boundary.repository, 'getTodos');
    const timetable = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await act(async () => { old.response.resolve(); await old.done; });
    expect(actualReads).not.toHaveBeenCalled();
    expect(materialReads).not.toHaveBeenCalled();
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'waiting', canRetry: false });
    await act(async () => {
      if (success) gate.resolve(); else gate.reject(new Error('writer failed'));
      const outcome = await mutation;
      if (!success) expect(outcome).toBeInstanceOf(Error);
    });
    expect(actualReads).toHaveBeenCalledTimes(1);
    expect(materialReads).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(plans).not.toHaveBeenCalled();
    expect(todos).not.toHaveBeenCalled();
    expect(timetable).not.toHaveBeenCalled();
    expect(state.actuals).toEqual(await old.storage.actuals.read());
    expect(state.studyMaterials).toEqual(await old.storage.materials.read());
    expect(state.plannerDataAvailability.status).toBe('ready');
    await expectPersistedProjection('quiescent target read preserves unrelated final plan/Todo arrays');
  },
);

const subject: StudySubject = { id: 'math', userId: 'owner', name: 'Math', color: '#123456', createdAt: STAMP, updatedAt: STAMP };
const emptySubject: StudySubject = { ...subject, id: 'empty-subject', name: 'Empty' };
const template: ScheduleTemplate = { id: 'template', userId: 'owner', title: 'Class', subject: 'Math', type: 'study', weekday: 'mon',
  startTime: '09:00', endTime: '10:00', termId: 'custom-term', memo: '', active: true, createdAt: STAMP, updatedAt: STAMP };
const term: TimetableTerm = { id: 'custom-term', userId: 'owner', year: 2026, kind: 'custom', label: 'Current', isActive: true,
  startDate: DATE, endDate: '2026-12-01', createdAt: STAMP, updatedAt: STAMP };
const period: TimetablePeriod = { id: 'period', userId: 'owner', termId: term.id, periodNumber: 2, label: '2',
  startTime: '11:00', endTime: '12:00', createdAt: STAMP, updatedAt: STAMP };
const event = createMonthEventFromDraft({ ...createEmptyMonthEventDraft('owner', DATE), title: 'Event' });
const ancillaryOperations: Array<{ name: string; method: keyof PlannerRepository; run: () => Promise<unknown> }> = [
  { name: 'saveDayNote', method: 'upsertDayNote', run: () => state.saveDayNote(createEmptyDayNoteDraft('owner', DATE)) },
  { name: 'saveMonthEvent', method: 'upsertMonthEvent', run: () => state.saveMonthEvent({ ...event, title: 'Changed' }, event.id) },
  { name: 'deleteMonthEvent', method: 'deleteMonthEvent', run: () => state.deleteMonthEvent(event) },
  { name: 'saveTodo', method: 'upsertTodo', run: () => state.saveTodo({ ...TODO, title: 'Changed' }, TODO.id) },
  { name: 'deleteTodo', method: 'deleteTodo', run: () => state.deleteTodo(TODO) },
  { name: 'saveStudySubject', method: 'upsertStudySubjectWithMaterials', run: () => state.saveStudySubject({ ...subject, name: 'Renamed' }, subject.id) },
  { name: 'deleteStudySubject', method: 'deleteStudySubject', run: () => state.deleteStudySubject(emptySubject) },
  { name: 'saveStudyMaterial', method: 'upsertStudyMaterial', run: () => state.saveStudyMaterial({ ...progressMaterial, name: 'Renamed' }, progressMaterial.id) },
  { name: 'deleteStudyMaterial', method: 'deleteStudyMaterial', run: () => state.deleteStudyMaterial(progressMaterial) },
  { name: 'saveScheduleTemplate', method: 'upsertScheduleTemplate', run: () => state.saveScheduleTemplate({ ...template, title: 'Changed' }, template.id) },
  { name: 'deleteScheduleTemplate', method: 'deleteScheduleTemplate', run: () => state.deleteScheduleTemplate(template) },
  { name: 'activateTimetableTerm', method: 'applyTimetableMutation', run: () => state.activateTimetableTerm(term) },
  { name: 'deleteTimetableTerm', method: 'applyTimetableMutation', run: () => state.deleteTimetableTerm(term) },
  { name: 'clearTimetableTermData', method: 'applyTimetableMutation', run: () => state.clearTimetableTermData(term) },
  { name: 'saveTimetablePeriod', method: 'upsertTimetablePeriod', run: () => state.saveTimetablePeriod({ ...period, label: 'Changed' }, period.id) },
  { name: 'deleteTimetablePeriod', method: 'deleteTimetablePeriod', run: () => state.deleteTimetablePeriod(period) },
];
it.each(ancillaryOperations.flatMap(operation => [false, true].map(success => ({ ...operation, success }))))(
  'tracks the entire $name mutation including failure finalization, success=$success', async ({ method, run, success }) => {
    const old = await staleActualAcknowledgment();
    await old.storage.subjects.write([subject, emptySubject]);
    await old.storage.materials.write([progressMaterial]);
    await old.storage.monthEvents.write([event]);
    await old.storage.terms.write([term, { ...term, id: 'other-term', isActive: false }]);
    await old.storage.templates.write([template]);
    await old.storage.periods.write([period]);
    await act(async () => { await state.loadPlannerData('owner'); });
    const gate = deferred();
    hold(method, gate);
    const write = vi.spyOn(boundary.repository, method);
    let mutation!: Promise<unknown>;
    await act(async () => { mutation = run().catch(error => error); });
    expect(gate.entered).toBe(true);
    const actualReads = vi.spyOn(boundary.repository, 'getActuals');
    const materialReads = vi.spyOn(boundary.repository, 'getStudyMaterials');
    const planReads = vi.spyOn(boundary.repository, 'getPlans');
    const todoReads = vi.spyOn(boundary.repository, 'getTodos');
    const termReads = vi.spyOn(boundary.repository, 'getTimetableTerms');
    await act(async () => { old.response.resolve(); await old.done; });
    expect(actualReads).not.toHaveBeenCalled();
    expect(materialReads).not.toHaveBeenCalled();
    await act(async () => {
      if (success) gate.resolve(); else gate.reject(new Error('writer failed'));
      const outcome = await mutation;
      if (!success) expect(outcome).toBeInstanceOf(Error);
    });
    expect(actualReads).toHaveBeenCalledTimes(1);
    expect(materialReads).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(planReads).not.toHaveBeenCalled();
    expect(todoReads).not.toHaveBeenCalled();
    expect(termReads).not.toHaveBeenCalled();
    expect(state.actuals).toEqual(await old.storage.actuals.read());
    expect(state.studyMaterials).toEqual(await old.storage.materials.read());
    expect(state.plannerDataAvailability.status).toBe('ready');
  },
);

it('render-time readiness is true after initial acceptance and after same-turn reset plus reload', async () => {
  await mount();
  expect(renderedReady).toBe(true);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
  const retainedLoad = state.loadPlannerData;
  await act(async () => {
    state.resetPlannerData();
    await retainedLoad('owner');
  });
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(renderedReady).toBe(true);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
});

it.each([false, true])('full refresh overlapping a writer start and settlement creates and repairs a fresh concern, writerSuccess=%s', async success => {
  const storage = await mount();
  const fullGate = deferred();
  hold('getPlans', fullGate);
  let load!: Promise<void>;
  await act(async () => { load = state.loadPlannerData('owner'); });
  const writeGate = deferred();
  hold('upsertActualWithMaterialProgress', writeGate);
  let saving!: Promise<unknown>;
  await act(async () => { saving = state.saveStandaloneActual(draftFor(null, 'WRITER'), STANDALONE.id).catch(error => error); });
  await act(async () => {
    if (success) writeGate.resolve(); else writeGate.reject(new Error('writer failed'));
    await saving;
  });
  const actualReads = vi.spyOn(boundary.repository, 'getActuals');
  const materialReads = vi.spyOn(boundary.repository, 'getStudyMaterials');
  await act(async () => { fullGate.resolve(); await load; });
  expect(actualReads).toHaveBeenCalledTimes(1);
  expect(materialReads).toHaveBeenCalledTimes(1);
  expect(state.actuals).toEqual(await storage.actuals.read());
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(state.plannerDataRecovery).toBeNull();
  expect(renderedReady).toBe(true);
});

it.each([false, true])('tracks recurring-scope confirmation through success or recovery full load, success=%s', async success => {
  const old = await staleActualAcknowledgment();
  const recurring: Plan = { ...B, repeat: 'weekly', repeatUntil: '2026-11-01' };
  await old.storage.plans.write([A, recurring]);
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { await state.deletePlan(recurring); });
  expect(state.pendingRecurringPlanAction?.kind).toBe('delete');
  const gate = deferred();
  hold('applyRecurringPlanMutation', gate);
  const write = vi.spyOn(boundary.repository, 'applyRecurringPlanMutation');
  let confirmation!: Promise<void>;
  await act(async () => { confirmation = state.confirmRecurringPlanScope('all'); });
  expect(gate.entered).toBe(true);
  const reads = vi.spyOn(boundary.repository, 'getActuals');
  await act(async () => { old.response.resolve(); await old.done; });
  expect(reads).not.toHaveBeenCalled();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () => {
      if (success) gate.resolve(); else gate.reject(new Error('recurring writer failed'));
      await confirmation;
    });
    expect(errors).toHaveBeenCalledTimes(success ? 0 : 1);
  } finally { errors.mockRestore(); }
  expect(write).toHaveBeenCalledTimes(1);
  // Failure deliberately performs its existing full recovery load, then the
  // quiescent targeted repair waits for that entire mutation lifetime to end.
  expect(reads).toHaveBeenCalledTimes(success ? 1 : 2);
  expect(state.actuals).toEqual(await old.storage.actuals.read());
  expect(state.plans).toEqual(await old.storage.plans.read());
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(renderedReady).toBe(true);
});

it('prepares both target collections before publication and latches malformed-material failure without replaying the saved write', async () => {
  const old = await staleActualAcknowledgment();
  const beforeActuals = structuredClone(state.actuals);
  const beforeMaterials = structuredClone(state.studyMaterials);
  const fullTimestamp = state.plannerDataAvailability.lastSuccessfulAt;
  await old.storage.actuals.write((await old.storage.actuals.read()).map(row => ({ ...row, note: 'AFTER FULL SNAPSHOT' })));
  // Existing adapters admit legacy rows without sorting fields. Two rows force
  // preparation's comparator to execute, rather than a one-row false positive.
  await old.storage.materials.write([
    { id: 'legacy-a', userId: 'owner' },
    { id: 'legacy-b', userId: 'owner' },
  ] as StudyMaterial[]);
  const actualReads = vi.spyOn(boundary.repository, 'getActuals');
  const materialReads = vi.spyOn(boundary.repository, 'getStudyMaterials');
  const savedWrite = vi.spyOn(boundary.repository, 'upsertActualWithMaterialProgress');
  showNotice.mockClear();
  await act(async () => { old.response.resolve(); await expect(old.done).resolves.toBeUndefined(); });
  expect(state.actuals).toEqual(beforeActuals);
  expect(state.studyMaterials).toEqual(beforeMaterials);
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true, reason: 'actual-material' });
  expect(state.plannerDataAvailability).toMatchObject({ status: 'stale', lastSuccessfulAt: fullTimestamp });
  expect(actualReads).toHaveBeenCalledTimes(1);
  expect(materialReads).toHaveBeenCalledTimes(1);
  expect(showNotice.mock.calls.map(call => call[0])).not.toContain('記録を保存できませんでした。');
  await act(async () => { await state.retryPlannerData(); });
  expect(state.actuals).toEqual(beforeActuals);
  expect(state.studyMaterials).toEqual(beforeMaterials);
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(actualReads).toHaveBeenCalledTimes(2);
  await old.storage.materials.write([progressMaterial]);
  await act(async () => { await state.retryPlannerData(); });
  expect(state.actuals).toEqual(await old.storage.actuals.read());
  expect(state.studyMaterials).toEqual([progressMaterial]);
  expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', lastSuccessfulAt: fullTimestamp });
  expect(state.plannerDataRecovery).toBeNull();
  expect(actualReads).toHaveBeenCalledTimes(3);
  expect(materialReads).toHaveBeenCalledTimes(3);
  expect(savedWrite).not.toHaveBeenCalled();
});

it.each([false, true])('abandoned concurrent owner render cannot poison committed-owner recovery, readFailure=%s', async readFailure => {
  await mount();
  unmount();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let owner = 'owner';
  let suspendedOwner: string | null = null;
  let committed!: UsePlannerDataStateResult;
  const renderedOwners: string[] = [];
  const never = new Promise<void>(() => undefined);
  function ConcurrentHarness() {
    const value = usePlannerDataState({ userId: owner, showNotice });
    useLayoutEffect(() => { committed = value; });
    renderedOwners.push(owner);
    if (owner === suspendedOwner) throw never;
    return <span>{owner}</span>;
  }
  const tree = () => <StrictMode><Suspense fallback={<span>Loading</span>}><ConcurrentHarness /></Suspense></StrictMode>;
  try {
    await act(async () => {
      renderer = create(tree(), { createNodeMock: () => null, unstable_isConcurrent: true } as Parameters<typeof create>[1]);
    });
    await act(async () => { await committed.loadPlannerData('owner'); });
    expect(committed.isPlannerDataSnapshotCurrent()).toBe(true);
    const held = holdFirstResponse('upsertActualWithMaterialProgress');
    let saved!: Promise<void>;
    await act(async () => { saved = committed.saveStandaloneActual(draftFor(), STANDALONE.id); });
    await held.persisted.promise;
    await act(async () => { await committed.loadPlannerData('owner'); });
    const target = holdNextActualRead(readFailure);
    const actualReads = vi.spyOn(boundary.repository, 'getActuals');
    await act(async () => { held.response.resolve(); await saved; });
    await target.entered.promise;
    expect(committed.plannerDataRecovery?.phase).toBe('refreshing');
    suspendedOwner = 'other';
    await act(async () => { startTransition(() => { owner = 'other'; renderer!.update(tree()); }); });
    expect(renderedOwners).toContain('other');
    expect(renderer!.toJSON()).toMatchObject({ children: ['owner'] });
    await act(async () => { target.response.resolve(); });
    owner = 'owner';
    suspendedOwner = null;
    await act(async () => { renderer!.update(tree()); });
    expect(renderer!.toJSON()).toMatchObject({ children: ['owner'] });
    expect(actualReads.mock.calls.every(([userId]) => userId === 'owner')).toBe(true);
    if (readFailure) {
      expect(committed.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
      await act(async () => { await committed.retryPlannerData(); });
      expect(target.reads()).toBe(2);
    } else {
      expect(target.reads()).toBe(1);
    }
    expect(committed.plannerDataAvailability.status).toBe('ready');
    expect(committed.plannerDataRecovery).toBeNull();
    expect(committed.isPlannerDataSnapshotCurrent()).toBe(true);
    expect(committed.actuals).toEqual(await boundary.repository.getActuals('owner'));
  } finally {
    unmount();
    vi.unstubAllGlobals();
  }
});

it('keeps a captured lease callback stable through unrelated committed UI renders', async () => {
  await mount();
  const captured = state.isPlannerDataSnapshotCurrent;
  expect(captured()).toBe(true);
  await act(async () => { state.setViewMode('day'); });
  expect(state.isPlannerDataSnapshotCurrent).toBe(captured);
  await act(async () => { state.openCreatePlan(); });
  expect(state.isPlannerDataSnapshotCurrent).toBe(captured);
  await act(async () => { state.closePlanEditor(); });
  expect(state.isPlannerDataSnapshotCurrent).toBe(captured);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(captured()).toBe(false);
  expect(state.isPlannerDataSnapshotCurrent).not.toBe(captured);
  expect(state.isPlannerDataSnapshotCurrent()).toBe(true);
});
