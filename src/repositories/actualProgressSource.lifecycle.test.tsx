import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActualEditorCard } from '../components/ActualEditorCard';
import { createActualDraftForPlan } from '../lib/actualDrafts';
import { createStandaloneActualDraft } from '../lib/standaloneActualDrafts';
import { createActualFromDraft } from '../domain/planner';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import { collectStudyDates } from '../lib/studyStreak';
import { isStudyRecordForDisplay, normalizeStudyRecordsForDisplay } from '../lib/studyRecords';
import { createMonthEventRecoveryRepository } from '../hooks/monthEventRecovery.testUtils';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { actual, event, plan, createLocalFixture } from './localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from './repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const date = '2026-10-15';
const monthEvent = () => event({ date, endDate: date, title: '塾バイト', startTime: '17:00', endTime: '21:30' });
const eventActual = () => actual({ planId: 'event', occurrenceDate: date, actualStartTime: '17:00', actualEndTime: '21:30' });
const eventPlan = () => plan({ id: 'event', date, type: 'other', title: '塾バイト', startTime: '17:00', endTime: '21:30' });
let renderer: ReactTestRenderer | undefined;
let state: UsePlannerDataStateResult;
const notice = vi.fn();
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: notice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); notice.mockClear(); });
async function verify(repository: PlannerRepository, expected: number) {
  const sources = await repository.getScheduleSnapshot('owner');
  const actuals = await repository.getActuals('owner');
  for (const includeGeneralEvents of [false, true, false]) {
    const dashboard = buildHomeDashboardModel({ ...sources, actuals, todos: [], now: new Date(date + 'T22:00:00'),
      progressPreferences: { includeGeneralEvents, includeTimetable: false } });
    expect(dashboard.weekActualMinutes).toBe(includeGeneralEvents ? expected : 0);
    expect(dashboard.currentStreak).toBe(includeGeneralEvents ? 1 : 0);
  }
  expect(normalizeStudyRecordsForDisplay({ ...sources, actuals }).filter(isStudyRecordForDisplay)).toEqual([]);
  expect(collectStudyDates({ ...sources, actuals, userId: 'owner', today: date })).toEqual([]);
}
describe('Actual provenance through real persistence and UI lifecycles', () => {
  it('persists a newly saved source, deletes its event, reloads, and keeps settings effective', async () => {
    const f = createLocalFixture();
    await f.repository.upsertMonthEvent(monthEvent());
    await f.repository.upsertActual(eventActual());
    expect((await f.repository.getActuals('owner'))[0].progressSource).toEqual({ kind: 'general-event', sourceId: 'event' });
    await f.repository.deleteMonthEvent('owner', 'event');
    await verify(createLocalPlannerRepository(f.storage), 270);
  });
  it.each(['legacy', 'canonical'] as const)('backfills only retained same-owner legacy actuals during %s deletion', async mode => {
    const ours = eventActual(), foreign = { ...ours, id: 'foreign', userId: 'other' };
    const { repository, storage } = createMonthEventRecoveryRepository(mode, [ours, foreign]);
    await repository.upsertMonthEvent(monthEvent());
    await repository.deleteMonthEvent('owner', 'event');
    expect((await storage.actuals.read()).find(item => item.id === 'foreign')).toEqual(foreign);
    expect((await repository.getActuals('owner'))[0]).toEqual({ ...ours, progressSource: { kind: 'general-event', sourceId: 'event' } });
    await verify(repository, 270);
  });
  it('the actual date editor detaches the link without losing source, including legacy records', async () => {
    const { repository } = createMonthEventRecoveryRepository('canonical', [eventActual()]);
    await repository.upsertMonthEvent(monthEvent());
    const save = vi.fn(async (_plan, draft) => { await repository.upsertActual(createActualFromDraft('owner', draft, eventActual())); });
    act(() => { renderer = create(<ActualEditorCard plan={eventPlan()} plans={[]} actuals={[eventActual()]} actual={eventActual()}
      onEditPlan={vi.fn()} onDeletePlan={vi.fn()} onSaveActual={save} onDeleteActual={vi.fn()}
      onClose={vi.fn()} forceOpen hideToggleButton hidePlanActions />); });
    act(() => renderer!.root.findByProps({ type: 'date' }).props.onChange({ target: { value: '2026-10-14' } }));
    await act(async () => { await renderer!.root.findAllByType('button').find(node => node.children.includes('記録保存'))!.props.onClick(); });
    expect((await repository.getActuals('owner'))[0]).toMatchObject({ planId: null, occurrenceDate: '2026-10-14', progressSource: { kind: 'general-event' } });
    await verify(repository, 270);
  });
  it('hook projection keeps legacy-source classification during deletion, failure rollback and Undo', async () => {
    const f = createLocalFixture(); await f.repository.upsertMonthEvent(monthEvent());
    await f.gateway.writeActuals([eventActual()]); boundary.repository = f.repository;
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await state.loadPlannerData('owner'); });
    const failed = vi.spyOn(boundary.repository, 'deleteMonthEvent').mockRejectedValueOnce(Error('offline'));
    await act(async () => { await expect(state.deleteMonthEvent(state.monthEvents[0])).rejects.toThrow('offline'); });
    expect(state.monthEvents).toHaveLength(1); expect(state.actuals[0].progressSource).toBeUndefined();
    failed.mockRestore();
    await act(async () => { await state.deleteMonthEvent(state.monthEvents[0]); });
    expect(state.monthEvents).toEqual([]); expect(state.actuals[0].progressSource?.kind).toBe('general-event');
    const restore = [...notice.mock.calls].reverse().find(call => call[2]?.actionLabel === '元に戻す')![2].onAction;
    await act(async () => { await restore(); });
    expect(state.monthEvents).toHaveLength(1); await verify(f.repository, 270);
  });
  it('rejects caller-forged snapshots and captures the actual relink destination', async () => {
    const f = createLocalFixture(); await f.repository.upsertMonthEvent(monthEvent()); await f.repository.upsertPlan(plan({ date }));
    const saved = await f.repository.upsertActual({ ...eventActual(), progressSource: { kind: 'study', sourceId: 'forged' } });
    expect(saved.progressSource?.kind).toBe('general-event');
    const linked = await f.repository.upsertActual({ ...saved, planId: 'plan' });
    expect(linked.progressSource).toEqual({ kind: 'study', sourceId: 'plan', planType: 'study' });
    const independent = await f.repository.upsertActual(actual({ id: 'independent', planId: null, progressSource: { kind: 'general-event', sourceId: 'event' } }));
    expect(independent.progressSource).toBeUndefined();
  });
});

it('rejects new and explicit relink saves after the source disappears, retaining unknown historical records', async () => {
  const f = createLocalFixture(); await f.repository.upsertMonthEvent(monthEvent());
  await f.repository.deleteMonthEvent('owner', 'event');
  await expect(f.repository.upsertActual(eventActual())).rejects.toThrow('再読み込み');
  expect(await f.repository.getActuals('owner')).toEqual([]);
  const unknown = actual({ planId: null, title: '塾バイト' });
  await f.repository.upsertActual(unknown);
  await expect(f.repository.upsertActual({ ...unknown, planId: 'event' })).rejects.toThrow('再読み込み');
  const edited = await f.repository.upsertActual({ ...unknown, note: 'Still editable' });
  expect(edited.progressSource).toBeUndefined(); expect(edited.planId).toBeNull();
});

it('hook creation, date unlink, standalone edit and explicit relink preserve only the confirmed source', async () => {
  const f = createLocalFixture(); await f.repository.upsertMonthEvent(monthEvent()); await f.repository.upsertPlan(plan({ date }));
  boundary.repository = f.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { await state.saveActual(eventPlan(), createActualDraftForPlan(eventPlan())); });
  expect(state.actuals[0].progressSource).toEqual({ kind: 'general-event', sourceId: 'event' });
  const id = state.actuals[0].id;
  await act(async () => { await state.saveActual(eventPlan(), { ...createActualDraftForPlan(eventPlan(), state.actuals[0]),
    planId: null, occurrenceDate: '2026-10-14' }, id); });
  expect(state.actuals[0]).toMatchObject({ planId: null, progressSource: { kind: 'general-event' } });
  await act(async () => { await state.saveStandaloneActual(createStandaloneActualDraft(state.actuals[0], {
    occurrenceDate: date, startTime: '17:00', endTime: '21:30', title: 'Edited work', subject: '', note: 'Edited',
  }), id); });
  expect(state.actuals[0].progressSource?.kind).toBe('general-event');
  await act(async () => { await state.linkStandaloneActualToPlan(state.actuals[0], state.plans[0]); });
  expect(state.actuals[0].progressSource).toEqual({ kind: 'study', sourceId: 'plan', planType: 'study' });
  expect((await f.repository.getActuals('owner'))[0].progressSource).toEqual(state.actuals[0].progressSource);
});
