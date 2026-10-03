import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityLogEntryPage, ObservabilityLogSessionPage, ObservabilityLogSessionSummary } from '../../shared/productObservabilityLogReadModel';

const { listMock, entryMock, bundleMock } = vi.hoisted(() => ({ listMock: vi.fn(), entryMock: vi.fn(), bundleMock: vi.fn() }));
vi.mock('../services/adminObservabilityService', () => ({ getAdminObservabilityLogs: listMock, getAdminObservabilityLogEntries: entryMock, getAdminObservabilityDebugBundle: bundleMock }));
import { AdminLogsPage } from './AdminLogsPage';

function deferred<T>(params: unknown) {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { params, promise, resolve, reject };
}
const lists: ReturnType<typeof deferred<ObservabilityLogSessionPage>>[] = [];
const details: ReturnType<typeof deferred<ObservabilityLogEntryPage>>[] = [];
const bundles: ReturnType<typeof deferred<unknown>>[] = [];
function session(id: string, status = 'active'): ObservabilityLogSessionSummary {
  return { source: 'weekly_planning_trace', traceSessionId: id, subjectAlias: 'synthetic', status, severity: 'info', startedAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z', endedAt: null, planningRangeStart: null, planningRangeEnd: null, entryCount: 40, turnCount: 1, hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false, appVersion: null, traceSchemaVersion: 2, summary: 'synthetic', metadataEvidence: 'indexed_activity' };
}
function page(ids: string[], nextCursor: string | null = null, status = 'active'): ObservabilityLogSessionPage {
  return { sessions: ids.map((id) => session(id, status)), nextCursor, pageEvidence: { rawDocumentCount: ids.length, mappedSessionCount: ids.length, unreadableSessionCount: 0, statusFilteredCount: 0 } };
}
function entries(ids: string[], nextAfterSequence: number | null = null, missing = 0): ObservabilityLogEntryPage {
  return { entries: ids.map((id) => ({ id, source: 'weekly_planning_trace', feature: 'weekly_planning', occurredAt: '2026-10-01T00:00:00Z', severity: 'info', subjectAlias: 'synthetic', traceSessionId: 'A', requestId: null, stateRevision: null, eventType: 'synthetic', summary: id, detail: {} })), totalEntryCount: 40, nextAfterSequence, responseBytes: 100, pageEvidence: { indexCountStatus: 'valid', requestedStartSequence: 0, requestedEndSequence: 19, unavailableSequenceCount: missing, unprojectableEntryCount: 0, byteLimited: false, indexedRangeExhausted: nextAfterSequence === null } };
}
let renderer: ReactTestRenderer | undefined;
async function mount() { await act(async () => { renderer = create(<AdminLogsPage />); }); }
async function settle<T>(request: ReturnType<typeof deferred<T>>, value: T) { await act(async () => { request.resolve(value); }); }
function button(label: string) { return renderer!.root.findAllByType('button').find((node) => node.children.includes(label))!; }
async function click(label: string) { const target = button(label); expect(target).toBeDefined(); expect(target.props.disabled).not.toBe(true); await act(async () => { target.props.onClick(); }); }
async function toggle(id: string) {
  const target = renderer!.root.findAllByProps({ className: 'admin-log-session-toggle' }).find((node) => node.findByType('code').children.join('') === id)!;
  await act(async () => { target.props.onClick(); });
}
async function filter(status: string) { await act(async () => { renderer!.root.findByType('select').props.onChange({ target: { value: status } }); }); await click('適用'); }
function ids() { return renderer!.root.findAllByProps({ className: 'admin-log-session-toggle' }).map((node) => node.findByType('code').children.join('')); }
function entryIds() { return renderer!.root.findAllByProps({ className: 'admin-log-entry' }).map((node) => node.findByType('p').children.join('')); }
function listEvidenceText() { return renderer!.root.findAllByType('p').map((node) => node.children.join('')).filter((value) => value.startsWith('取得ページ ')).join(''); }
function text() { return JSON.stringify(renderer!.toJSON()); }

beforeEach(() => {
  lists.length = 0; details.length = 0; bundles.length = 0;
  listMock.mockReset().mockImplementation((params) => { const r = deferred<ObservabilityLogSessionPage>(params); lists.push(r); return r.promise; });
  entryMock.mockReset().mockImplementation((params) => { const r = deferred<ObservabilityLogEntryPage>(params); details.push(r); return r.promise; });
  bundleMock.mockReset().mockImplementation((params) => { const r = deferred<unknown>(params); bundles.push(r); return r.promise; });
  const location = { pathname: '/admin/logs', search: '' };
  vi.stubGlobal('window', { location, history: { replaceState: (_state: unknown, _title: string, url: string) => { location.search = new URL(url, 'https://example.invalid').search; } } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Admin Logs request ownership', () => {
  it('keeps a newer filter result and evidence when the original request resolves late', async () => {
    await mount(); const old = lists[0]; await filter('failed');
    await settle(lists[1], page(['new'], null, 'failed'));
    const currentEvidence = listEvidenceText();
    expect(currentEvidence).toContain('元データ 1 件');
    await settle(old, page(['old', 'obsolete'], 'old-cursor'));
    expect(ids()).toEqual(['new']); expect(window.location.search).toBe('?status=failed');
    expect(button('次のsessionを読む')).toBeUndefined();
    expect(listEvidenceText()).toBe(currentEvidence);
    expect(listEvidenceText()).not.toContain('元データ 2 件');
  });
  it('ignores an append from a previous filter', async () => {
    await mount(); await settle(lists[0], page(['old'], 'old-cursor')); await click('次のsessionを読む'); const oldAppend = lists[1];
    await filter('failed'); await settle(lists[2], page(['new'], null, 'failed'));
    await settle(oldAppend, page(['old-page2'], 'old-next'));
    expect(ids()).toEqual(['new']); expect(button('次のsessionを読む')).toBeUndefined();
  });
  it('invalidates the previous cursor as soon as a replacement starts', async () => {
    await mount(); await settle(lists[0], page(['old'], 'old-cursor')); const oldClick = button('次のsessionを読む').props.onClick;
    await filter('failed');
    await act(async () => { oldClick(); });
    expect(lists).toHaveLength(2);
    expect(button('次のsessionを読む')).toBeUndefined();
  });
  it('does not let an obsolete append release a current append lock or duplicate a page', async () => {
    await mount(); await settle(lists[0], page(['A'], 'cursor1')); await click('次のsessionを読む'); const old = lists[1];
    await click('再読込'); await settle(lists[2], page(['A'], 'cursor1')); await click('次のsessionを読む'); const current = lists[3];
    await settle(old, page(['B'], 'cursor2'));
    expect(ids()).toEqual(['A']); expect(button('読込中...').props.disabled).toBe(true);
    await settle(current, page(['B'], 'cursor2')); expect(ids()).toEqual(['A', 'B']);
  });
  it('suppresses duplicate same-tick list pagination at the request boundary', async () => {
    await mount(); await settle(lists[0], page(['A'], 'cursor1')); const more = button('次のsessionを読む');
    await act(async () => { more.props.onClick(); more.props.onClick(); });
    expect(lists).toHaveLength(2);
  });
  it('does not leave an obsolete error on a successful new filter', async () => {
    await mount(); const old = lists[0]; await filter('failed');
    await act(async () => { old.reject(new Error('obsolete failure')); });
    await settle(lists[1], page(['new'], null, 'failed'));
    expect(ids()).toEqual(['new']); expect(text()).not.toContain('obsolete failure');
  });
  it('keeps session A locked while B loads and admits each detail page once', async () => {
    await mount(); await settle(lists[0], page(['A', 'B'])); await toggle('A'); await settle(details[0], entries(['A-0'], 19, 1));
    await click('次のentryを読む'); const a = details[1]; await toggle('B'); await toggle('A');
    const more = renderer!.root.findAllByType('button').find((node) => node.props.className === 'ghost-button admin-log-load-more')!;
    expect(more.props.disabled).toBe(true);
    await act(async () => { more.props.onClick(); }); expect(details).toHaveLength(3);
    await settle(a, entries(['A-20'])); expect(entryIds()).toEqual(['A-0', 'A-20']);
    expect(text()).toContain('取得済みの範囲に欠損または読めない記録があります');
  });
  it('reuses an initial detail request across collapse and reopen', async () => {
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await toggle('A'); await toggle('A');
    expect(details).toHaveLength(1);
    await settle(details[0], entries(['A-0'], 19)); await click('次のentryを読む'); await settle(details[1], entries(['A-20']));
    expect(entryIds()).toEqual(['A-0', 'A-20']);
  });
  it('rejects a detail response from before a list reload', async () => {
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); const old = details[0];
    await click('再読込'); await settle(lists[1], page(['A'])); await toggle('A'); await settle(details[1], entries(['fresh']));
    await settle(old, entries(['obsolete'], 19, 1));
    expect(entryIds()).toEqual(['fresh']); expect(text()).not.toContain('取得済みの範囲に欠損または読めない記録があります');
  });
  it('rejects retained detail, toggle, and export handlers after a same-tick reload', async () => {
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await settle(details[0], entries(['A-0'], 19));
    const oldDetail = button('次のentryを読む').props.onClick;
    const oldExport = button('Session Debug Bundle').props.onClick;
    const oldToggle = renderer!.root.findByProps({ className: 'admin-log-session-toggle' }).props.onClick;
    const reload = button('再読込').props.onClick;
    await act(async () => { reload(); oldDetail(); oldExport(); oldToggle(); });
    expect(details).toHaveLength(1); expect(bundles).toHaveLength(0);
    await settle(lists[1], page(['A']));
    expect(entryIds()).toEqual([]);
    await toggle('A'); expect(details).toHaveLength(2);
    expect(details[1].params).toMatchObject({ sessionId: 'A', afterSequence: undefined });
    await settle(details[1], entries(['fresh'])); expect(entryIds()).toEqual(['fresh']);
  });
  it('does not download a bundle after unmount', async () => {
    const clicked = vi.fn(); vi.stubGlobal('document', { createElement: () => ({ click: clicked }) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await settle(details[0], entries(['A-0']));
    await click('Session Debug Bundle'); await act(async () => { renderer!.unmount(); }); renderer = undefined;
    await settle(bundles[0], { synthetic: true }); expect(clicked).not.toHaveBeenCalled();
  });
  it('does not replay a completed detail cursor through an obsolete click handler', async () => {
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await settle(details[0], entries(['A-0'], 19));
    const oldClick = button('次のentryを読む').props.onClick;
    await act(async () => { oldClick(); }); await settle(details[1], entries(['A-20'], 39));
    await act(async () => { oldClick(); }); expect(details).toHaveLength(2);
    await click('次のentryを読む'); expect(details[2].params).toMatchObject({ afterSequence: 39 });
  });
  it('deduplicates overlapping server pages while retaining current evidence', async () => {
    await mount(); await settle(lists[0], page(['A'], 'cursor1')); await click('次のsessionを読む');
    await settle(lists[1], page(['A', 'B'])); expect(ids()).toEqual(['A', 'B']);
    await toggle('A'); await settle(details[0], entries(['A-0'], 19, 1)); await click('次のentryを読む');
    await settle(details[1], entries(['A-0', 'A-20'])); expect(entryIds()).toEqual(['A-0', 'A-20']);
    expect(text()).toContain('取得済みの範囲に欠損または読めない記録があります');
  });
  it('keeps a detail error scoped to its own session and allows retry', async () => {
    await mount(); await settle(lists[0], page(['A', 'B'])); await toggle('A'); await settle(details[0], entries(['A-0']));
    await toggle('B'); await toggle('A'); await act(async () => { details[1].reject(new Error('B detail failed')); });
    expect(text()).not.toContain('B detail failed'); expect(entryIds()).toEqual(['A-0']);
    await toggle('B'); expect(details).toHaveLength(3); await settle(details[2], entries(['B-0']));
    expect(text()).not.toContain('B detail failed');
  });
  it('allows an append retry after failure rather than marking a failed cursor complete', async () => {
    await mount(); await settle(lists[0], page(['A'], 'cursor1')); await click('次のsessionを読む');
    await act(async () => { lists[1].reject(new Error('temporary')); }); await click('次のsessionを読む');
    expect(lists[2].params).toMatchObject({ cursor: 'cursor1' }); await settle(lists[2], page(['B']));
    expect(ids()).toEqual(['A', 'B']); expect(text()).not.toContain('temporary');
  });
  it('suppresses duplicate bundle clicks but downloads an owned completed bundle once', async () => {
    const clicked = vi.fn(); vi.stubGlobal('document', { createElement: () => ({ click: clicked }) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await settle(details[0], entries(['A-0']));
    const download = button('Session Debug Bundle').props.onClick;
    await act(async () => { download(); download(); }); expect(bundles).toHaveLength(1);
    await settle(bundles[0], { synthetic: true }); expect(clicked).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it('does not start an obsolete download after reload', async () => {
    const clicked = vi.fn(); vi.stubGlobal('document', { createElement: () => ({ click: clicked }) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await mount(); await settle(lists[0], page(['A'])); await toggle('A'); await settle(details[0], entries(['A-0']));
    await click('Session Debug Bundle'); await click('再読込'); await settle(lists[1], page(['fresh']));
    await settle(bundles[0], { synthetic: true }); expect(clicked).not.toHaveBeenCalled();
  });

});
