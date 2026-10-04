import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleItemDeleteAction } from '../components/ScheduleItemDeleteAction';
import {
  createEmptyMonthEventDraft,
  createMonthEventDraftFromEvent,
  createMonthEventFromDraft,
} from '../domain/planner';
import { createScheduleOccurrenceProjection, type ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { deleteScheduleOccurrence } from '../domain/scheduleOccurrenceMutation';
import { createLocalPlannerStorageGateway } from '../repositories/localStorageGateway';
import { createLocalScheduleEventAuthority } from '../repositories/localScheduleEventAuthority';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { createScheduleEventBackedPlannerRepository } from '../repositories/scheduleEventAuthorityRepository';
import type { MonthEvent } from '../types/domain';
import type { ShowNotice } from './useNoticeState';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';
import { useScheduleItemActionPress } from './useScheduleItemActionPress';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({
  plannerRepository: new Proxy({}, {
    get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
  }),
}));
// The portal destination is layout only; preserve the actual action button and handlers.
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));

const OWNER = 'owner';
const DATE = '2026-10-04';
const STAMP = `${DATE}T00:00:00.000Z`;
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let repository: PlannerRepository;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function event(id: string): MonthEvent {
  return {
    ...createMonthEventFromDraft({
      ...createEmptyMonthEventDraft(OWNER, DATE),
      endDate: DATE,
      title: id,
      memo: `${id} original memo`,
      url: `https://example.test/${id}`,
      locationTags: [`${id} classroom`],
      checklist: [{ id: `${id}-check`, text: `${id} preparation`, checked: false }],
    }),
    id,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
const A = event('a');
const B = event('b');
function Harness({ owner = OWNER }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice });
  return null;
}
async function mount() {
  const storage = new MemoryStorage();
  const gateway = createLocalPlannerStorageGateway(storage);
  await gateway.writeMonthEvents([A, B]);
  repository = createScheduleEventBackedPlannerRepository(
    createPlannerRepository(gateway),
    createLocalScheduleEventAuthority(gateway, storage),
  );
  boundary.repository = { ...repository };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData(OWNER); });
}
function unmount() {
  act(() => renderer?.unmount());
  renderer = undefined;
}
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const ordered = (records: MonthEvent[]) => structuredClone(records).sort((a, b) => a.id.localeCompare(b.id));
async function expectStoredProjection(context: string) {
  expect(ordered(state.monthEvents), context).toEqual(ordered(await repository.getMonthEvents(OWNER)));
}

type Outcome = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
function observe(promise: Promise<void>): Promise<Outcome> {
  return promise.then(() => ({ status: 'fulfilled' }), reason => ({ status: 'rejected', reason }));
}
function deferredGate(label: string) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {
    promise, resolve, reject,
    error: new Error(`${label} persistence failed`),
    entries: 0,
    writes: 0,
    outcome: null as Outcome | null,
  };
}
type Gate = ReturnType<typeof deferredGate>;
function gateMethod<Args extends unknown[], Result>(
  original: (...args: Args) => Promise<Result>,
  matches: (...args: Args) => boolean,
  gate: Gate,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    if (!matches(...args)) return original(...args);
    gate.entries += 1;
    try {
      await gate.promise;
      const result = await original(...args);
      gate.writes += 1;
      gate.outcome = { status: 'fulfilled' };
      return result;
    } catch (reason) {
      gate.outcome = { status: 'rejected', reason };
      throw reason;
    }
  };
}
function holdUpsert(label: string, matches: (record: MonthEvent) => boolean) {
  const gate = deferredGate(label);
  boundary.repository.upsertMonthEvent = gateMethod(boundary.repository.upsertMonthEvent, matches, gate);
  return gate;
}
type OperationKind = 'edit' | 'create' | 'delete';
function gateFor(kind: OperationKind, record: MonthEvent) {
  if (kind !== 'delete') return holdUpsert(`${kind} ${record.id}`, candidate => candidate.title === `${record.title} saved`);
  const gate = deferredGate(`delete ${record.id}`);
  boundary.repository.deleteMonthEvent = gateMethod(
    boundary.repository.deleteMonthEvent,
    (owner, id) => owner === OWNER && id === record.id,
    gate,
  );
  return gate;
}
function mutate(kind: OperationKind, record: MonthEvent) {
  if (kind === 'delete') return state.deleteMonthEvent(record);
  return state.saveMonthEvent({
    ...createMonthEventDraftFromEvent(record),
    endDate: record.endDate ?? record.date,
    title: `${record.title} saved`,
    memo: `${record.id} saved memo`,
    checklist: record.checklist.map(item => ({ ...item, checked: true })),
  }, kind === 'edit' ? record.id : undefined);
}
interface PendingOperation { gate: Gate; done: Promise<Outcome> }
async function begin(gate: Gate, action: () => Promise<void>): Promise<PendingOperation> {
  let done!: Promise<Outcome>;
  await act(async () => { done = observe(action()); });
  expect(gate.entries).toBe(1);
  expect(gate.writes).toBe(0);
  expect(gate.outcome).toBeNull();
  return { gate, done };
}
async function finish(
  operation: PendingOperation,
  success: boolean,
  caller: 'mutation' | 'undo' | 'expired' = 'mutation',
) {
  const { gate } = operation;
  let outcome!: Outcome;
  await act(async () => {
    if (success) gate.resolve(); else gate.reject(gate.error);
    outcome = await operation.done;
  });
  expect(gate.entries).toBe(1);
  expect(gate.writes).toBe(success ? 1 : 0);
  expect(gate.outcome).toEqual(success ? { status: 'fulfilled' } : { status: 'rejected', reason: gate.error });
  if (caller === 'expired') {
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toBeInstanceOf(PlannerMutationScopeExpiredError);
  } else {
    expect(outcome).toEqual(success || caller === 'undo'
      ? { status: 'fulfilled' } : { status: 'rejected', reason: gate.error });
  }
}
function undoAction(): () => Promise<void> {
  const action = showNotice.mock.calls.slice().reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  if (!action) throw new Error('Expected a successful deletion to offer Undo');
  return async () => { await action(); };
}
async function deleteAndGetUndo() {
  await act(async () => { await state.deleteMonthEvent(A); });
  expect(ordered(state.monthEvents)).toEqual([B]);
  expect(ordered(await repository.getMonthEvents(OWNER))).toEqual([B]);
  return undoAction();
}

type ScopeBoundary = 'owner' | 'reset' | 'unmount';
async function replaceScope(edge: ScopeBoundary) {
  await act(async () => {
    if (edge === 'owner') renderer!.update(<Harness owner="other-owner" />);
    else if (edge === 'reset') state.resetPlannerData();
    else { renderer!.unmount(); renderer = create(<Harness />); }
  });
  if (edge === 'owner') await act(async () => { await state.loadPlannerData('other-owner'); });
}

const kinds: OperationKind[] = ['edit', 'create', 'delete'];
const pairs = kinds.flatMap(first => kinds.map(second => ({ first, second })));
it.each(pairs)('isolates $first A from $second B across both start/completion orders and outcomes', async ({ first, second }) => {
  // 9 operation pairs × 16 outcome/order combinations = 144 deterministic cases.
  for (const aSuccess of [false, true]) for (const bSuccess of [false, true]) {
    for (const aStartsFirst of [false, true]) for (const aFinishesFirst of [false, true]) {
      await mount();
      const gateA = gateFor(first, A); const gateB = gateFor(second, B);
      let a!: PendingOperation; let b!: PendingOperation;
      const beginA = async () => { a = await begin(gateA, () => mutate(first, A)); };
      const beginB = async () => { b = await begin(gateB, () => mutate(second, B)); };
      if (aStartsFirst) { await beginA(); await beginB(); } else { await beginB(); await beginA(); }
      if (aFinishesFirst) { await finish(a, aSuccess); await finish(b, bSuccess); }
      else { await finish(b, bSuccess); await finish(a, aSuccess); }
      await expectStoredProjection(JSON.stringify({ first, second, aSuccess, bSuccess, aStartsFirst, aFinishesFirst }));
      unmount();
    }
  }
});

it('preserves successful Undo across overlapping save outcomes and both start/completion orders', async () => {
  for (const undoSuccess of [false, true]) for (const saveSuccess of [false, true]) {
    for (const undoStartsFirst of [false, true]) for (const undoFinishesFirst of [false, true]) {
      await mount();
      const undo = await deleteAndGetUndo();
      const undoGate = holdUpsert('Undo A', record => record.id === A.id);
      const saveGate = gateFor('edit', B);
      let restoration!: PendingOperation; let save!: PendingOperation;
      const beginUndo = async () => { restoration = await begin(undoGate, undo); };
      const beginSave = async () => { save = await begin(saveGate, () => mutate('edit', B)); };
      if (undoStartsFirst) { await beginUndo(); await beginSave(); } else { await beginSave(); await beginUndo(); }
      if (undoFinishesFirst) { await finish(restoration, undoSuccess, 'undo'); await finish(save, saveSuccess); }
      else { await finish(save, saveSuccess); await finish(restoration, undoSuccess, 'undo'); }
      await expectStoredProjection(JSON.stringify({ undoSuccess, saveSuccess, undoStartsFirst, undoFinishesFirst }));
      expect(state.monthEvents.some(record => record.id === A.id)).toBe(undoSuccess);
      if (!undoSuccess) expect(showNotice).toHaveBeenCalledWith(undoGate.error.message, 'error');
      unmount();
    }
  }
});

it.each(kinds)('does not replace an accepted same-owner refresh after old %s rejection', async kind => {
  await mount();
  const pending = await begin(gateFor(kind, A), () => mutate(kind, A));
  await repository.upsertMonthEvent({ ...B, title: 'newer accepted title', memo: 'newer accepted memo' });
  await act(async () => { await state.loadPlannerData(OWNER); });
  // The accepted MonthEvent snapshot is preserved, while #437 conservatively
  // waits for every hook writer before certifying the Actual/material slice.
  expect(state.plannerDataAvailability.status).toBe('stale');
  expect(state.plannerDataRecovery).toMatchObject({ reason: 'actual-material', phase: 'waiting' });
  await expectStoredProjection('accepted refresh');
  const accepted = ordered(state.monthEvents);
  const fullTimestamp = state.plannerDataAvailability.lastSuccessfulAt;
  const actualReads = vi.spyOn(boundary.repository, 'getActuals');
  const materialReads = vi.spyOn(boundary.repository, 'getStudyMaterials');
  const monthReads = vi.spyOn(boundary.repository, 'getMonthEvents');
  await finish(pending, false);
  expect(ordered(state.monthEvents)).toEqual(accepted);
  await expectStoredProjection('old failure cannot replace accepted data');
  expect(actualReads).toHaveBeenCalledTimes(1);
  expect(materialReads).toHaveBeenCalledTimes(1);
  expect(monthReads).not.toHaveBeenCalled();
  expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', lastSuccessfulAt: fullTimestamp });
});

it('blocks old save/delete results and notices across owner, reset and unmount', async () => {
  for (const edge of ['owner', 'reset', 'unmount'] as const) for (const kind of kinds) for (const success of [false, true]) {
    await mount();
    const pending = await begin(gateFor(kind, A), () => mutate(kind, A));
    await replaceScope(edge);
    const visible = ordered(state.monthEvents); const notices = showNotice.mock.calls.length;
    await finish(pending, success, 'expired');
    expect(ordered(state.monthEvents)).toEqual(visible);
    expect(showNotice).toHaveBeenCalledTimes(notices);
    unmount();
  }
});

it('blocks stale Undo entry and late Undo results after scope replacement', async () => {
  for (const edge of ['owner', 'reset', 'unmount'] as const) {
    await mount();
    const staleUndo = await deleteAndGetUndo();
    const unusedGate = holdUpsert('stale Undo', record => record.id === A.id);
    await replaceScope(edge);
    await act(async () => { await staleUndo(); });
    expect(unusedGate.entries).toBe(0);
    expect(unusedGate.writes).toBe(0);
    expect(ordered(await repository.getMonthEvents(OWNER))).toEqual([B]);
    unmount();
    for (const success of [false, true]) {
      await mount();
      const undo = await deleteAndGetUndo();
      const pending = await begin(holdUpsert('pending Undo', record => record.id === A.id), undo);
      await replaceScope(edge);
      const visible = ordered(state.monthEvents); const notices = showNotice.mock.calls.length;
      await finish(pending, success, 'undo');
      expect(ordered(state.monthEvents)).toEqual(visible);
      expect(showNotice).toHaveBeenCalledTimes(notices);
      unmount();
    }
  }
});

it('keeps Undo post-persistence and restores its successful write after an earlier accepted refresh', async () => {
  await mount();
  const undo = await deleteAndGetUndo();
  const pending = await begin(holdUpsert('Undo before physical write', record => record.id === A.id), undo);
  // This read occurs BEFORE the physical write. Dropping an Undo operation at
  // refresh and ignoring its later acknowledgement would hide durable success.
  expect(ordered(state.monthEvents)).toEqual([B]);
  expect(ordered(await repository.getMonthEvents(OWNER))).toEqual([B]);
  await act(async () => { await state.loadPlannerData(OWNER); });
  expect(ordered(state.monthEvents)).toEqual([B]);
  expect(pending.gate.writes).toBe(0);
  await finish(pending, true, 'undo');
  expect(ordered(state.monthEvents)).toEqual([A, B]);
  await expectStoredProjection('successful Undo remains visible after refresh-before-write');
});

let actionPress: ReturnType<typeof useScheduleItemActionPress<ScheduleOccurrence>>;
let uiDone: Promise<Outcome> | undefined;
function LongPressHarness() {
  state = usePlannerDataState({ userId: OWNER, showNotice });
  actionPress = useScheduleItemActionPress<ScheduleOccurrence>();
  return <ScheduleItemDeleteAction action={actionPress.activeAction} onDismiss={actionPress.dismiss} onDelete={occurrence => {
    const deletion = deleteScheduleOccurrence({
      occurrence,
      plans: state.plans,
      monthEvents: state.monthEvents,
      deletePlan: state.deletePlan,
      deleteMonthEvent: state.deleteMonthEvent,
      confirmRecurringMonthEventSeries: () => true,
    }).then(() => undefined);
    uiDone = observe(deletion);
    return deletion;
  }} />;
}
it('allows a second long-press deletion while the dismissed first deletion is pending', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', {
    querySelectorAll: () => ({ length: 1, item: () => ({}) }),
    addEventListener() {}, removeEventListener() {},
  });
  await mount();
  await act(async () => { renderer!.update(<LongPressHarness />); });
  await act(async () => { await state.loadPlannerData(OWNER); });
  const gateA = gateFor('delete', A); const gateB = gateFor('delete', B);
  async function longPressAndDelete(record: MonthEvent, gate: Gate): Promise<PendingOperation> {
    const occurrence = createScheduleOccurrenceProjection({
      ownerId: OWNER, startDate: DATE, endDate: DATE, plans: [], monthEvents: state.monthEvents,
    }).occurrences.find(item => item.source.backingId === record.id);
    if (!occurrence) throw new Error(`Missing occurrence ${record.id}`);
    await act(async () => {
      actionPress.start(occurrence.id, occurrence, occurrence.title, 'touch', {
        getBoundingClientRect: () => ({ top: 0, right: 100 }),
      } as HTMLElement, 0, 0);
      vi.advanceTimersByTime(240);
    });
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);
    uiDone = undefined;
    await act(async () => {
      renderer!.root.findByType('button').props.onClick({ preventDefault() {}, stopPropagation() {} });
    });
    expect(actionPress.activeAction).toBeNull();
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
    expect(gate.entries).toBe(1);
    expect(gate.writes).toBe(0);
    expect(gate.outcome).toBeNull();
    if (!uiDone) throw new Error('Deletion button did not start its repository operation');
    return { gate, done: uiDone };
  }
  const first = await longPressAndDelete(A, gateA);
  const second = await longPressAndDelete(B, gateB);
  expect(state.monthEvents).toEqual([]);
  await finish(second, true);
  expect(ordered(await repository.getMonthEvents(OWNER))).toEqual([A]);
  await finish(first, false);
  expect(ordered(state.monthEvents)).toEqual([A]);
  await expectStoredProjection('failed first deletion does not revive successfully deleted B');
});
