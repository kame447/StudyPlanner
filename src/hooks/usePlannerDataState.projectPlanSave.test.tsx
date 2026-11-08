import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerRepository, PlannerStorageGateway } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';
import type { Plan } from '../types/domain';

/**
 * #355 flow 3 follow-up: two approval blocks are saved one after another through projectPlanSave
 * (the approval path), with a read, a delete or a note load crossing the second acknowledgement.
 * After everything settles, every acknowledged Plan must be in `plans`.
 */
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const DATE = '2026-10-04'; const STAMP = `${DATE}T00:00:00.000Z`;
const plan = (id: string, start = '09:00', end = '10:00'): Plan => ({ id, seriesId: id, userId: 'owner', title: id, subject: '数学', date: DATE,
  startTime: start, endTime: end, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
  type: 'study', memo: '', createdAt: STAMP, updatedAt: STAMP });
const EXISTING = plan('existing', '07:00', '08:00');
const N1 = plan('approved-1', '10:00', '10:30'); const N2 = plan('approved-2', '10:30', '11:00');
const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
function collection<T>(initial: T[]) {
  let value = structuredClone(initial);
  return { read: vi.fn(async () => structuredClone(value)), write: vi.fn(async (next: T[] | PromiseLike<T[]>) => { value = structuredClone(await next); }) };
}
async function mount() {
  const plans = collection([EXISTING]);
  const none = <T,>() => collection<T>([]);
  const gateway = {
    readPlans: plans.read, writePlans: plans.write,
    readActuals: none().read, writeActuals: none().write, readTodos: none().read, writeTodos: none().write,
    readDayNotes: none().read, writeDayNotes: none().write, readMonthEvents: none().read, writeMonthEvents: none().write,
    readStudySubjects: none().read, writeStudySubjects: none().write, readStudyMaterials: none().read, writeStudyMaterials: none().write,
    readScheduleTemplates: none().read, writeScheduleTemplates: none().write, readTimetableTerms: none().read, writeTimetableTerms: none().write,
    readTimetablePeriods: none().read, writeTimetablePeriods: none().write,
  } as unknown as PlannerStorageGateway;
  boundary.repository = createPlannerRepository(gateway);
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return plans;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function gate() {
  let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open, entered: false };
}
const ids = (rows: Plan[]) => rows.map(row => row.id).sort();
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function expectEveryAcknowledgedPlanShown(label: string, acknowledged: string[]) {
  await settle();
  const persisted = ids(await boundary.repository.getPlans('owner'));
  expect(persisted, `${label}: persisted`).toEqual(expect.arrayContaining(acknowledged));
  expect(ids(state.plans), label).toEqual(persisted);
  expect(state.plannerDataAvailability.status, `${label}: availability`).toBe('ready');
}
const save = (row: Plan) => state.projectPlanSave(() => boundary.repository.upsertPlan(row));
function holdMethod<K extends 'upsertPlan' | 'getScheduleSnapshot' | 'getPlans' | 'getTodos'>(method: K, which: (call: number) => boolean) {
  const g = gate(); let call = 0;
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    const mine = which(++call);
    if (!mine) return original(...args);
    const result = await original(...args); g.entered = true; await g.promise; return result;
  } };
  return g;
}

describe('approval blocks saved one after another keep every acknowledged Plan visible (the delete, read and out-of-order cases go through the reconciliation request branch)', () => {
  it('plain: two sequential saves', async () => {
    await mount();
    await act(async () => { await save(N1); await save(N2); });
    await expectEveryAcknowledgedPlanShown('plain', [N1.id, N2.id]);
  });

  it('a full read that started before the first acknowledgement lands after both saves', async () => {
    await mount();
    const read = holdMethod('getScheduleSnapshot', call => call === 1);
    let load!: Promise<void>;
    await act(async () => { load = state.loadPlannerData('owner'); });
    await act(async () => { await save(N1); await save(N2); });
    await act(async () => { read.open(); await load; });
    await expectEveryAcknowledgedPlanShown('stale full read', [N1.id, N2.id]);
  });

  it('a full read crossing only the second acknowledgement', async () => {
    await mount();
    await act(async () => { await save(N1); });
    const second = holdMethod('upsertPlan', call => call === 1);
    let saving!: Promise<Plan>;
    await act(async () => { saving = save(N2); });
    await vi.waitFor(() => expect(second.entered).toBe(true));
    const read = holdMethod('getScheduleSnapshot', call => call === 1);
    let load!: Promise<void>;
    await act(async () => { load = state.loadPlannerData('owner'); });
    await vi.waitFor(() => expect(read.entered).toBe(true));
    await act(async () => { second.open(); await saving; });
    await act(async () => { read.open(); await load; });
    await expectEveryAcknowledgedPlanShown('read crossing 2nd ack', [N1.id, N2.id]);
  });

  it('a delete of another Plan runs while the second block is being saved', async () => {
    await mount();
    await act(async () => { await save(N1); });
    const second = holdMethod('upsertPlan', call => call === 1);
    let saving!: Promise<Plan>;
    await act(async () => { saving = save(N2); });
    await vi.waitFor(() => expect(second.entered).toBe(true));
    await act(async () => { await state.deletePlan(EXISTING); });
    await act(async () => { second.open(); await saving; });
    await expectEveryAcknowledgedPlanShown('delete crossing 2nd ack', [N1.id, N2.id]);
  });

  it('the first acknowledgement arrives after the second save has finished', async () => {
    await mount();
    const first = holdMethod('upsertPlan', call => call === 1);
    let one!: Promise<Plan>; let two!: Promise<Plan>;
    await act(async () => { one = save(N1); });
    await vi.waitFor(() => expect(first.entered).toBe(true));
    await act(async () => { two = save(N2); await two; });
    await act(async () => { first.open(); await one; });
    await expectEveryAcknowledgedPlanShown('out-of-order acknowledgements', [N1.id, N2.id]);
  });

  it('opening the day view (a note load) is not a writer: the ordinary direct-publish path is used and both Plans show', async () => {
    await mount();
    await act(async () => { await save(N1); });
    const second = holdMethod('upsertPlan', call => call === 1);
    let saving!: Promise<Plan>;
    await act(async () => { saving = save(N2); });
    await vi.waitFor(() => expect(second.entered).toBe(true));
    await act(async () => { await state.loadDayNotes(); });
    const plansReads = vi.spyOn(boundary.repository, 'getPlans');
    await act(async () => { second.open(); await saving; });
    await settle();
    // loadDayNotes does not move the writer counters, so no reconciliation read of Plans is requested.
    expect(plansReads).not.toHaveBeenCalled();
    await expectEveryAcknowledgedPlanShown('note load crossing 2nd ack', [N1.id, N2.id]);
  });

  it('a failed reconciliation read leaves the projection stale (never ready) until the explicit retry', async () => {
    await mount();
    await act(async () => { await save(N1); });
    const second = holdMethod('upsertPlan', call => call === 1);
    let saving!: Promise<Plan>;
    await act(async () => { saving = save(N2); });
    await vi.waitFor(() => expect(second.entered).toBe(true));
    await act(async () => { await state.deletePlan(EXISTING); });
    const original = boundary.repository.getPlans; let failed = false;
    boundary.repository = { ...boundary.repository, getPlans: async (...args) => {
      if (!failed) { failed = true; throw new Error('read failed once'); }
      return original(...args);
    } };
    await act(async () => { second.open(); await saving; });
    await settle();
    // The acknowledged Plan is not shown, but the data is never presented as current: the projection is
    // 'stale' (the recovery notice owns it) and one explicit retry brings every acknowledged Plan back.
    expect(state.plannerDataAvailability.status).toBe('stale');
    await act(async () => { await state.retryPlannerData(); });
    await expectEveryAcknowledgedPlanShown('after retry', [N1.id, N2.id]);
  });
});
