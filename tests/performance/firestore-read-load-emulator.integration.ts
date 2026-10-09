import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import http2 from 'node:http2';
import { deleteApp, initializeApp, onLog, SDK_VERSION } from 'firebase/app';
import {
  connectFirestoreEmulator, doc, getDocFromServer, initializeFirestore,
  setDoc, setLogLevel, terminate, writeBatch,
} from 'firebase/firestore';
import { scheduleEventFromMonthEvent, scheduleEventFromPlan } from '../../src/domain/scheduleEvent';
import { createFirebasePlannerRepository } from '../../src/repositories/firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from '../../src/repositories/firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from '../../src/repositories/scheduleEventAuthorityRepository';
import { stripUndefinedDeep } from '../../src/repositories/plannerWritePreparation';
import type { MonthEvent, Plan } from '../../src/types/domain';

const PROJECT = 'demo-studyplanner-read-load';
assert.equal(process.env.FIRESTORE_READ_LOAD_PROJECT, PROJECT);
const host = process.env.FIRESTORE_READ_LOAD_HOST ?? '';
assert.match(host, /^127\.0\.0\.1:[1-9]\d{0,4}$/);
const port = Number(host.split(':')[1]);
assert(port < 65536);
assert(process.env.FIRESTORE_READ_LOAD_REPORT);
for (const key of Object.keys(process.env)) {
  assert(!/^(?:VITE_|GOOGLE_|GCLOUD_|FIREBASE_|OPENAI_|GEMINI_|ANTHROPIC_|NODE_OPTIONS)/.test(key),
    `Unexpected inherited environment key: ${key}`);
}
// Node Firestore uses gRPC over HTTP/2. Reject any destination other than this
// isolated emulator even if a later repository refactor changes SDK settings.
const connect = http2.connect;
http2.connect = new Proxy(connect, { apply(target, receiver, args) {
  assert.equal(String(args[0]), `http://${host}`, 'Non-emulator gRPC destination rejected.');
  return Reflect.apply(target, receiver, args);
} });
assert.throws(() => http2.connect('https://firestore.googleapis.com'), /destination rejected/);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, `http://${host}`, 'Non-emulator HTTP destination rejected.');
  return originalFetch(input, init);
};
assert.throws(() => fetch('https://example.invalid'), /destination rejected/);

const NOW = '2026-10-08T00:00:00.000Z';
export type Counts = {
  queryTargets: Record<string, number>;
  documentTargets: Record<string, number>;
  documentResponses: Record<string, number>;
  transactionDocumentRequests: number;
  transactionDocumentResponses: number;
  missingTransactionDocuments: number;
  transactionDocumentPaths: string[];
  commitRequests: number;
  writeRequests: Record<string, number>;
  verifyDocumentPreconditions: number;
  rpcErrors: string[];
};
let active: Counts | null = null;
const results: Array<{ operation: string; size?: number; counts: Counts }> = [];
const increment = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
// SDK logs describe actual gRPC messages, rather than getDocs mock calls. Their
// format is version-dependent; explicit nonzero expectations below fail closed.
onLog(log => {
  if (!active || !log.message.includes('GrpcConnection')) return;
  if (log.message.includes('failed with error:') && active.rpcErrors.length < 10) {
    active.rpcErrors.push(log.message.split('\n    at ')[0]);
  }
  const payload = log.args.at(-1);
  if (typeof payload !== 'string' || !payload.startsWith('{')) return;
  // The Node SDK serializes log arguments with util.inspect, not JSON. Match
  // only the transport's structural fields; never evaluate log text as code.
  const documentPaths = [...payload.matchAll(/\/documents\/([a-z_]+)\//g)];
  if (/RPC 'Listen'.* sending:/.test(log.message) && payload.includes('addTarget:')) {
    for (const [, collection] of payload.matchAll(/collectionId: '([^']+)'/g)) {
      increment(active.queryTargets, collection);
    }
    if (payload.includes('documents:')) {
      for (const [, collection] of documentPaths) increment(active.documentTargets, collection);
    }
  }
  if (/RPC 'Listen'.* received:/.test(log.message) && payload.includes('documentChange:')) {
    for (const [, collection] of documentPaths) increment(active.documentResponses, collection);
  }
  if (/RPC 'BatchGetDocuments'.* invoked/.test(log.message)) {
    active.transactionDocumentRequests += documentPaths.length;
    active.transactionDocumentPaths.push(...[...payload.matchAll(/projects\/[^'\s]+\/documents\/[^'\s]+/g)].map(match => match[0]));
  }
  if (/RPC BatchGetDocuments.* received result:/.test(log.message)) {
    active.transactionDocumentResponses += Number(payload.includes('found:'));
    active.missingTransactionDocuments += Number(payload.includes('missing:'));
  }
  if (/RPC 'Commit'.* invoked/.test(log.message) || /RPC 'Write'.* sending:/.test(log.message)) {
    if (/RPC 'Commit'/.test(log.message)) active.commitRequests++;
    if (payload.includes('writes:')) {
      // Transaction commits also contain `verify` operations for documents
      // read but not changed. They are preconditions, not document writes.
      active.verifyDocumentPreconditions += [...payload.matchAll(/verify:\s*'[^']+'/g)].length;
      for (const match of payload.matchAll(/update:\s*\{\s*name:\s*'([^']+)'|delete:\s*'([^']+)'|transform:\s*\{\s*document:\s*'([^']+)'/g)) {
        const name = match[1] ?? match[2] ?? match[3];
        increment(active.writeRequests, name.split('/').at(-2) ?? 'unknown');
      }
    }
  }
}, { level: 'debug' });
// Keep raw synthetic payloads out of the report and suppress verbose SDK logs.
const originalLog = console.log;
console.log = (...args) => {
  if (!args.some(value => typeof value === 'string' && value.includes('@firebase/firestore'))) originalLog(...args);
};
setLogLevel('debug');

export function context(owner: string) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: 'localhost' },
    `read-load-${owner}-${crypto.randomUUID()}`);
  const db = initializeFirestore(app, { host, ssl: false });
  connectFirestoreEmulator(db, '127.0.0.1', port, { mockUserToken: { sub: owner, user_id: owner } });
  const legacy = createFirebasePlannerRepository(db);
  const authority = createFirebaseScheduleEventAuthority(db);
  return {
    db, legacy, authority,
    repository: createScheduleEventBackedPlannerRepository(legacy, authority),
    async close() { await terminate(db); await deleteApp(app); },
  };
}

function fixture(owner: string, scale: number) {
  const plans: Plan[] = Array.from({ length: 24 * scale }, (_, index) => ({
    id: `${owner}-p${index}`, seriesId: `${owner}-p${index}`, userId: owner,
    title: `Synthetic plan ${index}`, subject: 'Math', date: '2024-01-01',
    startTime: '09:00', endTime: '10:00', repeat: index === 0 ? 'daily' : 'none',
    repeatUntil: index === 0 ? '2027-12-31' : null,
    excludedDates: index === 0 ? ['2026-10-09'] : [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: NOW, updatedAt: NOW,
  }));
  const monthEvents: MonthEvent[] = Array.from({ length: 8 * scale }, (_, index) => ({
    id: `${owner}-e${index}`, userId: owner, title: `Synthetic event ${index}`,
    date: '2026-09-30', endDate: '2026-10-10', startTime: '12:00', endTime: '13:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
    createdAt: NOW, updatedAt: NOW,
  }));
  return { plans, monthEvents };
}

async function seed(owner: string, scale: number, legacyOnly = false) {
  const ctx = context(owner);
  const data = fixture(owner, scale);
  const lease = {
    schemaVersion: 1, migrationVersion: 1, userId: owner, status: 'migrating',
    operationId: `schedule-event-migration-v1:${owner}`, revision: 1, startedAt: NOW, completedAt: null,
  };
  try {
    if (!legacyOnly) await setDoc(doc(ctx.db, 'schedule_event_migrations', owner), lease);
    const records = legacyOnly
      ? [...data.plans.map(value => ['plans', value] as const), ...data.monthEvents.map(value => ['month_events', value] as const)]
      : [...data.plans.map(scheduleEventFromPlan), ...data.monthEvents.map(scheduleEventFromMonthEvent)]
        .map(value => ['schedule_events', value] as const);
    for (let index = 0; index < records.length; index += 200) {
      const batch = writeBatch(ctx.db);
      for (const [collection, value] of records.slice(index, index + 200)) {
        batch.set(doc(ctx.db, collection, value.id), stripUndefinedDeep(value));
      }
      await batch.commit();
    }
    if (!legacyOnly) await setDoc(doc(ctx.db, 'schedule_event_migrations', owner), {
      ...lease, status: 'completed', completedAt: NOW, sourcePlanCount: data.plans.length,
      sourceMonthEventCount: data.monthEvents.length, eventCount: records.length,
    });
    return data;
  } finally { await ctx.close(); }
}

export async function measure<T>(operation: string, action: () => Promise<T>, size?: number) {
  assert.equal(active, null);
  const counts: Counts = { queryTargets: {}, documentTargets: {}, documentResponses: {}, transactionDocumentRequests: 0,
    transactionDocumentResponses: 0, missingTransactionDocuments: 0, transactionDocumentPaths: [],
    commitRequests: 0, writeRequests: {}, verifyDocumentPreconditions: 0, rpcErrors: [] };
  active = counts;
  try {
    const value = await action();
    return { value, counts };
  } finally { results.push({ operation, size, counts }); active = null; }
}
const normalized = (snapshot: { plans: Plan[]; monthEvents: MonthEvent[] }) => ({
  plans: [...snapshot.plans].sort((a, b) => a.id.localeCompare(b.id)),
  monthEvents: [...snapshot.monthEvents].sort((a, b) => a.id.localeCompare(b.id)),
});

async function main() {
  for (const scale of [1, 10, 100]) {
    process.stdout.write(`Measuring ${32 * scale} synthetic ScheduleEvents.\n`);
    const owner = `owner-${scale}`;
    await seed(owner, scale);
    const snapshots = [];
    for (const mode of ['before-concurrent', 'before-sequential', 'after-shared'] as const) {
      const ctx = context(owner);
      try {
        const result = await measure(`cold-${mode}`, async () => {
          if (mode === 'after-shared') return ctx.repository.getScheduleSnapshot(owner);
          if (mode === 'before-sequential') return {
            plans: await ctx.repository.getPlans(owner), monthEvents: await ctx.repository.getMonthEvents(owner),
          };
          const [plans, monthEvents] = await Promise.all([
            ctx.repository.getPlans(owner), ctx.repository.getMonthEvents(owner),
          ]);
          return { plans, monthEvents };
        }, 32 * scale);
        assert.equal(result.value.plans.length, 24 * scale);
        assert.equal(result.value.monthEvents.length, 8 * scale);
        assert.equal(result.counts.documentTargets.schedule_event_migrations, 1);
        assert(result.counts.queryTargets.schedule_events > 0, 'Missing real SDK query-target evidence.');
        assert(result.counts.documentResponses.schedule_events >= 32 * scale, 'Missing real server document-response evidence.');
        if (mode === 'after-shared') assert.equal(result.counts.queryTargets.schedule_events, 1);
        snapshots.push(normalized(result.value));
      } finally { await ctx.close(); }
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
    assert.deepEqual(snapshots[2], snapshots[0]);
  }

  const migrationOwner = 'owner-migration';
  await seed(migrationOwner, 1, true);
  const migrating = context(migrationOwner);
  let migrated;
  try {
    migrated = await measure('legacy-migration', () => migrating.repository.getScheduleSnapshot(migrationOwner), 32);
    assert.equal(migrated.value.plans.length, 24);
    assert.equal(migrated.value.monthEvents.length, 8);
    assert.equal(migrated.counts.queryTargets.plans, 1);
    assert.equal(migrated.counts.queryTargets.month_events, 1);
    const marker = await getDocFromServer(doc(migrating.db, 'schedule_event_migrations', migrationOwner));
    assert.equal(marker.data()?.status, 'completed');
    assert.equal(marker.data()?.eventCount, 32);
    await assert.rejects(setDoc(doc(migrating.db, 'plans', 'late-legacy-write'), {
      id: 'late-legacy-write', userId: migrationOwner,
    }), /permission-denied/);
  } finally { await migrating.close(); }
  const repeat = context(migrationOwner);
  try {
    const result = await measure('migration-reload', () => repeat.repository.getScheduleSnapshot(migrationOwner), 32);
    assert.deepEqual(normalized(result.value), normalized(migrated.value));
    assert.equal(result.counts.queryTargets.schedule_events, 1);
    assert.equal(result.counts.queryTargets.plans ?? 0, 0);
    assert.equal(result.counts.queryTargets.month_events ?? 0, 0);
    assert.equal(result.counts.transactionDocumentRequests, 0);
  } finally { await repeat.close(); }

  const intruder = context('other-owner');
  try {
    await assert.rejects(intruder.authority.getScheduleSnapshot('owner-1'), /permission-denied/);
    await assert.rejects(intruder.repository.getScheduleSnapshot('owner-1'), /permission-denied/);
    await assert.rejects(setDoc(doc(intruder.db, 'schedule_events', 'plan:owner-1-p0'), {
      title: 'unauthorized mutation',
    }, { merge: true }), /permission-denied/);
  } finally { await intruder.close(); }

  const report = {
    project: PROJECT, endpoint: host, emulatorVersion: '1.20.2', nodeVersion: process.version, firebaseSdkVersion: SDK_VERSION,
    sdkTransport: 'Node gRPC',
    limitations: [
      'Query targets and document responses are observed SDK-to-emulator RPC messages, not billable Firestore reads.',
      'Security-rule dependent reads, billing minimums, browser WebChannel behavior, and production usage are not measured.',
      'Before uses the unchanged getPlans/getMonthEvents methods; after uses the shared getScheduleSnapshot method.',
    ],
    checks: ['non-emulator gRPC and HTTP destinations rejected before connection',
      'snapshot equivalence at 32/320/3200 documents', 'legacy migration and idempotent reload',
      'post-migration legacy writes denied', 'cross-owner reads and writes denied'],
    results,
  };
  await writeFile(process.env.FIRESTORE_READ_LOAD_REPORT!, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export const observedResults = results;
if (!process.env.FIRESTORE_READ_LOAD_APPROVAL_MODE) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
