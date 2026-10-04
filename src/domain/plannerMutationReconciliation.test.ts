import { describe, expect, it, vi } from 'vitest';
import { PlannerDataReadAuthority } from './plannerDataReadAuthority';
import { PlannerMutationReconciliation } from './plannerMutationReconciliation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness() {
  const authority = new PlannerDataReadAuthority();
  authority.succeed(authority.begin('owner', 'full-start').token, 'full-success');
  const reads: ReturnType<typeof deferred<string[]>>[] = [];
  const read = vi.fn(() => { const gate = deferred<string[]>(); reads.push(gate); return gate.promise; });
  const publish = vi.fn();
  const changed = vi.fn();
  let currentOwner: string | null = 'owner';
  const controller = new PlannerMutationReconciliation<string[]>(authority, () => 'target-observed');
  controller.activateOwner('owner');
  controller.configure({ isCurrent: owner => owner === currentOwner, read, publish, changed });
  return { authority, controller, read, reads, publish, changed, setOwner: (owner: string | null) => { currentOwner = owner; } };
}

describe('PlannerMutationReconciliation isolated activity and authority integration', () => {
  it('waits for all local writers, coalesces requests and never waits on its own requester ticket', async () => {
    const h = harness();
    const first = h.controller.beginMutation();
    const second = h.controller.beginMutation();
    h.controller.request(h.authority.captureOwnerScope()!);
    h.controller.request(h.authority.captureOwnerScope()!);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'waiting', canRetry: false });
    h.controller.settleMutation(first);
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    h.controller.settleMutation(second);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.authority.read().status).toBe('stale');
    h.reads[0].resolve(['fresh']);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(['fresh']);
    expect(h.authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'full-success' });
  });

  it.each(['pending at entry', 'start during read', 'settle during read'] as const)('full-load activity fence detects %s', timing => {
    const h = harness();
    const existing = timing === 'pending at entry' || timing === 'settle during read' ? h.controller.beginMutation() : null;
    const snapshot = h.controller.captureActivity();
    if (timing === 'start during read') h.controller.beginMutation();
    if (existing) h.controller.settleMutation(existing);
    expect(h.controller.isQuiescentSince(snapshot)).toBe(false);
  });

  it.each([false, true])('rejects an unstable read, including a failed read, then waits for a writer: failure=%s', async failure => {
    const h = harness();
    h.controller.request(h.authority.captureOwnerScope()!);
    await flush();
    const writer = h.controller.beginMutation();
    if (failure) h.reads[0].reject(new Error('obsolete failure')); else h.reads[0].resolve(['obsolete']);
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'waiting', canRetry: false });
    expect(h.read).toHaveBeenCalledTimes(1);
    h.controller.settleMutation(writer);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    h.reads[1].resolve(['after writer']);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(['after writer']);
  });

  it('latches stable failure across ordinary writer activity and only explicit retry re-arms it once', async () => {
    const h = harness();
    const scope = h.authority.captureOwnerScope()!;
    h.controller.request(scope);
    await flush();
    h.reads[0].reject(new Error('offline'));
    await flush();
    const activity = h.controller.beginMutation();
    h.controller.settleMutation(activity);
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(h.authority.retryReconciliation(scope, 'retry')).toBe(true);
    expect(h.authority.retryReconciliation(scope, 'duplicate')).toBe(false);
    h.controller.pump();
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    h.reads[1].resolve(['retry success']);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(['retry success']);
  });

  it.each(['owner change', 'reset'] as const)('does not issue a queued old-owner getter after %s', async reason => {
    const h = harness();
    h.controller.request(h.authority.captureOwnerScope()!);
    if (reason === 'owner change') { h.setOwner('other'); h.authority.begin('other', 'new owner'); h.controller.activateOwner('other'); }
    else { h.authority.reset(); h.controller.reset(); }
    await flush();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])('fresh full-replacement concern does not wait for obsolete target promise: oldFailure=%s', async oldFailure => {
    const h = harness();
    h.controller.request(h.authority.captureOwnerScope()!);
    await flush();
    const full = h.authority.begin('owner', 'new full');
    h.authority.succeed(full.token, 'new full success', false);
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    h.reads[1].resolve(['fresh concern']);
    await flush();
    const snapshot = h.authority.readSnapshot();
    if (oldFailure) h.reads[0].reject(new Error('old target failure')); else h.reads[0].resolve(['obsolete']);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(['fresh concern']);
    expect(h.authority.readSnapshot()).toEqual(snapshot);
    expect(h.authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'new full success' });
  });

  it('new evidence supersedes a target ticket immediately and an obsolete finally cannot release its successor', async () => {
    const h = harness();
    const scope = h.authority.captureOwnerScope()!;
    h.controller.request(scope);
    await flush();
    h.controller.request(scope);
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    h.reads[0].resolve(['old']);
    await flush();
    expect(h.publish).not.toHaveBeenCalled();
    h.controller.pump();
    await flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    h.reads[1].resolve(['new']);
    await flush();
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(['new']);
  });

  it('old mutation settlement cannot release a current-epoch writer after reset', async () => {
    const h = harness();
    const old = h.controller.beginMutation();
    h.controller.reset();
    const current = h.controller.beginMutation();
    h.controller.request(h.authority.captureOwnerScope()!);
    h.controller.settleMutation(old);
    expect(h.controller.captureActivity()).toMatchObject({ started: 1, settled: 0, pending: 1 });
    h.controller.settleMutation(current);
    h.controller.settleMutation(current);
    await flush();
    expect(h.controller.captureActivity()).toMatchObject({ started: 1, settled: 1, pending: 0 });
    expect(h.read).toHaveBeenCalledTimes(1);
    h.reads[0].resolve([]);
    await flush();
  });
});

it('latches a synchronous current publication exception and retries without an automatic loop', async () => {
  const h = harness();
  const publish = vi.fn(() => { throw new Error('publication unavailable'); });
  h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish, changed: h.changed });
  h.controller.request(h.authority.captureOwnerScope()!);
  await flush();
  h.reads[0].resolve(['prepared']);
  await flush();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(h.authority.read().lastSuccessfulAt).toBe('full-success');
  const mutation = h.controller.beginMutation();
  h.controller.settleMutation(mutation);
  await flush();
  expect(h.read).toHaveBeenCalledTimes(1);
  h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish, changed: h.changed });
  h.authority.retryReconciliation(h.authority.captureOwnerScope()!, 'retry');
  h.controller.pump();
  await flush();
  h.reads[1].resolve(['retry']);
  await flush();
  expect(h.publish).toHaveBeenCalledExactlyOnceWith(['retry']);
  expect(h.authority.read().status).toBe('ready');
});

it('a publication exception after superseding its ticket cannot fail the successor', async () => {
  const h = harness();
  let first = true;
  const publish = vi.fn((snapshot: string[]) => {
    if (first) {
      first = false;
      h.controller.request(h.authority.captureOwnerScope()!);
      throw new Error('obsolete publication');
    }
    h.publish(snapshot);
  });
  h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish, changed: h.changed });
  h.controller.request(h.authority.captureOwnerScope()!);
  await flush();
  h.reads[0].resolve(['old']);
  await flush();
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'refreshing', canRetry: false });
  h.reads[1].resolve(['new']);
  await flush();
  expect(h.publish).toHaveBeenCalledExactlyOnceWith(['new']);
  expect(h.authority.read().status).toBe('ready');
});

it('a throwing read-start observer latches recovery without making a detached request', async () => {
  const h = harness();
  let calls = 0;
  const changed = vi.fn(() => { if (++calls === 2) throw new Error('observer unavailable'); });
  h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish, changed });
  h.controller.request(h.authority.captureOwnerScope()!);
  await flush();
  expect(h.read).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(3);
  expect(h.authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
});

it('a post-accept observer exception cannot resurrect an already accepted concern', async () => {
  const h = harness();
  let calls = 0;
  const changed = vi.fn(() => { if (++calls === 3) throw new Error('observer unavailable'); });
  h.controller.configure({ isCurrent: owner => owner === 'owner', read: h.read, publish: h.publish, changed });
  h.controller.request(h.authority.captureOwnerScope()!);
  await flush();
  h.reads[0].resolve(['accepted']);
  await flush();
  expect(h.publish).toHaveBeenCalledExactlyOnceWith(['accepted']);
  expect(h.authority.read().status).toBe('ready');
  expect(h.authority.readSnapshot().recovery).toBeNull();
  expect(h.read).toHaveBeenCalledTimes(1);
});
