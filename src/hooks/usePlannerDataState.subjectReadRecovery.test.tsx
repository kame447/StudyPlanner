import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalFixture, deferred, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { StudySubject } from '../types/domain';
import type { ShowNotice } from './useNoticeState';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const SUBJECT: StudySubject = { id: 'subject', userId: 'owner', name: 'Original', color: '#123456', createdAt: STAMP, updatedAt: STAMP };
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ owner = 'owner' }: { owner?: string }) { state = usePlannerDataState({ userId: owner, showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
async function mount() {
  const fixture = createLocalFixture();
  await fixture.repository.upsertStudySubject(SUBJECT);
  boundary.repository = { ...fixture.repository };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
it('late empty-Subject delete acknowledgement preserves a newer accepted subject', async () => {
  const { repository } = await mount();
  const persisted = deferred(), response = deferred();
  const remove = boundary.repository.deleteStudySubject;
  boundary.repository.deleteStudySubject = async (...args) => { await remove(...args); persisted.resolve(); await response.promise; };
  let saving!: Promise<void>;
  await act(async () => { saving = state.deleteStudySubject(SUBJECT); await persisted.promise; });
  const newer = { ...SUBJECT, name: 'Newer canonical subject' };
  await repository.upsertStudySubject(newer);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.studySubjects).toEqual([newer]);
  await act(async () => { response.resolve(); await saving; await microtasks(); });
  expect(await repository.getStudySubjects('owner')).toEqual([newer]);
  expect(state.studySubjects).toEqual([newer]);
});
it('late empty-Subject Undo acknowledgement preserves a newer accepted subject', async () => {
  const { repository } = await mount();
  await act(async () => { await state.deleteStudySubject(SUBJECT); });
  const undo = [...showNotice.mock.calls].reverse().find(call => call[2]?.onAction)?.[2]?.onAction;
  expect(undo).toBeTypeOf('function');
  const persisted = deferred(), response = deferred();
  const put = boundary.repository.upsertStudySubject;
  boundary.repository.upsertStudySubject = async row => { const saved = await put(row); persisted.resolve(); await response.promise; return saved; };
  let saving!: Promise<void | unknown>;
  await act(async () => { saving = Promise.resolve(undo!()); await persisted.promise; });
  const newer = { ...SUBJECT, name: 'Newer canonical subject' };
  await repository.upsertStudySubject(newer);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.studySubjects).toEqual([newer]);
  await act(async () => { response.resolve(); await saving; await microtasks(); });
  expect(await repository.getStudySubjects('owner')).toEqual([newer]);
  expect(state.studySubjects).toEqual([newer]);
});
it('full read captured before empty-Subject deletion cannot finish ready with the deleted subject', async () => {
  const { repository } = await mount();
  const captured = deferred(), response = deferred();
  const get = boundary.repository.getStudySubjects;
  let first = true;
  boundary.repository.getStudySubjects = async owner => { const rows = await get(owner); if (first) { first = false; captured.resolve(); await response.promise; } return rows; };
  let loading!: Promise<void>;
  await act(async () => { loading = state.loadPlannerData('owner'); await captured.promise; });
  await act(async () => { await state.deleteStudySubject(SUBJECT); });
  expect(await repository.getStudySubjects('owner')).toEqual([]);
  await act(async () => { response.resolve(); await loading; await microtasks(); });
  expect(state.studySubjects).toEqual([]);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

function offeredUndo() {
  const action = [...showNotice.mock.calls].reverse().find(call => call[2]?.onAction)?.[2]?.onAction;
  expect(action).toBeTypeOf('function');
  return () => Promise.resolve(action!());
}
async function prepare(writer: 'delete' | 'undo') {
  const fixture = await mount();
  if (writer === 'delete') return { ...fixture, run: () => state.deleteStudySubject(SUBJECT) };
  await act(async () => { await state.deleteStudySubject(SUBJECT); });
  return { ...fixture, run: offeredUndo() };
}
function holdWrite(writer: 'delete' | 'undo', afterPersist = false) {
  const entered = deferred(), release = deferred();
  const name = writer === 'delete' ? 'deleteStudySubject' : 'upsertStudySubject';
  const original = boundary.repository[name] as (...args: unknown[]) => Promise<unknown>;
  const dispatch = vi.fn(async (...args: unknown[]) => {
    const result = afterPersist ? await original(...args) : undefined;
    entered.resolve(); await release.promise;
    return afterPersist ? result : original(...args);
  });
  boundary.repository = { ...boundary.repository, [name]: dispatch };
  return { entered, release, dispatch };
}
async function start(run: () => Promise<unknown>, entered: Promise<void>) {
  let done!: Promise<unknown>;
  await act(async () => { done = run(); await entered; });
  return { done };
}

it.each(['delete', 'undo'] as const)('%s physically completing after refresh still converges to repository', async writer => {
  const fixture = await prepare(writer);
  const gate = holdWrite(writer);
  const { done } = await start(fixture.run, gate.entered.promise);
  await act(async () => { await state.loadPlannerData('owner'); });
  const subjects = vi.spyOn(boundary.repository, 'getStudySubjects');
  await act(async () => { gate.release.resolve(); await done; await microtasks(); });
  expect(subjects).toHaveBeenCalledTimes(1);
  expect(state.studySubjects).toEqual(await fixture.repository.getStudySubjects('owner'));
  expect(state.studySubjects).toHaveLength(writer === 'delete' ? 0 : 1);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('full read captured before Subject Undo cannot publish ready without the restored subject', async () => {
  const fixture = await prepare('undo');
  const captured = deferred(), release = deferred();
  const get = boundary.repository.getStudySubjects;
  let first = true;
  boundary.repository.getStudySubjects = async owner => {
    const rows = await get(owner);
    if (first) { first = false; captured.resolve(); await release.promise; }
    return rows;
  };
  let loading!: Promise<void>;
  await act(async () => { loading = state.loadPlannerData('owner'); await captured.promise; });
  await act(async () => { await fixture.run(); });
  expect(await fixture.repository.getStudySubjects('owner')).toEqual([SUBJECT]);
  await act(async () => { release.resolve(); await loading; await microtasks(); });
  expect(state.studySubjects).toEqual([SUBJECT]);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['delete', 'undo'] as const)('uncontended %s does not add repair getters', async writer => {
  const fixture = await prepare(writer);
  const getters = ['getStudySubjects', 'getStudyMaterials', 'getActuals'] as const;
  const reads = getters.map(name => vi.spyOn(boundary.repository, name));
  await act(async () => { await fixture.run(); await microtasks(); });
  for (const read of reads) expect(read).not.toHaveBeenCalled();
  expect(state.studySubjects).toEqual(await fixture.repository.getStudySubjects('owner'));
});

it.each(['delete', 'undo'] as const)('%s repair failure keeps successful write separate and retry is read-only', async writer => {
  const fixture = await prepare(writer);
  const gate = holdWrite(writer, true);
  const { done } = await start(fixture.run, gate.entered.promise);
  await act(async () => { await state.loadPlannerData('owner'); });
  const subjects = vi.spyOn(boundary.repository, 'getStudySubjects').mockRejectedValueOnce(new Error('Subject read failed'));
  showNotice.mockClear();
  await act(async () => { gate.release.resolve(); await expect(done).resolves.toBeUndefined(); await microtasks(); });
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(state.plannerDataAvailability.status).not.toBe('ready');
  expect(showNotice.mock.calls.some(call => call[0] === (writer === 'delete' ? '削除しました' : '元に戻しました。'))).toBe(true);
  const storageWrites = vi.spyOn(fixture.storage, 'setItem');
  const normalization = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await state.retryPlannerData(); await microtasks(); });
  expect(subjects).toHaveBeenCalledTimes(2);
  expect(gate.dispatch).toHaveBeenCalledTimes(1);
  expect(storageWrites).not.toHaveBeenCalled();
  expect(normalization).not.toHaveBeenCalled();
  expect(state.studySubjects).toEqual(await fixture.repository.getStudySubjects('owner'));
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['delete', 'undo'] as const)('%s rejection after persistence repairs surviving data without replay', async writer => {
  const fixture = await prepare(writer);
  const gate = holdWrite(writer, true);
  let done!: Promise<unknown>;
  await act(async () => { done = fixture.run().catch(error => error); await gate.entered.promise; });
  const subjects = vi.spyOn(boundary.repository, 'getStudySubjects');
  const failure = new Error('Acknowledgement lost');
  await act(async () => { gate.release.reject(failure); await done; await microtasks(); });
  expect(subjects).toHaveBeenCalledTimes(1);
  expect(gate.dispatch).toHaveBeenCalledTimes(1);
  expect(state.studySubjects).toEqual(await fixture.repository.getStudySubjects('owner'));
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(showNotice.mock.calls.some(call => call[0] === failure.message && call[1] === 'error')).toBe(true);
});

it('retained Undo refuses an already observed same-ID replacement before writing', async () => {
  const { repository } = await mount();
  const gate = holdWrite('delete', true);
  const { done } = await start(() => state.deleteStudySubject(SUBJECT), gate.entered.promise);
  const newer = { ...SUBJECT, name: 'Replacement must survive' };
  await repository.upsertStudySubject(newer);
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { gate.release.resolve(); await done; await microtasks(); });
  const undo = offeredUndo();
  const put = vi.spyOn(boundary.repository, 'upsertStudySubject');
  await act(async () => { await undo(); });
  expect(put).not.toHaveBeenCalled();
  expect(await repository.getStudySubjects('owner')).toEqual([newer]);
  expect(state.studySubjects).toEqual([newer]);
  expect(showNotice.mock.calls[showNotice.mock.calls.length - 1]?.[1]).toBe('error');
});

it('same-subject commands remain excluded through failed repair while unrelated subject save works', async () => {
  const { repository } = await mount();
  const gate = holdWrite('delete');
  const { done } = await start(() => state.deleteStudySubject(SUBJECT), gate.entered.promise);
  const write = vi.spyOn(boundary.repository, 'upsertStudySubjectWithMaterials');
  await act(async () => { await expect(state.saveStudySubject({ ...SUBJECT, name: 'Conflicting' }, SUBJECT.id)).rejects.toThrow(); });
  await act(async () => { await state.loadPlannerData('owner'); });
  vi.spyOn(boundary.repository, 'getStudySubjects').mockRejectedValueOnce(new Error('Repair unavailable'));
  await act(async () => { gate.release.resolve(); await done; await microtasks(); });
  expect(state.studySubjects).toEqual([SUBJECT]);
  await act(async () => { await expect(state.saveStudySubject({ ...SUBJECT, name: 'Still conflicting' }, SUBJECT.id)).rejects.toThrow(); });
  expect(write).not.toHaveBeenCalled();
  await act(async () => { await state.saveStudySubject({ ...SUBJECT, name: 'Independent', color: '#abcdef' }); });
  expect(write).toHaveBeenCalledTimes(1);
  expect(state.plannerDataRecovery?.phase).toBe('failed');
  await act(async () => { await state.retryPlannerData(); await microtasks(); });
  expect(state.studySubjects).toEqual(await repository.getStudySubjects('owner'));
  expect(state.studySubjects.map(subject => subject.name)).toEqual(['Independent']);
});

it.each(['absent', 'foreign-owner'] as const)('delete rejects %s targets before repository dispatch', async target => {
  const fixture = await mount();
  const remove = vi.spyOn(boundary.repository, 'deleteStudySubject');
  const row = target === 'absent' ? { ...SUBJECT, id: 'absent' } : { ...SUBJECT, userId: 'other' };
  await act(async () => { await expect(state.deleteStudySubject(row)).rejects.toThrow(); });
  expect(remove).not.toHaveBeenCalled();
  expect(await fixture.repository.getStudySubjects('owner')).toEqual([SUBJECT]);
});

it('retained delete resolves current material membership before dispatch', async () => {
  const { repository } = await mount();
  const retained = state.deleteStudySubject;
  await repository.upsertStudyMaterial({ id: 'material', userId: 'owner', name: 'Now present', subjectId: SUBJECT.id,
    subjectName: SUBJECT.name, color: SUBJECT.color, aliases: [], status: 'active', paceEnabled: false,
    progressUnit: 'page', currentUnit: 0, totalUnits: 20, estimatedMinutesPerUnit: undefined,
    maxUnitsPerDay: undefined, createdAt: STAMP, updatedAt: STAMP });
  await act(async () => { await state.loadPlannerData('owner'); });
  const remove = vi.spyOn(boundary.repository, 'deleteStudySubject');
  await act(async () => { await expect(retained(SUBJECT)).rejects.toThrow(/教材がある教科/); });
  expect(remove).not.toHaveBeenCalled();
  expect(await repository.getStudySubjects('owner')).toEqual([SUBJECT]);
});

it('delete Undo captures the current subject instead of an older caller row', async () => {
  const { repository } = await mount();
  const newer = { ...SUBJECT, name: 'Current name' };
  await repository.upsertStudySubject(newer);
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { await state.deleteStudySubject(SUBJECT); });
  const undo = offeredUndo();
  await act(async () => { await undo(); });
  expect(state.studySubjects).toEqual([newer]);
  expect(await repository.getStudySubjects('owner')).toEqual([newer]);
});

it.each([
  ['delete', 'owner'], ['delete', 'reset'], ['undo', 'owner'], ['undo', 'reset'],
] as const)('%s response after %s retirement cannot change current data or notices', async (writer, lifetime) => {
  const fixture = await prepare(writer);
  const gate = holdWrite(writer, true);
  let done!: Promise<unknown>;
  await act(async () => { done = fixture.run().catch(error => error); await gate.entered.promise; });
  const owner = lifetime === 'owner' ? 'other' : 'owner';
  const current = { ...SUBJECT, userId: owner, name: 'Current session subject' };
  await fixture.repository.upsertStudySubject(current);
  await act(async () => {
    if (lifetime === 'owner') renderer!.update(<Harness owner={owner} />);
    else state.resetPlannerData();
  });
  await act(async () => { await state.loadPlannerData(owner); });
  showNotice.mockClear();
  await act(async () => { gate.release.resolve(); await done; await microtasks(); });
  expect(state.studySubjects).toEqual([current]);
  expect(await fixture.repository.getStudySubjects(owner)).toEqual([current]);
  expect(showNotice).not.toHaveBeenCalled();
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['owner', 'reset'] as const)('retained Undo after %s retirement is inert', async lifetime => {
  const fixture = await prepare('undo');
  const owner = lifetime === 'owner' ? 'other' : 'owner';
  const current = { ...SUBJECT, userId: owner, name: 'Current session subject' };
  await fixture.repository.upsertStudySubject(current);
  await act(async () => {
    if (lifetime === 'owner') renderer!.update(<Harness owner={owner} />);
    else state.resetPlannerData();
  });
  await act(async () => { await state.loadPlannerData(owner); });
  const put = vi.spyOn(boundary.repository, 'upsertStudySubject');
  showNotice.mockClear();
  await act(async () => { await fixture.run(); });
  expect(put).not.toHaveBeenCalled();
  expect(showNotice).not.toHaveBeenCalled();
  expect(state.studySubjects).toEqual([current]);
  expect(await fixture.repository.getStudySubjects(owner)).toEqual([current]);
});

it.each([
  ['owner', 'success'], ['owner', 'failure'], ['reset', 'success'], ['reset', 'failure'],
] as const)('retired subject repair %s/%s cannot publish data or health', async (lifetime, outcome) => {
  const fixture = await mount();
  const writer = holdWrite('delete', true);
  const { done } = await start(() => state.deleteStudySubject(SUBJECT), writer.entered.promise);
  await act(async () => { await state.loadPlannerData('owner'); });
  const captured = deferred(), response = deferred();
  const get = boundary.repository.getStudySubjects;
  let first = true;
  boundary.repository.getStudySubjects = async owner => {
    const rows = await get(owner);
    if (first) { first = false; captured.resolve(); await response.promise; }
    return rows;
  };
  await act(async () => { writer.release.resolve(); await done; await captured.promise; });
  const owner = lifetime === 'owner' ? 'other' : 'owner';
  const current = { ...SUBJECT, userId: owner, name: 'Accepted after retirement' };
  await fixture.repository.upsertStudySubject(current);
  await act(async () => {
    if (lifetime === 'owner') renderer!.update(<Harness owner={owner} />);
    else state.resetPlannerData();
  });
  await act(async () => { await state.loadPlannerData(owner); });
  showNotice.mockClear();
  await act(async () => {
    if (outcome === 'failure') response.reject(new Error('Retired read failure'));
    else response.resolve();
    await microtasks();
  });
  expect(state.studySubjects).toEqual([current]);
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(state.plannerDataRecovery).toBeNull();
  expect(showNotice).not.toHaveBeenCalled();
  // The old repair also cannot strand the new session's subject claim.
  boundary.repository.deleteStudySubject = fixture.repository.deleteStudySubject;
  await act(async () => { await state.deleteStudySubject(current); });
  expect(state.studySubjects).toEqual([]);
});

it.each(['success', 'failure'] as const)('repair crossed by a later %s writer discards the captured subject snapshot', async outcome => {
  const fixture = await mount();
  const remove = holdWrite('delete', true);
  const { done } = await start(() => state.deleteStudySubject(SUBJECT), remove.entered.promise);
  await act(async () => { await state.loadPlannerData('owner'); });
  const captured = deferred(), response = deferred();
  const get = boundary.repository.getStudySubjects;
  let first = true;
  const reads = vi.fn(async (owner: string) => {
    const rows = await get(owner);
    if (first) { first = false; captured.resolve(); await response.promise; }
    return rows;
  });
  boundary.repository.getStudySubjects = reads;
  await act(async () => { remove.release.resolve(); await done; await captured.promise; });
  const entered = deferred(), release = deferred();
  const put = boundary.repository.upsertStudySubjectWithMaterials;
  boundary.repository.upsertStudySubjectWithMaterials = async input => {
    const result = await put(input); entered.resolve(); await release.promise; return result;
  };
  let newer!: Promise<unknown>;
  await act(async () => {
    newer = state.saveStudySubject({ ...SUBJECT, name: 'Later subject' }).catch(error => error);
    await entered.promise;
  });
  await act(async () => { response.resolve(); await microtasks(); });
  expect(state.plannerDataAvailability.status).not.toBe('ready');
  await act(async () => {
    if (outcome === 'failure') release.reject(new Error('Late save response failed'));
    else release.resolve();
    await newer; await microtasks();
  });
  expect(reads).toHaveBeenCalledTimes(2);
  expect(state.studySubjects).toEqual(await fixture.repository.getStudySubjects('owner'));
  expect(state.studySubjects.map(subject => subject.name)).toEqual(['Later subject']);
  expect(state.plannerDataAvailability.status).toBe('ready');
});
