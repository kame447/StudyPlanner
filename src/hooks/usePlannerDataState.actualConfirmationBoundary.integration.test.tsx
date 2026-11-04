// #974: separate confirmed duration replacements from unacknowledged writes, including read publication.
// The existing timed-Actual path is the positive control for the shared hook's optimistic contract.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { createLocalFixture, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { createFirebasePlannerRepository } from '../repositories/firebasePlannerRepository';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { buildDurationActuals, type DurationActualInput } from '../domain/durationActuals';
import type { ActualDraft } from '../types/domain';
import { WeekView } from '../components/WeekView';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository, getDocs: vi.fn() }));
vi.mock('../repositories', async importOriginal => ({ ...await importOriginal<typeof import('../repositories')>(),
  plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }),
}));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(),
  getDocs: boundary.getDocs,
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
}));

const OWNER = 'owner';
const STAMP = '2026-11-03T00:00:00.000Z';
const week: DurationActualInput[] = [
  { occurrenceDate: '2026-10-26', subject: '数学', minutes: 60 },
  { occurrenceDate: '2026-10-27', subject: '英語', minutes: 45 },
  { occurrenceDate: '2026-10-28', subject: '現代文', minutes: 30 },
  { occurrenceDate: '2026-10-30', subject: '英語', minutes: 50 },
  { occurrenceDate: '2026-10-31', subject: '数学', minutes: 120 },
  { occurrenceDate: '2026-11-01', subject: '化学', minutes: 90 },
].map(row => ({ ...row, id: `wp-actual-${OWNER}-${row.occurrenceDate}-${row.subject}`, title: row.subject }));
const correction = { ...week[1], minutes: 50 };
const textOf = (node: ReactTestInstance | string | number): string => typeof node === 'object'
  ? node.children.map(textOf).join('') : String(node);
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let releases: Array<() => void>;
let operations: Array<Promise<unknown>>;
let outbound: ReturnType<typeof vi.fn>;
const notice = vi.fn<ShowNotice>();
function Harness() {
  state = usePlannerDataState({ userId: OWNER, showNotice: notice });
  return <WeekView selectedDate="2026-10-26" userId={OWNER} plans={state.plans} actuals={state.actuals} onOpenDay={() => {}} />;
}
beforeEach(() => {
  releases = []; operations = []; notice.mockClear(); boundary.getDocs.mockReset();
  outbound = vi.fn(async () => { throw new Error('No real API is permitted.'); });
  vi.stubGlobal('fetch', outbound);
});
afterEach(async () => {
  await act(async () => { releases.forEach(release => release()); await Promise.allSettled(operations); renderer?.unmount(); });
  renderer = undefined;
  expect(outbound).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function capture(promise: Promise<void>) {
  const done = promise.then(() => undefined, (error: unknown) => error);
  operations.push(done); return done;
}
async function mount() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData(OWNER); });
  const actualMode = renderer!.root.findAllByType('button').find(button => button.children.join('') === '記録');
  expect(actualMode).toBeDefined(); act(() => actualMode!.props.onClick());
  notice.mockClear();
}
function tuesdayTotal() {
  const headers = renderer!.root.findAllByProps({ className: 'weekly-draft-preview-date' });
  return headers[1].findAllByProps({ className: 'week-duration-actual-total' }).map(textOf).join('');
}
function expectConfirmedWeek(minutes: number) {
  expect(state.actuals).toHaveLength(6);
  expect(new Set(state.actuals.map(row => row.id)).size).toBe(6);
  expect(state.actuals.reduce((sum, row) => sum + (row.actualDurationMinutes ?? 0), 0)).toBe(minutes);
}

it('keeps the confirmed 45-minute value through a lost acknowledgement, then publishes the 50-minute replacement exactly once', async () => {
  const fixture = createLocalFixture();
  await fixture.repository.saveDurationActualsBatch(OWNER, week);
  const entered = deferred<void>(), ack = deferred<void>(); releases.push(() => ack.resolve());
  const save = vi.fn<PlannerRepository['saveDurationActualsBatch']>(async (owner, records) => {
    const saved = await fixture.repository.saveDurationActualsBatch(owner, records);
    entered.resolve(); await ack.promise; return saved;
  });
  boundary.repository = { ...fixture.repository, saveDurationActualsBatch: save };
  await mount();
  expect(tuesdayTotal()).toBe('時刻なし 45分'); expectConfirmedWeek(395);
  const originalIds = state.actuals.map(row => row.id);
  let done!: Promise<unknown>;
  await act(async () => { done = capture(state.saveDurationActualsBatch([correction])); await entered.promise; });
  const server = await fixture.repository.getActuals(OWNER);
  expect(server.find(row => row.id === correction.id)?.actualDurationMinutes).toBe(50);
  expect.soft(tuesdayTotal(), 'server commit is not yet acknowledged to this client').toBe('時刻なし 45分');
  expect(notice).not.toHaveBeenCalledWith('記録を保存しました。', 'success');
  expect(save).toHaveBeenCalledOnce();
  await act(async () => { ack.resolve(); expect(await done).toBeUndefined(); });
  expect(tuesdayTotal()).toBe('時刻なし 50分'); expectConfirmedWeek(400);
  expect(state.actuals.map(row => row.id).sort()).toEqual(originalIds.sort());
  for (const record of week.filter(row => row.id !== correction.id)) {
    expect(state.actuals.find(row => row.id === record.id)?.actualDurationMinutes).toBe(record.minutes);
  }
  expect(save).toHaveBeenCalledOnce();
  expect(notice.mock.calls.filter(([message, kind]) => message === '記録を保存しました。' && kind === 'success')).toHaveLength(1);
});

it('does not let a pending-writes SDK snapshot certify the replacement during a full read', async () => {
  const fixture = createLocalFixture();
  await fixture.repository.saveDurationActualsBatch(OWNER, week);
  let sdkRows = buildDurationActuals(OWNER, week, STAMP);
  let pendingWrites = false;
  boundary.getDocs.mockImplementation(async (request: { source: { name: string }; constraints: unknown[] }) => {
    expect(request.source.name).toBe('actuals');
    expect(request.constraints).toEqual([{ field: 'userId', op: '==', value: OWNER }]);
    return { docs: sdkRows.map(row => ({ id: row.id, data: () => row })),
      metadata: { fromCache: pendingWrites, hasPendingWrites: pendingWrites } };
  });
  const firebase = createFirebasePlannerRepository({} as Firestore);
  const entered = deferred<void>(), ack = deferred<void>(); releases.push(() => ack.resolve());
  const save = vi.fn<PlannerRepository['saveDurationActualsBatch']>(async (owner, records) => {
    sdkRows = buildDurationActuals(owner, week.map(row => row.id === correction.id ? correction : row), STAMP);
    pendingWrites = true; entered.resolve(); await ack.promise;
    const saved = await fixture.repository.saveDurationActualsBatch(owner, records);
    pendingWrites = false;
    return saved;
  });
  boundary.repository = { ...fixture.repository, getActuals: owner => firebase.getActuals(owner), saveDurationActualsBatch: save };
  await mount(); expect(tuesdayTotal()).toBe('時刻なし 45分');
  let done!: Promise<unknown>;
  await act(async () => { done = capture(state.saveDurationActualsBatch([correction])); await entered.promise; });
  expect((await fixture.repository.getActuals(OWNER)).find(row => row.id === correction.id)?.actualDurationMinutes).toBe(45);
  await act(async () => { await state.loadPlannerData(OWNER); });
  expect(pendingWrites).toBe(true);
  expect(boundary.getDocs).toHaveBeenCalledTimes(2);
  expect.soft(tuesdayTotal(), 'cached pending writes are not a server acknowledgement').toBe('時刻なし 45分');
  expect(notice).not.toHaveBeenCalledWith('記録を保存しました。', 'success');
  await act(async () => { ack.resolve(); expect(await done).toBeUndefined(); });
  expect(tuesdayTotal()).toBe('時刻なし 50分'); expectConfirmedWeek(400);
  expect(save).toHaveBeenCalledOnce();
});

it('keeps the shared legacy timed-Actual save immediately visible before its acknowledgement', async () => {
  const fixture = createLocalFixture();
  const entered = deferred<void>(), ack = deferred<void>(); releases.push(() => ack.resolve());
  const save = vi.fn<PlannerRepository['upsertActualWithMaterialProgress']>(async mutation => {
    entered.resolve(); await ack.promise; return fixture.repository.upsertActualWithMaterialProgress(mutation);
  });
  boundary.repository = { ...fixture.repository, upsertActualWithMaterialProgress: save };
  await mount(); expect(state.actuals).toEqual([]);
  const draft: ActualDraft = { userId: OWNER, planId: null, occurrenceDate: '2026-10-26', actualStartTime: '09:00', actualEndTime: '09:30',
    title: '旧経路の数学', subject: '数学', isAlignedToPlan: false, note: '', materialProgressUpdates: [] };
  let done!: Promise<unknown>;
  await act(async () => { done = capture(state.saveStandaloneActual(draft)); await entered.promise; });
  expect(await fixture.repository.getActuals(OWNER)).toEqual([]);
  expect(state.actuals).toMatchObject([{ title: '旧経路の数学', actualStartTime: '09:00', actualEndTime: '09:30' }]);
  expect(textOf(renderer!.root)).toContain('旧経路の数学');
  expect(notice).not.toHaveBeenCalledWith('記録を保存しました。', 'success');
  await act(async () => { ack.resolve(); expect(await done).toBeUndefined(); });
  expect(state.actuals).toHaveLength(1);
  expect(await fixture.repository.getActuals(OWNER)).toHaveLength(1);
  expect(save).toHaveBeenCalledOnce();
});
