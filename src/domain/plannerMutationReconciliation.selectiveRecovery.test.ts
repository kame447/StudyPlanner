import { describe, expect, it, vi } from 'vitest';
import { PlannerDataReadAuthority, type PlannerRepairTarget } from './plannerDataReadAuthority';
import { PlannerMutationReconciliation } from './plannerMutationReconciliation';

const BOTH: readonly PlannerRepairTarget[] = ['actual-material', 'month-events'];
const orders: [PlannerRepairTarget, PlannerRepairTarget][] = [
  ['actual-material', 'month-events'],
  ['month-events', 'actual-material'],
];
type Snapshot = Partial<Record<PlannerRepairTarget, string[]>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const sorted = (targets: readonly PlannerRepairTarget[]) => [...targets].sort();
function harness() {
  const authority = new PlannerDataReadAuthority();
  authority.succeed(authority.begin('owner', 'initial start').token, 'initial success');
  const reads: ReturnType<typeof deferred<Snapshot>>[] = [];
  const read = vi.fn((_owner: string, _targets: readonly PlannerRepairTarget[]) => {
    const gate = deferred<Snapshot>();
    reads.push(gate);
    return gate.promise;
  });
  const publish = vi.fn((_snapshot: Snapshot) => {});
  const changed = vi.fn();
  let currentOwner: string | null = 'owner';
  const controller = new PlannerMutationReconciliation<Snapshot>(authority, () => 'target observation');
  controller.activateOwner('owner');
  controller.configure({ isCurrent: owner => owner === currentOwner, read, publish, changed });
  return {
    authority, controller, read, reads, publish, changed,
    setOwner: (owner: string | null) => { currentOwner = owner; },
  };
}

// These tests exercise the coordinator boundary, not repository atomicity.
// Configuration.read prepares one complete snapshot; publish remains one argument.
describe('selective repair coordinator target and successful-completion contract', () => {
  it.each(orders)('coalesces %s and %s while preserving the global writer barrier', async (first, second) => {
    const h = harness();
    const firstWriter = h.controller.beginMutation();
    const lastWriter = h.controller.beginMutation();
    const scope = h.authority.captureOwnerScope()!;
    h.controller.request(scope, [first]);
    h.controller.request(scope, [second]);
    h.controller.settleMutation(firstWriter);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    h.controller.settleMutation(lastWriter);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(sorted(h.read.mock.calls[0][1])).toEqual(sorted(BOTH));
    const snapshot = { 'actual-material': ['fresh actual/material'], 'month-events': ['fresh month'] };
    h.reads[0].resolve(snapshot);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(h.authority.read().status).toBe('ready');
  });

  for (const oldFailure of [false, true]) {
    it.each(orders)(`new %s/%s union supersedes a live immutable ticket, obsoleteFailure=${oldFailure}`, async (first, second) => {
      const h = harness();
      const scope = h.authority.captureOwnerScope()!;
      h.controller.request(scope, [first]);
      await flush();
      const oldTargets = h.read.mock.calls[0][1];
      h.controller.request(scope, [second]);
      await flush();
      expect(h.read).toHaveBeenCalledTimes(2);
      expect(oldTargets).toEqual([first]);
      expect(sorted(h.read.mock.calls[1][1])).toEqual(sorted(BOTH));
      if (oldFailure) h.reads[0].reject(new Error('obsolete group failure'));
      else h.reads[0].resolve({ [first]: ['obsolete'] });
      await flush();
      expect(h.publish).not.toHaveBeenCalled();
      h.controller.pump();
      await flush();
      expect(h.read).toHaveBeenCalledTimes(2);
      const fresh = { 'actual-material': ['fresh actual/material'], 'month-events': ['fresh month'] };
      h.reads[1].resolve(fresh);
      await flush();
      expect(h.publish).toHaveBeenCalledExactlyOnceWith(fresh);
      expect(h.authority.read().status).toBe('ready');
    });
  }

  it.each([
    ['actual/material', ['actual-material']],
    ['month', ['month-events']],
    ['both', BOTH],
  ] as const)('stable %s failure latches and explicit retry rereads exactly the same targets', async (_name, targets) => {
    const h = harness();
    const scope = h.authority.captureOwnerScope()!;
    h.controller.request(scope, targets);
    await flush();
    h.reads[0].reject(new Error('offline'));
    await flush();
    const ordinary = h.controller.beginMutation(['month-events']);
    h.controller.settleMutation(ordinary, 'failure');
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(h.authority.retryReconciliation(scope, 'retry')).toBe(true);
    expect(h.authority.retryReconciliation(scope, 'duplicate retry')).toBe(false);
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(sorted(h.read.mock.calls[1][1])).toEqual(sorted(targets));
    const recovered = Object.fromEntries(targets.map(target => [target, ['recovered']])) as Snapshot;
    h.reads[1].resolve(recovered);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(recovered);
  });

  it('preserves the default Actual/material-only read-cost contract', async () => {
    const h = harness();
    h.controller.request(h.authority.captureOwnerScope()!);
    await flush();
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', ['actual-material']);
    h.reads[0].resolve({ 'actual-material': ['fresh'] });
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith({ 'actual-material': ['fresh'] });
  });

  it('records per-group successful completions, not starts, failed completions or repeated acknowledgments', () => {
    const h = harness();
    const before = h.controller.captureActivity();
    const month = h.controller.beginMutation(['month-events']);
    const failedActual = h.controller.beginMutation(['actual-material']);
    const untagged = h.controller.beginMutation();
    expect(h.controller.successfulTargetsSince(before)).toEqual([]);
    h.controller.settleMutation(month, 'success');
    h.controller.settleMutation(failedActual, 'failure');
    h.controller.settleMutation(untagged, 'success');
    expect(h.controller.successfulTargetsSince(before)).toEqual(['month-events']);
    const after = h.controller.captureActivity();
    h.controller.settleMutation(month, 'success');
    h.controller.settleMutation(failedActual, 'success');
    expect(h.controller.successfulTargetsSince(after)).toEqual([]);
    const actual = h.controller.beginMutation(['actual-material', 'actual-material']);
    h.controller.settleMutation(actual, 'success');
    expect(h.controller.successfulTargetsSince(after)).toEqual(['actual-material']);
    expect(sorted(h.controller.successfulTargetsSince(before))).toEqual(sorted(BOTH));
    expect(h.controller.captureActivity()).toMatchObject({ started: 4, settled: 4, pending: 0 });
    expect(h.read).not.toHaveBeenCalled();
  });

  it('copies mutation target tags at entry instead of using a later-mutated caller array', () => {
    const h = harness();
    const before = h.controller.captureActivity();
    const tags: PlannerRepairTarget[] = ['month-events'];
    const mutation = h.controller.beginMutation(tags);
    tags.splice(0, 1, 'actual-material');
    h.controller.settleMutation(mutation, 'success');
    expect(h.controller.successfulTargetsSince(before)).toEqual(['month-events']);
  });

  it.each(['reset', 'A-B-A'] as const)('old successful settlement cannot contaminate counters or release a new writer after %s', scenario => {
    const h = harness();
    const oldActivity = h.controller.captureActivity();
    const old = h.controller.beginMutation(['month-events']);
    if (scenario === 'reset') {
      h.authority.reset();
      h.controller.reset();
    } else {
      h.authority.begin('other', 'other owner');
      h.controller.activateOwner('other');
      h.setOwner('other');
    }
    h.setOwner('owner');
    h.controller.activateOwner('owner');
    h.authority.succeed(h.authority.begin('owner', 'return full').token, 'return success');
    const currentActivity = h.controller.captureActivity();
    const current = h.controller.beginMutation(['actual-material']);
    h.controller.settleMutation(old, 'success');
    expect(h.controller.captureActivity()).toMatchObject({ started: 1, settled: 0, pending: 1 });
    expect(h.controller.successfulTargetsSince(currentActivity)).toEqual([]);
    expect(h.controller.successfulTargetsSince(oldActivity)).toEqual([]);
    expect(h.authority.readSnapshot().recovery).toBeNull();
    h.controller.settleMutation(current, 'success');
    expect(h.controller.successfulTargetsSince(currentActivity)).toEqual(['actual-material']);
  });

  it('requests MonthEvents synchronously on success after accepted full replacement, before releasing the writer barrier', async () => {
    const h = harness();
    const month = h.controller.beginMutation(['month-events']);
    const unrelated = h.controller.beginMutation();
    const before = h.controller.captureActivity();
    const full = h.authority.begin('owner', 'full start');
    h.authority.succeed(full.token, 'full success', h.controller.isQuiescentSince(before), []);
    h.controller.pump();
    h.controller.settleMutation(month, 'success');
    expect(h.controller.successfulTargetsSince(before)).toEqual(['month-events']);
    expect(h.authority.readSnapshot().recovery?.phase).toBe('waiting');
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    h.controller.settleMutation(unrelated);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(sorted(h.read.mock.calls[0][1])).toEqual(sorted(BOTH));
    h.reads[0].resolve({ 'actual-material': ['current actual/material'], 'month-events': ['durable month'] });
    await flush();
    expect(h.authority.read().status).toBe('ready');
  });

  it('retains already-settled MonthEvent success when an older full snapshot accepts afterward', async () => {
    const h = harness();
    const full = h.authority.begin('owner', 'full start');
    const before = h.controller.captureActivity();
    const month = h.controller.beginMutation(['month-events']);
    h.controller.settleMutation(month, 'success');
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.controller.captureActivity().pending).toBe(0);
    expect(h.controller.successfulTargetsSince(before)).toEqual(['month-events']);
    h.authority.succeed(full.token, 'stale full accepted',
      h.controller.isQuiescentSince(before), h.controller.successfulTargetsSince(before));
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(sorted(h.read.mock.calls[0][1])).toEqual(sorted(BOTH));
    h.reads[0].resolve({ 'actual-material': [], 'month-events': ['current durable row'] });
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith({ 'actual-material': [], 'month-events': ['current durable row'] });
    expect(h.authority.read().status).toBe('ready');
  });

  it.each(['before', 'after'] as const)('rejected-only MonthEvent settlement %s full acceptance adds no MonthEvent repair request', async timing => {
    const h = harness();
    const full = h.authority.begin('owner', 'full start');
    const before = h.controller.captureActivity();
    const month = h.controller.beginMutation(['month-events']);
    if (timing === 'before') h.controller.settleMutation(month, 'failure');
    h.authority.succeed(full.token, 'full accepted',
      h.controller.isQuiescentSince(before), h.controller.successfulTargetsSince(before));
    if (timing === 'after') h.controller.settleMutation(month, 'failure');
    h.controller.pump();
    await flush();
    expect(h.controller.successfulTargetsSince(before)).toEqual([]);
    expect(h.read).toHaveBeenCalledExactlyOnceWith('owner', ['actual-material']);
    h.reads[0].resolve({ 'actual-material': [] });
    await flush();
    expect(h.authority.read().status).toBe('ready');
  });

  it.each(['success', 'failure'] as const)('an uncontended MonthEvent %s adds no target reads', async outcome => {
    const h = harness();
    const mutation = h.controller.beginMutation(['month-events']);
    h.controller.settleMutation(mutation, outcome);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toBeNull();
  });

  it('a failed full read does not look like an accepted projection crossing a successful MonthEvent write', async () => {
    const h = harness();
    const before = h.controller.captureActivity();
    const mutation = h.controller.beginMutation(['month-events']);
    h.authority.fail(h.authority.begin('owner', 'full start').token, 'full failure');
    h.controller.settleMutation(mutation, 'success');
    await flush();
    expect(h.controller.successfulTargetsSince(before)).toEqual(['month-events']);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ reason: 'full-read', canRetry: true });
  });

  it.each(orders)('does not partially publish prepared %s data when the requested %s group fails', async (succeeds, fails) => {
    const h = harness();
    const groupReads: Partial<Record<PlannerRepairTarget, ReturnType<typeof deferred<string[]>>>> = {
      'actual-material': deferred<string[]>(),
      'month-events': deferred<string[]>(),
    };
    const read = vi.fn(async (_owner: string, targets: readonly PlannerRepairTarget[]): Promise<Snapshot> => {
      const results = await Promise.all(targets.map(async target => [target, await groupReads[target]!.promise] as const));
      return Object.fromEntries(results);
    });
    h.controller.configure({ isCurrent: owner => owner === 'owner', read, publish: h.publish, changed: h.changed });
    const revision = h.authority.captureProjectionLease()!.acceptedRevision;
    h.controller.request(h.authority.captureOwnerScope()!, BOTH);
    await flush();
    groupReads[succeeds]!.resolve(['prepared successful group']);
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.authority.read().status).toBe('stale');
    expect(h.authority.captureProjectionLease()!.acceptedRevision).toBe(revision);
    groupReads[fails]!.reject(new Error('other requested group failed'));
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.authority.captureProjectionLease()!.acceptedRevision).toBe(revision);
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
    h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish, changed: h.changed });
    h.authority.retryReconciliation(h.authority.captureOwnerScope()!, 'explicit retry');
    h.controller.pump();
    await flush();
    expect(sorted(h.read.mock.calls[0][1])).toEqual(sorted(BOTH));
    const complete = { 'actual-material': ['reread actual/material'], 'month-events': ['reread month'] };
    h.reads[0].resolve(complete);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(complete);
    expect(h.authority.read().status).toBe('ready');
  });

  it.each([false, true])('preserves the union when another writer crosses a target read: obsoleteFailure=%s', async oldFailure => {
    const h = harness();
    h.controller.request(h.authority.captureOwnerScope()!, BOTH);
    await flush();
    const writer = h.controller.beginMutation(['month-events']);
    if (oldFailure) h.reads[0].reject(new Error('obsolete failure'));
    else h.reads[0].resolve({ 'month-events': ['obsolete month'], 'actual-material': ['obsolete actual'] });
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'waiting', canRetry: false });
    h.controller.settleMutation(writer, 'success');
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(sorted(h.read.mock.calls[1][1])).toEqual(sorted(BOTH));
    h.reads[1].resolve({ 'actual-material': [], 'month-events': ['fresh'] });
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith({ 'actual-material': [], 'month-events': ['fresh'] });
  });
});

describe('successful-settlement reentrant observer safety', () => {
  it('claims a success once before a synchronous observer repeats the same settlement', async () => {
    const h = harness();
    const mutation = h.controller.beginMutation(['month-events']);
    h.authority.succeed(h.authority.begin('owner', 'crossed full').token, 'crossed success', false);
    let repeated = false;
    h.controller.configure({
      isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish,
      changed: () => {
        if (!repeated) {
          repeated = true;
          h.controller.settleMutation(mutation, 'success');
        }
      },
    });
    h.controller.settleMutation(mutation, 'success');
    expect(h.controller.captureActivity()).toMatchObject({
      started: 1, settled: 1, pending: 0, successful: { 'month-events': 1 },
    });
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(sorted(h.read.mock.calls[0][1])).toEqual(sorted(BOTH));
    h.reads[0].resolve({ 'actual-material': [], 'month-events': ['durable'] });
    await flush();
    expect(h.authority.read().status).toBe('ready');
  });

  it('cannot increment a new epoch or release its writer after an observer resets during successful settlement', async () => {
    const h = harness();
    const mutation = h.controller.beginMutation(['month-events']);
    h.authority.succeed(h.authority.begin('owner', 'crossed full').token, 'crossed success', false);
    let reset = false;
    h.controller.configure({
      isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish,
      changed: () => {
        if (reset) return;
        reset = true;
        h.authority.reset();
        h.controller.reset();
        h.authority.succeed(h.authority.begin('owner', 'new epoch full').token, 'new epoch success');
        h.controller.beginMutation(['actual-material']);
      },
    });
    h.controller.settleMutation(mutation, 'success');
    expect(h.controller.captureActivity()).toMatchObject({
      started: 1, settled: 0, pending: 1, successful: { 'actual-material': 0, 'month-events': 0 },
    });
    expect(h.authority.readSnapshot().recovery).toBeNull();
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
});
