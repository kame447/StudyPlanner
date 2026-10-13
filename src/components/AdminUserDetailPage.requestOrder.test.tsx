import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminObservabilityUserInvestigation } from '../services/adminObservabilityService';

const { investigate } = vi.hoisted(() => ({ investigate: vi.fn() }));
vi.mock('../services/adminObservabilityService', () => ({
  getAdminObservabilityUserInvestigation: investigate,
}));
import { AdminUserDetailPage } from './AdminUserDetailPage';
import { AdminGuard } from './AdminGuard';

type Query = Parameters<typeof import('../services/adminObservabilityService').getAdminObservabilityUserInvestigation>[0];
function deferred(query: Query) {
  let resolve!: (value: AdminObservabilityUserInvestigation) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AdminObservabilityUserInvestigation>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { query, promise, resolve, reject };
}

const requests: ReturnType<typeof deferred>[] = [];
let renderer: ReactTestRenderer | undefined;
const navigate = vi.fn();
function page(actorSubjectId: string, ids: string[], nextCursor: string | null = null): AdminObservabilityUserInvestigation {
  return {
    actorSubjectId,
    environment: 'production',
    summary: null,
    activeDayCount: 1,
    nextCursor,
    timeline: ids.map((eventId) => ({
      eventId,
      eventType: 'product_activity',
      occurredAt: '2026-10-13T00:00:00Z',
      appVersion: eventId,
      productAction: null,
      ai: null,
      planningOutcome: null,
      featureSessionId: null,
      requestId: null,
      traceSessionId: null,
    })),
  };
}

async function show(actor: string, status: 'allowed' | 'checking' | 'denied' = 'allowed') {
  await act(async () => {
    const view = (
      <AdminGuard status={status}>
        <AdminUserDetailPage userId={actor} navigate={navigate} />
      </AdminGuard>
    );
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}
async function settle(index: number, result: AdminObservabilityUserInvestigation) {
  await act(async () => { requests[index].resolve(result); });
}
async function fail(index: number, message: string) {
  await act(async () => { requests[index].reject(new Error(message)); });
}
function moreButton() {
  return renderer!.root.findAllByType('button').find((button) =>
    button.children.includes('次の50件を読み込む') || button.children.includes('読み込み中…'));
}
async function more() {
  const button = moreButton();
  expect(button).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => { void button!.props.onClick(); });
}
function rows() {
  return renderer!.root.findAllByProps({ className: 'admin-observability-timeline-item' })
    .map((row) => row.findByType('small').children.join('').replace('app ', ''));
}
function text() { return JSON.stringify(renderer!.toJSON()); }

beforeEach(() => {
  requests.length = 0;
  investigate.mockReset().mockImplementation((query: Query) => {
    const request = deferred(query);
    requests.push(request);
    return request.promise;
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

describe('Admin user investigation request ownership', () => {
  it('retains normal page order and advances the selected actor cursor', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    expect(requests[1].query).toEqual({ actorSubjectId: 'A', environment: 'production', cursor: 'A-cursor-1', limit: 50 });
    await settle(1, page('A', ['A-2'], 'A-cursor-2'));
    await more();
    expect(requests[2].query.cursor).toBe('A-cursor-2');
    await settle(2, page('A', ['A-3']));
    expect(rows()).toEqual(['A-1', 'A-2', 'A-3']);
    expect(moreButton()).toBeUndefined();
  });

  it('clears prior actor detail, appended rows and cursor before the next actor resolves', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    await settle(1, page('A', ['A-2'], 'A-cursor-2'));
    await show('B');
    expect(rows()).toEqual([]);
    expect(text()).not.toContain('A-1');
    expect(moreButton()).toBeUndefined();
    await settle(2, page('B', ['B-1'], 'B-cursor-1'));
    expect(rows()).toEqual(['B-1']);
    await more();
    expect(requests[3].query).toMatchObject({ actorSubjectId: 'B', cursor: 'B-cursor-1' });
  });

  it.each(['success', 'failure'] as const)('ignores an old %s and its finally while the new actor is loading more', async (outcome) => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    await show('B');
    await settle(2, page('B', ['B-1'], 'B-cursor-1'));
    await more();
    if (outcome === 'success') await settle(1, page('A', ['A-obsolete'], 'A-cursor-2'));
    else await fail(1, 'obsolete actor failure');
    expect(rows()).toEqual(['B-1']);
    expect(text()).not.toContain('obsolete actor failure');
    expect(moreButton()!.props.disabled).toBe(true);
    await settle(3, page('B', ['B-2']));
    expect(rows()).toEqual(['B-1', 'B-2']);
    expect(moreButton()).toBeUndefined();
  });

  it('admits only one request for same-tick pagination clicks', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    const click = moreButton()!.props.onClick;
    await act(async () => { void click(); void click(); });
    expect(requests).toHaveLength(2);
    await settle(1, page('A', ['A-2']));
    expect(rows()).toEqual(['A-1', 'A-2']);
  });

  it('rejects a retained callback for a completed cursor', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    const click = moreButton()!.props.onClick;
    await act(async () => { void click(); });
    await settle(1, page('A', ['A-2'], 'A-cursor-2'));
    await act(async () => { void click(); });
    expect(requests).toHaveLength(2);
    await more();
    expect(requests[2].query.cursor).toBe('A-cursor-2');
  });

  it('retries a failed cursor once and clears its error on success', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    await fail(1, 'retryable failure');
    expect(text()).toContain('retryable failure');
    expect(rows()).toEqual(['A-1']);
    await more();
    expect(requests[2].query.cursor).toBe('A-cursor-1');
    await settle(2, page('A', ['A-2']));
    expect(text()).not.toContain('retryable failure');
    expect(rows()).toEqual(['A-1', 'A-2']);
  });

  it('does not retain a previous actor pagination error after navigation', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    await fail(1, 'A-only failure');
    await show('B');
    await settle(2, page('B', ['B-1']));
    expect(text()).not.toContain('A-only failure');
  });

  it.each(['switch actor', 'unmount'] as const)('rejects a retained callback after %s', async (action) => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    const click = moreButton()!.props.onClick;
    if (action === 'switch actor') await show('B');
    else { act(() => renderer!.unmount()); renderer = undefined; }
    const requestCount = requests.length;
    await act(async () => { void click(); });
    expect(requests).toHaveLength(requestCount);
  });

  it('does not revive an older A request after navigating A to B to A', async () => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    await more();
    await show('B');
    await settle(2, page('B', ['B-1']));
    await show('A');
    await settle(3, page('A', ['A-fresh'], 'A-fresh-cursor'));
    await settle(1, page('A', ['A-obsolete']));
    expect(rows()).toEqual(['A-fresh']);
    await more();
    expect(requests[4].query.cursor).toBe('A-fresh-cursor');
  });

  it('preserves the initial loader protection when an earlier actor resolves late', async () => {
    await show('A');
    await show('B');
    await settle(1, page('B', ['B-1']));
    await settle(0, page('A', ['A-obsolete']));
    expect(rows()).toEqual(['B-1']);
  });

  it.each(['checking', 'denied'] as const)('revokes pagination when the existing auth guard is %s', async (status) => {
    await show('A');
    await settle(0, page('A', ['A-1'], 'A-cursor-1'));
    const click = moreButton()!.props.onClick;
    await more();
    await show('A', status);
    await act(async () => { void click(); });
    expect(requests).toHaveLength(2);
    expect(rows()).toEqual([]);
    await show('A');
    await settle(2, page('A', ['A-fresh'], 'A-fresh-cursor'));
    await settle(1, page('A', ['A-obsolete']));
    expect(rows()).toEqual(['A-fresh']);
    await more();
    expect(requests[3].query.cursor).toBe('A-fresh-cursor');
  });
});
