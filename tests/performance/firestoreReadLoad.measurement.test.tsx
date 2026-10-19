import './firestoreReadLoad.noNetwork';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from '../../src/repositories/repositoryContracts';
import type { WeeklyPlanningApprovalPlanRepository } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepositoryContract';
import type { Plan, PlanDraft } from '../../src/types/domain';
import { APPROVAL_COUNT, fixtures, NOW, OWNER, SIZES } from './firestoreReadLoad.fixtures';

// The actual app hook, data hook, migration wrapper, and both Firebase persistence
// implementations run. Only the SDK transport, authentication, catalog and notices
// are substituted. An unsupported SDK operation or real network access fails shut.
const fixture = vi.hoisted(() => {
  type Ref = { collectionName: string; id: string; path: string };
  type Query = { collectionName: string; constraints: { field: string; operator: string; value: unknown }[] };
  type Read = { operation: string; collection: string; returned: number; missing: boolean; emptyQuery: boolean };
  const database = { syntheticOnly: true };
  const store = new Map<string, Record<string, unknown>>();
  const reads: Read[] = [];
  const writes: string[] = [];
  const transactions: number[] = [];
  function reference(parent: unknown, collectionName: string, id: string): Ref {
    if (parent !== database && !(parent && typeof parent === 'object' && 'path' in parent)) throw new Error('Non-synthetic Firestore reference');
    return { collectionName, id, path: `${parent === database ? '' : `${(parent as Ref).path}/`}${collectionName}/${id}` };
  }
  function snapshot(ref: Ref) {
    const value = store.get(ref.path);
    return { id: ref.id, exists: () => value !== undefined, data: () => structuredClone(value), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  async function read(ref: Ref, operation: string) {
    const snap = snapshot(ref);
    reads.push({ operation, collection: ref.collectionName, returned: Number(snap.exists()), missing: !snap.exists(), emptyQuery: false });
    return snap;
  }
  function set(ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) {
    const previous = options?.merge ? store.get(ref.path) : undefined;
    store.set(ref.path, structuredClone({ ...previous, ...value })); writes.push(ref.path);
  }
  function readQuery(query: Query, operation: string) {
    if (query.constraints.some(constraint => constraint.operator !== '==')) throw new Error('Unsupported query operator');
    const rows = [...store.entries()].filter(([path, value]) => path.split('/').length === 2 && path.startsWith(`${query.collectionName}/`)
      && query.constraints.every(constraint => value[constraint.field] === constraint.value));
    reads.push({ operation, collection: query.collectionName, returned: rows.length, missing: false, emptyQuery: rows.length === 0 });
    return { docs: rows.map(([path, value]) => ({ id: path.split('/').at(-1)!, data: () => structuredClone(value) })), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  const sdk = {
    doc: reference,
    collection: (db: unknown, collectionName: string) => { if (db !== database) throw new Error('Non-synthetic collection'); return { collectionName }; },
    where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
    query: (collection: { collectionName: string }, ...constraints: Query['constraints']) => ({ ...collection, constraints }),
    getDocs: async (query: Query) => readQuery(query, 'getDocs'),
    getDocsFromServer: async (query: Query) => readQuery(query, 'getDocsFromServer'),
    getDoc: (ref: Ref) => read(ref, 'getDoc'),
    getDocFromServer: (ref: Ref) => read(ref, 'getDocFromServer'),
    setDoc: async (ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) => set(ref, value, options),
    deleteDoc: async (ref: Ref) => { store.delete(ref.path); writes.push(ref.path); },
    deleteField: () => { throw new Error('Unexpected deleteField in measurement'); },
    onSnapshot: () => { throw new Error('Unexpected listener in planner-hydration measurement'); },
    runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
      if (_db !== database) throw new Error('Non-synthetic transaction');
      transactions.push(1);
      const pending: (() => void)[] = [];
      const result = await callback({ get: (ref: Ref) => read(ref, 'transaction.get'),
        set: (ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) => pending.push(() => set(ref, value, options)),
        delete: (ref: Ref) => pending.push(() => { store.delete(ref.path); writes.push(ref.path); }) });
      pending.forEach(commit => commit()); return result;
    },
    writeBatch: (_db: unknown) => {
      if (_db !== database) throw new Error('Non-synthetic batch');
      const pending: (() => void)[] = [];
      return { set: (ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) => pending.push(() => set(ref, value, options)),
        delete: (ref: Ref) => pending.push(() => { store.delete(ref.path); writes.push(ref.path); }),
        commit: async () => { pending.forEach(commit => commit()); } };
    },
  };
  const owner = { id: 'read-load-owner', email: 'synthetic@example.invalid', username: 'Synthetic', avatar: '', createdAt: '2026-10-08T12:00:00.000Z' };
  const state = { database, store, reads, writes, transactions, sdk, id: 0,
    repository: null as unknown as PlannerRepository, approval: null as unknown as WeeklyPlanningApprovalPlanRepository,
    bootstrap: Promise.resolve(), loader: null as null | ((ownerId: string) => Promise<void>),
    bootstrapSession: vi.fn((load: (ownerId: string) => Promise<void>) => { state.loader = load; state.bootstrap = load(owner.id); return state.bootstrap; }),
    owner, noop: vi.fn(), asyncNoop: vi.fn(async () => undefined) };
  return state;
});
vi.mock('firebase/firestore', () => fixture.sdk);
vi.mock('../../src/lib/firebaseClient', () => ({ getFirestoreDb: () => { throw new Error('Real Firebase client forbidden'); },
  getFirebaseAuth: () => { throw new Error('Real Firebase auth forbidden'); } }));
vi.mock('../../src/lib/id', () => ({ createId: (prefix: string) => `${prefix}-synthetic-${fixture.id++}` }));
vi.mock('../../src/repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => Reflect.get(fixture.repository, key) }) }));
vi.mock('../../src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => fixture.approval,
}));
vi.mock('../../src/hooks/useAuthSessionState', () => ({ useAuthSessionState: () => ({ booting: false, user: fixture.owner,
  bootstrapSession: fixture.bootstrapSession, signUpWithPassword: fixture.asyncNoop, signInWithPassword: fixture.asyncNoop,
  signInWithGoogle: fixture.asyncNoop, sendPasswordReset: fixture.asyncNoop, saveUserProfile: fixture.asyncNoop, signOut: fixture.asyncNoop }) }));
vi.mock('../../src/hooks/useNoticeState', () => ({ useNoticeState: () => ({ notice: null, showNotice: fixture.noop, dismissNotice: fixture.noop }) }));
vi.mock('../../src/data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalogWithOutcome: async () => ({ source: 'server' }) }));

import { createFirebasePlannerRepository } from '../../src/repositories/firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from '../../src/repositories/firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from '../../src/repositories/scheduleEventAuthorityRepository';
import { createFirestoreWeeklyPlanningApprovalPlanRepository } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository';
import { buildWeeklyPlanningPlanSourceId } from '../../src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';
import { createEmptyPlanDraft } from '../../src/domain/planner';
import { usePlannerAppState } from '../../src/hooks/usePlannerAppState';
import { expandPlansForDateRange } from '../../src/lib/planRecurrence';
import { doesMonthEventOccurOnDate } from '../../src/lib/monthEvents';
import { addDays } from '../../src/lib/date';
import { normalizePlanRecord } from '../../src/repositories/repositoryUtils';

type AppState = ReturnType<typeof usePlannerAppState>;
let state: AppState;
function Harness() { state = usePlannerAppState(); return null; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]));
  return value;
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function dataSnapshot() {
  return Object.fromEntries(['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos', 'studySubjects', 'studyMaterials', 'scheduleTemplates', 'timetableTerms', 'timetablePeriods']
    .map(key => {
      const rows = key === 'plans' ? state.plans.map(normalizePlanRecord) : state[key as keyof AppState];
      return [key, rows === null ? null : [...rows as Array<{ id: string }>].sort((a, b) => a.id.localeCompare(b.id))];
    }));
}
function projectionSnapshot() {
  return {
    plans: expandPlansForDateRange(state.plans.map(normalizePlanRecord), '2026-09-28', '2026-10-12'),
    events: Array.from({ length: 15 }, (_, i) => addDays('2026-09-28', i)).map(date => ({ date,
      ids: state.monthEvents.filter(event => doesMonthEventOccurOnDate(event, date)).map(event => event.id).sort() })),
  };
}
function metrics() {
  const byCollection: Record<string, { calls: number; returnedDocuments: number; emptyQueries: number; missingDocumentCalls: number }> = {};
  const byOperation: Record<string, number> = {};
  for (const read of fixture.reads) {
    byOperation[read.operation] = (byOperation[read.operation] ?? 0) + 1;
    const row = byCollection[read.collection] ??= { calls: 0, returnedDocuments: 0, emptyQueries: 0, missingDocumentCalls: 0 };
    row.calls++; row.returnedDocuments += read.returned; row.emptyQueries += Number(read.emptyQuery); row.missingDocumentCalls += Number(read.missing);
  }
  return { readCalls: fixture.reads.length, returnedDocuments: fixture.reads.reduce((sum, read) => sum + read.returned, 0),
    emptyQueries: fixture.reads.filter(read => read.emptyQuery).length, missingDocumentCalls: fixture.reads.filter(read => read.missing).length,
    transactionAttempts: fixture.transactions.length, writtenDocuments: fixture.writes.length, byOperation, byCollection };
}
function installRepositories() {
  const db = fixture.database as unknown as Firestore;
  fixture.repository = createScheduleEventBackedPlannerRepository(createFirebasePlannerRepository(db), createFirebaseScheduleEventAuthority(db));
  fixture.approval = createFirestoreWeeklyPlanningApprovalPlanRepository(db);
}
function planDraft(title: string): PlanDraft {
  return { ...createEmptyPlanDraft(OWNER, '2026-10-08'), title, subject: 'Math', startTime: '13:00', endTime: '14:00' };
}
const results: unknown[] = [];
afterAll(() => {
  try {
    if (process.env.FIRESTORE_READ_LOAD_OUTPUT) writeFileSync(process.env.FIRESTORE_READ_LOAD_OUTPUT, JSON.stringify({
      schemaVersion: 1, scope: 'Planner hydration, navigation, manual save, durable weekly approval and reload; auth/profile/catalog/telemetry excluded',
      syntheticTransport: true, sdkCacheAndBillingObserved: false, now: NOW, approvalCount: APPROVAL_COUNT, results,
    }, null, 2));
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe('Firestore read-load executable measurement', () => {
  it('fails closed on a network attempt', () => {
    expect(() => fetch('https://example.invalid')).toThrow('READ_LOAD_MEASUREMENT_NETWORK_FORBIDDEN');
  });
  it('counts an empty query call separately from returned documents', async () => {
    fixture.store.clear(); fixture.reads.length = 0; installRepositories();
    expect(await fixture.repository.getActuals(OWNER)).toEqual([]);
    expect(fixture.reads).toEqual([{ operation: 'getDocs', collection: 'actuals', returned: 0, missing: false, emptyQuery: true }]);
  });
  for (const [name, scale] of Object.entries(SIZES)) it(`${name}: executes real app and persistence boundaries`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
    fixture.store.clear(); fixture.id = 0;
    const data = fixtures(scale);
    for (const [collection, documents] of Object.entries(data.documents)) for (const document of documents) fixture.store.set(`${collection}/${document.id}`, structuredClone(document));
    installRepositories();
    let renderer: ReactTestRenderer | undefined;
    const rows: unknown[] = [];
    async function phase(operation: string, action: () => Promise<void> | void) {
      fixture.reads.length = 0; fixture.writes.length = 0; fixture.transactions.length = 0;
      await act(async () => { await action(); });
      const snapshot = dataSnapshot();
      rows.push({ operation, ...metrics(), dataDigest: digest(snapshot),
        consumedDataDigest: digest(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'dayNotes'))),
        projectionDigest: digest(projectionSnapshot()),
        collectionSizes: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value === null ? null : (value as unknown[]).length])),
        view: { mode: state.viewMode, selectedDate: state.selectedDate, monthDate: state.monthDate } });
      expect(state.plannerDataAvailability.status).toBe('ready');
      expect(state.plans.some(plan => plan.userId !== OWNER)).toBe(false);
      expect(state.plans.find(plan => plan.id === 'plan-0')?.date).toBe('2024-01-01');
      expect(expandPlansForDateRange(state.plans, '2026-10-08', '2026-10-10').filter(plan => plan.id === 'plan-0').map(plan => plan.occurrenceDate)).toEqual(['2026-10-08', '2026-10-10']);
      expect(state.monthEvents.filter(event => doesMonthEventOccurOnDate(event, '2026-10-08')).map(event => event.id)).toContain('event-0');
    }
    async function mount() { renderer = create(createElement(Harness)); }
    async function bootstrapMount() {
      await act(mount); await fixture.bootstrap; await act(async () => undefined);
    }
    async function approval(count: number, operationId: string) {
      const saved: Plan[] = [];
      for (let i = 0; i < count; i++) {
        const draft: PlanDraft = { ...planDraft(`Approved ${operationId} ${i}`), sourceType: 'weekly-planning',
          sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: operationId, sourceDraftBlockId: `block-${i}` }) };
        await act(async () => { saved.push(await state.saveWeeklyApprovedPlan(draft)); });
      }
      await act(async () => { await state.completeWeeklyApprovalOperation({ approvalOperationId: operationId, userId: OWNER,
        previewId: `preview-${operationId}`, previewStateRevision: 1, startedAt: NOW, completedAt: NOW, status: 'completed',
        items: saved.map((plan, i) => ({ sourceDraftBlockId: `block-${i}`, savedPlanId: plan.id, status: 'saved', attemptCount: 1, updatedAt: NOW })) }); });
      expect(saved.every(plan => state.plans.some(current => current.id === plan.id))).toBe(true);
    }
    try {
      // cold = new repository/migration gate; warm = fresh mount, same repository.
      await phase('cold-planner-launch', bootstrapMount);
      expect(state.plans).toHaveLength(data.plans.length); expect(state.actuals).toHaveLength(12 * scale);
      await act(async () => renderer?.unmount());
      await phase('warm-planner-launch', bootstrapMount);
      await phase('open-day', () => state.openDay('2026-10-08'));
      await phase('next-day', () => state.selectDate('2026-10-09'));
      await phase('open-week', () => state.openWeek('2026-10-05'));
      await phase('next-week', () => state.openWeek('2026-10-12'));
      await phase('open-month', () => state.setViewMode('month'));
      await phase('next-month', () => state.changeMonth('2026-11-01'));
      await phase('manual-save-1', () => state.savePlanDraft(planDraft('Manual saved plan')));
      await phase('approved-save-1-and-complete', () => approval(1, 'single-operation'));
      await phase('approved-save-K-and-complete', () => approval(APPROVAL_COUNT, 'batch-operation'));
      const beforeRefreshData = dataSnapshot();
      const beforeRefresh = digest(beforeRefreshData);
      await phase('explicit-planner-reload', () => fixture.loader!(OWNER));
      expect(canonical(dataSnapshot())).toEqual(canonical(beforeRefreshData));
      await act(async () => renderer?.unmount()); installRepositories();
      await phase('cold-reload-after-saves', bootstrapMount);
      expect(digest(dataSnapshot())).toBe(beforeRefresh);
      expect(state.plans).toHaveLength(data.plans.length + 1 + 1 + APPROVAL_COUNT);
      // Older baseline hooks already hydrate notes. Current hooks explicitly
      // request them before using the retained save API; unread is never empty.
      await phase('first-note-use', () => state.loadDayNotes?.());
      expect(state.dayNotes).toHaveLength(4 * scale);
      await phase('save-existing-note', () => state.saveDayNote({ userId: OWNER, date: '2024-01-01',
        quickMemo: 'Updated historical note', reflection: '', nextFocus: '', checkedPlan: false,
        checkedRecord: false, checkedReady: false }));
      expect(state.dayNotes?.find(note => note.id === 'note-0')?.quickMemo).toBe('Updated historical note');
      expect([...fixture.store.keys()].filter(key => key.startsWith('day_notes/'))).toHaveLength(4 * scale);
      const withSavedNote = digest(dataSnapshot());
      await act(async () => renderer?.unmount()); installRepositories();
      await phase('cold-reload-after-note-save', bootstrapMount);
      await phase('first-note-use-after-reload', () => state.loadDayNotes?.());
      expect(digest(dataSnapshot())).toBe(withSavedNote);
      results.push({ dataset: name, scale, fixtureDigest: digest(data.documents),
        seededCollectionSizes: Object.fromEntries(Object.entries(data.documents).map(([key, value]) => [key, value.length])),
        finalPersistedDigest: digest([...fixture.store].sort(([a], [b]) => a.localeCompare(b))), rows });
    } finally { await act(async () => renderer?.unmount()); }
  }, 30_000);
});
