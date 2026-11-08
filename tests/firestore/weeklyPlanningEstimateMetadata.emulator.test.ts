import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import { scheduleEventIdForLegacy, scheduleEventToPlan, type ScheduleEvent } from '../../src/domain/scheduleEvent';
import type { PlanDraft, WeeklyPlanningEstimateMetadataV1 } from '../../src/types/domain';
import { createFirestoreWeeklyPlanningApprovalPlanRepository } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository';
import { resolveApprovalDraftIdentity } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalPersistencePolicy';
import { buildWeeklyPlanningPlanSourceId } from '../../src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';

// #47: a Plan saved from a weekly-planning block carries `weeklyPlanningEstimate`. The deployed Rules must accept it
// in both storage modes without any Rules change. This file is prepared for the demo-studyplanner emulators
// and skips ordinary CI.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-studyplanner';
const enabled = Boolean(authHost && firestoreHost);
const apps: FirebaseApp[] = [];
const run = `${Date.now()}`;

function address(value: string) {
  const url = new URL(`http://${value}`);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) throw new Error('loopback-emulators-only');
  return { host: url.hostname, port: Number(url.port) };
}
async function user(label: string) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: project }, `estimate-metadata-${label}-${run}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const location = address(firestoreHost!);
  connectFirestoreEmulator(db, location.host, location.port);
  const uid = (await createUserWithEmailAndPassword(auth, `estimate-${label}-${run}@example.test`, 'demo-test-password')).user.uid;
  return { db, uid };
}
async function seedCompletedMigration(uid: string) {
  const text = (stringValue: string) => ({ stringValue });
  const count = (integerValue: number) => ({ integerValue: String(integerValue) });
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/schedule_event_migrations/${uid}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      userId: text(uid), schemaVersion: count(1), migrationVersion: count(1), status: text('completed'),
      operationId: text(`schedule-event-migration-v1:${uid}`), revision: count(1), startedAt: text('2026-11-08T00:00:00.000Z'),
      completedAt: text('2026-11-08T00:00:01.000Z'), sourcePlanCount: count(0), sourceMonthEventCount: count(0), eventCount: count(0),
    } }),
  });
  expect(response.status).toBe(200);
}

const estimate: WeeklyPlanningEstimateMetadataV1 = {
  version: 1, baseEstimateMinutes: 30, estimateBasis: 'direct_effort', calibrationMultiplier: 1,
  allocationMinutes: 45, roundingStepMinutes: 15, sourceFactRefs: ['task-1', 'workload-1', 'estimate-1'],
};
function draft(userId: string, suffix: string, withEstimate: boolean): PlanDraft {
  return {
    userId, title: 'Estimate metadata regression', subject: 'math', date: '2026-11-09', startTime: '19:00', endTime: '19:45',
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo: '', sourceType: 'weekly-planning',
    sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: `estimate-${suffix}-${run}`, sourceDraftBlockId: `block-${suffix}` }),
    ...(withEstimate ? { weeklyPlanningEstimate: estimate } : {}),
  };
}

describe.skipIf(!enabled)('weeklyPlanningEstimate under the current Rules (no Rules change)', () => {
  let legacy: Awaited<ReturnType<typeof user>>;
  let canonical: Awaited<ReturnType<typeof user>>;
  beforeAll(async () => {
    if (project !== 'demo-studyplanner') throw new Error('demo-studyplanner-required');
    address(authHost!); address(firestoreHost!);
    legacy = await user('legacy'); canonical = await user('canonical');
    await seedCompletedMigration(canonical.uid);
  });
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); });

  it('saves the estimate on a legacy `plans` document through the real approval transaction, and a plan without it saves as before', async () => {
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository(legacy.db);
    const withEstimate = draft(legacy.uid, 'legacy-with', true);
    const saved = await repository.saveApprovedPlan(withEstimate);
    expect(saved.weeklyPlanningEstimate).toEqual(estimate);
    const stored = await getDoc(doc(legacy.db, 'plans', resolveApprovalDraftIdentity(withEstimate).planId));
    expect(stored.data()?.weeklyPlanningEstimate).toEqual(estimate);

    const without = draft(legacy.uid, 'legacy-without', false);
    await repository.saveApprovedPlan(without);
    const old = await getDoc(doc(legacy.db, 'plans', resolveApprovalDraftIdentity(without).planId));
    expect(old.exists()).toBe(true);
    expect(old.data()).not.toHaveProperty('weeklyPlanningEstimate');
  });

  it('saves the estimate inside the `plan` map of a canonical `schedule_events` document and reads it back as the same Plan field', async () => {
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository(canonical.db);
    const input = draft(canonical.uid, 'canonical-with', true);
    const saved = await repository.saveApprovedPlan(input);
    expect(saved.weeklyPlanningEstimate).toEqual(estimate);
    const eventId = scheduleEventIdForLegacy({ kind: 'plan', id: resolveApprovalDraftIdentity(input).planId });
    const stored = await getDoc(doc(canonical.db, 'schedule_events', eventId));
    expect((stored.data() as { plan?: { weeklyPlanningEstimate?: unknown } }).plan?.weeklyPlanningEstimate).toEqual(estimate);
    expect(scheduleEventToPlan({ ...(stored.data() as ScheduleEvent), id: stored.id })?.weeklyPlanningEstimate).toEqual(estimate);
  });
});
