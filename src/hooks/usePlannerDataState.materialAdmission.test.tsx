import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actual as makeActual, createLocalFixture, DATE, deferred, microtasks, plan as makePlan, STAMP,
} from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { Actual, ActualDraft, StudyMaterial, StudyMaterialDraft, StudySubject } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
import { PlannerMutationScopeExpiredError } from './usePlannerMutationScope';
import { MaterialMutationAdmissionError } from './useActualMutationAdmission';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const A = makePlan({ id: 'plan-a', seriesId: 'plan-a' });
const B = makePlan({ id: 'plan-b', seriesId: 'plan-b' });
const MATH: StudySubject = { id: 'math', userId: 'owner', name: 'Math', color: '#123456', createdAt: STAMP, updatedAt: STAMP };
const SCIENCE: StudySubject = { ...MATH, id: 'science', name: 'Science' };
const ONE: StudyMaterial = { id: 'one', userId: 'owner', name: 'First book', subjectId: MATH.id,
  subjectName: MATH.name, color: MATH.color, aliases: ['First'], status: 'active', paceEnabled: true,
  progressUnit: 'page', currentUnit: 10, totalUnits: 100, estimatedMinutesPerUnit: 2,
  maxUnitsPerDay: 20, createdAt: STAMP, updatedAt: STAMP };
const TWO: StudyMaterial = { ...ONE, id: 'two', name: 'Second book', aliases: ['Second'], currentUnit: 30 };
const THREE: StudyMaterial = { ...ONE, id: 'three', name: 'Science book', subjectId: SCIENCE.id, subjectName: SCIENCE.name, aliases: [] };
const STANDALONE = makeActual({ id: 'standalone', planId: null, materialProgressUpdates: [{ materialId: ONE.id, deltaUnits: 5 }] });
const LINKED = makeActual({ id: 'linked', planId: A.id, materialProgressUpdates: [{ materialId: ONE.id, deltaUnits: 5 }] });
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ owner = 'owner' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice });
  return null;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

function draft(ids: string[] = [ONE.id], overrides: Partial<ActualDraft> = {}): ActualDraft {
  return { userId: 'owner', planId: null, occurrenceDate: DATE, title: 'New study record', subject: 'Math',
    actualStartTime: '10:00', actualEndTime: '11:00', isAlignedToPlan: false, note: 'Preserve input',
    materialProgressUpdates: ids.map(materialId => ({ materialId, deltaUnits: 5 })), ...overrides };
}
function current(id = ONE.id) { return state.studyMaterials.find(material => material.id === id)!; }
async function remove(material = current()) {
  return state.deleteStudyMaterial(material, state.captureStudyMaterialBaseline(material));
}
function edit(material = current(), changes: Partial<StudyMaterialDraft> = {}) {
  return state.saveStudyMaterial({ ...material, ...changes }, material.id, state.captureStudyMaterialBaseline(material));
}
async function mount(materials = [ONE, TWO, THREE], actuals: Actual[] = [], load = true) {
  const fixture = createLocalFixture();
  for (const subject of [MATH, SCIENCE]) await fixture.repository.upsertStudySubject(subject);
  for (const plan of [A, B]) await fixture.repository.upsertPlan(plan);
  for (const material of materials) await fixture.repository.upsertStudyMaterial(material);
  for (const actual of actuals) await fixture.repository.upsertActual(actual);
  const saveActual = vi.fn(fixture.repository.upsertActualWithMaterialProgress);
  const saveMaterial = vi.fn(fixture.repository.upsertStudyMaterial);
  const deleteMaterial = vi.fn(fixture.repository.deleteStudyMaterial);
  const saveSubject = vi.fn(fixture.repository.upsertStudySubjectWithMaterials);
  boundary.repository = { ...fixture.repository, upsertActualWithMaterialProgress: saveActual,
    upsertStudyMaterial: saveMaterial, deleteStudyMaterial: deleteMaterial, upsertStudySubjectWithMaterials: saveSubject };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  if (load) await act(async () => { await state.loadPlannerData('owner'); });
  return { ...fixture, saveActual, saveMaterial, deleteMaterial, saveSubject };
}
// Controlled facade dispatch/response gates isolate same-owner hook admission.
// Admitted writes use the public local factory; these schedules do not claim
// native storage concurrency, cross-client exclusion, or backend transactions.
function hold(method: keyof PlannerRepository, afterPersist = false, everyCall = false) {
  const entered = deferred(), release = deferred();
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  let first = true;
  const dispatch = vi.fn(async (...args: unknown[]) => {
    if (!first && !everyCall) return original(...args);
    first = false;
    const saved = afterPersist ? await original(...args) : undefined;
    entered.resolve();
    await release.promise;
    return afterPersist ? saved : original(...args);
  });
  boundary.repository = { ...boundary.repository, [method]: dispatch };
  return { entered, release, dispatch,
    restore: () => { boundary.repository = { ...boundary.repository, [method]: original }; } };
}
const capture = (operation: Promise<unknown>) => operation.then(() => undefined, (error: unknown) => error);
async function start(operation: () => Promise<unknown>, gate: Pick<ReturnType<typeof hold>, 'entered'>) {
  let done!: Promise<unknown>;
  await act(async () => {
    done = capture(operation());
    const result = await Promise.race([gate.entered.promise.then(() => 'entered'), done]);
    expect(result, 'Expected the first operation to reach its facade dispatch').toBe('entered');
  });
  return { done };
}
// Projection retry starts detached work; its public promise may settle before
// the repair getter runs. Await the observed read, not the command promise.
async function startRepair(gate: Pick<ReturnType<typeof hold>, 'entered'>) {
  let done!: Promise<unknown>;
  await act(async () => { done = capture(state.retryPlannerData()); await gate.entered.promise; });
  return { done };
}
async function finish(gate: Pick<ReturnType<typeof hold>, 'release'>, done: Promise<unknown>, failure?: Error) {
  let result: unknown;
  await act(async () => {
    if (failure) gate.release.reject(failure); else gate.release.resolve();
    result = await done;
    await microtasks();
  });
  return result;
}
async function rejected(operation: () => Promise<unknown>) {
  let error: unknown;
  await act(async () => { error = await capture(operation()); });
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message.trim()).not.toBe('');
  return error as Error;
}
async function retainUndo(material = current()) {
  await act(async () => { await remove(material); });
  return offeredUndo();
}
function offeredUndo() {
  const callback = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  expect(callback).toBeTypeOf('function');
  return async () => { await callback!(); };
}
const sorted = <T extends { id: string }>(rows: T[]) => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
async function expectStored(fixture: Awaited<ReturnType<typeof mount>>, owner = 'owner') {
  expect(sorted(state.studyMaterials)).toEqual(sorted(await fixture.repository.getStudyMaterials(owner)));
  expect(sorted(state.actuals)).toEqual(sorted(await fixture.repository.getActuals(owner)));
}


describe('material writes require a canonical same-owner projection', () => {
  it.each(['progress-actual', 'subject', 'material'] as const)('rejects pre-load %s creation before dispatch', async action => {
    const fixture = await mount(undefined, [], false);
    const actualRead = vi.spyOn(boundary.repository, 'getActuals');
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
    const subjectRead = vi.spyOn(boundary.repository, 'getStudySubjects');
    const error = await rejected(() => action === 'progress-actual' ? state.saveStandaloneActual(draft())
      : action === 'subject' ? state.saveStudySubject({ ...MATH, name: 'Premature subject' })
      : state.saveStudyMaterial({ ...ONE, name: 'Premature material' }));
    if (action !== 'material') expect(error).toBeInstanceOf(MaterialMutationAdmissionError);
    expect(fixture.saveActual).not.toHaveBeenCalled();
    expect(fixture.saveSubject).not.toHaveBeenCalled();
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(actualRead).not.toHaveBeenCalled();
    expect(materialRead).not.toHaveBeenCalled();
    expect(subjectRead).not.toHaveBeenCalled();
    expect(state.actuals).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
  });

  it('rejects progress and subject/material creation between an owner render and its first load', async () => {
    const fixture = await mount();
    await act(async () => { renderer!.update(<Harness owner="other" />); });
    const error = await rejected(() => state.saveStandaloneActual(draft([ONE.id], { userId: 'other' })));
    expect(error).toBeInstanceOf(MaterialMutationAdmissionError);
    await rejected(() => state.saveStudySubject({ ...MATH, userId: 'other', name: 'New owner subject' }));
    await rejected(() => state.saveStudyMaterial({ ...ONE, userId: 'other', name: 'New owner material' }));
    expect(fixture.saveActual).not.toHaveBeenCalled();
    expect(fixture.saveSubject).not.toHaveBeenCalled();
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(await fixture.repository.getActuals('other')).toEqual([]);
    await act(async () => { await state.loadPlannerData('other'); });
    await act(async () => { await state.saveStandaloneActual(draft([ONE.id], { userId: 'other' })); });
    expect(fixture.saveActual).toHaveBeenCalledTimes(1);
    expect(state.actuals[0].userId).toBe('other');
  });

  it('does not impose the material pre-load guard on a progress-free standalone Actual', async () => {
    const fixture = await mount(undefined, [], false);
    await act(async () => { await state.saveStandaloneActual(draft([])); });
    expect(fixture.saveActual).toHaveBeenCalledTimes(1);
    expect(fixture.saveActual.mock.calls[0][0].materials).toEqual([]);
    expect(fixture.saveSubject).not.toHaveBeenCalled();
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
  });
});


describe('same-owner material dependencies', () => {
  it.each(['linked', 'standalone'] as const)('claims every %s Actual dependency atomically and leaves rejected disjoint keys free', async mode => {
    const fixture = await mount();
    const gate = hold('upsertActualWithMaterialProgress');
    const input = draft([ONE.id, TWO.id], { planId: mode === 'linked' ? A.id : null });
    const { done } = await start(() => mode === 'linked' ? state.saveActual(A, input) : state.saveStandaloneActual(input), gate);
    await rejected(() => state.saveStandaloneActual(draft([TWO.id, THREE.id])));
    expect(gate.dispatch).toHaveBeenCalledTimes(1);
    await act(async () => { await state.saveStandaloneActual(draft([THREE.id])); });
    expect(current(THREE.id).currentUnit).toBe(15);
    expect(await finish(gate, done)).toBeUndefined();
    expect(current(ONE.id).currentUnit).toBe(15);
    expect(current(TWO.id).currentUnit).toBe(35);
    expect(state.actuals).toHaveLength(2);
    await expectStored(fixture);
  });

  it.each([
    { reason: 'clamped', material: { ...ONE, currentUnit: ONE.totalUnits } },
    { reason: 'disabled', material: { ...ONE, paceEnabled: false } },
    { reason: 'missing', material: null },
  ])('claims the requested ID even when progress is $reason', async ({ material }) => {
    const fixture = await mount([...(material ? [material] : []), TWO, THREE]);
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveStandaloneActual(draft()), gate);
    expect(gate.dispatch.mock.calls[0][0]).toMatchObject({ materials: [] });
    await rejected(() => state.saveActual(B, draft([ONE.id], { planId: B.id })));
    expect(gate.dispatch).toHaveBeenCalledTimes(1);
    if (material) {
      await rejected(() => edit(current(), { name: 'Blocked rename' }));
      await rejected(() => remove());
      expect(fixture.saveMaterial).not.toHaveBeenCalled();
      expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    }
    expect(await finish(gate, done)).toBeUndefined();
    await expectStored(fixture);
  });

  it('pending Actual excludes absolute save, delete and member fanout but leaves unrelated materials usable', async () => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveStandaloneActual(draft()), gate);
    await rejected(() => state.saveStudyMaterial({ ...original, name: 'Stale absolute editor' }, original.id, baseline));
    await rejected(() => remove(original));
    await rejected(() => state.saveStudySubject({ ...MATH, name: 'Renamed math' }, MATH.id));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    expect(fixture.saveSubject).not.toHaveBeenCalled();
    await act(async () => { await edit(current(THREE.id), { name: 'Independent saved' }); });
    expect(await finish(gate, done)).toBeUndefined();
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    await rejected(() => remove(original));
    await act(async () => { await edit(current(), { name: 'Reopened saved' }); });
    expect(current().currentUnit).toBe(15);
    await expectStored(fixture);
  });

  it.each(['save', 'delete', 'undo', 'fanout'] as const)('pending material %s excludes overlapping new Actual only until settlement', async writer => {
    const fixture = await mount();
    const undo = writer === 'undo' ? await retainUndo() : undefined;
    const method = writer === 'delete' ? 'deleteStudyMaterial'
      : writer === 'fanout' ? 'upsertStudySubjectWithMaterials' : 'upsertStudyMaterial';
    const gate = hold(method);
    const { done } = await start(() => writer === 'save' ? edit(current(), { name: 'Saved book' })
      : writer === 'delete' ? remove()
      : writer === 'undo' ? undo!()
      : state.saveStudySubject({ ...MATH, name: 'Renamed math' }, MATH.id), gate);
    await rejected(() => state.saveStandaloneActual(draft()));
    if (writer === 'fanout') {
      await rejected(() => state.saveActual(B, draft([TWO.id], { planId: B.id })));
      await rejected(() => state.saveStudySubject({ ...MATH, name: 'Second rename' }, MATH.id));
    }
    expect(fixture.saveActual).not.toHaveBeenCalled();
    await act(async () => { await state.saveStandaloneActual(draft([THREE.id])); });
    expect(await finish(gate, done)).toBeUndefined();
    await act(async () => { await state.saveStandaloneActual(draft()); });
    expect(state.actuals).toHaveLength(2);
    await expectStored(fixture);
  });

  it('an absent material dependency excludes its retained Undo and can be retried after Actual settles', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveStandaloneActual(draft()), gate);
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(await finish(gate, done)).toBeUndefined();
    await act(async () => { await undo(); });
    expect(current().currentUnit).toBe(10);
    await expectStored(fixture);
  });

  it('rejects overlapping material writers before dispatch while a distinct save proceeds', async () => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    const gate = hold('upsertStudyMaterial');
    const { done } = await start(() => state.saveStudyMaterial({ ...original, name: 'First write' }, original.id, baseline), gate);
    await rejected(() => state.saveStudyMaterial({ ...original, name: 'Second write' }, original.id, baseline));
    await rejected(() => remove(original));
    expect(gate.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    await act(async () => { await edit(current(THREE.id), { name: 'Other write' }); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(current().name).toBe('First write');
    expect(current(THREE.id).name).toBe('Other write');
    await expectStored(fixture);
  });

  it.each(['standalone-edit', 'linked-edit', 'link', 'delete'] as const)('existing Actual %s neither claims nor adjusts material progress', async action => {
    const fixture = await mount(undefined, [STANDALONE, LINKED]);
    const gate = hold('upsertStudyMaterial');
    const { done } = await start(() => edit(current(), { currentUnit: 42 }), gate);
    await act(async () => {
      if (action === 'standalone-edit') await state.saveStandaloneActual(draft([ONE.id], { note: 'Edited' }), STANDALONE.id);
      else if (action === 'linked-edit') await state.saveActual(A, draft([ONE.id], { planId: A.id, note: 'Edited' }), LINKED.id);
      else if (action === 'link') await state.linkStandaloneActualToPlan(STANDALONE, B);
      else await state.deleteActual(STANDALONE);
    });
    for (const [mutation] of fixture.saveActual.mock.calls) expect(mutation.materials).toEqual([]);
    expect(await finish(gate, done)).toBeUndefined();
    expect(current().currentUnit).toBe(42);
    await expectStored(fixture);
  });

  it('a pending existing Actual edit leaves material saves free and cannot replay its progress delta', async () => {
    const fixture = await mount(undefined, [STANDALONE]);
    const gate = hold('upsertActualWithMaterialProgress');
    const { done } = await start(() => state.saveStandaloneActual(draft(), STANDALONE.id), gate);
    await act(async () => { await edit(current(), { currentUnit: 70 }); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(current().currentUnit).toBe(70);
    expect(fixture.saveActual.mock.calls[0][0].materials).toEqual([]);
    await expectStored(fixture);
  });

  it.each(['linked', 'standalone'] as const)('retained %s creation computes progress from the latest layout-committed material', async mode => {
    const fixture = await mount();
    const retained = state;
    await act(async () => { await edit(current(), { currentUnit: 60, totalUnits: 62, progressUnit: 'problem' }); });
    const input = draft([ONE.id], { planId: mode === 'linked' ? A.id : null });
    await act(async () => { await (mode === 'linked' ? retained.saveActual(A, input) : retained.saveStandaloneActual(input)); });
    expect(current()).toMatchObject({ currentUnit: 62, totalUnits: 62, progressUnit: 'problem' });
    expect(fixture.saveActual.mock.calls[0][0].materials[0]).toMatchObject({ currentUnit: 62, totalUnits: 62, progressUnit: 'problem' });
    await expectStored(fixture);
  });

  it('retained subject fanout snapshots current members without overwriting their latest progress', async () => {
    const fixture = await mount();
    const retained = state;
    await act(async () => { await edit(current(), { currentUnit: 55, progressUnit: 'problem' }); });
    await act(async () => { await retained.saveStudySubject({ ...MATH, name: 'New subject name' }, MATH.id); });
    expect(current()).toMatchObject({ currentUnit: 55, progressUnit: 'problem', subjectName: 'New subject name' });
    expect(current(TWO.id).subjectName).toBe('New subject name');
    expect(current(THREE.id).subjectName).toBe(SCIENCE.name);
    await expectStored(fixture);
  });

  it('serializes an empty subject by its own key while an unrelated subject rename proceeds', async () => {
    const fixture = await mount([THREE]);
    const gate = hold('upsertStudySubjectWithMaterials');
    const { done } = await start(() => state.saveStudySubject({ ...MATH, name: 'First math rename' }, MATH.id), gate);
    await rejected(() => state.saveStudySubject({ ...MATH, name: 'Second math rename' }, MATH.id));
    expect(gate.dispatch).toHaveBeenCalledTimes(1);
    await act(async () => { await state.saveStudySubject({ ...SCIENCE, name: 'New science name' }, SCIENCE.id); });
    expect(await finish(gate, done)).toBeUndefined();
    expect(state.studySubjects.find(subject => subject.id === MATH.id)?.name).toBe('First math rename');
    expect(current(THREE.id).subjectName).toBe('New science name');
    await expectStored(fixture);
  });

  it('a rejected fanout cannot partially claim its subject or unoccupied members', async () => {
    const fixture = await mount();
    const gate = hold('upsertStudyMaterial');
    const { done } = await start(() => edit(current(), { name: 'Busy first material' }), gate);
    await rejected(() => state.saveStudySubject({ ...MATH, name: 'Rejected rename' }, MATH.id));
    expect(fixture.saveSubject).not.toHaveBeenCalled();
    await act(async () => { await edit(current(TWO.id), { currentUnit: 50 }); });
    expect(await finish(gate, done)).toBeUndefined();
    await act(async () => { await state.saveStudySubject({ ...MATH, name: 'Reopened rename' }, MATH.id); });
    expect(current(TWO.id)).toMatchObject({ currentUnit: 50, subjectName: 'Reopened rename' });
    await expectStored(fixture);
  });
});


describe('absolute material edit baselines and expected-absence Undo', () => {
  it.each([
    ['name', { name: 'Changed elsewhere' }],
    ['aliases', { aliases: ['New alias'] }],
    ['metadata', { catalogTitle: 'New catalog metadata' }],
    ['progress', { currentUnit: 40 }],
    ['total', { totalUnits: 200 }],
    ['unit', { progressUnit: 'problem' as const }],
    ['pace toggle', { paceEnabled: false }],
    ['pace settings', { estimatedMinutesPerUnit: 9, maxUnitsPerDay: 3 }],
  ] satisfies Array<[string, Partial<StudyMaterial>]>)('rejects a stale %s baseline even when updatedAt is unchanged', async (_name, change) => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    const retained = state.saveStudyMaterial;
    await fixture.repository.upsertStudyMaterial({ ...original, ...change });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(() => state.captureStudyMaterialBaseline(original)).toThrow(MaterialMutationAdmissionError);
    await rejected(() => retained({ ...original, name: 'Stale dialog save' }, original.id, baseline));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(current()).toMatchObject(change);
    await expectStored(fixture);
  });

  it('requires the original immutable token for existing IDs while new creates need no baseline', async () => {
    const fixture = await mount();
    await rejected(() => state.saveStudyMaterial({ ...current(), name: 'No token' }, ONE.id));
    const forged = {} as ReturnType<UsePlannerDataStateResult['captureStudyMaterialBaseline']>;
    await rejected(() => state.saveStudyMaterial({ ...current(), name: 'Forged token' }, ONE.id, forged));
    const token = state.captureStudyMaterialBaseline(current());
    expect(Object.isFrozen(token)).toBe(true);
    await rejected(() => state.saveStudyMaterial({ ...current(TWO.id), name: 'Wrong target token' }, TWO.id, token));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    await act(async () => { await state.saveStudyMaterial({ ...ONE, name: 'New book' }); });
    expect(state.studyMaterials).toHaveLength(4);
    expect(fixture.saveMaterial).toHaveBeenCalledTimes(1);
  });

  it('does not turn a deleted existing target into a newly generated material', async () => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    await act(async () => { await remove(original); });
    await rejected(() => state.saveStudyMaterial({ ...original, name: 'Retained editor' }, original.id, baseline));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(state.studyMaterials).toHaveLength(2);
    await expectStored(fixture);
  });

  it.each(['original', 'clone', 'key-order', 'optional-undefined'] as const)('keeps an unchanged open edit usable after an equal full read (%s baseline)', async kind => {
    const fixture = await mount();
    const original = current();
    const snapshot = kind === 'original' ? original
      : kind === 'key-order' ? Object.fromEntries(Object.entries(original).reverse()) as unknown as StudyMaterial
      : kind === 'optional-undefined' ? { ...original, coverImageUrl: undefined }
      : { ...original, aliases: [...(original.aliases ?? [])] };
    const baseline = state.captureStudyMaterialBaseline(snapshot);
    const retainedSave = state.saveStudyMaterial;
    const openDraft = { ...original, name: 'Unsaved open editor', currentUnit: 22 };
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toEqual(original);
    expect(current()).not.toBe(original);
    expect(() => state.captureStudyMaterialBaseline(snapshot)).not.toThrow();
    await act(async () => { await retainedSave(openDraft, original.id, baseline); });
    expect(fixture.saveMaterial).toHaveBeenCalledTimes(1);
    expect(current()).toMatchObject({ name: 'Unsaved open editor', currentUnit: 22 });
    await expectStored(fixture);
  });

  it('treats reordered alias values as changed material content', async () => {
    const fixture = await mount([{ ...ONE, aliases: ['First', 'Second'] }, TWO, THREE]);
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    await fixture.repository.upsertStudyMaterial({ ...original, aliases: ['Second', 'First'] });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(() => state.captureStudyMaterialBaseline(original)).toThrow(MaterialMutationAdmissionError);
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(current().aliases).toEqual(['Second', 'First']);
    await expectStored(fixture);
  });

  it('accepts a retained original delete snapshot after an equal-content full reread', async () => {
    const fixture = await mount();
    const original = current();
    const retainedDelete = state.deleteStudyMaterial;
    const baseline = state.captureStudyMaterialBaseline(original);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toEqual(original);
    expect(current()).not.toBe(original);
    await act(async () => { await retainedDelete(original, baseline); });
    expect(fixture.deleteMaterial).toHaveBeenCalledTimes(1);
    expect(fixture.deleteMaterial).toHaveBeenCalledWith('owner', original.id);
    expect(current()).toBeUndefined();
    await expectStored(fixture);
  });

  it('rejects a material deletion without its edit-session baseline before dispatch', async () => {
    const fixture = await mount();
    const original = current();
    await rejected(() => state.deleteStudyMaterial(original));
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    expect(current()).toBe(original);
    await act(async () => { await remove(original); });
    expect(fixture.deleteMaterial).toHaveBeenCalledTimes(1);
    expect(current()).toBeUndefined();
    await expectStored(fixture);
  });

  it.each(['same-owner reset', 'observed absence and equal restoration'] as const)('rejects a retained Delete token after %s through the latest callback', async lifetime => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    if (lifetime === 'same-owner reset') {
      await act(async () => { state.resetPlannerData(); });
      await act(async () => { await state.loadPlannerData('owner'); });
    } else {
      await fixture.repository.deleteStudyMaterial('owner', original.id);
      await act(async () => { await state.loadPlannerData('owner'); });
      expect(current()).toBeUndefined();
      await fixture.repository.upsertStudyMaterial({ ...original });
      await act(async () => { await state.loadPlannerData('owner'); });
    }
    expect(current()).toEqual(original);
    expect(current()).not.toBe(original);
    await rejected(() => state.deleteStudyMaterial(original, baseline));
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    expect(current()).toEqual(original);
    await act(async () => { await remove(); });
    expect(fixture.deleteMaterial).toHaveBeenCalledTimes(1);
    expect(current()).toBeUndefined();
    await expectStored(fixture);
  });

  it('an equal present reread during deletion preserves the offered Undo after authoritative absence', async () => {
    const fixture = await mount();
    const original = current();
    const gate = hold('deleteStudyMaterial');
    const { done } = await start(() => remove(original), gate);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toEqual(original);
    expect(current()).not.toBe(original);
    expect(await finish(gate, done)).toBeUndefined();
    expect(current()).toBeUndefined();
    const undo = offeredUndo();
    // An equal absent reread is also harmless to the deletion's receipt.
    await act(async () => { await state.loadPlannerData('owner'); });
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).toHaveBeenCalledTimes(1);
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(false);
    expect(current()).toEqual(original);
    await expectStored(fixture);
  });

  it('a changed row observed during deletion invalidates its old Undo even after authoritative absence', async () => {
    const fixture = await mount();
    const original = current();
    const gate = hold('deleteStudyMaterial');
    const { done } = await start(() => remove(original), gate);
    await fixture.repository.upsertStudyMaterial({ ...original, name: 'Changed outside this deletion', currentUnit: 65 });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toMatchObject({ name: 'Changed outside this deletion', currentUnit: 65 });
    expect(await finish(gate, done)).toBeUndefined();
    expect(current()).toBeUndefined();
    const undo = offeredUndo();
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(current()).toBeUndefined();
    await expectStored(fixture);
  });

  it('an observed absent-present-absent cycle invalidates an unused Undo even when recreated content is equal', async () => {
    const fixture = await mount();
    const original = current();
    const undo = await retainUndo(original);
    await fixture.repository.upsertStudyMaterial({ ...original });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toEqual(original);
    await fixture.repository.deleteStudyMaterial('owner', original.id);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(current()).toBeUndefined();
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(current()).toBeUndefined();
    await expectStored(fixture);
  });

  it('a retained Undo cannot overwrite a material that reappeared with newer state', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    await fixture.repository.upsertStudyMaterial({ ...ONE, name: 'Newer row', currentUnit: 80 });
    await act(async () => { await state.loadPlannerData('owner'); });
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(current()).toMatchObject({ name: 'Newer row', currentUnit: 80 });
    await expectStored(fixture);
  });

  it('an old-owner token remains invalid after returning to the same owner', async () => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    const retained = state.saveStudyMaterial;
    await act(async () => { renderer!.update(<Harness owner="other" />); });
    await act(async () => { await state.loadPlannerData('other'); });
    await act(async () => { renderer!.update(<Harness />); });
    await act(async () => { await state.loadPlannerData('owner'); });
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    await rejected(() => retained(original, original.id, baseline));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    await act(async () => { await edit(current(), { name: 'Fresh owner editor' }); });
    await expectStored(fixture);
  });

  it.each(['reset', 'unmount'] as const)('%s invalidates old edit and Undo tokens even for the same owner', async lifetime => {
    const fixture = await mount();
    const original = current(TWO.id);
    const retained = state;
    const baseline = state.captureStudyMaterialBaseline(original);
    const undo = await retainUndo();
    if (lifetime === 'reset') await act(async () => { state.resetPlannerData(); });
    else {
      act(() => renderer!.unmount());
      renderer = undefined;
      await act(async () => { renderer = create(<Harness />); });
    }
    await act(async () => { await state.loadPlannerData('owner'); });
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    await rejected(() => retained.saveStudyMaterial(original, original.id, baseline));
    showNotice.mockClear();
    await act(async () => { await undo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
    expect(current(ONE.id)).toBeUndefined();
    await act(async () => { await edit(current(TWO.id), { name: 'New lifetime editor' }); });
    await expectStored(fixture);
  });

  it('a restore/delete ABA cannot revive a consumed expected-absence Undo token', async () => {
    const fixture = await mount();
    const oldUndo = await retainUndo();
    await act(async () => { await oldUndo(); });
    await act(async () => { await edit(current(), { name: 'New material state', currentUnit: 70 }); });
    const currentUndo = await retainUndo();
    fixture.saveMaterial.mockClear();
    showNotice.mockClear();
    await act(async () => { await oldUndo(); });
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(showNotice.mock.calls.some(call => call[1] === 'error')).toBe(true);
    expect(current()).toBeUndefined();
    await act(async () => { await currentUndo(); });
    expect(current()).toMatchObject({ name: 'New material state', currentUnit: 70 });
    await expectStored(fixture);
  });
});


describe('material admission settlement and authoritative repair', () => {
  it('publishes a real failed-compensation partial standalone create without claiming repaired progress or replaying it', async () => {
    const fixture = await mount();
    const materialFailure = new Error('Material write failed before persistence');
    const rollbackFailure = new Error('Actual rollback write failed');
    const writeActuals = fixture.gateway.writeActuals;
    const actualWrites = vi.spyOn(fixture.gateway, 'writeActuals')
      .mockImplementationOnce(rows => writeActuals(rows))
      .mockRejectedValueOnce(rollbackFailure);
    const materialWrites = vi.spyOn(fixture.gateway, 'writeStudyMaterials').mockRejectedValueOnce(materialFailure);
    let repositoryFailure: unknown;
    fixture.saveActual.mockImplementation(async mutation => {
      try { return await fixture.repository.upsertActualWithMaterialProgress(mutation); }
      catch (error) { repositoryFailure = error; throw error; }
    });
    const repair = hold('getActuals', true, true);
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
    let saving!: Promise<unknown>;
    await act(async () => {
      saving = capture(state.saveStandaloneActual(draft()));
      await repair.entered.promise;
    });
    // The public local repository reports failed compensation as its own Error.
    // The hook must preserve that exact rejection rather than replace it with
    // a repair outcome or pretend the partially persisted create was undone.
    expect(repositoryFailure).toBeInstanceOf(Error);
    expect((repositoryFailure as Error).message).toContain(rollbackFailure.message);
    expect(await saving).toBe(repositoryFailure);
    const persistedActuals = await fixture.repository.getActuals('owner');
    expect(persistedActuals).toHaveLength(1);
    expect(persistedActuals[0]).toMatchObject({ planId: null, materialProgressUpdates: [{ materialId: ONE.id, deltaUnits: 5 }] });
    expect((await fixture.repository.getStudyMaterials('owner')).find(material => material.id === ONE.id)?.currentUnit).toBe(10);
    expect(state.actuals).toEqual([]);
    await rejected(() => edit(current(), { name: 'Blocked until authoritative inspection' }));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(await finish(repair, saving)).toBe(repositoryFailure);
    expect(materialRead).toHaveBeenCalled();
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.actuals).toEqual(persistedActuals);
    expect(current().currentUnit).toBe(10);
    expect(fixture.saveActual).toHaveBeenCalledTimes(1);
    expect(actualWrites).toHaveBeenCalledTimes(2);
    expect(materialWrites).toHaveBeenCalledTimes(1);
    expect(showNotice.mock.calls.some(call => call[1] === 'success')).toBe(false);
    await expectStored(fixture);
  });

  it.each(['actual', 'save', 'delete', 'fanout'] as const)('unknown post-write %s rejection reads authoritative Actual/material data and preserves the original error', async writer => {
    const fixture = await mount();
    const method = writer === 'actual' ? 'upsertActualWithMaterialProgress' : writer === 'save' ? 'upsertStudyMaterial'
      : writer === 'delete' ? 'deleteStudyMaterial' : 'upsertStudySubjectWithMaterials';
    const gate = hold(method, true);
    const { done } = await start(() => writer === 'actual' ? state.saveStandaloneActual(draft())
      : writer === 'save' ? edit(current(), { currentUnit: 45 })
      : writer === 'delete' ? remove()
      : state.saveStudySubject({ ...MATH, name: 'Committed rename' }, MATH.id), gate);
    const actualRead = vi.spyOn(boundary.repository, 'getActuals');
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
    const failure = new Error('Acknowledgement lost after persistence');
    expect(await finish(gate, done, failure)).toBe(failure);
    expect(actualRead).toHaveBeenCalledTimes(1);
    expect(materialRead).toHaveBeenCalledTimes(1);
    expect(state.plannerDataRecovery).toBeNull();
    await expectStored(fixture);
    if (writer === 'fanout') {
      expect(state.studySubjects.find(subject => subject.id === MATH.id)?.name).toBe('Committed rename');
    }
    // This is an explicit new command after inspection, not automatic replay
    // or a guarantee against duplicate standalone records after unknown outcomes.
    await act(async () => { await state.saveStandaloneActual(draft()); });
    await expectStored(fixture);
  });

  it('uncertain multi-material Actual keeps every dependency busy through failed repair', async () => {
    const fixture = await mount();
    const gate = hold('upsertActualWithMaterialProgress', true);
    const { done } = await start(() => state.saveStandaloneActual(draft([ONE.id, TWO.id])), gate);
    vi.spyOn(boundary.repository, 'getActuals').mockRejectedValueOnce(new Error('Actual repair offline'));
    const failure = new Error('Actual acknowledgement lost');
    expect(await finish(gate, done, failure)).toBe(failure);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    await rejected(() => edit(current(ONE.id), { name: 'First stale write' }));
    await rejected(() => edit(current(TWO.id), { name: 'Second stale write' }));
    await rejected(() => remove(current(TWO.id)));
    expect(fixture.saveMaterial).not.toHaveBeenCalled();
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    await act(async () => { await edit(current(THREE.id), { name: 'Independent write' }); });
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plannerDataRecovery).toBeNull();
    expect(current(ONE.id).currentUnit).toBe(15);
    expect(current(TWO.id).currentUnit).toBe(35);
    expect(state.actuals).toHaveLength(1);
    await act(async () => { await edit(current(TWO.id), { name: 'Reopened second' }); });
    await expectStored(fixture);
  });

  it.each(['getActuals', 'getStudyMaterials'] as const)('failed %s repair retains affected claims until retry and does not replace the original rejection', async failedGetter => {
    const fixture = await mount();
    const original = current();
    const baseline = state.captureStudyMaterialBaseline(original);
    const gate = hold('upsertStudyMaterial', true);
    const { done } = await start(() => edit(original, { currentUnit: 45 }), gate);
    const actualRead = vi.spyOn(boundary.repository, 'getActuals');
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
    (failedGetter === 'getActuals' ? actualRead : materialRead).mockRejectedValueOnce(new Error('Repair offline'));
    const failure = new Error('Material acknowledgement unavailable');
    expect(await finish(gate, done, failure)).toBe(failure);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(current().currentUnit).toBe(10);
    await rejected(() => state.saveStandaloneActual(draft()));
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    await rejected(() => remove(original));
    expect(fixture.saveActual).not.toHaveBeenCalled();
    expect(fixture.deleteMaterial).not.toHaveBeenCalled();
    await act(async () => { await edit(current(THREE.id), { name: 'Independent repair-time edit' }); });
    await rejected(() => state.saveStandaloneActual(draft()));
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(45);
    expect(actualRead).toHaveBeenCalledTimes(2);
    expect(materialRead).toHaveBeenCalledTimes(2);
    await rejected(() => state.saveStudyMaterial(original, original.id, baseline));
    await act(async () => { await state.saveStandaloneActual(draft()); });
    expect(current().currentUnit).toBe(50);
    await expectStored(fixture);
  });

  it('failed Undo repair retains the missing ID reservation until authoritative retry', async () => {
    const fixture = await mount();
    const undo = await retainUndo();
    const gate = hold('upsertStudyMaterial', true);
    const { done } = await start(undo, gate);
    vi.spyOn(boundary.repository, 'getStudyMaterials').mockRejectedValueOnce(new Error('Undo repair offline'));
    const failure = new Error('Undo acknowledgement unavailable');
    expect(await finish(gate, done, failure)).toBeUndefined();
    expect(showNotice.mock.calls.some(call => call[0] === failure.message && call[1] === 'error')).toBe(true);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    await rejected(() => state.saveStandaloneActual(draft()));
    await act(async () => { await state.retryPlannerData(); });
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(10);
    await act(async () => { await state.saveStandaloneActual(draft()); });
    expect(current().currentUnit).toBe(15);
    await expectStored(fixture);
  });

  it.each([false, true])('prior-owner material completion cannot publish or unlock the new owner (failure=%s)', async failOld => {
    const fixture = await mount();
    const oldGate = hold('upsertStudyMaterial');
    const { done: oldDone } = await start(() => edit(current(), { name: 'Old owner save' }), oldGate);
    const newFixture = createLocalFixture();
    await newFixture.repository.upsertStudySubject({ ...MATH, userId: 'other' });
    await newFixture.repository.upsertStudyMaterial({ ...ONE, userId: 'other', currentUnit: 20 });
    boundary.repository = { ...newFixture.repository };
    await act(async () => { renderer!.update(<Harness owner="other" />); });
    await act(async () => { await state.loadPlannerData('other'); });
    const newGate = hold('upsertStudyMaterial');
    const { done: newDone } = await start(() => edit(current(), { name: 'New owner save' }), newGate);
    showNotice.mockClear();
    const failure = new Error('Old owner save failed');
    expect(await finish(oldGate, oldDone, failOld ? failure : undefined)).toBeInstanceOf(PlannerMutationScopeExpiredError);
    expect(showNotice).not.toHaveBeenCalled();
    expect(current()).toMatchObject({ userId: 'other', currentUnit: 20 });
    await rejected(() => state.saveStandaloneActual(draft([ONE.id], { userId: 'other' })));
    expect(newGate.dispatch).toHaveBeenCalledTimes(1);
    expect(await finish(newGate, newDone)).toBeUndefined();
    expect(current()).toMatchObject({ userId: 'other', name: 'New owner save', currentUnit: 20 });
    await expectStored({ ...fixture, repository: newFixture.repository }, 'other');
  });
});


// Full-read response gates capture real repository snapshots before publication.
// The cross-product checks both read/write start orders and both completion
// orders without depending on local adapter callback timing.
describe('material claims across read authority lifetimes', () => {
  const crossings = (['material', 'actual'] as const).flatMap(writer => [false, true].flatMap(readFirst =>
    [false, true].map(readBeforeSettlement => ({ writer, readFirst, readBeforeSettlement }))));
  it.each(crossings)('$writer: read starts first=$readFirst, publishes before writer=$readBeforeSettlement', async ({ writer, readFirst, readBeforeSettlement }) => {
    const fixture = await mount();
    const writerGate = hold(writer === 'actual' ? 'upsertActualWithMaterialProgress' : 'upsertStudyMaterial');
    const run = () => writer === 'actual' ? state.saveStandaloneActual(draft()) : edit(current(), { currentUnit: 45 });
    let read!: ReturnType<typeof hold>;
    let loading!: Promise<unknown>;
    let done!: Promise<unknown>;
    if (readFirst) {
      read = hold('getActuals', true);
      ({ done: loading } = await start(() => state.loadPlannerData('owner'), read));
      await act(async () => { await microtasks(); });
      ({ done } = await start(run, writerGate));
    } else {
      ({ done } = await start(run, writerGate));
      read = hold('getActuals', true);
      ({ done: loading } = await start(() => state.loadPlannerData('owner'), read));
      await act(async () => { await microtasks(); });
    }
    expect(state.plannerDataAvailability.status).toBe('loading');
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials').mockRejectedValueOnce(new Error('Crossed material repair offline'));
    if (readBeforeSettlement) expect(await finish(read, loading)).toBeUndefined();
    expect(await finish(writerGate, done)).toBeUndefined();
    if (!readBeforeSettlement) {
      await rejected(() => state.saveStandaloneActual(draft()));
      await rejected(() => edit(current(), { name: 'Before old read returns' }));
      expect(await finish(read, loading)).toBeUndefined();
    }
    await act(async () => { await microtasks(); });
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(materialRead).toHaveBeenCalledTimes(1);
    await rejected(() => state.saveStandaloneActual(draft()));
    await rejected(() => edit(current(), { name: 'Before repair retry' }));
    await act(async () => { await edit(current(THREE.id), { name: 'Independent during repair' }); });
    const retryGate = hold('getStudyMaterials', true, true);
    const { done: retrying } = await startRepair(retryGate);
    await rejected(() => state.saveStandaloneActual(draft()));
    await rejected(() => edit(current(), { name: 'Before repair publication' }));
    expect(await finish(retryGate, retrying)).toBeUndefined();
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(writer === 'actual' ? 15 : 45);
    expect(state.actuals).toHaveLength(writer === 'actual' ? 1 : 0);
    await expectStored(fixture);
    await act(async () => { await edit(current(), { name: 'Reopened after repair' }); });
    await expectStored(fixture);
  });

  const supersessions = [false, true].flatMap(secondFails => [false, true].map(firstReturnsLast => ({ secondFails, firstReturnsLast })));
  it.each(supersessions)('superseding full read preserves material claim: current fails=$secondFails, old returns last=$firstReturnsLast', async ({ secondFails, firstReturnsLast }) => {
    const fixture = await mount();
    const retainedLoad = state.loadPlannerData;
    const writer = hold('upsertStudyMaterial');
    const { done } = await start(() => edit(current(), { currentUnit: 45 }), writer);
    const first = hold('getActuals', true);
    const { done: firstLoading } = await start(() => retainedLoad('owner'), first);
    expect(await finish(writer, done)).toBeUndefined();
    const second = hold('getActuals', true);
    const { done: secondLoading } = await start(() => retainedLoad('owner'), second);
    await act(async () => { await state.saveDayNote({ userId: 'owner', date: DATE, quickMemo: 'Make current full read nonquiescent',
      reflection: '', nextFocus: '', checkedPlan: false, checkedRecord: false, checkedReady: false }); });
    const repair = hold('getStudyMaterials', true, true);
    if (!firstReturnsLast) {
      expect(await finish(first, firstLoading)).toBeUndefined();
      await rejected(() => state.saveStandaloneActual(draft()));
    }
    const fullFailure = new Error('Current full read failed');
    expect(await finish(second, secondLoading, secondFails ? fullFailure : undefined)).toBe(secondFails ? fullFailure : undefined);
    await act(async () => { await repair.entered.promise; });
    await rejected(() => state.saveStandaloneActual(draft()));
    await rejected(() => edit(current(), { name: 'Before detached repair' }));
    await act(async () => {
      if (secondFails) repair.release.reject(new Error('Superseding repair offline')); else repair.release.resolve();
      await microtasks();
    });
    if (secondFails) {
      expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
      await rejected(() => state.saveStandaloneActual(draft()));
    } else expect(state.plannerDataRecovery).toBeNull();
    if (firstReturnsLast) {
      const snapshot = state.studyMaterials;
      expect(await finish(first, firstLoading)).toBeUndefined();
      expect(state.studyMaterials).toBe(snapshot);
      if (secondFails) await rejected(() => state.saveStandaloneActual(draft()));
    }
    if (secondFails) {
      repair.restore();
      await act(async () => { await state.retryPlannerData(); });
    }
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(45);
    await expectStored(fixture);
    await act(async () => { await edit(current(), { name: 'Current editor after supersession' }); });
    await expectStored(fixture);
  });

  it('a full read supersedes an in-flight repair without allowing its old material snapshot to publish', async () => {
    const fixture = await mount();
    const writer = hold('upsertStudyMaterial', true);
    const { done } = await start(() => edit(current(), { currentUnit: 45 }), writer);
    const repair = hold('getStudyMaterials', true);
    const failure = new Error('Unknown material save outcome');
    expect(await finish(writer, done, failure)).toBe(failure);
    await act(async () => { await repair.entered.promise; });
    await fixture.repository.upsertStudyMaterial({ ...ONE, currentUnit: 70, name: 'Later authoritative row' });
    const full = hold('getActuals', true);
    const { done: loading } = await start(() => state.loadPlannerData('owner'), full);
    await rejected(() => state.saveStandaloneActual(draft()));
    expect(await finish(full, loading)).toBeUndefined();
    await act(async () => { await microtasks(); });
    const newer = current();
    expect(newer).toMatchObject({ currentUnit: 70, name: 'Later authoritative row' });
    await act(async () => { repair.release.resolve(); await microtasks(); });
    expect(current()).toBe(newer);
    expect(state.plannerDataRecovery).toBeNull();
    await act(async () => { await edit(current(), { name: 'After authoritative supersession' }); });
    await expectStored(fixture);
  });

  it('subject read failure prevents material-group publication and certification until all members retry', async () => {
    const fixture = await mount();
    const originalMaterials = state.studyMaterials;
    const writer = hold('upsertStudySubjectWithMaterials', true);
    const { done } = await start(() => state.saveStudySubject({ ...MATH, name: 'Persisted subject rename' }, MATH.id), writer);
    const subjectRead = vi.spyOn(boundary.repository, 'getStudySubjects').mockRejectedValueOnce(new Error('Subject repair offline'));
    const failure = new Error('Subject acknowledgement lost');
    expect(await finish(writer, done, failure)).toBe(failure);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(state.studyMaterials).toBe(originalMaterials);
    expect(state.studySubjects.find(subject => subject.id === MATH.id)?.name).toBe(MATH.name);
    await rejected(() => state.saveStandaloneActual(draft()));
    await rejected(() => state.saveStudySubject({ ...MATH, name: 'Blocked subject rename' }, MATH.id));
    await act(async () => { await state.saveStudySubject({ ...SCIENCE, name: 'Independent subject rename' }, SCIENCE.id); });
    const retry = hold('getStudySubjects', true, true);
    const { done: retrying } = await startRepair(retry);
    await rejected(() => state.saveStandaloneActual(draft([TWO.id])));
    expect(await finish(retry, retrying)).toBeUndefined();
    // The blocked retry-time command changes activity, so each superseding
    // repair must include Subjects again instead of borrowing the old receipt.
    expect(retry.dispatch.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(subjectRead).toHaveBeenCalledTimes(1 + retry.dispatch.mock.calls.length);
    expect(state.plannerDataRecovery).toBeNull();
    expect(current(ONE.id).subjectName).toBe('Persisted subject rename');
    expect(current(TWO.id).subjectName).toBe('Persisted subject rename');
    expect(state.studySubjects.find(subject => subject.id === MATH.id)?.name).toBe('Persisted subject rename');
    await expectStored(fixture);
    await act(async () => { await edit(current(), { name: 'Reopened after subject repair' }); });
    await expectStored(fixture);
  });
});


describe('selective subject repair dependencies', () => {
  it('does not request Subjects for an Actual-only authoritative repair', async () => {
    const fixture = await mount();
    const writer = hold('upsertActualWithMaterialProgress', true);
    const { done } = await start(() => state.saveStandaloneActual(draft()), writer);
    const subjectRead = vi.spyOn(boundary.repository, 'getStudySubjects');
    const failure = new Error('Actual-only acknowledgement unavailable');
    expect(await finish(writer, done, failure)).toBe(failure);
    expect(subjectRead).not.toHaveBeenCalled();
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(15);
    await expectStored(fixture);
  });

  it('a fanout settling during held Actual-only repair requires a fresh Subjects receipt', async () => {
    const fixture = await mount();
    const actualWriter = hold('upsertActualWithMaterialProgress', true);
    const { done: savingActual } = await start(() => state.saveStandaloneActual(draft()), actualWriter);
    const oldRepair = hold('getActuals', true);
    const subjectRead = vi.spyOn(boundary.repository, 'getStudySubjects');
    const actualFailure = new Error('Actual acknowledgement unavailable');
    expect(await finish(actualWriter, savingActual, actualFailure)).toBe(actualFailure);
    await act(async () => { await oldRepair.entered.promise; });
    expect(subjectRead).not.toHaveBeenCalled();
    const fanout = hold('upsertStudySubjectWithMaterials', true);
    const { done: renaming } = await start(() => state.saveStudySubject({ ...SCIENCE, name: 'Late science rename' }, SCIENCE.id), fanout);
    subjectRead.mockRejectedValueOnce(new Error('New subject dependency offline'));
    const subjectFailure = new Error('Fanout acknowledgement unavailable');
    expect(await finish(fanout, renaming, subjectFailure)).toBe(subjectFailure);
    await act(async () => { oldRepair.release.resolve(); await microtasks(); });
    expect(subjectRead).toHaveBeenCalledTimes(1);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(current().currentUnit).toBe(10);
    expect(current(THREE.id).subjectName).toBe(SCIENCE.name);
    await rejected(() => state.saveStandaloneActual(draft([ONE.id])));
    await rejected(() => state.saveStandaloneActual(draft([THREE.id])));
    await rejected(() => state.saveStudySubject({ ...SCIENCE, name: 'Uncertified rename' }, SCIENCE.id));
    await act(async () => { await state.retryPlannerData(); });
    expect(subjectRead).toHaveBeenCalledTimes(2);
    expect(state.plannerDataRecovery).toBeNull();
    expect(current().currentUnit).toBe(15);
    expect(current(THREE.id).subjectName).toBe('Late science rename');
    expect(state.studySubjects.find(subject => subject.id === SCIENCE.id)?.name).toBe('Late science rename');
    await expectStored(fixture);
  });

  it('a superseding nonquiescent full read retains the fanout Subjects requirement through failed repair', async () => {
    const fixture = await mount();
    const writer = hold('upsertStudySubjectWithMaterials');
    const { done } = await start(() => state.saveStudySubject({ ...MATH, name: 'Crossed math rename' }, MATH.id), writer);
    const oldRead = hold('getActuals', true);
    const { done: oldLoading } = await start(() => state.loadPlannerData('owner'), oldRead);
    expect(await finish(writer, done)).toBeUndefined();
    const newerRead = hold('getActuals', true);
    const { done: newerLoading } = await start(() => state.loadPlannerData('owner'), newerRead);
    await act(async () => { await state.saveDayNote({ userId: 'owner', date: DATE, quickMemo: 'Cross the new full read',
      reflection: '', nextFocus: '', checkedPlan: false, checkedRecord: false, checkedReady: false }); });
    const subjects = vi.spyOn(boundary.repository, 'getStudySubjects').mockRejectedValueOnce(new Error('Subject refresh unavailable'));
    expect(await finish(newerRead, newerLoading)).toBeUndefined();
    expect(subjects).toHaveBeenCalledTimes(1);
    expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
    await rejected(() => state.saveStandaloneActual(draft()));
    expect(await finish(oldRead, oldLoading)).toBeUndefined();
    await rejected(() => state.saveStandaloneActual(draft([TWO.id])));
    await act(async () => { await state.retryPlannerData(); });
    expect(subjects).toHaveBeenCalledTimes(2);
    expect(state.plannerDataRecovery).toBeNull();
    expect(state.studySubjects.find(subject => subject.id === MATH.id)?.name).toBe('Crossed math rename');
    expect(current().subjectName).toBe('Crossed math rename');
    await act(async () => { await edit(current(), { name: 'After all dependencies certified' }); });
    await expectStored(fixture);
  });

  it.each(['reset', 'owner-switch'] as const)('%s prevents a retired subject repair from clearing current fanout claims', async lifetime => {
    const fixture = await mount();
    const oldWriter = hold('upsertStudySubjectWithMaterials', true);
    const { done: oldDone } = await start(() => state.saveStudySubject({ ...MATH, name: 'Prior session rename' }, MATH.id), oldWriter);
    const oldRepair = hold('getStudySubjects', true);
    expect(await finish(oldWriter, oldDone, new Error('Prior session acknowledgement unavailable'))).toBeInstanceOf(Error);
    await act(async () => { await oldRepair.entered.promise; });
    const owner = lifetime === 'reset' ? 'owner' : 'other';
    const currentFixture = lifetime === 'reset' ? fixture : createLocalFixture();
    if (lifetime === 'reset') await act(async () => { state.resetPlannerData(); });
    else {
      await currentFixture.repository.upsertStudySubject({ ...MATH, userId: owner, name: 'Other owner Math' });
      await currentFixture.repository.upsertStudyMaterial({ ...ONE, userId: owner, subjectName: 'Other owner Math' });
      boundary.repository = { ...currentFixture.repository };
      await act(async () => { renderer!.update(<Harness owner={owner} />); });
    }
    await act(async () => { await state.loadPlannerData(owner); });
    const subject = state.studySubjects.find(subject => subject.id === MATH.id)!;
    const snapshot = state.studyMaterials;
    const newWriter = hold('upsertStudySubjectWithMaterials');
    const { done: newDone } = await start(() => state.saveStudySubject({ ...subject, name: 'Current held rename' }, subject.id), newWriter);
    showNotice.mockClear();
    await act(async () => { oldRepair.release.resolve(); await microtasks(); });
    expect(state.studyMaterials).toBe(snapshot);
    expect(showNotice).not.toHaveBeenCalled();
    await rejected(() => state.saveStandaloneActual(draft([ONE.id], { userId: owner })));
    expect(newWriter.dispatch).toHaveBeenCalledTimes(1);
    expect(await finish(newWriter, newDone)).toBeUndefined();
    expect(current().subjectName).toBe('Current held rename');
    expect(state.plannerDataRecovery).toBeNull();
    await expectStored({ ...fixture, repository: currentFixture.repository }, owner);
  });
});

it.each([
  { label: 'absolute toUnit precedence', update: { toUnit: 20, deltaUnits: 500 }, expected: 20 },
  { label: 'upper total bound', update: { toUnit: 200, deltaUnits: 1 }, expected: 100 },
  { label: 'lower zero bound', update: { deltaUnits: -500 }, expected: 0 },
])('retained Actual dispatch preserves existing $label without inferring additive absolute intent', async ({ update, expected }) => {
  const fixture = await mount();
  const retained = state.saveStandaloneActual;
  await act(async () => { await edit(current(), { currentUnit: 75 }); });
  await act(async () => {
    await retained(draft([], { materialProgressUpdates: [{ materialId: ONE.id, fromUnit: 10, ...update }] }));
  });
  expect(current().currentUnit).toBe(expected);
  await expectStored(fixture);
});
