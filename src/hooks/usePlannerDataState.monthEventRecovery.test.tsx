import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { createEmptyMonthEventDraft, createMonthEventFromDraft, createMonthEventDraftFromEvent } from '../domain/planner';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
import type { MonthEvent } from '../types/domain';
import { createMonthEventRecoveryRepository } from './monthEventRecovery.testUtils';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const DATE = '2026-10-04';
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let harnessOwner: string | null = 'owner';
function Harness() { state = usePlannerDataState({ userId: harnessOwner, showNotice }); return null; }
function unmount() { act(() => renderer?.unmount()); renderer = undefined; }
afterEach(unmount);
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, entered: false };
}

describe.each(['legacy', 'canonical'] as const)('MonthEvent refresh recovery with %s storage', mode => {
  async function mount() {
    harnessOwner = 'owner';
    const fixture = createMonthEventRecoveryRepository(mode);
    boundary.repository = { ...fixture.repository };
    showNotice.mockClear();
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await state.loadPlannerData('owner'); });
    return fixture.storage;
  }

  const E = { ...createMonthEventFromDraft({ ...createEmptyMonthEventDraft('owner', DATE), title: 'Original', endDate: DATE }), id: 'event-a' };
  const rows = () => boundary.repository.getMonthEvents('owner');
  async function seed() {
    const storage = await mount();
    await storage.monthEvents.write([E]);
    await act(async () => { await state.loadPlannerData('owner'); });
    return storage;
  }
  const edit = (title: string, date = DATE) => state.saveMonthEvent({ ...createMonthEventDraftFromEvent(E), title, date, endDate: date }, E.id);
  function control(method: 'upsertMonthEvent' | 'deleteMonthEvent', match: (args: unknown[]) => boolean = () => true) {
    const write = deferred(), persisted = deferred(), response = deferred();
    const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
    boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
      if (!match(args)) return original(...args);
      write.entered = true;
      await write.promise;
      const result = await original(...args);
      persisted.resolve();
      await response.promise;
      return result;
    } };
    return { write, persisted, response };
  }
  async function start(action: () => Promise<void>) {
    let done!: Promise<unknown>;
    await act(async () => { done = action().then(() => undefined, error => error); });
    return { done };
  }
  async function write(control: ReturnType<typeof globalControl>) {
    await act(async () => { control.write.resolve(); await control.persisted.promise; });
  }
  const globalControl = control;
  async function ack(control: ReturnType<typeof globalControl>, operation: Awaited<ReturnType<typeof start>>) {
    await act(async () => { control.response.resolve(); expect(await operation.done).toBeUndefined(); });
  }
  async function sameStorage(label: string) { expect(state.monthEvents, label).toEqual(await rows()); }
  async function undo() {
    await act(async () => { await state.deleteMonthEvent(E); });
    const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
    if (!action) throw Error('Missing undo');
    return async () => { await action(); };
  }
  it.each(['create', 'edit', 'delete', 'undo'] as const)('%s persists after accepted full refresh and repairs exact stored collection without reloading', async kind => {
    await seed();
    const action = kind === 'undo' ? await undo() : kind === 'delete' ? () => state.deleteMonthEvent(E)
      : kind === 'edit' ? () => edit('Changed') : () => state.saveMonthEvent({ ...createEmptyMonthEventDraft('owner', DATE), title: 'Added' });
    const gate = control(kind === 'delete' ? 'deleteMonthEvent' : 'upsertMonthEvent');
    const operation = await start(action);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(gate.write.entered).toBe(true);
    expect(state.plannerDataAvailability.status).toBe('stale');
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents');
    const planRead = vi.spyOn(boundary.repository, 'getPlans');
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await write(gate); await ack(gate, operation);
    const readCount = monthRead.mock.calls.length;
    await sameStorage(kind);
    expect(readCount).toBe(1);
    expect(planRead).not.toHaveBeenCalled(); expect(normalize).not.toHaveBeenCalled();
    expect(state.plannerDataAvailability.status).toBe('ready');
  });
  it.each(['edit', 'delete', 'undo'] as const)('%s late acknowledgment cannot overwrite a newer accepted row', async kind => {
    const storage = await seed();
    const action = kind === 'undo' ? await undo() : kind === 'delete' ? () => state.deleteMonthEvent(E) : () => edit('Old');
    const gate = control(kind === 'delete' ? 'deleteMonthEvent' : 'upsertMonthEvent');
    const operation = await start(action);
    await write(gate);
    await storage.monthEvents.write([{ ...E, title: 'Fresh accepted record' }]);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.monthEvents[0].title).toBe('Fresh accepted record');
    await ack(gate, operation);
    await sameStorage(kind);
    expect(state.monthEvents[0].title).toBe('Fresh accepted record');
  });
  const schedules = ['W0 A0 W1 A1', 'W0 W1 A0 A1', 'W0 W1 A1 A0', 'W1 A1 W0 A0', 'W1 W0 A1 A0', 'W1 W0 A0 A1'];
  it.each(schedules)('same-row saves after accepted refresh follow physical storage, schedule %s', async schedule => {
    await seed();
    const gates = [control('upsertMonthEvent', args => (args[0] as MonthEvent).title === 'Old'), control('upsertMonthEvent', args => (args[0] as MonthEvent).title === 'New')];
    const ops = [await start(() => edit('Old')), await start(() => edit('New'))];
    await act(async () => { await state.loadPlannerData('owner'); });
    for (const event of schedule.split(' ')) {
      const index = Number(event[1]);
      if (event[0] === 'W') await write(gates[index]); else await ack(gates[index], ops[index]);
    }
    await sameStorage(schedule);
  });
  it.each(schedules)('delete/save after accepted refresh follows physical storage, schedule %s', async schedule => {
    await seed();
    const gates = [control('deleteMonthEvent'), control('upsertMonthEvent')];
    const ops = [await start(() => state.deleteMonthEvent(E)), await start(() => edit('Saved'))];
    await act(async () => { await state.loadPlannerData('owner'); });
    for (const event of schedule.split(' ')) {
      const index = Number(event[1]);
      if (event[0] === 'W') await write(gates[index]); else await ack(gates[index], ops[index]);
    }
    await sameStorage(schedule);
  });
  it('target MonthEvent read failure preserves successful persistence, latches stale, and retries reads only', async () => {
    await seed(); const gate = control('upsertMonthEvent'); const operation = await start(() => edit('Saved'));
    await act(async () => { await state.loadPlannerData('owner'); });
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents').mockRejectedValueOnce(Error('offline read'));
    const upsert = vi.spyOn(boundary.repository, 'upsertMonthEvent');
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    await write(gate); await ack(gate, operation);
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(monthRead).toHaveBeenCalledTimes(1);
    await act(async () => { await state.retryPlannerData(); });
    expect(monthRead).toHaveBeenCalledTimes(2); expect(upsert).not.toHaveBeenCalled(); expect(normalize).not.toHaveBeenCalled();
    await sameStorage('retry'); expect(state.plannerDataAvailability.status).toBe('ready');
  });
  it.each(['owner', 'reset', 'unmount'] as const)('old held target MonthEvent read cannot publish after %s', async edge => {
    await seed(); const writer = control('upsertMonthEvent'); const operation = await start(() => edit('Saved'));
    await act(async () => { await state.loadPlannerData('owner'); });
    const readGate = deferred(); const original = boundary.repository.getMonthEvents;
    boundary.repository = { ...boundary.repository, getMonthEvents: async owner => { const result = await original(owner); readGate.entered = true; await readGate.promise; return result; } };
    await write(writer); await ack(writer, operation); expect(readGate.entered).toBe(true);
    await act(async () => {
      if (edge === 'owner') { harnessOwner = 'other-owner'; renderer!.update(<Harness />); }
      else if (edge === 'reset') state.resetPlannerData();
      else { renderer!.unmount(); renderer = create(<Harness />); }
    });
    const visible = state.monthEvents;
    await act(async () => { readGate.resolve(); });
    expect(state.monthEvents).toBe(visible);
    expect(state.plannerDataAvailability.status).toBe('idle');
  });
  it('writer crossing MonthEvent target read discards snapshot and rereads quiescent storage', async () => {
    await seed(); const gate = control('upsertMonthEvent', args => (args[0] as MonthEvent).title === 'First'); const op = await start(() => edit('First'));
    await act(async () => { await state.loadPlannerData('owner'); });
    const readGate = deferred(); const original = boundary.repository.getMonthEvents;
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents').mockImplementationOnce(async owner => { const result = await original(owner); readGate.entered = true; await readGate.promise; return result; });
    await write(gate); await ack(gate, op); expect(readGate.entered).toBe(true);
    await act(async () => { await edit('Second'); });
    await act(async () => { readGate.resolve(); });
    expect(monthRead).toHaveBeenCalledTimes(2); await sameStorage('interfering writer');
  });
  it.each([false, true])('new navigation is not changed by refresh-boundary MonthEvent settlement success=%s', async success => {
    await seed(); const gate = control('upsertMonthEvent'); const op = await start(() => edit('Saved', '2026-11-12'));
    await act(async () => { await state.loadPlannerData('owner'); state.openDay('2026-12-20'); });
    if (success) { await write(gate); await ack(gate, op); }
    else await act(async () => { gate.write.reject(Error('save failed')); expect(await op.done).toBeInstanceOf(Error); });
    expect(state.selectedDate).toBe('2026-12-20'); expect(state.monthDate).toBe('2026-12-01'); expect(state.viewMode).toBe('day');
    await sameStorage('navigation');
  });
  it('sequential uncontended MonthEvent operations add no getters', async () => {
    await seed(); const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents'); const actualRead = vi.spyOn(boundary.repository, 'getActuals');
    await act(async () => { await edit('First'); });
    await act(async () => { await edit('Second'); });
    const restore = await undo(); await act(async () => { await restore(); });
    expect(monthRead).not.toHaveBeenCalled(); expect(actualRead).not.toHaveBeenCalled();
    await sameStorage('sequential');
  });

  it('full read started first and accepted after a successful MonthEvent write repairs the stale captured collection', async () => {
    await seed();
    const monthGate = deferred(); const original = boundary.repository.getScheduleSnapshot;
    const scheduleRead = vi.spyOn(boundary.repository, 'getScheduleSnapshot').mockImplementationOnce(async owner => {
      const captured = await original(owner); monthGate.entered = true; await monthGate.promise; return captured;
    });
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents');
    let loading!: Promise<void>;
    await act(async () => { loading = state.loadPlannerData('owner'); });
    expect(monthGate.entered).toBe(true);
    await act(async () => { await edit('Saved while full read waits'); });
    expect(state.monthEvents[0].title).toBe('Saved while full read waits');
    await act(async () => { monthGate.resolve(); await loading; });
    await sameStorage('full read accepts after write settled');
    expect(scheduleRead).toHaveBeenCalledOnce();
    expect(monthRead).toHaveBeenCalledTimes(2); // Target read and verification read.
    expect(state.plannerDataAvailability.status).toBe('ready');
  });

  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)('recurring %s record survives save/delete/Undo across full refresh with recurrence metadata intact', async repeat => {
    const storage = await seed();
    const recurring: MonthEvent = { ...E, repeat, repeatUntil: '2028-10-04', excludedDates: ['2026-10-05'],
      memo: 'Keep recurrence data', checklist: [{ id: 'c', text: 'Prepare', checked: true }], locationTags: ['classroom'], url: 'https://example.test/event' };
    await storage.monthEvents.write([recurring]);
    await act(async () => { await state.loadPlannerData('owner'); });
    const saveGate = control('upsertMonthEvent');
    const save = await start(() => state.saveMonthEvent({ ...createMonthEventDraftFromEvent(recurring), title: 'Recurring saved' }, recurring.id));
    await act(async () => { await state.loadPlannerData('owner'); });
    await write(saveGate); await ack(saveGate, save); await sameStorage('recurring save');
    const saved = structuredClone(state.monthEvents[0]);
    expect(saved).toMatchObject({ repeat, repeatUntil: '2028-10-04', excludedDates: ['2026-10-05'], checklist: recurring.checklist, locationTags: recurring.locationTags, url: recurring.url });
    const deleteGate = control('deleteMonthEvent');
    const deletion = await start(() => state.deleteMonthEvent(saved));
    await act(async () => { await state.loadPlannerData('owner'); });
    await write(deleteGate); await ack(deleteGate, deletion); await sameStorage('recurring delete'); expect(state.monthEvents).toEqual([]);
    const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
    expect(action).toBeDefined();
    const undoGate = control('upsertMonthEvent');
    const restoration = await start(async () => { await action!(); });
    await act(async () => { await state.loadPlannerData('owner'); });
    await write(undoGate); await ack(undoGate, restoration); await sameStorage('recurring Undo'); expect(state.monthEvents).toEqual([saved]);
  });

  it.each(['success', 'failure'] as const)('retired full %s cannot overwrite a newer repaired full snapshot', async oldOutcome => {
    await seed();
    const old = deferred(), fresh = deferred();
    const original = boundary.repository.getScheduleSnapshot;
    const scheduleRead = vi.spyOn(boundary.repository, 'getScheduleSnapshot')
      .mockImplementationOnce(async owner => { const captured = await original(owner); old.entered = true; await old.promise; return captured; })
      .mockImplementationOnce(async owner => { const captured = await original(owner); fresh.entered = true; await fresh.promise; return captured; });
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents');
    let oldLoading!: Promise<unknown>, freshLoading!: Promise<void>;
    await act(async () => { oldLoading = state.loadPlannerData('owner').catch(error => error); });
    await act(async () => { freshLoading = state.loadPlannerData('owner'); });
    expect(old.entered && fresh.entered).toBe(true);
    await act(async () => { await edit('New durable after two full snapshots'); });
    await act(async () => { fresh.resolve(); await freshLoading; });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.monthEvents[0].title).toBe('New durable after two full snapshots');
    expect(scheduleRead).toHaveBeenCalledTimes(2);
    expect(monthRead).toHaveBeenCalledOnce();
    const accepted = state.monthEvents;
    await act(async () => {
      if (oldOutcome === 'success') old.resolve(); else old.reject(Error('obsolete full failure'));
      await oldLoading;
    });
    expect(state.monthEvents).toBe(accepted);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(scheduleRead).toHaveBeenCalledTimes(2);
    expect(monthRead).toHaveBeenCalledOnce();
    await sameStorage('newer full supersession with successful MonthEvent evidence');
  });

  it('MonthEvent repair after later full failure cannot certify full health', async () => {
    await seed();
    const writer = control('upsertMonthEvent');
    const op = await start(() => edit('Durable after failed later full'));
    await act(async () => { await state.loadPlannerData('owner'); });
    const scheduleRead = vi.spyOn(boundary.repository, 'getScheduleSnapshot').mockRejectedValueOnce(Error('full failed'));
    await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('full failed'); });
    const upsert = vi.spyOn(boundary.repository, 'upsertMonthEvent');
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents');
    await write(writer); await ack(writer, op);
    expect(state.monthEvents[0].title).toBe('Durable after failed later full');
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'full-read', phase: 'failed', canRetry: true });
    expect(monthRead).toHaveBeenCalledTimes(1);
    expect(scheduleRead).toHaveBeenCalledTimes(1);
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(monthRead).toHaveBeenCalledOnce();
    expect(scheduleRead).toHaveBeenCalledTimes(2);
    expect(upsert).not.toHaveBeenCalled();
    await sameStorage('full health and repaired MonthEvent data');
  });
});
