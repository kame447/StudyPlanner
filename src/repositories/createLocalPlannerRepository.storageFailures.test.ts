import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../types/domain';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import {
  MemoryStorage,
  STAMP,
  actual,
  createLocalFixture,
  deferred,
  event,
  microtasks,
  mutation,
  pauseActualWrite,
  plan,
  todo,
} from './localPersistenceConcurrency.testUtils';

vi.mock('../lib/firebaseConfig', () => ({ isFirebaseEnabled: () => false }));
vi.mock('./firebaseRepositories', () => ({
  createFirebaseRepositories: () => {
    throw new Error('The local production branch must not select Firebase');
  },
}));

afterEach(() => vi.unstubAllGlobals());

const EVENTS = 'studyplanner.scheduleEvents.v1';
const ACTUALS = 'studyplanner.actuals';
const TODOS = 'studyplanner.todos.v1';
const MIGRATIONS = 'studyplanner.scheduleEventMigrations.v1';
const MATERIALS = 'studyplanner.studyMaterials.v1';

class OneShotFaultStorage extends MemoryStorage {
  failKey: string | undefined;
  readonly failure = new Error('Synchronous Storage write failed');
  readonly writes: { key: string; failed: boolean }[] = [];

  override setItem(key: string, value: string): void {
    const failed = key === this.failKey;
    this.writes.push({ key, failed });
    if (failed) {
      this.failKey = undefined;
      throw this.failure;
    }
    super.setItem(key, value);
  }
}

describe('local planner production wiring and physical storage failures', () => {
  it('shares one queue through the production index, default factory, and explicit Storage factory', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', {
      localStorage: storage,
      location: { hostname: 'localhost' },
    });
    const explicit = createLocalFixture(storage);
    const { plannerRepository: fromIndex } = await import('./index');
    const fromDefault = createLocalPlannerRepository();
    await explicit.repository.getPlans('owner');
    const pause = pauseActualWrite(explicit.gateway);
    const restoring = explicit.repository.restorePlanWithDependents(mutation())
      .catch(error => error);
    await pause.entered.promise;

    let indexSaved = false;
    let defaultSaved = false;
    const indexWrite = fromIndex.upsertMonthEvent(event({ id: 'index', title: 'INDEX' }))
      .then(() => { indexSaved = true; });
    const defaultWrite = fromDefault.upsertTodo(todo({ id: 'default', title: 'DEFAULT' }))
      .then(() => { defaultSaved = true; });
    await microtasks();
    expect([indexSaved, defaultSaved]).toEqual([false, false]);

    const failure = new Error('Undo failed');
    pause.release.reject(failure);
    expect(await restoring).toBe(failure);
    await Promise.all([indexWrite, defaultWrite]);
    expect(await fromIndex.getPlans('owner')).toEqual([]);
    expect((await fromIndex.getMonthEvents('owner'))[0].title).toBe('INDEX');
    expect((await fromDefault.getTodos('owner'))[0].title).toBe('DEFAULT');
  });

  it.each([EVENTS, ACTUALS, TODOS])(
    'finishes compensation after setItem fails at %s before a queued unrelated save',
    async failKey => {
      const storage = new OneShotFaultStorage();
      const first = createLocalPlannerRepository(storage);
      const second = createLocalPlannerRepository(storage);
      await first.upsertMonthEvent(event());
      await first.upsertActual(actual({ id: 'prior', planId: null }));
      await first.upsertTodo(todo({ id: 'prior', status: 'open', scheduledPlanId: null }));
      const previousActuals = await first.getActuals('owner');
      const previousTodos = await first.getTodos('owner');
      storage.writes.length = 0;
      storage.failKey = failKey;

      const restoring = first.restorePlanWithDependents(mutation()).catch(error => error);
      const writing = second.upsertMonthEvent(event({ title: 'LATER' }));
      expect(await restoring).toBe(storage.failure);
      await writing;

      expect(await first.getPlans('owner')).toEqual([]);
      expect(await first.getActuals('owner')).toEqual(previousActuals);
      expect(await first.getTodos('owner')).toEqual(previousTodos);
      expect((await first.getMonthEvents('owner'))[0].title).toBe('LATER');
      expect(storage.writes.filter(write => write.failed)).toEqual([
        { key: failKey, failed: true },
      ]);
      // All three compensation writes finish before the later calendar save.
      expect(storage.writes.slice(-4)).toEqual([
        { key: EVENTS, failed: false },
        { key: ACTUALS, failed: false },
        { key: TODOS, failed: false },
        { key: EVENTS, failed: false },
      ]);
    },
  );

  it('evicts a failed migration, continues queued work, and retries the migration', async () => {
    const storage = new OneShotFaultStorage();
    const fixture = createLocalFixture(storage);
    await fixture.gateway.writePlans([plan()]);
    await fixture.gateway.writeMonthEvents([event()]);
    storage.failKey = MIGRATIONS;

    const reading = fixture.repository.getPlans('owner').catch(error => error);
    const later = fixture.repository.upsertActual(actual({ id: 'later', planId: null }));
    expect(await reading).toBe(storage.failure);
    await later;
    expect(JSON.parse(storage.getItem(EVENTS) ?? '[]')).toEqual([]);
    expect(JSON.parse(storage.getItem(MIGRATIONS) ?? '[]')).toEqual([]);

    expect((await fixture.repository.getPlans('owner'))[0].id).toBe('plan');
    expect((await fixture.repository.getMonthEvents('owner'))[0].id).toBe('event');
    expect((await fixture.repository.getActuals('owner'))[0].id).toBe('later');
    expect(storage.writes.filter(write => write.key === MIGRATIONS)).toEqual([
      { key: MIGRATIONS, failed: true },
      { key: MIGRATIONS, failed: false },
      { key: MIGRATIONS, failed: false },
    ]);
    expect((await fixture.gateway.readPlans())[0].id).toBe('plan');
    expect((await fixture.gateway.readMonthEvents())[0].title).toBe('Original event');
  });

  it('compensates a real Actual/material payload before a queued newer material save', async () => {
    const fixture = createLocalFixture();
    const originalMaterial: StudyMaterial = {
      id: 'material',
      userId: 'owner',
      name: 'Math book',
      subjectId: 'math',
      subjectName: 'Math',
      paceEnabled: true,
      currentUnit: 10,
      totalUnits: 100,
      progressUnit: 'page',
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    await fixture.repository.upsertStudyMaterial(originalMaterial);
    await fixture.repository.upsertActual(actual({ id: 'prior', planId: null }));
    const previousActuals = await fixture.repository.getActuals('owner');
    const entered = deferred();
    const release = deferred();
    const writeMaterials = fixture.gateway.writeStudyMaterials;
    const materialWrites: number[] = [];
    let first = true;
    fixture.gateway.writeStudyMaterials = async rows => {
      await writeMaterials(rows);
      materialWrites.push(JSON.parse(fixture.storage.getItem(MATERIALS) ?? '[]')[0].currentUnit);
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
    };
    const writing = fixture.repository.upsertActualWithMaterialProgress({
      actual: actual({
        id: 'compound-actual',
        planId: null,
        materialProgressUpdates: [{ materialId: 'material', deltaUnits: 10 }],
      }),
      materials: [{ ...originalMaterial, currentUnit: 20 }],
    }).catch(error => error);
    await entered.promise;
    expect(JSON.parse(fixture.storage.getItem(ACTUALS) ?? '[]')).toHaveLength(2);
    expect(JSON.parse(fixture.storage.getItem(MATERIALS) ?? '[]')[0].currentUnit).toBe(20);

    let saved = false;
    const newerMaterial = { ...originalMaterial, name: 'NEWER', currentUnit: 35 };
    const later = fixture.repository.upsertStudyMaterial(newerMaterial)
      .then(() => { saved = true; });
    await microtasks();
    expect(saved).toBe(false);
    const failure = new Error('Material acknowledgment failed after persistence');
    release.reject(failure);
    expect(await writing).toBe(failure);
    await later;

    expect(await fixture.repository.getActuals('owner')).toEqual(previousActuals);
    expect(await fixture.repository.getStudyMaterials('owner')).toEqual([newerMaterial]);
    expect(materialWrites).toEqual([20, 10, 35]);
  });
});
