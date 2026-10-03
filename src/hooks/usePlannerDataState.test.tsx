import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actual, ActualDraft, Plan, StudyMaterial, TimetableTerm, TodoTask } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const repository = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getActuals: vi.fn(),
  getDayNotes: vi.fn(),
  getMonthEvents: vi.fn(),
  getTodos: vi.fn(),
  getStudySubjects: vi.fn(),
  getStudyMaterials: vi.fn(),
  getScheduleTemplates: vi.fn(),
  getTimetableTerms: vi.fn(),
  getTimetablePeriods: vi.fn(),
  upsertTodo: vi.fn(),
  deleteTodo: vi.fn(),
  scheduleTodoPlan: vi.fn(),
  deletePlanWithDependents: vi.fn(),
  restorePlanWithDependents: vi.fn(),
  applyTimetableMutation: vi.fn(),
  upsertActualWithMaterialProgress: vi.fn<(mutation: { actual: Actual; materials: readonly StudyMaterial[] }) => Promise<Actual>>(),
}));

vi.mock('../repositories', () => ({ plannerRepository: repository }));

let latestState: UsePlannerDataStateResult | null = null;
const showNotice = vi.fn();

function Harness({ userId }: { userId: string | null }) {
  latestState = usePlannerDataState({ userId, showNotice });
  return null;
}

function readState(): UsePlannerDataStateResult {
  if (!latestState) throw new Error('planner state is not mounted');
  return latestState;
}

function studyMaterial(ownerId: string, name: string): StudyMaterial {
  return {
    id: `material-${ownerId}`,
    userId: ownerId,
    name,
    subjectId: `subject-${ownerId}`,
    subjectName: '数学',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function resetRepositoryMocks() {
  repository.getPlans.mockResolvedValue([]);
  repository.getActuals.mockResolvedValue([]);
  repository.getDayNotes.mockResolvedValue([]);
  repository.getMonthEvents.mockResolvedValue([]);
  repository.getTodos.mockResolvedValue([]);
  repository.getStudySubjects.mockResolvedValue([]);
  repository.getStudyMaterials.mockResolvedValue([]);
  repository.getScheduleTemplates.mockResolvedValue([]);
  repository.getTimetableTerms.mockResolvedValue([]);
  repository.getTimetablePeriods.mockResolvedValue([]);
  repository.upsertTodo.mockResolvedValue(undefined);
  repository.deleteTodo.mockResolvedValue(undefined);
  repository.scheduleTodoPlan.mockResolvedValue(undefined);
  repository.deletePlanWithDependents.mockResolvedValue(undefined);
  repository.restorePlanWithDependents.mockResolvedValue(undefined);
  repository.applyTimetableMutation.mockResolvedValue(undefined);
  repository.upsertActualWithMaterialProgress.mockImplementation(async ({ actual }) => actual);
}

describe('usePlannerDataState planner-data read authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestState = null;
    resetRepositoryMocks();
  });

  it('marks a successful empty load ready instead of unavailable', async () => {
    const renderer = create(<Harness userId="owner-a" />);

    await act(async () => {
      await readState().loadPlannerData('owner-a');
    });

    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
    expect(readState().studyMaterials).toEqual([]);
    renderer.unmount();
  });

  it('marks a first failed load unavailable instead of authoritative empty', async () => {
    const failure = new Error('plans unavailable');
    repository.getPlans.mockRejectedValueOnce(failure);
    const renderer = create(<Harness userId="owner-a" />);
    let caught: unknown;

    await act(async () => {
      try {
        await readState().loadPlannerData('owner-a');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBe(failure);
    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'unavailable',
      ownerId: 'owner-a',
      lastSuccessfulAt: null,
    });
    expect(readState().plans).toEqual([]);
    renderer.unmount();
  });

  it('returns to ready after retrying a failed initial load', async () => {
    const failure = new Error('temporary planner outage');
    repository.getPlans.mockRejectedValueOnce(failure);
    const renderer = create(<Harness userId="owner-a" />);

    await act(async () => {
      await expect(readState().loadPlannerData('owner-a')).rejects.toBe(failure);
    });
    expect(readState().plannerDataAvailability.status).toBe('unavailable');

    await act(async () => {
      await readState().loadPlannerData('owner-a');
    });

    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
    renderer.unmount();
  });

  it('keeps the last successful snapshot but marks it stale when refresh fails', async () => {
    const material = studyMaterial('owner-a', '数学の参考書');
    repository.getStudyMaterials.mockResolvedValue([material]);
    const renderer = create(<Harness userId="owner-a" />);

    await act(async () => {
      await readState().loadPlannerData('owner-a');
    });
    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
    expect(readState().studyMaterials).toEqual([material]);

    const failure = new Error('refresh unavailable');
    repository.getPlans.mockRejectedValueOnce(failure);
    let caught: unknown;
    await act(async () => {
      try {
        await readState().loadPlannerData('owner-a');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBe(failure);
    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'stale',
      ownerId: 'owner-a',
    });
    expect(readState().studyMaterials).toEqual([material]);
    renderer.unmount();
  });

  it('does not let an older same-owner load overwrite a newer snapshot', async () => {
    const olderMaterials = deferred<StudyMaterial[]>();
    const olderMaterial = studyMaterial('owner-a', '古い教材');
    const newerMaterial = {
      ...studyMaterial('owner-a', '新しい教材'),
      id: 'material-owner-a-newer',
    };
    repository.getStudyMaterials
      .mockReturnValueOnce(olderMaterials.promise)
      .mockResolvedValueOnce([newerMaterial]);
    const renderer = create(<Harness userId="owner-a" />);
    let olderLoad!: Promise<void>;

    await act(async () => {
      olderLoad = readState().loadPlannerData('owner-a');
      await Promise.resolve();
    });

    await act(async () => {
      await readState().loadPlannerData('owner-a');
    });
    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
    expect(readState().studyMaterials).toEqual([newerMaterial]);

    await act(async () => {
      olderMaterials.resolve([olderMaterial]);
      await olderLoad;
    });

    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
    expect(readState().studyMaterials).toEqual([newerMaterial]);
    renderer.unmount();
  });

  it('does not let an older owner load overwrite a newer owner snapshot', async () => {
    const oldOwnerMaterials = deferred<StudyMaterial[]>();
    const materialA = studyMaterial('owner-a', 'Aの教材');
    const materialB = studyMaterial('owner-b', 'Bの教材');
    repository.getStudyMaterials.mockImplementation((ownerId: string) =>
      ownerId === 'owner-a'
        ? oldOwnerMaterials.promise
        : Promise.resolve([materialB]),
    );
    const renderer = create(<Harness userId="owner-a" />);
    let oldOwnerLoad!: Promise<void>;

    await act(async () => {
      oldOwnerLoad = readState().loadPlannerData('owner-a');
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(<Harness userId="owner-b" />);
      await readState().loadPlannerData('owner-b');
    });
    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-b',
    });
    expect(readState().studyMaterials).toEqual([materialB]);

    await act(async () => {
      oldOwnerMaterials.resolve([materialA]);
      await oldOwnerLoad;
    });

    expect(readState().plannerDataAvailability).toMatchObject({
      status: 'ready',
      ownerId: 'owner-b',
    });
    expect(readState().studyMaterials).toEqual([materialB]);
    renderer.unmount();
  });

  it('invalidates an in-flight load when planner data is reset', async () => {
    const pendingMaterials = deferred<StudyMaterial[]>();
    const material = studyMaterial('owner-a', '遅延教材');
    repository.getStudyMaterials.mockReturnValueOnce(pendingMaterials.promise);
    const renderer = create(<Harness userId="owner-a" />);
    let pendingLoad!: Promise<void>;

    await act(async () => {
      pendingLoad = readState().loadPlannerData('owner-a');
      await Promise.resolve();
    });
    await act(async () => {
      readState().resetPlannerData();
    });
    expect(readState().plannerDataAvailability.status).toBe('idle');

    await act(async () => {
      pendingMaterials.resolve([material]);
      await pendingLoad;
    });

    expect(readState().plannerDataAvailability.status).toBe('idle');
    expect(readState().studyMaterials).toEqual([]);
    renderer.unmount();
  });
});

function legacyTerm(ownerId: string): TimetableTerm {
  return {
    id: `legacy-${ownerId}`, userId: ownerId, year: 2026, kind: 'fullYear',
    label: '旧ラベル', isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const studyPlan: Plan = {
  id: 'plan', seriesId: 'plan', userId: 'owner-a', title: '数学', subject: '数学',
  date: '2026-10-02', startTime: '09:00', endTime: '10:00', repeat: 'none',
  repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

function progressDraft(mode: 'linked' | 'standalone'): ActualDraft {
  return {
    userId: 'owner-a', planId: mode === 'linked' ? studyPlan.id : null,
    occurrenceDate: studyPlan.date, actualStartTime: '09:00', actualEndTime: '10:00',
    title: '数学', subject: '数学', isAlignedToPlan: mode === 'linked', note: '',
    materialProgressUpdates: [{ materialId: 'material-owner-a', deltaUnits: 5 }],
  };
}

function saveProgressActual(mode: 'linked' | 'standalone', draft: ActualDraft, targetActualId?: string) {
  return mode === 'linked'
    ? readState().saveActual(studyPlan, draft, targetActualId)
    : readState().saveStandaloneActual(draft, targetActualId);
}

describe('usePlannerDataState transform orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestState = null;
    resetRepositoryMocks();
  });

  it('keeps all original timetable collections when normalization persistence fails', async () => {
    const term = legacyTerm('owner-a');
    const template = {
      id: 'template', userId: 'owner-a', title: '数学', subject: '数学', type: 'study',
      weekday: 'mon', startTime: '09:00', endTime: '10:00', termId: term.id,
      memo: '', active: true, createdAt: term.createdAt, updatedAt: term.updatedAt,
    };
    const period = {
      id: 'period', userId: 'owner-a', termId: term.id, periodNumber: 1,
      label: '1限', startTime: '09:00', endTime: '10:00',
      createdAt: term.createdAt, updatedAt: term.updatedAt,
    };
    repository.getTimetableTerms.mockResolvedValue([term]);
    repository.getScheduleTemplates.mockResolvedValue([template]);
    repository.getTimetablePeriods.mockResolvedValue([period]);
    repository.applyTimetableMutation.mockRejectedValueOnce(new Error('normalization unavailable'));
    const renderer = create(<Harness userId="owner-a" />);

    await act(async () => { await readState().loadPlannerData('owner-a'); });

    expect(repository.applyTimetableMutation).toHaveBeenCalledWith(expect.objectContaining({
      termUpserts: [expect.objectContaining({ id: '2026-full-year' })],
      termDeletes: [term],
      templateUpserts: [expect.objectContaining({ termId: '2026-full-year' })],
      periodUpserts: [expect.objectContaining({ termId: '2026-full-year' })],
    }));
    expect(readState().timetableTerms).toEqual([term]);
    expect(readState().scheduleTemplates).toEqual([template]);
    expect(readState().timetablePeriods).toEqual([period]);
    expect(readState().plannerDataAvailability.status).toBe('ready');
    expect(showNotice).toHaveBeenCalledWith('時間割データを整合化できませんでした。再読み込みしてください。', 'error');
    renderer.unmount();
  });

  it.each(['success', 'failure'] as const)('ignores an old owner after pending normalization ends with %s', async (outcome) => {
    const pendingMutation = deferred<void>();
    repository.getTimetableTerms
      .mockResolvedValueOnce([legacyTerm('owner-a')])
      .mockResolvedValueOnce([legacyTerm('owner-b')]);
    repository.applyTimetableMutation.mockReturnValueOnce(pendingMutation.promise);
    const renderer = create(<Harness userId="owner-a" />);
    let oldLoad!: Promise<void>;

    await act(async () => {
      oldLoad = readState().loadPlannerData('owner-a');
      await Promise.resolve();
    });
    expect(repository.applyTimetableMutation).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.update(<Harness userId="owner-b" />);
      await readState().loadPlannerData('owner-b');
    });
    const newSnapshot = readState().timetableTerms;

    await act(async () => {
      if (outcome === 'success') pendingMutation.resolve();
      else pendingMutation.reject(new Error('old owner normalization failed'));
      await oldLoad;
    });

    expect(readState().timetableTerms).toBe(newSnapshot);
    expect(newSnapshot[0]).toMatchObject({ id: '2026-full-year', userId: 'owner-b' });
    expect(readState().plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: 'owner-b' });
    expect(showNotice).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it.each(['linked', 'standalone'] as const)('commits %s progress only after save and never reapplies it on edit', async (mode) => {
    const material = {
      ...studyMaterial('owner-a', '数学問題集'), paceEnabled: true,
      progressUnit: 'problem' as const, currentUnit: 10, totalUnits: 100,
    };
    repository.getStudyMaterials.mockResolvedValue([material]);
    const pendingSave = deferred<Actual>();
    repository.upsertActualWithMaterialProgress.mockReturnValueOnce(pendingSave.promise);
    const renderer = create(<Harness userId="owner-a" />);
    await act(async () => { await readState().loadPlannerData('owner-a'); });
    let saving!: Promise<void>;
    await act(async () => { saving = saveProgressActual(mode, progressDraft(mode)); });

    expect(readState().actuals).toHaveLength(1);
    expect(readState().studyMaterials).toEqual([material]);
    const mutation = repository.upsertActualWithMaterialProgress.mock.calls[0][0];
    expect(mutation.materials).toEqual([expect.objectContaining({ id: material.id, currentUnit: 15 })]);
    const savedActual = { ...mutation.actual, id: 'persisted-actual' };
    await act(async () => {
      pendingSave.resolve(savedActual);
      await saving;
    });

    expect(readState().actuals).toEqual([savedActual]);
    expect(readState().studyMaterials).toEqual(mutation.materials);
    await act(async () => {
      await saveProgressActual(mode, { ...progressDraft(mode), note: '追記' }, savedActual.id);
    });
    expect(repository.upsertActualWithMaterialProgress.mock.calls[1][0].materials).toEqual([]);
    expect(readState().studyMaterials[0].currentUnit).toBe(15);
    expect(readState().actuals[0].note).toBe('追記');
    renderer.unmount();
  });

  it.each(['linked', 'standalone'] as const)('rolls back failed %s creation and editing without changing material progress', async (mode) => {
    const material = {
      ...studyMaterial('owner-a', '数学問題集'), paceEnabled: true,
      progressUnit: 'problem' as const, currentUnit: 10, totalUnits: 100,
    };
    repository.getStudyMaterials.mockResolvedValue([material]);
    const renderer = create(<Harness userId="owner-a" />);
    await act(async () => { await readState().loadPlannerData('owner-a'); });
    const failure = new Error('actual save failed');
    repository.upsertActualWithMaterialProgress.mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(saveProgressActual(mode, progressDraft(mode))).rejects.toBe(failure);
    });
    expect(readState().actuals).toEqual([]);
    expect(readState().studyMaterials).toEqual([material]);

    await act(async () => { await saveProgressActual(mode, progressDraft(mode)); });
    const savedActual = readState().actuals[0];
    const savedMaterials = readState().studyMaterials;
    repository.upsertActualWithMaterialProgress.mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(saveProgressActual(mode, { ...progressDraft(mode), note: 'failed edit' }, savedActual.id)).rejects.toBe(failure);
    });
    expect(readState().actuals).toEqual([savedActual]);
    expect(readState().studyMaterials).toBe(savedMaterials);
    expect(showNotice).toHaveBeenLastCalledWith('actual save failed', 'error');
    renderer.unmount();
  });
});

describe('planner mutation owner isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestState = null;
    resetRepositoryMocks();
  });

  for (const mode of ['linked', 'standalone'] as const) {
    for (const transition of ['switch', 'reset', 'roundtrip'] as const) {
      it.each(['success', 'failure'] as const)(`${mode} ignores late %s UI effects after ${transition}`, async (outcome) => {
        const materialA = {
          ...studyMaterial('owner-a', 'A material'), paceEnabled: true,
          progressUnit: 'problem' as const, currentUnit: 10, totalUnits: 100,
        };
        repository.getStudyMaterials.mockResolvedValue([materialA]);
        const renderer = create(<Harness userId="owner-a" />);
        await act(async () => { await readState().loadPlannerData('owner-a'); });
        const pendingSave = deferred<Actual>();
        repository.upsertActualWithMaterialProgress.mockReturnValueOnce(pendingSave.promise);
        let settled!: Promise<unknown>;
        await act(async () => {
          settled = saveProgressActual(mode, progressDraft(mode)).catch(error => error);
        });
        const mutation = repository.upsertActualWithMaterialProgress.mock.calls[0][0];
        const nextOwner = transition === 'switch' ? 'owner-b' : 'owner-a';
        const newActual = { ...mutation.actual, id: 'current-owner-actual', userId: nextOwner };
        const newMaterial = studyMaterial(nextOwner, 'Current material');
        await act(async () => {
          if (transition === 'roundtrip') renderer.update(<Harness userId="owner-b" />);
          readState().resetPlannerData();
        });
        repository.getActuals.mockResolvedValue([newActual]);
        repository.getStudyMaterials.mockResolvedValue([newMaterial]);
        await act(async () => {
          renderer.update(<Harness userId={nextOwner} />);
          await readState().loadPlannerData(nextOwner);
        });
        showNotice.mockClear();
        await act(async () => {
          if (outcome === 'success') pendingSave.resolve(mutation.actual);
          else pendingSave.reject(new Error('old owner save failed'));
          await settled;
        });
        expect(readState().actuals).toEqual([newActual]);
        expect(readState().studyMaterials).toEqual([newMaterial]);
        expect(readState().plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: nextOwner });
        expect(showNotice).not.toHaveBeenCalled();
        renderer.unmount();
      });
    }
  }
});


describe('usePlannerDataState overlapping Todo mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestState = null;
    resetRepositoryMocks();
  });

  it.each(['save', 'delete'].flatMap(operation => ['update', 'create', 'delete'].map(newer => [operation, newer])))('does not roll back another Todo after older %s fails and newer %s succeeds', async (operation, newer) => {
    const todo = (id: string): TodoTask => ({
      id, userId: 'owner-a', title: id, subject: '', type: 'study',
      estimatedMinutes: null, dueDate: null, memo: '', status: 'open',
      scheduledPlanId: null, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    });
    const first = todo('first');
    const second = todo('second');
    repository.getTodos.mockResolvedValue([first, second]);
    const renderer = create(<Harness userId="owner-a" />);
    await act(async () => { await readState().loadPlannerData('owner-a'); });
    const pending = deferred<void>();
    if (operation === 'save') repository.upsertTodo.mockReturnValueOnce(pending.promise);
    else repository.deleteTodo.mockReturnValueOnce(pending.promise);
    let failed!: Promise<unknown>;
    await act(async () => {
      failed = (operation === 'save'
        ? readState().saveTodo({ ...first, title: 'first pending' }, first.id)
        : readState().deleteTodo(first)).catch((error: unknown) => error);
    });
    await act(async () => {
      if (newer === 'delete') await readState().deleteTodo(second);
      else await readState().saveTodo({ ...second, title: 'second saved' }, newer === 'update' ? second.id : undefined);
    });
    const expectedOthers = readState().todos.filter(item => item.id !== first.id);
    const failure = new Error('first failed');
    await act(async () => { pending.reject(failure); expect(await failed).toBe(failure); });
    expect(readState().todos.find((item) => item.id === first.id)).toEqual(first);
    expect(readState().todos.filter(item => item.id !== first.id)).toEqual(expectedOthers);
    renderer.unmount();
  });
  it.each(['schedule', 'delete-linked-plan'] as const)('preserves another Todo when %s fails', async operation => {
    const first: TodoTask = {
      id: 'linked', userId: 'owner-a', title: 'linked', subject: '', type: 'study',
      estimatedMinutes: null, dueDate: null, memo: '', status: 'open', scheduledPlanId: null,
      createdAt: studyPlan.createdAt, updatedAt: studyPlan.updatedAt,
    };
    if (operation === 'delete-linked-plan') {
      first.status = 'scheduled';
      first.scheduledPlanId = studyPlan.id;
    }
    const second = { ...first, id: 'other', title: 'other', status: 'open' as const, scheduledPlanId: null };
    const plan = { ...studyPlan, sourceType: 'todo' as const, sourceId: first.id };
    repository.getPlans.mockResolvedValue([plan]);
    repository.getTodos.mockResolvedValue([first, second]);
    const renderer = create(<Harness userId="owner-a" />);
    await act(async () => { await readState().loadPlannerData('owner-a'); });
    const pending = deferred<void>();
    if (operation === 'schedule') repository.scheduleTodoPlan.mockReturnValueOnce(pending.promise);
    else repository.deletePlanWithDependents.mockReturnValueOnce(pending.promise);
    let failed!: Promise<unknown>;
    await act(async () => {
      failed = (operation === 'schedule'
        ? readState().scheduleTodoAsPlan(first, studyPlan)
        : readState().deletePlan(plan)).catch((error: unknown) => error);
    });
    await act(async () => { await readState().saveTodo({ ...second, title: 'saved' }, second.id); });
    const failure = new Error('linked mutation rejected');
    await act(async () => { pending.reject(failure); expect(await failed).toBe(failure); });
    expect(readState().todos.find(item => item.id === first.id)).toEqual(first);
    expect(readState().todos.find(item => item.id === second.id)?.title).toBe('saved');
    renderer.unmount();
  });

  it('retains durable delete Undo when another pending Todo save fails', async () => {
    const first: TodoTask = {
      id: 'first', userId: 'owner-a', title: 'first', subject: '', type: 'study',
      estimatedMinutes: null, dueDate: null, memo: '', status: 'open', scheduledPlanId: null,
      createdAt: studyPlan.createdAt, updatedAt: studyPlan.updatedAt,
    };
    const second = { ...first, id: 'second', title: 'second' };
    repository.getTodos.mockResolvedValue([first, second]);
    const renderer = create(<Harness userId="owner-a" />);
    await act(async () => { await readState().loadPlannerData('owner-a'); });
    const pending = deferred<void>();
    repository.upsertTodo.mockReturnValueOnce(pending.promise);
    let failed!: Promise<unknown>;
    await act(async () => {
      failed = readState().saveTodo({ ...first, title: 'pending' }, first.id).catch((error: unknown) => error);
    });
    await act(async () => { await readState().deleteTodo(second); });
    const undo = showNotice.mock.calls.find(call => call[0] === '削除しました')?.[2]?.onAction;
    expect(undo).toBeTypeOf('function');
    await act(async () => { await undo(); });
    expect(repository.upsertTodo).toHaveBeenLastCalledWith(second);
    await act(async () => { pending.reject(new Error('save failed')); await failed; });
    expect(readState().todos).toEqual([first, second]);
    renderer.unmount();
  });

});
