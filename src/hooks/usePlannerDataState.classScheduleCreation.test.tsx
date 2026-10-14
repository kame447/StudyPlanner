import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyPlanDraft } from '../domain/planner';
import { createLocalFixture, deferred, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer;
function Harness({ owner = 'owner' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: () => undefined });
  return null;
}
const draft = () => ({ ...createEmptyPlanDraft('owner', '2026-10-13'), title: '授業の提出予定',
  classTemplateId: 'class', type: 'deadline' as const, startTime: '17:00', endTime: '17:15' });
async function mount(repeat: 'none' | 'weekly' = 'none') {
  const fixture = createLocalFixture();
  const existing = plan({ repeat, repeatUntil: repeat === 'weekly' ? '2026-11-01' : null });
  await fixture.repository.upsertPlan(existing);
  boundary.repository = fixture.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); state.openEditPlan(existing); });
  return { ...fixture, existing: (await fixture.repository.getPlans('owner'))[0] };
}
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });

it.each(['none', 'weekly'] as const)('creates a related schedule independently of a %s editor and waits for persistence', async repeat => {
  const fixture = await mount(repeat);
  const entered = deferred(), release = deferred();
  const original = fixture.repository.upsertPlan;
  const save = vi.fn(async (next: Parameters<typeof original>[0]) => {
    entered.resolve(); await release.promise; return original(next);
  });
  boundary.repository = { ...fixture.repository, upsertPlan: save };
  let settled = false, pending!: Promise<void>;
  await act(async () => {
    pending = state.createPlanDraft(draft()).then(() => { settled = true; });
    await entered.promise;
  });
  expect(settled).toBe(false);
  expect(state.pendingRecurringPlanAction).toBeNull();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ classTemplateId: 'class', repeat: 'none' });
  expect(save.mock.calls[0][0].id).not.toBe(fixture.existing.id);
  await act(async () => { release.resolve(); await pending; });
  const rows = await fixture.repository.getPlans('owner');
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.id === fixture.existing.id)).toEqual(fixture.existing);
  expect(state.plans.find(row => row.classTemplateId === 'class')?.title).toBe('授業の提出予定');
  expect(state.editingPlanId).toBe(fixture.existing.id);
  expect(state.editorDraft?.title).toBe(fixture.existing.title);
});

it('rejects a failed new schedule without mutating the existing edit or pretending it was saved', async () => {
  const fixture = await mount('weekly');
  boundary.repository = { ...fixture.repository, upsertPlan: vi.fn(async () => { throw Error('offline'); }) };
  await act(async () => { await expect(state.createPlanDraft(draft())).rejects.toThrow('offline'); });
  expect((await fixture.repository.getPlans('owner'))).toEqual([fixture.existing]);
  expect(state.plans).toEqual([fixture.existing]);
  expect(state.pendingRecurringPlanAction).toBeNull();
  expect(state.editingPlanId).toBe(fixture.existing.id);
});

it('rejects a foreign owner and an invalid time before repository mutation', async () => {
  const fixture = await mount();
  const save = vi.spyOn(fixture.repository, 'upsertPlan');
  await act(async () => {
    await expect(state.createPlanDraft({ ...draft(), userId: 'intruder' })).rejects.toThrow();
    await expect(state.createPlanDraft({ ...draft(), endTime: '16:00' })).rejects.toThrow();
  });
  expect(save).not.toHaveBeenCalled();
});
