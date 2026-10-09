import '../../tests/performance/firestoreReadLoad.noNetwork';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyDayNoteDraft } from '../domain/planner';
import { createLocalFixture, DATE, deferred, microtasks, STAMP, todo } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';
import { usePlannerDataState, type DeferredDayNotesPlannerDataStateResult } from './usePlannerDataState';
import { plannerFullReadMethods, spyPlannerReads } from './plannerReadSpies.testUtils';
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
let state: DeferredDayNotesPlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn();
function Harness({ owner = 'owner' }: { owner?: string }) { state = usePlannerDataState({ userId: owner, showNotice, deferDayNotes: true }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const draft = () => ({ ...createEmptyDayNoteDraft('owner', DATE), quickMemo: 'updated note' });
async function mount(failBootstrap = false) {
  const fixture = createLocalFixture();
  await fixture.repository.upsertDayNote({ ...draft(), id: 'existing-note', quickMemo: 'old note', updatedAt: STAMP });
  await fixture.repository.upsertDayNote({ ...draft(), date: '2022-02-02', id: 'historical-note', quickMemo: 'keep history', updatedAt: STAMP });
  boundary.repository = { ...fixture.repository };
  const reads = spyPlannerReads(boundary.repository);
  if (failBootstrap) reads.getActuals.mockRejectedValueOnce(new Error('bootstrap failed'));
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.bootstrapPlannerData('owner').catch(() => undefined); });
  return { ...fixture, reads };
}
it('skips only notes, exposes unread null and preserves explicit full refresh', async () => {
  const { reads, repository } = await mount();
  for (const name of plannerFullReadMethods) expect(reads[name], name).toHaveBeenCalledTimes(name === 'getDayNotes' ? 0 : 1);
  expect(state.dayNotes).toBeNull(); expect(state.currentDayNote).toBeNull(); expect(state.plannerDataAvailability.status).toBe('ready');
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(reads.getDayNotes).toHaveBeenCalledOnce(); expect(reads.getDayNotes).toHaveBeenLastCalledWith('owner', { requireServer: true }); expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
});
it('explicit lazy load only reads notes, performs no normalization and retains bootstrap identity', async () => {
  const { reads, repository } = await mount(); const bootstrap = state.bootstrapPlannerData;
  Object.values(reads).forEach(read => read.mockClear()); const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await state.loadDayNotes(); });
  for (const [name, read] of Object.entries(reads)) expect(read, name).toHaveBeenCalledTimes(name === 'getDayNotes' ? 1 : 0);
  expect(normalize).not.toHaveBeenCalled(); expect(state.dayNotes).toEqual(await repository.getDayNotes('owner')); expect(state.bootstrapPlannerData).toBe(bootstrap);
});
it('shares first load/save outside the mutation ticket and retains existing ID/history after reload', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  reads.getDayNotes.mockImplementation(async owner => { entered.resolve(); await release.promise; return repository.getDayNotes(owner); });
  const write = vi.spyOn(boundary.repository, 'upsertDayNote'); let loading!: Promise<void[]>, saving!: Promise<void>;
  await act(async () => { loading = Promise.all([state.loadDayNotes(), state.loadDayNotes()]); saving = state.saveDayNote(draft()); await entered.promise; });
  expect(reads.getDayNotes).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
  await act(async () => { release.resolve(); await Promise.all([loading, saving]); });
  expect(write).toHaveBeenCalledOnce(); expect(write.mock.calls[0][0].id).toBe('existing-note');
  const stored = await repository.getDayNotes('owner'); expect(stored).toHaveLength(2); expect(stored.find(note => note.id === 'historical-note')?.quickMemo).toBe('keep history');
  expect(state.dayNotes?.slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(stored.slice().sort((a, b) => a.id.localeCompare(b.id))); await act(async () => { await state.loadPlannerData('owner'); }); expect(state.dayNotes?.slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(stored.slice().sort((a, b) => a.id.localeCompare(b.id)));
});
it('fails without writing, keeps requested scope through bootstrap and retries explicitly', async () => {
  const { repository, reads } = await mount(); const write = vi.spyOn(boundary.repository, 'upsertDayNote');
  reads.getDayNotes.mockRejectedValueOnce(new Error('denied'));
  await act(async () => { await expect(state.saveDayNote(draft())).rejects.toThrow('読み込めません'); });
  expect(write).not.toHaveBeenCalled(); expect(state.dayNotes).toBeNull(); expect(state.plannerDataRecovery?.phase).toBe('failed');
  await act(async () => { await state.bootstrapPlannerData('owner'); }); expect(reads.getDayNotes).toHaveBeenCalledTimes(2);
  expect(state.dayNotes).toEqual(await repository.getDayNotes('owner')); await act(async () => { await state.saveDayNote(draft()); }); expect(write.mock.calls[0][0].id).toBe('existing-note');
});
it('allows explicit lazy retry without replaying save', async () => {
  const { reads } = await mount(); reads.getDayNotes.mockRejectedValueOnce(new Error('offline')); const write = vi.spyOn(boundary.repository, 'upsertDayNote');
  await act(async () => { await expect(state.loadDayNotes()).rejects.toThrow('読み込めません'); });
  await act(async () => { await state.loadDayNotes(); }); expect(reads.getDayNotes).toHaveBeenCalledTimes(2); expect(write).not.toHaveBeenCalled(); expect(state.dayNotes).toHaveLength(2);
});
it.each(['owner', 'reset', 'unmount'] as const)('retires pending first save at %s without a write', async lifetime => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  reads.getDayNotes.mockImplementation(async owner => { entered.resolve(); await release.promise; return repository.getDayNotes(owner); });
  const write = vi.spyOn(boundary.repository, 'upsertDayNote'); let saving!: Promise<unknown>;
  await act(async () => { saving = state.saveDayNote(draft()).catch(error => error); await entered.promise; });
  await act(async () => { if (lifetime === 'owner') renderer!.update(<Harness owner="other" />); else if (lifetime === 'reset') state.resetPlannerData(); else { renderer!.unmount(); renderer = undefined; } });
  expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError); await act(async () => { release.resolve(); await microtasks(); }); expect(write).not.toHaveBeenCalled(); if (lifetime !== 'unmount') expect(state.dayNotes).toBeNull();
});
it('does not publish old A into a later A epoch', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  reads.getDayNotes.mockImplementationOnce(async owner => { entered.resolve(); const notes = await repository.getDayNotes(owner); await release.promise; return notes; }); let loading!: Promise<unknown>;
  await act(async () => { loading = state.loadDayNotes().catch(error => error); await entered.promise; });
  await act(async () => { renderer!.update(<Harness owner="other" />); }); await act(async () => { await state.bootstrapPlannerData('other'); });
  await act(async () => { renderer!.update(<Harness />); }); await act(async () => { await state.bootstrapPlannerData('owner'); });
  expect(await loading).toBeInstanceOf(PlannerMutationScopeExpiredError); await act(async () => { release.resolve(); await microtasks(); }); expect(state.dayNotes).toBeNull();
  await act(async () => { await state.loadDayNotes(); }); expect(state.dayNotes).toEqual(await repository.getDayNotes('owner'));
});
it('note-only success cannot mask failed initial full health or admit a repeated save', async () => {
  await mount(true); const write = vi.spyOn(boundary.repository, 'upsertDayNote');
  for (let attempt = 0; attempt < 2; attempt++) await act(async () => { await expect(state.saveDayNote(draft())).rejects.toThrow('読み込めません'); await microtasks(); });
  expect(state.plannerDataAvailability.status).toBe('unavailable'); expect(write).not.toHaveBeenCalled();
});

it('waits for an already-active writer before the first note query', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  boundary.repository.upsertTodo = async row => { entered.resolve(); await release.promise; return repository.upsertTodo(row); };
  let writing!: Promise<void>, loading!: Promise<void>;
  await act(async () => { writing = state.saveTodo(todo()); await entered.promise; loading = state.loadDayNotes(); await microtasks(); });
  expect(reads.getDayNotes).not.toHaveBeenCalled();
  await act(async () => { release.resolve(); await Promise.all([writing, loading]); });
  expect(reads.getDayNotes).toHaveBeenCalledOnce(); expect(state.dayNotes).toHaveLength(2);
});
it('discards a note read crossed by a mutation and waits for the fresh reread', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  reads.getDayNotes.mockImplementationOnce(async owner => { const rows = await repository.getDayNotes(owner); entered.resolve(); await release.promise; return rows; });
  let loaded = false, loading!: Promise<void>;
  await act(async () => { loading = state.loadDayNotes().then(() => { loaded = true; }); await entered.promise; });
  await repository.upsertDayNote({ ...draft(), id: 'existing-note', quickMemo: 'newer read', updatedAt: STAMP });
  await act(async () => { await state.saveTodo(todo()); }); expect(loaded).toBe(false);
  await act(async () => { release.resolve(); await loading; });
  expect(reads.getDayNotes).toHaveBeenCalledTimes(2); expect(state.dayNotes?.find(note => note.id === 'existing-note')?.quickMemo).toBe('newer read');
});
it('a newer full read can fulfill lazy demand but a retired lazy response cannot overwrite it', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  reads.getDayNotes.mockImplementationOnce(async owner => { const rows = await repository.getDayNotes(owner); entered.resolve(); await release.promise; return rows; });
  let loading!: Promise<void>;
  await act(async () => { loading = state.loadDayNotes(); await entered.promise; });
  await repository.upsertDayNote({ ...draft(), id: 'existing-note', quickMemo: 'newer full snapshot', updatedAt: STAMP });
  await act(async () => { await state.loadPlannerData('owner'); await loading; });
  const accepted = state.dayNotes;
  await act(async () => { release.resolve(); await microtasks(); });
  expect(state.dayNotes).toBe(accepted); expect(state.dayNotes?.find(note => note.id === 'existing-note')?.quickMemo).toBe('newer full snapshot');
});
it('union failure publishes no notes, and explicit lazy retry rearms all unresolved groups without resaving', async () => {
  const { repository, reads } = await mount(); const entered = deferred(), release = deferred();
  boundary.repository.upsertTodo = async row => { entered.resolve(); await release.promise; return repository.upsertTodo(row); };
  const put = vi.spyOn(boundary.repository, 'upsertTodo'); let writing!: Promise<void>, loading!: Promise<unknown>;
  await act(async () => { writing = state.saveTodo(todo()); await entered.promise; });
  await act(async () => { await state.bootstrapPlannerData('owner'); });
  reads.getActuals.mockRejectedValueOnce(new Error('union actual read failed'));
  await act(async () => { loading = state.loadDayNotes().catch(error => error); release.resolve(); await writing; await microtasks(); });
  expect(await loading).toBeInstanceOf(Error); expect(state.dayNotes).toBeNull(); expect(state.plannerDataRecovery?.phase).toBe('failed');
  Object.values(reads).forEach(read => read.mockClear()); const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await state.loadDayNotes(); });
  expect(state.dayNotes).toHaveLength(2); expect(state.plannerDataAvailability.status).toBe('ready'); expect(put).toHaveBeenCalledOnce(); expect(normalize).not.toHaveBeenCalled();
  for (const name of ['getDayNotes', 'getActuals', 'getStudyMaterials', 'getPlans', 'getTodos'] as const) expect(reads[name], name).toHaveBeenCalledOnce();
});
it('does not treat notes published by a nonquiescent first full read as save-ready', async () => {
  const { repository } = await mount(); const entered = deferred(), release = deferred();
  boundary.repository.upsertTodo = async row => { entered.resolve(); await release.promise; return repository.upsertTodo(row); };
  let writing!: Promise<void>, saving!: Promise<void>;
  await act(async () => { writing = state.saveTodo(todo()); await entered.promise; });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.dayNotes).toHaveLength(2); expect(state.plannerDataAvailability.status).toBe('stale');
  const put = vi.spyOn(boundary.repository, 'upsertDayNote');
  await act(async () => { saving = state.saveDayNote(draft()); await microtasks(); }); expect(put).not.toHaveBeenCalled();
  await act(async () => { release.resolve(); await Promise.all([writing, saving]); });
  expect(put).toHaveBeenCalledOnce(); expect(put.mock.calls[0][0].id).toBe('existing-note');
});


it('requires server authority on every deferred first-read route until accepted ready', async () => {
  const { reads } = await mount();
  reads.getDayNotes.mockRejectedValueOnce(new Error('offline first request'));
  await act(async () => { await expect(state.loadDayNotes()).rejects.toThrow(); });
  expect(reads.getDayNotes).toHaveBeenLastCalledWith('owner', { requireServer: true });
  reads.getDayNotes.mockRejectedValueOnce(new Error('offline full request'));
  await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow(); });
  expect(reads.getDayNotes).toHaveBeenLastCalledWith('owner', { requireServer: true });
  await act(async () => { await state.bootstrapPlannerData('owner'); });
  expect(reads.getDayNotes).toHaveBeenLastCalledWith('owner', { requireServer: true });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(reads.getDayNotes).toHaveBeenLastCalledWith('owner');
});
