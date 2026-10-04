import { describe, expect, it, vi } from 'vitest';
import { PlannerDataReadAuthority, type PlannerRepairTarget } from './plannerDataReadAuthority';
import { PlannerMutationReconciliation } from './plannerMutationReconciliation';

const RESTORE: readonly PlannerRepairTarget[] = ['actual-material', 'plans-todos'];
const ALL: readonly PlannerRepairTarget[] = ['actual-material', 'month-events', 'plans-todos'];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const authority = new PlannerDataReadAuthority();
  authority.succeed(authority.begin('owner', 'initial').token, 'initial ready');
  const reads: ReturnType<typeof deferred<string>>[] = [];
  const read = vi.fn((_owner: string, _targets: readonly PlannerRepairTarget[]) => {
    const gate = deferred<string>();
    reads.push(gate);
    return gate.promise;
  });
  const publish = vi.fn();
  const controller = new PlannerMutationReconciliation<string>(authority, () => 'repair');
  controller.activateOwner('owner');
  controller.configure({ isCurrent: owner => owner === 'owner', read, publish, changed: () => undefined });
  const startFull = () => ({ activity: controller.captureActivity(), token: authority.begin('owner', 'full').token });
  const acceptFull = ({ activity, token }: ReturnType<typeof startFull>) => {
    authority.succeed(token, 'full ready', controller.isQuiescentSince(activity), [
      ...controller.successfulTargetsSince(activity), ...controller.planRestoreTargetsSince(activity),
    ]);
    controller.pump();
  };
  return { authority, controller, read, reads, publish, startFull, acceptFull };
}

describe('Plan Undo potential projection effects', () => {
  it.each(['success', 'failure'] as const)('retains an entire %s settlement inside an older full read', async outcome => {
    const h = harness();
    const full = h.startFull();
    const restore = h.controller.beginPlanRestore();
    h.controller.settleMutation(restore, outcome);
    expect(h.controller.successfulTargetsSince(full.activity)).toEqual([]);
    expect(h.controller.planRestoreTargetsSince(full.activity)).toEqual(RESTORE);
    expect(h.read).not.toHaveBeenCalled();
    h.acceptFull(full);
    expect(h.authority.readSnapshot().recovery).toMatchObject({ reason: 'projections', phase: 'refreshing' });
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', RESTORE);
    h.reads[0].resolve('current storage');
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('current storage');
    expect(h.authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'full ready' });
  });

  it.each(['success', 'failure'] as const)('marks all effects before full acceptance while restore remains active, then repairs on %s', async outcome => {
    const h = harness();
    const restore = h.controller.beginPlanRestore();
    const full = h.startFull();
    h.acceptFull(full);
    expect(h.authority.readSnapshot().recovery).toMatchObject({ reason: 'projections', phase: 'waiting' });
    const staleLease = h.authority.captureProjectionLease()!;
    expect(h.authority.isProjectionUsable(staleLease)).toBe(false);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    h.controller.settleMutation(restore, outcome);
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', RESTORE);
    h.reads[0].resolve('settled storage');
    await flush();
    expect(h.authority.read().status).toBe('ready');
    expect(h.authority.isProjectionUsable(staleLease)).toBe(false);
  });

  it.each(['success', 'failure'] as const)('a %s restore settled before full entry is covered by that later full snapshot', async outcome => {
    const h = harness();
    const restore = h.controller.beginPlanRestore();
    h.controller.settleMutation(restore, outcome);
    const full = h.startFull();
    expect(h.controller.planRestoreTargetsSince(full.activity)).toEqual([]);
    h.acceptFull(full);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.authority.read().status).toBe('ready');
  });

  it('does not turn an untagged pre-dispatch rejection or MonthEvent failure into Plan/Todo effects', async () => {
    const h = harness();
    const full = h.startFull();
    const rejected = h.controller.beginMutation();
    const month = h.controller.beginMutation(['month-events']);
    h.controller.settleMutation(rejected, 'failure');
    h.controller.settleMutation(month, 'failure');
    expect(h.controller.planRestoreTargetsSince(full.activity)).toEqual([]);
    expect(h.controller.successfulTargetsSince(full.activity)).toEqual([]);
    h.acceptFull(full);
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', ['actual-material']);
  });

  it.each(['success', 'failure'] as const)('duplicates cannot settle or re-arm a %s restore twice', async outcome => {
    const h = harness();
    const full = h.startFull();
    const restore = h.controller.beginPlanRestore();
    h.acceptFull(full);
    h.controller.settleMutation(restore, outcome);
    const settled = h.controller.captureActivity();
    h.controller.settleMutation(restore, outcome === 'success' ? 'failure' : 'success');
    expect(h.controller.captureActivity()).toEqual(settled);
    expect(h.controller.planRestoreTargetsSince(settled)).toEqual([]);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it.each(['month-first', 'restore-first'] as const)('unions independent MonthEvent evidence with restore effects, %s', async order => {
    const h = harness();
    const full = h.startFull();
    const restore = h.controller.beginPlanRestore();
    const month = h.controller.beginMutation(['month-events']);
    if (order === 'month-first') {
      h.controller.settleMutation(month, 'success');
      h.controller.settleMutation(restore, 'failure');
    } else {
      h.controller.settleMutation(restore, 'failure');
      h.controller.settleMutation(month, 'success');
    }
    h.acceptFull(full);
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', ALL);
    h.reads[0].resolve('all groups');
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('all groups');
  });

  it('discards every group if another restore enters during the repair read', async () => {
    const h = harness();
    const full = h.startFull();
    const first = h.controller.beginPlanRestore();
    h.controller.settleMutation(first, 'success');
    h.acceptFull(full);
    await flush();
    const second = h.controller.beginPlanRestore();
    h.reads[0].resolve('obsolete snapshot');
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(1);
    h.controller.settleMutation(second, 'failure');
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read.mock.calls[1][1]).toEqual(RESTORE);
    h.reads[1].resolve('settled snapshot');
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('settled snapshot');
  });

  it('preserves failed full-read health after targeted recovery', async () => {
    const h = harness();
    const oldLease = h.authority.captureProjectionLease()!;
    const restore = h.controller.beginPlanRestore();
    h.acceptFull(h.startFull());
    const laterFull = h.startFull();
    h.authority.fail(laterFull.token, 'full failed');
    h.controller.settleMutation(restore, 'failure');
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', RESTORE);
    h.reads[0].resolve('restored projection');
    await flush();
    expect(h.authority.read()).toMatchObject({ status: 'stale', lastSuccessfulAt: 'full ready' });
    expect(h.authority.readSnapshot().recovery).toMatchObject({ reason: 'full-read', phase: 'failed', canRetry: true });
    expect(h.authority.isProjectionUsable(oldLease)).toBe(false);
  });

  it.each(['reset', 'A-B-A'] as const)('ignores stale restore settlement after %s', async scenario => {
    const h = harness();
    const oldActivity = h.controller.captureActivity();
    const restore = h.controller.beginPlanRestore();
    if (scenario === 'reset') {
      h.authority.reset();
      h.controller.reset();
    } else {
      h.authority.begin('other', 'other');
      h.controller.activateOwner('other');
    }
    h.controller.activateOwner('owner');
    h.authority.succeed(h.authority.begin('owner', 'return').token, 'return ready');
    const current = h.controller.captureActivity();
    h.controller.settleMutation(restore, 'failure');
    expect(h.controller.captureActivity()).toEqual(current);
    expect(h.controller.planRestoreTargetsSince(oldActivity)).toEqual([]);
    expect(h.controller.planRestoreTargetsSince(current)).toEqual([]);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
  });

  it('a dispatched failure without a crossing read requests all effects once and latches read-only retry', async () => {
    const h = harness();
    const oldLease = h.authority.captureProjectionLease()!;
    const restore = h.controller.beginPlanRestore();
    h.controller.settleMutation(restore, 'failure');
    expect(h.authority.readSnapshot().recovery).toMatchObject({ reason: 'projections', phase: 'refreshing' });
    expect(h.authority.isProjectionUsable(oldLease)).toBe(false);
    h.controller.settleMutation(restore, 'failure');
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', RESTORE);
    h.reads[0].reject(Error('projection unavailable'));
    await flush();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.controller.captureActivity()).toMatchObject({ started: 1, settled: 1, pending: 0, planRestoreSettled: 1 });
    expect(h.authority.retryReconciliation(oldLease, 'read-only retry')).toBe(true);
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read.mock.calls[1][1]).toEqual(RESTORE);
    h.reads[1].resolve('current storage');
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('current storage');
    expect(h.authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'initial ready' });
    expect(h.authority.isProjectionUsable(oldLease)).toBe(false);
  });

  it('a reentrant failure observer cannot settle twice or contaminate its replacement owner', async () => {
    const h = harness();
    const restore = h.controller.beginPlanRestore();
    const changed = vi.fn(() => {
      h.controller.settleMutation(restore, 'failure');
      expect(h.controller.captureActivity()).toMatchObject({ started: 1, settled: 1, pending: 0, planRestoreSettled: 1 });
      h.authority.reset();
      h.controller.reset(null);
      h.controller.activateOwner('owner');
      h.authority.succeed(h.authority.begin('owner', 'replacement').token, 'replacement ready');
    });
    h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish, changed });
    h.controller.settleMutation(restore, 'failure');
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(h.controller.captureActivity()).toMatchObject({ started: 0, settled: 0, pending: 0, planRestoreSettled: 0 });
    expect(h.authority.read().status).toBe('ready');
    expect(h.authority.readSnapshot().recovery).toBeNull();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

});
