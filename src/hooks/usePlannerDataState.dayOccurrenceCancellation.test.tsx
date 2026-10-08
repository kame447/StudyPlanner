import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalFixture, deferred, plan, event, actual, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ScheduleTemplate } from '../types/domain';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const DATE = '2026-10-05';
let state: UsePlannerDataStateResult, renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn<ShowNotice>();
function Harness({ owner = 'owner' }: { owner?: string }) { state = usePlannerDataState({ userId: owner, showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const template: ScheduleTemplate = { id: 'class', userId: 'owner', title: 'Class', subject: 'Math', type: 'school-event', weekday: 'mon',
  startTime: '14:00', endTime: '15:00', termId: 'custom', periodNumber: 1, memo: '', active: true, createdAt: STAMP, updatedAt: STAMP };
async function mount() {
  const fixture = createLocalFixture(); boundary.repository = { ...fixture.repository }; showNotice.mockClear();
  await fixture.repository.upsertPlan(plan({ date: DATE, repeat: 'weekly' }));
  await fixture.repository.upsertMonthEvent(event({ date: DATE, endDate: DATE, repeat: 'weekly' }));
  await fixture.repository.upsertActual(actual({ occurrenceDate: DATE }));
  await fixture.repository.upsertActual(actual({ id: 'event-actual', planId: 'event', occurrenceDate: DATE }));
  await fixture.repository.upsertTimetableTerm({ id: 'custom', userId: 'owner', year: 2026, kind: 'custom', label: 'Custom', isActive: true, createdAt: STAMP, updatedAt: STAMP });
  await fixture.repository.upsertScheduleTemplate(template);
  await fixture.repository.upsertScheduleTemplate({ ...template, id: 'class-2', startTime: '15:00', endTime: '16:00', periodNumber: 2 });
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
function project(date = DATE) { return createScheduleOccurrenceProjection({ ownerId: 'owner', plans: state.plans, monthEvents: state.monthEvents,
  scheduleTemplates: state.scheduleTemplates, timetableTerms: state.timetableTerms, startDate: date, endDate: date }).occurrences; }
const get = (kind: 'plan' | 'month-event' | 'timetable-template') => project().find(row => row.source.backingKind === kind)!;
const undo = () => { const action = [...showNotice.mock.calls].reverse().find(call => call[2]?.actionLabel === '元に戻す')?.[2]?.onAction; if (!action) throw Error('no undo'); return action; };
it.each(['plan', 'month-event', 'timetable-template'] as const)('persists only this %s occurrence, retains actuals, reloads and restores once', async kind => {
  const { repository } = await mount();
  const beforeActuals = await repository.getActuals('owner'); const id = get(kind).id;
  await act(async () => { await state.deleteDayOccurrence(get(kind)); });
  expect(project().some(row => row.id === id)).toBe(false);
  expect(project('2026-10-12').filter(row => row.source.backingKind === kind)).toHaveLength(1);
  expect(await repository.getActuals('owner')).toEqual(beforeActuals); expect(state.actuals).toEqual(beforeActuals);
  const restore = undo();
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(project().some(row => row.id === id)).toBe(false);
  await act(async () => { await restore(); });
  expect(project().some(row => row.id === id)).toBe(true);
  expect(await repository.getActuals('owner')).toEqual(beforeActuals);
});
it.each(['plan', 'month-event', 'timetable-template'] as const)('keeps %s on failed save, rejects duplicate dispatch, and retries', async kind => {
  await mount(); const occurrence = get(kind);
  const method = kind === 'plan' ? 'applyRecurringPlanMutation' : kind === 'month-event' ? 'upsertMonthEvent' : 'applyTimetableMutation';
  const gate = deferred(); const original = boundary.repository[method] as (...args: never[]) => Promise<unknown>;
  const spy = vi.fn(async (...args: never[]) => { await gate.promise; return original(...args); });
  boundary.repository = { ...boundary.repository, [method]: spy };
  let result!: Promise<unknown>;
  await act(async () => { result = state.deleteDayOccurrence(occurrence).catch(error => error); });
  await act(async () => { await expect(state.deleteDayOccurrence(occurrence)).rejects.toThrow('保存中'); });
  expect(spy).toHaveBeenCalledTimes(1); expect(get(kind).id).toBe(occurrence.id);
  await act(async () => { gate.reject(Error('offline')); expect(await result).toBeInstanceOf(Error); });
  expect(get(kind).id).toBe(occurrence.id);
  boundary.repository = { ...boundary.repository, [method]: original };
  await act(async () => { await state.deleteDayOccurrence(occurrence); });
  expect(project().some(row => row.id === occurrence.id)).toBe(false);
});
it('keeps date exceptions through template editing and a reload', async () => {
  const { repository } = await mount(); await act(async () => { await state.deleteDayOccurrence(get('timetable-template')); });
  const row = state.scheduleTemplates[0]; const { excludedDates: _excluded, ...draft } = row;
  await act(async () => { await state.saveScheduleTemplate({ ...draft, title: 'Renamed' }, row.id); });
  expect((await repository.getScheduleTemplates('owner')).find(item => item.id === row.id)?.excludedDates).toEqual([DATE]);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.scheduleTemplates.find(item => item.id === row.id)?.excludedDates).toEqual([DATE]);
});
it('does not overwrite a newer edit or revive a removed template through stale undo', async () => {
  await mount(); await act(async () => { await state.deleteDayOccurrence(get('timetable-template')); });
  const restore = undo(); const row = state.scheduleTemplates[0];
  await act(async () => { await state.saveScheduleTemplate({ ...row, title: 'Newer' }, row.id); });
  await act(async () => { await restore(); });
  expect(state.scheduleTemplates.find(item => item.id === row.id)?.title).toBe('Newer');
  expect(state.scheduleTemplates.every(item => item.excludedDates?.includes(DATE))).toBe(true);
  expect(showNotice.mock.calls[showNotice.mock.calls.length - 1]?.[0]).toContain('更新された');
});
it('blocks callbacks and undo from an old owner', async () => {
  await mount(); const old = state.deleteDayOccurrence; const occurrence = get('timetable-template');
  await act(async () => { await state.deleteDayOccurrence(occurrence); }); const restore = undo();
  await act(async () => { renderer!.update(<Harness owner="other" />); });
  const write = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await expect(old(occurrence)).rejects.toThrow('切り替わりました'); await restore(); });
  expect(write).not.toHaveBeenCalled();
});
it('repairs a late cancellation after an accepted read rather than losing the stored exception', async () => {
  const { repository } = await mount(); const occurrence = get('timetable-template'), gate = deferred();
  const original = boundary.repository.applyTimetableMutation;
  boundary.repository.applyTimetableMutation = async mutation => { if (mutation.templateUpserts.some(row => row.excludedDates?.includes(DATE))) await gate.promise; return original(mutation); };
  let pending!: Promise<void>;
  await act(async () => { pending = state.deleteDayOccurrence(occurrence); });
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { gate.resolve(); await pending; });
  expect(state.scheduleTemplates).toEqual(await repository.getScheduleTemplates('owner'));
  expect(project().some(row => row.id === occurrence.id)).toBe(false);
});
it.each(['cancel-first', 'edit-first'] as const)('admits only one overlapping template edit/cancellation (%s)', async order => {
  await mount(); const occurrence = get('timetable-template'), row = state.scheduleTemplates[0];
  const gate = deferred(), write = boundary.repository.upsertScheduleTemplate, mutation = boundary.repository.applyTimetableMutation;
  boundary.repository.upsertScheduleTemplate = async item => { await gate.promise; return write(item); };
  boundary.repository.applyTimetableMutation = async value => { await gate.promise; return mutation(value); };
  let first!: Promise<void>;
  await act(async () => { first = order === 'cancel-first' ? state.deleteDayOccurrence(occurrence) : state.saveScheduleTemplate({ ...row, title: 'Changed' }, row.id); });
  await act(async () => { await expect(order === 'cancel-first' ? state.saveScheduleTemplate({ ...row, title: 'Changed' }, row.id) : state.deleteDayOccurrence(occurrence)).rejects.toThrow('保存中'); });
  await act(async () => { gate.resolve(); await first; });
  if (order === 'cancel-first') expect(state.scheduleTemplates.every(item => item.excludedDates?.includes(DATE))).toBe(true);
  else expect(state.scheduleTemplates.find(item => item.id === row.id)?.title).toBe('Changed');
});
it.each(['cancel-first', 'clear-first'] as const)('prevents class resurrection when term clear crosses cancellation (%s)', async order => {
  const { repository } = await mount(); const occurrence = get('timetable-template'), term = state.timetableTerms[0];
  const gate = deferred(), original = boundary.repository.applyTimetableMutation;
  boundary.repository.applyTimetableMutation = async value => { await gate.promise; return original(value); };
  let first!: Promise<void>;
  await act(async () => { first = order === 'cancel-first' ? state.deleteDayOccurrence(occurrence) : state.clearTimetableTermData(term); });
  await act(async () => { await expect(order === 'cancel-first' ? state.clearTimetableTermData(term) : state.deleteDayOccurrence(occurrence)).rejects.toThrow('保存中'); });
  await act(async () => { gate.resolve(); await first; });
  const rows = await repository.getScheduleTemplates('owner');
  if (order === 'clear-first') expect(rows).toEqual([]); else expect(rows.every(row => row.excludedDates?.includes(DATE))).toBe(true);
  expect(state.scheduleTemplates).toEqual(rows);
});
it.each(['cancel-first', 'move-first'] as const)('protects an imported non-recurring Plan move against cancellation (%s)', async order => {
  const { repository } = await mount();
  const source = { ...state.plans[0], repeat: 'none' as const, sourceType: 'timetable' as const, sourceId: 'separate-template' };
  await repository.upsertPlan(source); await act(async () => { await state.loadPlannerData('owner'); });
  const occurrence = get('plan'), gate = deferred();
  const put = boundary.repository.upsertPlan, mutation = boundary.repository.applyRecurringPlanMutation;
  boundary.repository.upsertPlan = async value => { await gate.promise; return put(value); };
  boundary.repository.applyRecurringPlanMutation = async (...args) => { await gate.promise; return mutation(...args); };
  const target = { date: '2026-10-06', startTime: '10:00', endTime: '11:00' };
  let first!: Promise<void>;
  await act(async () => { first = order === 'cancel-first' ? state.deleteDayOccurrence(occurrence) : state.movePlanOccurrence(source, target); });
  await act(async () => { await expect(order === 'cancel-first' ? state.movePlanOccurrence(source, target) : state.deleteDayOccurrence(occurrence)).rejects.toThrow(); });
  await act(async () => { gate.resolve(); await first; });
  const current = (await repository.getPlans('owner'))[0];
  if (order === 'move-first') expect(current.date).toBe(target.date); else expect(current.excludedDates).toContain(DATE);
  expect(state.plans[0]).toEqual(current);
});
it.each(['plan', 'month-event', 'timetable-template'] as const)('repairs an unknown %s cancellation result after the write committed', async kind => {
  const { repository } = await mount(); const occurrence = get(kind);
  const method = kind === 'plan' ? 'applyRecurringPlanMutation' : kind === 'month-event' ? 'upsertMonthEvent' : 'applyTimetableMutation';
  const original = boundary.repository[method] as (...args: never[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: never[]) => { await original(...args); throw Error('ack lost'); } };
  await act(async () => { await expect(state.deleteDayOccurrence(occurrence)).rejects.toThrow('ack lost'); });
  expect(project().some(row => row.id === occurrence.id)).toBe(false);
  expect(state.plans).toEqual(await repository.getPlans('owner'));
  expect(state.monthEvents).toEqual(await repository.getMonthEvents('owner'));
  expect(state.scheduleTemplates).toEqual(await repository.getScheduleTemplates('owner'));
  expect(state.plannerDataAvailability.status).toBe('ready');
});
it('blocks resending and undo until a failed reconciliation is successfully retried', async () => {
  await mount(); const occurrence = get('timetable-template'), put = boundary.repository.applyTimetableMutation;
  boundary.repository.applyTimetableMutation = async value => { await put(value); throw Error('ack lost'); };
  const read = boundary.repository.getScheduleTemplates;
  boundary.repository.getScheduleTemplates = async () => { throw Error('read offline'); };
  const writes = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await expect(state.deleteDayOccurrence(occurrence)).rejects.toThrow('ack lost'); });
  expect(state.plannerDataAvailability.status).toBe('stale');
  await act(async () => { await expect(state.deleteDayOccurrence(occurrence)).rejects.toThrow('保存状態を確認できません'); });
  expect(writes).toHaveBeenCalledTimes(1);
  boundary.repository.getScheduleTemplates = read;
  await act(async () => { await state.retryPlannerData(); });
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(project().some(row => row.id === occurrence.id)).toBe(false);
});
it('repairs an unknown template Undo result without replaying its write', async () => {
  const { repository } = await mount(); await act(async () => { await state.deleteDayOccurrence(get('timetable-template')); });
  const restore = undo(), put = boundary.repository.applyTimetableMutation;
  const writes = vi.fn(async (value: Parameters<typeof put>[0]) => { await put(value); throw Error('undo ack lost'); });
  boundary.repository.applyTimetableMutation = writes;
  await act(async () => { await restore(); });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(state.scheduleTemplates).toEqual(await repository.getScheduleTemplates('owner'));
  expect(project().some(row => row.source.backingKind === 'timetable-template')).toBe(true);
});
it('does not let template editing overwrite an uncertain cancellation after its repair failed', async () => {
  await mount(); const occurrence = get('timetable-template'), row = state.scheduleTemplates[0];
  const put = boundary.repository.applyTimetableMutation, read = boundary.repository.getScheduleTemplates;
  boundary.repository.applyTimetableMutation = async value => { await put(value); throw Error('ack lost'); };
  boundary.repository.getScheduleTemplates = async () => { throw Error('offline'); };
  await act(async () => { await expect(state.deleteDayOccurrence(occurrence)).rejects.toThrow('ack lost'); });
  const write = vi.spyOn(boundary.repository, 'upsertScheduleTemplate');
  await act(async () => { await expect(state.saveScheduleTemplate({ ...row, title: 'Unsafe stale save' }, row.id)).rejects.toThrow('保存状態を確認できません'); });
  expect(write).not.toHaveBeenCalled();
  boundary.repository.getScheduleTemplates = read;
  await act(async () => { await state.retryPlannerData(); });
  await act(async () => { await state.saveScheduleTemplate({ ...row, title: 'Safe after refresh' }, row.id); });
  expect(state.scheduleTemplates.find(item => item.id === row.id)?.excludedDates).toEqual([DATE]);
});
