import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { productionDatabaseFromRequestUrl, readProductionServerSnapshot } from '../tests/e2e/support/d5-production-readonly.mjs';

const database = 'projects/smoke-fixture/databases/(default)';
const prefix = `${database}/documents`;
const uid = 'isolated-fixture-owner';
const document = (name, extra = {}) => ({ name, fields: { userId: { stringValue: uid }, ...extra } });
function server(mode = 'complete') {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const query = JSON.parse(init.body).structuredQuery;
    const collection = query.from[0].collectionId;
    const parent = String(url).replace('https://firestore.googleapis.com/v1/', '').replace(':runQuery', '');
    requests.push({ parent, collection, method: init.method, query });
    expect(query.where.fieldFilter).toEqual({ field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } });
    if (collection === 'weekly_planning_approval_items') {
      if (!parent.startsWith(`${prefix}/weekly_planning_approval_operations/`)) throw new Error('Root item query is not complete.');
      if (parent.endsWith('/op-b') && mode === 'denied-child') return new Response('', { status: 403 });
      if (parent.endsWith('/op-b') && mode === 'empty-stream') return Response.json([]);
      if (parent.endsWith('/op-b') && mode === 'error-stream') return Response.json([{ error: { code: 7 } }]);
      if (parent.endsWith('/op-b') && mode === 'skipped-stream') return Response.json([{ skippedResults: 1, readTime: '2026-10-21T00:00:00Z' }]);
      const fields = parent.endsWith('/op-b') && mode === 'changed-child' ? { savedPlanId: { stringValue: 'changed' } } : {};
      return Response.json([{ document: document(`${parent}/${collection}/item`, fields) }]);
    }
    expect(parent).toBe(prefix);
    if (collection === 'weekly_planning_approval_operations') return Response.json(['op-a', 'op-b'].map(id => ({ document: document(`${parent}/${collection}/${id}`) })));
    expect(['schedule_events', 'plans', 'month_events']).toContain(collection);
    return Response.json([{ document: document(`${parent}/${collection}/existing`) }]);
  }));
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe('D5 production smoke offline preflight', () => {
  it('derives the exact database from real SDK Listen/Write query shapes and REST paths', () => {
    const query = new URLSearchParams({ database, VER: '8', RID: 'rpc', SID: 'fixture' });
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?${query}`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?${query}`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/v1/${prefix}:runQuery`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/v1/${prefix}/schedule_events/existing`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://other.invalid/?${query}`)).toBeNull();
    expect(productionDatabaseFromRequestUrl('https://firestore.googleapis.com/?database=projects/wrong')).toBeNull();
  });
  it('reads canonical/legacy schedules and every actual operation item subcollection with no writes', async () => {
    const requests = server();
    const result = await readProductionServerSnapshot({ uid, database, idToken: 'isolated-fixture-token' });
    expect(requests).toHaveLength(6);
    expect(requests.map(r => [r.parent, r.collection])).toEqual([
      [prefix, 'schedule_events'], [prefix, 'plans'], [prefix, 'month_events'], [prefix, 'weekly_planning_approval_operations'],
      [`${prefix}/weekly_planning_approval_operations/op-a`, 'weekly_planning_approval_items'],
      [`${prefix}/weekly_planning_approval_operations/op-b`, 'weekly_planning_approval_items'],
    ]);
    expect(result.weekly_planning_approval_items).toHaveLength(2);
    expect(requests.every(r => r.method === 'POST')).toBe(true); // every endpoint above is :runQuery only
    const repository = readFileSync(new URL('../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository.ts', import.meta.url), 'utf8');
    expect(repository).toContain("const OPERATION_COLLECTION = 'weekly_planning_approval_operations'");
    expect(repository).toContain('doc(operationRef, ITEM_COLLECTION, identity.itemDocumentId)');
    expect(repository).toContain("const SCHEDULE_EVENT_COLLECTION = 'schedule_events'");
    const planner = readFileSync(new URL('../src/repositories/firebasePlannerRepository.ts', import.meta.url), 'utf8');
    expect(planner).toContain("listByUserId<Plan>(firestoreDb, 'plans', userId)");
    expect(planner).toContain("listByUserId<MonthEvent>(firestoreDb, 'month_events', userId)");
  });
  it('detects a change confined to the second operation child (root query would miss it)', async () => {
    server(); const before = await readProductionServerSnapshot({ uid, database, idToken: 'fixture' });
    server('changed-child'); const after = await readProductionServerSnapshot({ uid, database, idToken: 'fixture' });
    expect(before.weekly_planning_approval_operations).toEqual(after.weekly_planning_approval_operations);
    expect(JSON.stringify(before) === JSON.stringify(after)).toBe(false);
  });
  it.each(['denied-child', 'empty-stream', 'error-stream', 'skipped-stream'])('fails closed on %s rather than reporting unchanged', async mode => {
    server(mode);
    await expect(readProductionServerSnapshot({ uid, database, idToken: 'fixture' })).rejects.toThrow(/unavailable|Incomplete/u);
  });
  it('rejects a foreign-owner item even when its path is under an owned operation', async () => {
    server(); const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (url, init) => {
      const response = await original(url, init);
      const rows = await response.json();
      if (String(url).includes('/op-b:runQuery')) rows[0].document.fields.userId.stringValue = 'foreign-owner';
      return Response.json(rows);
    });
    await expect(readProductionServerSnapshot({ uid, database, idToken: 'fixture' })).rejects.toThrow('Unexpected server document scope');
  });
});
