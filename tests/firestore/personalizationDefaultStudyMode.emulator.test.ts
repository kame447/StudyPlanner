import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import {
  createFirestoreWeeklyPlanningPersonalizationRepository,
} from '../../src/features/weeklyPlanning/personalization/weeklyPlanningPersonalizationRepository';

// #190: the default study mode is stored in weekly_planning_personalization_profiles next to the week start,
// so it must save and restore under the Rules as they are. Prepared for the demo-studyplanner Auth/Firestore
// emulators; it skips ordinary CI.
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
async function seed(path: string, fields: object) {
  const response = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  });
  expect(response.status).toBe(200);
}
async function user(label: string, policy: boolean) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: project }, `default-study-mode-${label}-${run}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const location = address(firestoreHost!);
  connectFirestoreEmulator(db, location.host, location.port);
  const uid = (await createUserWithEmailAndPassword(auth, `study-mode-${label}-${run}@example.test`, 'demo-test-password')).user.uid;
  if (policy) {
    await seed(`profiles/${uid}`, { weeklyPlanningTracePolicy: { mapValue: { fields: { version: { stringValue: '2026-07-18-v1' } } } } });
  }
  return { db, uid, repository: createFirestoreWeeklyPlanningPersonalizationRepository(db) };
}
type Actor = Awaited<ReturnType<typeof user>>;
const denied = { code: 'permission-denied' };

describe.skipIf(!enabled)('default study mode in weekly_planning_personalization_profiles', () => {
  let owner: Actor; let foreign: Actor; let noPolicy: Actor;
  beforeAll(async () => {
    if (project !== 'demo-studyplanner') throw new Error('demo-studyplanner-required');
    address(authHost!); address(firestoreHost!);
    owner = await user('owner', true); foreign = await user('foreign', true); noPolicy = await user('nopolicy', false);
  });
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); });

  it('saves and restores the default mode and pomodoro length without a Rules change, keeping the week start', async () => {
    await owner.repository.setWeekStartsOn(owner.uid, 'sunday');
    expect((await owner.repository.getProfile(owner.uid))?.defaultStudyMode).toBeUndefined();

    const mode = { mode: 'pomodoro', pomodoro: { preset: 'custom', customFocusMinutes: 40, customBreakMinutes: 8 } } as const;
    const saved = await owner.repository.setDefaultStudyMode(owner.uid, mode);
    const restored = await owner.repository.getProfile(owner.uid);

    expect(restored).toEqual(saved);
    expect(restored?.defaultStudyMode?.value).toEqual(mode);
    expect(restored?.weekStartsOn?.value).toBe('sunday');
    // The stored document, not only the repository's view of it, carries the preference.
    const stored = (await getDoc(doc(owner.db, 'weekly_planning_personalization_profiles', owner.uid))).data();
    expect(stored?.defaultStudyMode).toMatchObject({ value: mode, origin: 'user_confirmed' });
  });

  it('saves a profile that has only the default mode, and a later week start keeps it', async () => {
    const own = await user('mode-first', true);
    await own.repository.setDefaultStudyMode(own.uid, { mode: 'normal', pomodoro: { preset: '50-10' } });
    const next = await own.repository.setWeekStartsOn(own.uid, 'monday');
    expect(next.defaultStudyMode?.value).toEqual({ mode: 'normal', pomodoro: { preset: '50-10' } });
    expect((await own.repository.getProfile(own.uid))?.weekStartsOn?.value).toBe('monday');
  });

  it("does not let another user read or change someone's default mode", async () => {
    await expect(foreign.repository.getProfile(owner.uid)).rejects.toMatchObject(denied);
    await expect(foreign.repository.setDefaultStudyMode(owner.uid, { mode: 'normal', pomodoro: { preset: '25-5' } }))
      .rejects.toMatchObject(denied);
    expect((await owner.repository.getProfile(owner.uid))?.defaultStudyMode?.value.mode).toBe('pomodoro');
  });

  it('does not save without the accepted weekly-planning policy', async () => {
    await expect(noPolicy.repository.setDefaultStudyMode(noPolicy.uid, { mode: 'pomodoro', pomodoro: { preset: '25-5' } }))
      .rejects.toMatchObject(denied);
  });
});
