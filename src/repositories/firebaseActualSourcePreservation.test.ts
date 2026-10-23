import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { scheduleEventFromMonthEvent } from '../domain/scheduleEvent';
import { actual, event } from './localPersistenceConcurrency.testUtils';
import { deleteMonthEventPreservingActualSources } from './firebaseActualSourcePreservation';
const boundary = vi.hoisted(() => ({ getDocs: vi.fn(), runTransaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...clauses: unknown[]) => ({ source, clauses }),
  getDocs: boundary.getDocs, runTransaction: boundary.runTransaction,
}));
type Ref = { name: string; id: string };
const key = (ref: Ref) => ref.name + '/' + ref.id;
let rows = new Map<string, unknown>();
let beforeTransaction: () => void;
let failCommit: boolean;
let writes: { ref: Ref; value?: unknown }[];
const db = {} as Firestore;
beforeEach(() => {
  vi.resetAllMocks(); rows = new Map(); beforeTransaction = () => {}; failCommit = false; writes = [];
  boundary.getDocs.mockImplementation(async ({ clauses }) => ({ docs: [...rows].filter(([name, row]) => name.startsWith('actuals/')
    && clauses.every((clause: { field: string; value: string }) => (row as Record<string, unknown>)[clause.field] === clause.value))
    .map(([name, row]) => ({ id: name.split('/')[1], data: () => row })) }));
  boundary.runTransaction.mockImplementation(async (_db, callback) => {
    beforeTransaction(); const pending: { ref: Ref; value?: unknown }[] = [];
    await callback({
      get: async (ref: Ref) => {
        if (!rows.has(key(ref))) throw Object.assign(Error('permission-denied'), { code: 'permission-denied' });
        return { id: ref.id, exists: () => true, data: () => structuredClone(rows.get(key(ref))) };
      },
      set: (ref: Ref, value: unknown) => { pending.push({ ref, value }); },
      delete: (ref: Ref) => { pending.push({ ref }); },
    });
    if (failCommit) throw Error('transaction rejected');
    for (const op of pending) {
      if (op.value) rows.set(key(op.ref), { ...(rows.get(key(op.ref)) as object), ...op.value });
      else rows.delete(key(op.ref));
    }
    writes = pending;
  });
});
function seed(mode: 'legacy' | 'canonical') {
  const source = mode === 'legacy' ? event() : scheduleEventFromMonthEvent(event());
  const sourceKey = (mode === 'legacy' ? 'month_events/' : 'schedule_events/') + source.id;
  rows.set(sourceKey, source); rows.set('actuals/actual', actual({ planId: 'event' }));
  rows.set('actuals/foreign', actual({ id: 'foreign', planId: 'event', userId: 'other' }));
  return sourceKey;
}
describe('transactional source-preserving event deletion', () => {
  it.each(['legacy', 'canonical'] as const)('patches retained owner Actuals and deletes the %s source in one commit', async mode => {
    const sourceKey = seed(mode);
    await deleteMonthEventPreservingActualSources(db, 'owner', 'event', mode);
    expect(rows.has(sourceKey)).toBe(false);
    expect(rows.get('actuals/actual')).toMatchObject({ note: 'Original actual', progressSource: { kind: 'general-event', sourceId: 'event' } });
    expect(rows.get('actuals/foreign')).not.toHaveProperty('progressSource');
    expect(writes).toHaveLength(2);
    expect(writes[0].value).toEqual({ progressSource: { kind: 'general-event', sourceId: 'event' } });
  });
  it.each(['edit', 'relink'] as const)('rereads concurrent Actual %s after the candidate query', async change => {
    seed('canonical');
    beforeTransaction = () => {
      rows.set('actuals/actual', actual({ planId: change === 'relink' ? 'new-plan' : 'event', note: 'newer note' }));
    };
    await deleteMonthEventPreservingActualSources(db, 'owner', 'event', 'canonical');
    expect(rows.get('actuals/actual')).toMatchObject({ note: 'newer note' });
    if (change === 'relink') expect(rows.get('actuals/actual')).not.toHaveProperty('progressSource');
    else expect(rows.get('actuals/actual')).toHaveProperty('progressSource');
  });
  it('fails closed when a candidate is deleted before its owner-only transactional read', async () => {
    const source = seed('canonical'); beforeTransaction = () => { rows.delete('actuals/actual'); };
    await expect(deleteMonthEventPreservingActualSources(db, 'owner', 'event', 'canonical')).rejects.toThrow('permission-denied');
    expect(rows.has(source)).toBe(true); expect(rows.has('actuals/actual')).toBe(false); expect(writes).toEqual([]);
  });
  it('leaves source and Actuals intact when the transaction fails', async () => {
    seed('canonical'); const before = structuredClone(rows); failCommit = true;
    await expect(deleteMonthEventPreservingActualSources(db, 'owner', 'event', 'canonical')).rejects.toThrow('transaction rejected');
    expect(rows).toEqual(before);
  });
  it('does not delete a foreign source even if candidate IDs were supplied', async () => {
    const key = seed('canonical'); rows.set(key, scheduleEventFromMonthEvent(event({ userId: 'other' })));
    await expect(deleteMonthEventPreservingActualSources(db, 'owner', 'event', 'canonical')).rejects.toThrow('所有者');
    expect(rows.has(key)).toBe(true); expect(writes).toEqual([]);
  });
  it('fails before starting a transaction when the atomic write bound is exceeded', async () => {
    const source = seed('canonical');
    for (let i = 0; i < 500; i++) rows.set('actuals/' + i, actual({ id: String(i), planId: 'event' }));
    await expect(deleteMonthEventPreservingActualSources(db, 'owner', 'event', 'canonical')).rejects.toThrow('予定は削除されていません');
    expect(boundary.runTransaction).not.toHaveBeenCalled(); expect(rows.has(source)).toBe(true);
  });
});
