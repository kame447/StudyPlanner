import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, type Firestore } from 'firebase/firestore';
import { scheduleEventIdForLegacy } from '../../src/domain/scheduleEvent';
import type { PlanDraft } from '../../src/types/domain';
import { createFirestoreWeeklyPlanningApprovalPlanRepository } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository';
import { resolveApprovalDraftIdentity } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalPersistencePolicy';
import { buildWeeklyPlanningPlanSourceId } from '../../src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';

// Never initialize an online Firebase client. This file is prepared for the
// existing demo-studyplanner Auth/Firestore emulators and skips ordinary CI.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const configuredProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
const enabled = Boolean(authHost && firestoreHost);
const apps: FirebaseApp[] = [];

function localAddress(value: string): { host: string; port: number } {
  const url = new URL(`http://${value}`);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error('This regression permits only explicit local emulator hosts.');
  }
  return { host: url.hostname, port: Number(url.port) };
}

async function context(label: string) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-studyplanner' },
    `approval-first-save-${label}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const address = localAddress(firestoreHost!);
  connectFirestoreEmulator(db, address.host, address.port);
  const credential = await createUserWithEmailAndPassword(auth,
    `approval-${label}-${Date.now()}@example.test`, 'demo-test-password');
  return { db, uid: credential.user.uid };
}

function draft(userId: string, suffix: string): PlanDraft {
  return {
    userId, title: 'Isolated approval regression', subject: 'math',
    date: '2026-10-16', startTime: '19:00', endTime: '20:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
    type: 'study', memo: '', sourceType: 'weekly-planning',
    sourceId: buildWeeklyPlanningPlanSourceId({
      approvalOperationId: `issue51-${suffix}`,
      sourceDraftBlockId: `block-${suffix}`,
    }),
  };
}

const targets = ['operation', 'item', 'legacy-plan', 'canonical-event'] as const;
function targetRef(db: Firestore, value: PlanDraft, target: typeof targets[number]) {
  const identity = resolveApprovalDraftIdentity(value);
  const operation = doc(db, 'weekly_planning_approval_operations', identity.operationDocumentId);
  if (target === 'operation') return operation;
  if (target === 'item') return doc(operation, 'weekly_planning_approval_items', identity.itemDocumentId);
  if (target === 'legacy-plan') return doc(db, 'plans', identity.planId);
  return doc(db, 'schedule_events', scheduleEventIdForLegacy({ kind: 'plan', id: identity.planId }));
}

describe.skipIf(!enabled)('Issue #51 first approval transaction — actual deployed Rules contract', () => {
  let owner: Awaited<ReturnType<typeof context>>;
  let foreign: Awaited<ReturnType<typeof context>>;
  beforeAll(async () => {
    if (configuredProject && configuredProject !== 'demo-studyplanner') {
      throw new Error('A demo-studyplanner project is mandatory.');
    }
    localAddress(authHost!);
    localAddress(firestoreHost!);
    owner = await context('owner');
    foreign = await context('foreign');
  });
  afterAll(async () => { await Promise.all(apps.map(app => deleteApp(app))); });

  it.each(targets)('owner can check absence of own %s before first write', async target => {
    const snapshot = await getDoc(targetRef(owner.db, draft(owner.uid, `missing-${target}`), target));
    expect(snapshot.exists()).toBe(false);
  });

  it.each(targets)('foreign user cannot inspect owner %s (including absence)', async target => {
    await expect(getDoc(targetRef(foreign.db, draft(owner.uid, `foreign-${target}`), target)))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('first actual repository transaction saves once and same-source retry preserves identity', async () => {
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository(owner.db);
    const input = draft(owner.uid, 'first-save');
    const first = await repository.saveApprovedPlan(input);
    const second = await repository.saveApprovedPlan(input);
    expect(first.userId).toBe(owner.uid);
    expect(second.id).toBe(first.id);
    expect((await getDoc(targetRef(owner.db, input, 'operation'))).exists()).toBe(true);
    expect((await getDoc(targetRef(owner.db, input, 'item'))).exists()).toBe(true);
    expect((await getDoc(targetRef(owner.db, input, 'legacy-plan'))).exists()).toBe(true);
    await expect(getDoc(targetRef(foreign.db, input, 'operation')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(targetRef(foreign.db, input, 'item')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(targetRef(foreign.db, input, 'legacy-plan')))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});
