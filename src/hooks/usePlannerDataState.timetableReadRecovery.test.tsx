import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';
import { plannerReadMethods, spyPlannerReads } from './plannerReadSpies.testUtils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { actual, createLocalFixture, deferred, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ScheduleTemplate } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: vi.fn() }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const template: ScheduleTemplate = { id: 'class', userId: 'owner', title: 'Old class', subject: 'Math', type: 'study', weekday: 'mon', startTime: '12:00', endTime: '13:00', termId: 'custom-term', memo: '', active: true, createdAt: STAMP, updatedAt: STAMP };
async function mount() {
  const fixture = createLocalFixture(); boundary.repository = { ...fixture.repository };
  await fixture.repository.upsertTimetableTerm({ id: 'custom-term', userId: 'owner', year: 2026, kind: 'custom', label: 'Custom', isActive: true, createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertScheduleTemplate(template);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}


it('native full read overlapping class save preserves the durable result', async () => {
  const { repository } = await mount();
  const order: string[] = [];
  const get = boundary.repository.getScheduleTemplates;
  boundary.repository.getScheduleTemplates = async owner => { const rows = await get(owner); order.push('captured'); return rows; };
  const put = boundary.repository.upsertScheduleTemplate;
  boundary.repository.upsertScheduleTemplate = async row => { const saved = await put(row); order.push('persisted'); return saved; };
  await act(async () => { const loading = state.loadPlannerData('owner').then(() => { order.push('returned'); }); await Promise.all([loading, state.saveScheduleTemplate({ ...template, title: 'Updated class' }, template.id)]); });
  expect(order.indexOf('captured')).toBeLessThan(order.indexOf('persisted'));
  expect(order.indexOf('persisted')).toBeLessThan(order.indexOf('returned'));
  expect((await repository.getScheduleTemplates('owner'))[0].title).toBe('Updated class');
  expect(state.scheduleTemplates).toEqual(await repository.getScheduleTemplates('owner'));
});



const operations = ['class-save', 'class-delete', 'term-activate', 'term-delete', 'term-clear', 'period-save', 'period-delete'] as const;
type Operation = typeof operations[number];
async function mountAll() {
  const fixture = await mount();
  await fixture.repository.upsertTimetableTerm({ id: 'other-term', userId: 'owner', year: 2026, kind: 'custom', label: 'Other', isActive: false, createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertTimetablePeriod({ id: 'period', userId: 'owner', termId: 'custom-term', periodNumber: 1, label: 'Old period', startTime: '12:00', endTime: '13:00', createdAt: STAMP, updatedAt: STAMP });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
function start(operation: Operation) {
  const term = state.timetableTerms.find(row => row.id === 'custom-term')!;
  const period = state.timetablePeriods.find(row => row.id === 'period')!;
  switch (operation) {
    case 'class-save': return state.saveScheduleTemplate({ ...template, title: 'Updated class' }, template.id);
    case 'class-delete': return state.deleteScheduleTemplate(template);
    case 'term-activate': return state.activateTimetableTerm({ ...term, label: 'Updated term' });
    case 'term-delete': return state.deleteTimetableTerm(term);
    case 'term-clear': return state.clearTimetableTermData(term);
    case 'period-save': return state.saveTimetablePeriod({ ...period, label: 'Updated period' }, period.id);
    case 'period-delete': return state.deleteTimetablePeriod(period);
  }
}
async function stored(repository: PlannerRepository) {
  const [templates, terms, periods] = await Promise.all([repository.getScheduleTemplates('owner'), repository.getTimetableTerms('owner'), repository.getTimetablePeriods('owner')]);
  const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((a,b) => a.id.localeCompare(b.id));
  return { templates: sort(templates), terms: sort(terms), periods: sort(periods) };
}
async function expectCurrent(repository: PlannerRepository, operation: Operation) {
  const rows = await stored(repository);
  if (operation === 'class-save') expect(rows.templates[0].title).toBe('Updated class');
  if (operation === 'class-delete' || operation === 'term-clear' || operation === 'term-delete') expect(rows.templates).toEqual([]);
  if (operation === 'term-activate') expect(rows.terms.find(row => row.id === 'custom-term')?.label).toBe('Updated term');
  if (operation === 'term-delete') { expect(rows.terms.map(row=>row.id)).toEqual(['other-term']); expect(rows.terms[0].isActive).toBe(true); }
  if (operation === 'period-save') expect(rows.periods[0].label).toBe('Updated period');
  if (operation === 'period-delete' || operation === 'term-clear' || operation === 'term-delete') expect(rows.periods).toEqual([]);
  expect([...state.scheduleTemplates].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(rows.templates);
  expect([...state.timetableTerms].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(rows.terms);
  expect([...state.timetablePeriods].sort((a,b)=>a.id.localeCompare(b.id))).toEqual(rows.periods);
  expect(state.plannerDataAvailability.status).toBe('ready');
}
it.each(operations)('captured full read cannot hide successful %s', async operation => {
  const { repository } = await mountAll();
  const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  const captured = deferred(), response = deferred();
  const get = boundary.repository.getScheduleTemplates;
  let hold = true;
  boundary.repository.getScheduleTemplates = async owner => { const rows=await get(owner); if(hold){hold=false;captured.resolve();await response.promise;} return rows; };
  let loading!: Promise<void>;
  await act(async()=>{loading=state.loadPlannerData('owner');await captured.promise;});
  await act(async()=>{await start(operation);});
  await act(async()=>{response.resolve();await loading;});
  expect(normalize.mock.calls[normalize.mock.calls.length - 1]?.[0]).toEqual({ userId: 'owner', termUpserts: [], termDeletes: [], templateUpserts: [], templateDeletes: [], periodUpserts: [], periodDeletes: [] });
  await expectCurrent(repository,operation);
});
it.each(operations)('%s without a crossing does not add repair reads', async operation => {
  const { repository } = await mountAll();
  const reads = spyPlannerReads(boundary.repository);
  await act(async()=>{await start(operation);});
  for (const name of plannerReadMethods) expect(reads[name], name).not.toHaveBeenCalled();
  await expectCurrent(repository,operation);
});

it('class persistence after an accepted full read is repaired, not suppressed', async () => {
  const { repository } = await mount();
  const gate = deferred();
  const put = boundary.repository.upsertScheduleTemplate;
  boundary.repository.upsertScheduleTemplate = async row => { await gate.promise; return put(row); };
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveScheduleTemplate({ ...template, title: 'Updated class' }, template.id); });
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { gate.resolve(); await saving; });
  await expectCurrent(repository, 'class-save');
});
it.each(['getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods', 'getActuals'] as const)('failed %s publishes no timetable slice and retry only reads', async failedGetter => {
  const { repository, storage } = await mountAll();
  const gate = deferred();
  const put = boundary.repository.upsertScheduleTemplate;
  const write = vi.fn(async (row: ScheduleTemplate) => { await gate.promise; return put(row); });
  boundary.repository.upsertScheduleTemplate = write;
  let saving!: Promise<void>;
  await act(async()=>{saving=state.saveScheduleTemplate({...template,title:'Updated class'},template.id);});
  await act(async()=>{await state.loadPlannerData('owner');});
  const before = structuredClone({templates:state.scheduleTemplates,terms:state.timetableTerms,periods:state.timetablePeriods});
  await repository.upsertActual(actual({ planId: null }));
  const term = (await repository.getTimetableTerms('owner')).find(row=>row.id==='custom-term')!;
  await repository.upsertTimetableTerm({...term,label:'Externally updated term'});
  const period = (await repository.getTimetablePeriods('owner'))[0];
  await repository.upsertTimetablePeriod({...period,label:'Externally updated period'});
  const get = boundary.repository[failedGetter];
  boundary.repository = {...boundary.repository,[failedGetter]:async()=>{throw Error('read offline');}};
  await act(async()=>{state.openDay('2026-12-15');gate.resolve();await saving;});
  expect(state.plannerDataRecovery).toMatchObject({phase:'failed',canRetry:true});
  expect({templates:state.scheduleTemplates,terms:state.timetableTerms,periods:state.timetablePeriods}).toEqual(before);
  expect(state.actuals).toEqual([]);
  boundary.repository = {...boundary.repository,[failedGetter]:get};
  const reads = spyPlannerReads(boundary.repository);
  const writes = vi.spyOn(storage,'setItem');
  const normalize = vi.spyOn(boundary.repository,'applyTimetableMutation');
  await act(async()=>{await state.retryPlannerData();});
  for(const name of plannerReadMethods) expect(reads[name],name).toHaveBeenCalledTimes(['getScheduleTemplates','getTimetableTerms','getTimetablePeriods','getActuals','getStudyMaterials'].includes(name)?1:0);
  expect(writes).not.toHaveBeenCalled();
  expect(normalize).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(1);
  await expectCurrent(repository,'class-save');
  expect(state.actuals).toEqual(await repository.getActuals('owner'));
  expect(state.selectedDate).toBe('2026-12-15');
});
const writerMethods = { 'class-save':'upsertScheduleTemplate', 'class-delete':'deleteScheduleTemplate', 'term-activate':'applyTimetableMutation', 'term-delete':'applyTimetableMutation', 'term-clear':'applyTimetableMutation', 'period-save':'upsertTimetablePeriod', 'period-delete':'deleteTimetablePeriod' } as const;
it.each(operations)('late %s acknowledgement preserves a newer accepted trio before repair completes', async operation => {
  const { repository } = await mountAll();
  const method = writerMethods[operation];
  const original = boundary.repository[method] as (...args: unknown[])=>Promise<unknown>;
  const persisted=deferred(),response=deferred();let hold=true;
  boundary.repository={...boundary.repository,[method]:async(...args:unknown[])=>{const result=await original(...args);if(hold){hold=false;persisted.resolve();await response.promise;}return result;}};
  let saving!:Promise<unknown>;
  await act(async()=>{saving=start(operation);await persisted.promise;});
  await repository.upsertTimetableTerm({id:'custom-term',userId:'owner',year:2026,kind:'custom',label:'Newer term',isActive:true,createdAt:STAMP,updatedAt:STAMP});
  await repository.upsertScheduleTemplate({...template,title:'Newer class'});
  await repository.upsertTimetablePeriod({id:'period',userId:'owner',termId:'custom-term',periodNumber:1,label:'Newer period',startTime:'12:00',endTime:'13:00',createdAt:STAMP,updatedAt:STAMP});
  await act(async()=>{await state.loadPlannerData('owner');});
  const accepted=structuredClone({templates:state.scheduleTemplates,terms:state.timetableTerms,periods:state.timetablePeriods});
  const repair=deferred();const get=boundary.repository.getScheduleTemplates;
  boundary.repository.getScheduleTemplates=async owner=>{const rows=await get(owner);await repair.promise;return rows;};
  await act(async()=>{response.resolve();await saving;});
  expect({templates:state.scheduleTemplates,terms:state.timetableTerms,periods:state.timetablePeriods}).toEqual(accepted);
  expect(state.plannerDataAvailability.status).not.toBe('ready');
  await act(async()=>{repair.resolve();});
  expect(state.scheduleTemplates[0].title).toBe('Newer class');
  expect(state.timetableTerms.find(row=>row.id==='custom-term')?.label).toBe('Newer term');
  expect(state.timetablePeriods[0].label).toBe('Newer period');
  expect(state.plannerDataAvailability.status).toBe('ready');
});
it.each(operations)('rejected %s does not claim a successful timetable effect', async operation => {
  const { repository } = await mountAll();
  const before=await stored(repository);
  const method=writerMethods[operation];const original=boundary.repository[method] as (...args:unknown[])=>Promise<unknown>;
  const gate=deferred();let hold=true;
  boundary.repository={...boundary.repository,[method]:async(...args:unknown[])=>{if(hold){hold=false;await gate.promise;}return original(...args);}};
  let saving!:Promise<unknown>;
  await act(async()=>{saving=start(operation).catch(error=>error);});
  await act(async()=>{await state.loadPlannerData('owner');});
  const reads=spyPlannerReads(boundary.repository);
  await act(async()=>{gate.reject(Error('not dispatched'));expect(await saving).toBeInstanceOf(Error);});
  expect(reads.getScheduleTemplates).not.toHaveBeenCalled();
  expect(reads.getTimetableTerms).not.toHaveBeenCalled();
  expect(reads.getTimetablePeriods).not.toHaveBeenCalled();
  expect(await stored(repository)).toEqual(before);
});
it.each(['reset','unmount'] as const)('old timetable save cannot publish after %s', async lifetime => {
  await mountAll();
  const persisted=deferred(),response=deferred();const put=boundary.repository.upsertScheduleTemplate;
  boundary.repository.upsertScheduleTemplate=async row=>{const result=await put(row);persisted.resolve();await response.promise;return result;};
  let saving!:Promise<unknown>;
  await act(async()=>{saving=start('class-save').catch(error=>error);await persisted.promise;});
  await act(async()=>{if(lifetime==='reset')state.resetPlannerData();else{renderer!.unmount();renderer=undefined;}});
  const reads=spyPlannerReads(boundary.repository);
  await act(async()=>{response.resolve();expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError);});
  for(const name of plannerReadMethods)expect(reads[name]).not.toHaveBeenCalled();
  if(lifetime==='reset')expect(state.scheduleTemplates).toEqual([]);
});
it.each(['write','full-read'] as const)('a newer %s supersedes a captured timetable repair', async newer => {
  const { repository }=await mountAll();
  const admission=deferred();const put=boundary.repository.upsertScheduleTemplate;
  let holdWrite=true;
  boundary.repository.upsertScheduleTemplate=async row=>{if(holdWrite){holdWrite=false;await admission.promise;}return put(row);};
  let saving!:Promise<unknown>;
  await act(async()=>{saving=start('class-save');});
  await act(async()=>{await state.loadPlannerData('owner');});
  const captured=deferred(),response=deferred();const get=boundary.repository.getScheduleTemplates;let holdRead=true;
  boundary.repository.getScheduleTemplates=async owner=>{const rows=await get(owner);if(holdRead){holdRead=false;captured.resolve();await response.promise;}return rows;};
  await act(async()=>{admission.resolve();await saving;await captured.promise;});
  if(newer==='write') await act(async()=>{await state.saveScheduleTemplate({...template,title:'Newest class'},template.id);});
  else {await repository.upsertScheduleTemplate({...template,title:'Newest class'});await act(async()=>{await state.loadPlannerData('owner');});}
  await act(async()=>{response.resolve();});
  expect((await repository.getScheduleTemplates('owner'))[0].title).toBe('Newest class');
  expect(state.scheduleTemplates[0].title).toBe('Newest class');
  expect(state.plannerDataAvailability.status).toBe('ready');
});
