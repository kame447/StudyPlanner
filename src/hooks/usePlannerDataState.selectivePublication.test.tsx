import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { createEmptyMonthEventDraft } from '../domain/planner';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { Actual, MonthEvent, StudyMaterial } from '../types/domain';
import { createMonthEventRecoveryRepository } from './monthEventRecovery.testUtils';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const DATE = '2026-10-04'; const STAMP = `${DATE}T00:00:00.000Z`;
const AA: Actual = { id: 'actual', userId: 'owner', planId: null, occurrenceDate: DATE,
  actualStartTime: '09:00', actualEndTime: '10:00', title: 'Record', subject: 'Math', note: 'Original', updatedAt: STAMP };
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: () => undefined }); return null; }
async function mount() {
  const fixture = createMonthEventRecoveryRepository('legacy', [AA]);
  boundary.repository = { ...fixture.repository };
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture.storage;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
function hold(method: keyof PlannerRepository, gate: ReturnType<typeof deferred>) {
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    await gate.promise;
    return original(...args);
  } };
}

const material: StudyMaterial = { id: 'material', userId: 'owner', name: 'Book', subjectId: 'math', subjectName: 'Math',
  paceEnabled: true, progressUnit: 'problem', currentUnit: 20, totalUnits: 100, createdAt: STAMP, updatedAt: STAMP };

it.each(['actual read', 'material read', 'month read', 'material preparation', 'month preparation'] as const)(
  'withholds every requested projection when %s fails and retries the same union without replaying writes', async failure => {
    const storage = await mount();
    const writer = deferred();
    hold('upsertMonthEvent', writer);
    let saving!: Promise<void>;
    await act(async () => {
      saving = state.saveMonthEvent({ ...createEmptyMonthEventDraft('owner', DATE), title: 'Durable month event' });
    });
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.monthEvents).toEqual([]);
    expect(state.plannerDataAvailability.status).toBe('stale');
    const fullTimestamp = state.plannerDataAvailability.lastSuccessfulAt;
    const oldActuals = structuredClone(state.actuals);
    await storage.actuals.write([{ ...AA, note: 'New durable actual' }]);
    await storage.materials.write([material]);
    const actualRead = vi.spyOn(boundary.repository, 'getActuals');
    const materialRead = vi.spyOn(boundary.repository, 'getStudyMaterials');
    const monthRead = vi.spyOn(boundary.repository, 'getMonthEvents');
    const fullRead = vi.spyOn(boundary.repository, 'getScheduleSnapshot');
    const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
    const upsert = vi.spyOn(boundary.repository, 'upsertMonthEvent');
    if (failure === 'actual read') actualRead.mockRejectedValueOnce(Error('Actual read unavailable'));
    if (failure === 'material read') materialRead.mockRejectedValueOnce(Error('Material read unavailable'));
    if (failure === 'month read') monthRead.mockRejectedValueOnce(Error('Month read unavailable'));
    if (failure === 'material preparation') materialRead.mockResolvedValueOnce([
      material, { ...material, id: 'bad material', subjectName: undefined as unknown as string },
    ]);
    if (failure === 'month preparation') {
      const event = { ...createEmptyMonthEventDraft('owner', DATE), id: 'valid', createdAt: STAMP, updatedAt: STAMP } as MonthEvent;
      monthRead.mockResolvedValueOnce([event, { ...event, id: 'bad month', date: undefined as unknown as string }]);
    }
    await act(async () => { writer.resolve(); await saving; });
    expect(state.actuals).toEqual(oldActuals);
    expect(state.studyMaterials).toEqual([]);
    expect(state.monthEvents).toEqual([]);
    expect(state.plannerDataRecovery).toMatchObject({ reason: 'projections', phase: 'failed', canRetry: true });
    expect(state.plannerDataAvailability).toMatchObject({ status: 'stale', lastSuccessfulAt: fullTimestamp });
    await act(async () => { state.openDay('2027-01-09'); });
    expect(actualRead).toHaveBeenCalledTimes(1);
    expect(materialRead).toHaveBeenCalledTimes(1);
    expect(monthRead).toHaveBeenCalledTimes(1);
    await act(async () => { await state.retryPlannerData(); });
    expect(actualRead).toHaveBeenCalledTimes(2);
    expect(materialRead).toHaveBeenCalledTimes(2);
    expect(monthRead).toHaveBeenCalledTimes(2);
    expect(state.actuals).toEqual(await storage.actuals.read());
    expect(state.studyMaterials).toEqual(await storage.materials.read());
    expect(state.monthEvents).toEqual(await storage.monthEvents.read());
    expect(state.monthEvents).toHaveLength(1);
    expect(state.selectedDate).toBe('2027-01-09');
    expect(state.monthDate).toBe('2027-01-01');
    expect(state.viewMode).toBe('day');
    expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', lastSuccessfulAt: fullTimestamp });
    expect(upsert).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(fullRead).not.toHaveBeenCalled();
  });
