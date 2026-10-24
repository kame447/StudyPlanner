import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { compareAnnouncementTime, isAnnouncementUnread, type Announcement } from '../features/announcements/announcement';
import { useAnnouncementUnread } from './useAnnouncementUnread';

type Constraint = { kind: string; field?: string; op?: string; value?: unknown; count?: number; time?: Timestamp; id?: string };
type Query = { path: string; constraints: Constraint[] };
type Row = { id: string; data: () => Record<string, unknown> };
type Observation = { path: string; kind: 'query' | 'document'; ids: string[] };
const sdk = vi.hoisted(() => ({ uid: 'owner', getDocs: vi.fn(), getDoc: vi.fn() }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: sdk.uid } }), getFirestoreDb: () => ({}) }));
vi.mock('firebase/firestore', async original => ({
  ...await original<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...paths: string[]) => paths.join('/'),
  collection: (_db: unknown, ...paths: string[]) => paths.join('/'),
  documentId: () => '__name__',
  query: (path: string, ...constraints: Constraint[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  limit: (count: number) => ({ kind: 'limit', count }),
  orderBy: (field: string, direction: string) => ({ kind: 'order', field, direction }),
  startAfter: (time: Timestamp, id: string) => ({ kind: 'after', time, id }),
  getDocsFromServer: (query: Query) => sdk.getDocs(query),
  getDocFromServer: (path: string) => sdk.getDoc(path),
}));

let announcements: Announcement[];
let receipts: Record<string, Record<string, Timestamp>>;
let summaries: Record<string, Timestamp>;
let observations: Observation[];
let model: ReturnType<typeof useAnnouncementUnread>;
let renderer: ReactTestRenderer | undefined;
let foreground: EventTarget;
let visibility: EventTarget & { visibilityState: string };
const item = (n: number): Announcement => ({ id: `notice-${n}`, title: `Notice ${n}`, body: 'Synthetic announcement',
  category: 'お知らせ', revision: 1, publishedAt: { seconds: 1000 - n, nanoseconds: 7 } });
const timestamp = (item: Announcement) => new Timestamp(item.publishedAt.seconds, item.publishedAt.nanoseconds);
function Probe({ owner = 'owner' }: { owner?: string }) { model = useAnnouncementUnread(owner, false); return null; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function snapshot(data?: Record<string, unknown>) { return { exists: () => data !== undefined, data: () => data }; }
async function readQuery(query: Query): Promise<{ docs: Row[] }> {
  let docs: Row[];
  if (query.path === 'announcements') {
    let rows = announcements.slice().sort((a, b) => compareAnnouncementTime(b.publishedAt, a.publishedAt) || b.id.localeCompare(a.id));
    const cursor = query.constraints.find(constraint => constraint.kind === 'after');
    if (cursor) rows = rows.filter(row => compareAnnouncementTime(row.publishedAt, cursor.time!) < 0
      || compareAnnouncementTime(row.publishedAt, cursor.time!) === 0 && row.id.localeCompare(cursor.id!) < 0);
    docs = rows.map(row => ({ id: row.id, data: () => ({ ...row, schemaVersion: 1, publishedAt: timestamp(row) }) }));
  } else {
    const owner = query.path.split('/')[1];
    const constraint = query.constraints.find(constraint => constraint.kind === 'where');
    expect(constraint?.field).toBe('__name__'); expect(constraint?.op).toBe('in');
    const ids = constraint!.value as string[];
    expect(ids.length).toBeGreaterThan(0); expect(ids.length).toBeLessThanOrEqual(25);
    docs = ids.filter(id => receipts[owner]?.[id]).map(id => ({ id, data: () => ({ publishedAt: receipts[owner][id] }) }));
  }
  const count = query.constraints.find(constraint => constraint.kind === 'limit')?.count;
  docs = docs.slice(0, count);
  observations.push({ path: query.path, kind: 'query', ids: docs.map(row => row.id) });
  return { docs };
}
function counts(label: string) {
  const value = { label, queries: observations.filter(row => row.kind === 'query').length,
    directReads: observations.filter(row => row.kind === 'document').length,
    returnedDocuments: observations.reduce((sum, row) => sum + row.ids.length, 0),
    receiptQueries: observations.filter(row => row.path.endsWith('/items')).length,
    receiptDocuments: observations.filter(row => row.path.endsWith('/items')).reduce((sum, row) => sum + row.ids.length, 0) };
  console.log(JSON.stringify(value)); return value;
}
async function mount(settle = true) {
  await act(async () => { renderer = create(<Probe />); });
  if (settle) await act(async () => { await model.loadPage(null); });
}
async function refresh(settle = true) {
  vi.advanceTimersByTime(300000);
  await act(async () => { foreground.dispatchEvent(new Event('focus')); });
  if (settle) await act(async () => { await model.loadPage(null); });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); sdk.uid = 'owner';
  foreground = new EventTarget(); visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', foreground); vi.stubGlobal('document', visibility);
  announcements = Array.from({ length: 25 }, (_, n) => item(n));
  receipts = { owner: Object.fromEntries(announcements.map(row => [row.id, timestamp(row)])), other: {} };
  summaries = {}; observations = [];
  sdk.getDocs.mockImplementation(readQuery);
  sdk.getDoc.mockImplementation(async (path: string) => {
    const through = summaries[path.split('/')[1]];
    observations.push({ path, kind: 'document', ids: through ? [path] : [] });
    return snapshot(through ? { through } : undefined);
  });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('real announcement hook/service receipt query boundary', () => {
  it('refreshes publications and the owner summary without rereading 25 acknowledged receipts', async () => {
    await mount(); expect(model.status).toBe('read');
    expect(counts('initial-25')).toMatchObject({ queries: 2, directReads: 1, returnedDocuments: 50, receiptDocuments: 25 });
    observations = []; await refresh();
    const result = counts('refresh-25-known');
    expect(model.status).toBe('read');
    expect(result).toMatchObject({ queries: 1, directReads: 1, returnedDocuments: 25, receiptQueries: 0 });
    const page = await model.loadPage(null); expect(page.page.items).toHaveLength(25);
    expect(page.page.items.every(item => !isAnnouncementUnread(item, page.read))).toBe(true);
  });

  it('queries only five unknown receipts and observes their acknowledgement from another device', async () => {
    for (const row of announcements.slice(20)) delete receipts.owner[row.id];
    await mount(); expect(model.status).toBe('unread');
    for (const row of announcements.slice(20)) receipts.owner[row.id] = timestamp(row);
    observations = []; await refresh();
    const result = counts('refresh-20-known-5-remote-acks');
    expect(model.status).toBe('read');
    expect(result).toMatchObject({ queries: 2, directReads: 1, returnedDocuments: 30, receiptDocuments: 5 });
    const request = sdk.getDocs.mock.calls.map(([query]) => query as Query).filter(query => query.path.endsWith('/items')).pop()!;
    expect(request.constraints.find(constraint => constraint.kind === 'where')?.value).toEqual(announcements.slice(20).map(item => item.id));
  });

  it('keeps all historical continuation items while skipping receipts covered by the bulk watermark', async () => {
    announcements = Array.from({ length: 30 }, (_, n) => item(n));
    summaries.owner = timestamp(announcements[0]);
    await mount(); expect(model.status).toBe('read');
    const first = await model.loadPage(null); expect(first.page.items).toHaveLength(25); expect(first.page.nextCursor).not.toBeNull();
    observations = []; let next!: Awaited<ReturnType<typeof model.loadPage>>;
    await act(async () => { next = await model.loadPage(first.page.nextCursor); });
    const result = counts('older-page-bulk-covered');
    expect(next.page.items.map(item => item.id)).toEqual(announcements.slice(25).map(item => item.id));
    expect(next.page.nextCursor).toBeNull(); expect(model.status).toBe('read');
    expect(result).toMatchObject({ queries: 1, directReads: 1, returnedDocuments: 6, receiptQueries: 0 });
  });

  it('queries a publication revised one nanosecond after the old receipt and observes its later ACK', async () => {
    summaries.owner = timestamp(announcements[0]);
    await mount();
    announcements[0] = { ...announcements[0], revision: 2, publishedAt: { ...announcements[0].publishedAt, nanoseconds: 8 } };
    observations = []; await refresh();
    expect(model.status).toBe('unread');
    expect(counts('republished-newer-nanosecond')).toMatchObject({ queries: 2, directReads: 1, receiptDocuments: 1 });
    const request = sdk.getDocs.mock.calls.map(([query]) => query as Query).filter(query => query.path.endsWith('/items')).pop()!;
    expect(request.constraints.find(constraint => constraint.kind === 'where')?.value).toEqual([announcements[0].id]);
    receipts.owner[announcements[0].id] = timestamp(announcements[0]);
    await refresh(); expect(model.status).toBe('read');
  });

  it('reuses individual and bulk ACKs received while a page is pending', async () => {
    receipts.owner = {}; await mount(); expect(model.status).toBe('unread');
    const gate = deferred<{ docs: Row[] }>();
    sdk.getDocs.mockImplementationOnce(async query => { const rows = await readQuery(query); await gate.promise; return rows; });
    vi.advanceTimersByTime(300000); let pending!: Promise<unknown>;
    await act(async () => { pending = model.loadPage(null); });
    act(() => model.acknowledge({ through: null, items: { [announcements[0].id]: announcements[0].publishedAt } }));
    act(() => model.acknowledge({ through: announcements[1].publishedAt, items: {} }));
    observations = []; await act(async () => { gate.resolve({ docs: [] }); await pending; });
    expect(model.status).toBe('read');
    expect(counts('ack-during-page')).toMatchObject({ directReads: 1, receiptQueries: 0 });
  });

  it('does not reuse owner evidence for another account or a later session of the same account', async () => {
    await mount(); expect(model.status).toBe('read');
    const old = model; sdk.uid = 'other'; observations = [];
    await act(async () => renderer!.update(<Probe owner="other" />));
    expect(model.status).toBe('unread'); expect(counts('other-owner')).toMatchObject({ queries: 2, directReads: 1, receiptQueries: 1 });
    act(() => old.acknowledge({ through: announcements[0].publishedAt, items: {} })); expect(model.status).toBe('unread');
    sdk.uid = 'owner'; observations = [];
    await act(async () => renderer!.update(<Probe />));
    expect(model.status).toBe('read'); expect(counts('return-owner-new-session')).toMatchObject({ receiptQueries: 1, receiptDocuments: 25 });
    act(() => renderer!.unmount()); renderer = undefined; observations = [];
    await mount(); expect(counts('remount-owner')).toMatchObject({ receiptQueries: 1, receiptDocuments: 25 });
  });

  it('rejects a failed fresh summary even when every receipt is known, then retries without losing evidence', async () => {
    await mount(); vi.advanceTimersByTime(300000); observations = [];
    sdk.getDoc.mockImplementationOnce(async (path: string) => {
      observations.push({ path, kind: 'document', ids: [] }); throw new Error('permission-denied');
    });
    await act(async () => { await expect(model.loadPage(null)).rejects.toThrow('permission-denied'); });
    expect(model.status).toBe('read'); expect(counts('failed-summary-known-receipts').receiptQueries).toBe(0);
    await act(async () => { await model.loadPage(null); });
    expect(model.status).toBe('read'); expect(sdk.getDoc).toHaveBeenCalledTimes(3);
  });

  it('drops an old-owner pending publication before starting its receipt reads', async () => {
    const gate = deferred<{ docs: Row[] }>();
    sdk.getDocs.mockImplementationOnce(async query => { const rows = await readQuery(query); await gate.promise; return rows; });
    await mount(false); sdk.uid = 'other';
    await act(async () => renderer!.update(<Probe owner="other" />));
    observations = []; await act(async () => gate.resolve({ docs: [] }));
    expect(model.status).toBe('unread'); expect(observations).toEqual([]);
  });

  it('shares a concurrent explicit open with the foreground refresh', async () => {
    await mount(); const gate = deferred<{ docs: Row[] }>();
    sdk.getDocs.mockImplementationOnce(async query => { const rows = await readQuery(query); await gate.promise; return rows; });
    observations = []; await refresh(false); let pending!: ReturnType<typeof model.loadPage>;
    await act(async () => { pending = model.loadPage(null); });
    await act(async () => { gate.resolve({ docs: [] }); await pending; });
    expect(model.status).toBe('read');
    expect(counts('foreground-and-open')).toMatchObject({ queries: 1, directReads: 1, receiptQueries: 0 });
  });
});
