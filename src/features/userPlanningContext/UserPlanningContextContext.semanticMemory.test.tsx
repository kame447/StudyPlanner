import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserPlanningContextProvider, useUserPlanningContextV1, type UserPlanningContextContextValueV1 } from './UserPlanningContextContext';
import type { UserPlanningContextRepositoryStateV1 } from './userPlanningContextRepository';
import { createEmptyUserPlanningContextSnapshotV1 } from './userPlanningContextTypes';

const fixture = vi.hoisted(() => ({
  initialize: vi.fn(), save: vi.fn(), remove: vi.fn(),
  connect: vi.fn(), publish: vi.fn(), dispose: vi.fn(), hydrate: vi.fn(),
  onRemote: null as ((next: UserPlanningContextRepositoryStateV1) => void) | null,
}));
vi.mock('./semanticMemory/index/semanticMemoryApplication', () => ({ semanticMemoryApplication: { connect: fixture.connect } }));
vi.mock('./userPlanningContextRepository', () => ({ getUserPlanningContextRepositoryV1: () => ({
  initialize: fixture.initialize, saveUserConfirmedRecord: fixture.save, removeRecord: fixture.remove,
  subscribe: (_owner: string, listener: typeof fixture.onRemote) => { fixture.onRemote = listener; return () => {}; },
}) }));
vi.mock('./userPlanningContextSpace', () => ({
  loadUserPlanningContextSnapshotV1: ({ ownerId }: { ownerId: string }) => createEmptyUserPlanningContextSnapshotV1(ownerId),
  hydrateUserPlanningContextSnapshotV1: (...args: unknown[]) => fixture.hydrate(...args),
  isUserPlanningContextVisibleV1: () => true,
  createUserConfirmedPlanningContextRecordV1: (input: unknown) => input,
}));
let renderer: ReactTestRenderer | undefined;
let state: UserPlanningContextContextValueV1;
const canonical = (ownerId: string, revision: number, shared = true): UserPlanningContextRepositoryStateV1 => ({
  snapshot: createEmptyUserPlanningContextSnapshotV1(ownerId), revision, shared,
});
function Probe() { state = useUserPlanningContextV1(); return <span />; }
beforeEach(() => {
  vi.clearAllMocks(); fixture.onRemote = null;
  fixture.connect.mockReturnValue({ publish: fixture.publish, dispose: fixture.dispose });
  fixture.initialize.mockResolvedValue(canonical('owner-a', 8));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

it('publishes actual canonical revisions from load, subscription, save and forget', async () => {
  await act(async () => { renderer = create(<UserPlanningContextProvider ownerId="owner-a"><Probe /></UserPlanningContextProvider>); });
  expect(fixture.publish).toHaveBeenLastCalledWith({ ownerId: 'owner-a', revision: 8, records: [] });
  await act(async () => { fixture.onRemote!(canonical('owner-a', 9)); });
  expect(fixture.publish).toHaveBeenLastCalledWith({ ownerId: 'owner-a', revision: 9, records: [] });
  fixture.save.mockResolvedValue(canonical('owner-a', 10));
  await act(async () => { await state.saveRecord({ kind: 'concern', label: '数学', value: '計算が苦手' }); });
  expect(fixture.publish).toHaveBeenLastCalledWith({ ownerId: 'owner-a', revision: 10, records: [] });
  fixture.remove.mockResolvedValue(canonical('owner-a', 11));
  await act(async () => { await state.removeRecord('synthetic'); });
  expect(fixture.publish).toHaveBeenLastCalledWith({ ownerId: 'owner-a', revision: 11, records: [] });
  act(() => renderer!.unmount()); renderer = undefined;
  expect(fixture.dispose).toHaveBeenCalledOnce();
});

it('never promotes local-only bootstrap into a canonical index revision', async () => {
  fixture.initialize.mockResolvedValue(canonical('owner-a', 0, false));
  await act(async () => { renderer = create(<UserPlanningContextProvider ownerId="owner-a"><Probe /></UserPlanningContextProvider>); });
  expect(fixture.publish).not.toHaveBeenCalled();
});

it('disposes the old owner scope and ignores its late subscription delivery', async () => {
  await act(async () => { renderer = create(<UserPlanningContextProvider ownerId="owner-a"><Probe /></UserPlanningContextProvider>); });
  const oldSubscription = fixture.onRemote!;
  fixture.initialize.mockResolvedValue(canonical('owner-b', 2));
  await act(async () => { renderer!.update(<UserPlanningContextProvider ownerId="owner-b"><Probe /></UserPlanningContextProvider>); });
  expect(fixture.dispose).toHaveBeenCalledOnce();
  fixture.publish.mockClear();
  await act(async () => { oldSubscription(canonical('owner-a', 99)); });
  expect(fixture.publish).not.toHaveBeenCalled();
});
