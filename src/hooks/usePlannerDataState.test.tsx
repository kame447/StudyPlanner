import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../types/domain';
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
  applyTimetableMutation: vi.fn(),
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
  repository.applyTimetableMutation.mockResolvedValue(undefined);
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
