import process from 'node:process';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-studyplanner';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const FIXED_AT = '2026-09-03T00:00:00.000Z';

function emulatorUrl(host) {
  return host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}`;
}

function splitHost(value, fallbackPort) {
  const withoutScheme = value.replace(/^https?:\/\//, '');
  const [host, rawPort] = withoutScheme.split(':');
  return { host, port: Number(rawPort || fallbackPort) };
}

async function createContext(label) {
  const app = initializeApp({
    apiKey: 'demo-key',
    authDomain: 'localhost',
    projectId,
  }, `rules-${label}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, emulatorUrl(authHost), { disableWarnings: true });
  const db = getFirestore(app);
  const firestore = splitHost(firestoreHost, 8080);
  connectFirestoreEmulator(db, firestore.host, firestore.port);
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const credential = await createUserWithEmailAndPassword(auth, email, 'rules-test-password');
  return {
    app,
    auth,
    db,
    user: credential.user,
    email,
  };
}

async function expectPermissionDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
    if (code.includes('permission-denied')) return;
    throw new Error(`${label}: expected permission-denied, received ${code || String(error)}`);
  }
  throw new Error(`${label}: expected permission-denied, operation succeeded`);
}

function baseProfile(userId, email) {
  return {
    id: userId,
    email,
    username: 'Rules Test',
    avatar: '',
    createdAt: new Date().toISOString(),
  };
}

function migrationLease(userId, startedAt) {
  return {
    schemaVersion: 1,
    migrationVersion: 1,
    userId,
    status: 'migrating',
    operationId: `schedule-event-migration-v1:${userId}`,
    revision: 1,
    startedAt,
    completedAt: null,
  };
}

function baseScheduleEvent(userId, id) {
  return {
    schemaVersion: 1,
    id,
    userId,
    title: 'Rules schedule event',
    date: '2026-09-03',
    endDate: '2026-09-03',
    startTime: '09:00',
    endTime: '10:00',
    recurrence: {
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      rules: [],
    },
    busy: true,
    memo: '',
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
  };
}

function scheduleEvent(userId, legacyId = 'legacy-plan') {
  return {
    ...baseScheduleEvent(userId, `plan:${legacyId}`),
    category: 'study',
    kind: 'study',
    provenance: {
      legacy: {
        kind: 'plan',
        id: legacyId,
      },
      sourceType: null,
      sourceId: null,
    },
    plan: {
      legacyPlanId: legacyId,
      seriesId: legacyId,
      subject: 'Math',
      planType: 'study',
    },
    general: null,
  };
}

function monthScheduleEvent(userId, legacyId = 'legacy-month-event') {
  return {
    ...baseScheduleEvent(userId, `month-event:${legacyId}`),
    category: 'other',
    kind: 'general',
    provenance: {
      legacy: {
        kind: 'month-event',
        id: legacyId,
      },
      sourceType: 'month-event',
      sourceId: null,
    },
    plan: null,
    general: {
      url: '',
      checklist: [],
      locationTags: [],
    },
  };
}

const contexts = [];
try {
  const owner = await createContext('owner');
  contexts.push(owner);
  const profileRef = doc(owner.db, 'profiles', owner.user.uid);

  await setDoc(profileRef, {
    ...baseProfile(owner.user.uid, owner.email),
    registeredAt: serverTimestamp(),
  }, { merge: true });

  const created = await getDoc(profileRef);
  if (!created.exists()) throw new Error('owner profile was not created');
  const registeredAt = created.get('registeredAt');
  if (!(registeredAt instanceof Timestamp)) {
    throw new Error('registeredAt was not persisted as a Firestore timestamp');
  }

  await setDoc(profileRef, {
    ...baseProfile(owner.user.uid, owner.email),
    username: 'Updated Rules Test',
  }, { merge: true });

  await expectPermissionDenied('registeredAt mutation', () => setDoc(profileRef, {
    registeredAt: serverTimestamp(),
  }, { merge: true }));

  const missingRegistration = await createContext('missing-registration');
  contexts.push(missingRegistration);
  await expectPermissionDenied('profile create without registeredAt', () => setDoc(
    doc(missingRegistration.db, 'profiles', missingRegistration.user.uid),
    baseProfile(missingRegistration.user.uid, missingRegistration.email),
    { merge: true },
  ));

  const forgedRegistration = await createContext('forged-registration');
  contexts.push(forgedRegistration);
  await expectPermissionDenied('profile create with forged registeredAt', () => setDoc(
    doc(forgedRegistration.db, 'profiles', forgedRegistration.user.uid),
    {
      ...baseProfile(forgedRegistration.user.uid, forgedRegistration.email),
      registeredAt: Timestamp.fromMillis(0),
    },
    { merge: true },
  ));

  const legacyPlanRef = doc(owner.db, 'plans', 'legacy-plan');
  await setDoc(legacyPlanRef, {
    id: 'legacy-plan',
    userId: owner.user.uid,
    title: 'Legacy plan before cutover',
  });

  await expectPermissionDenied('ScheduleEvent create before migration lease', () => setDoc(
    doc(owner.db, 'schedule_events', 'plan:pre-migration'),
    scheduleEvent(owner.user.uid, 'pre-migration'),
  ));

  const startedAt = new Date().toISOString();
  const migrationRef = doc(
    owner.db,
    'schedule_event_migrations',
    owner.user.uid,
  );
  await expectPermissionDenied('forged migration operation identity', () => setDoc(
    migrationRef,
    {
      ...migrationLease(owner.user.uid, startedAt),
      operationId: 'forged-operation',
    },
  ));
  await setDoc(migrationRef, migrationLease(owner.user.uid, startedAt));

  const legacyReadableAfterLease = await getDoc(legacyPlanRef);
  if (!legacyReadableAfterLease.exists()) {
    throw new Error('legacy plan must remain readable while migration is in progress');
  }

  await expectPermissionDenied('legacy Plan write after migration lease', () => setDoc(
    legacyPlanRef,
    { title: 'must not fork authority' },
    { merge: true },
  ));

  await expectPermissionDenied('legacy MonthEvent create after migration lease', () => setDoc(
    doc(owner.db, 'month_events', 'late-month-event'),
    { id: 'late-month-event', userId: owner.user.uid, title: 'late legacy write' },
  ));

  await expectPermissionDenied('incomplete canonical ScheduleEvent schema', () => setDoc(
    doc(owner.db, 'schedule_events', 'plan:incomplete'),
    {
      schemaVersion: 1,
      id: 'plan:incomplete',
      userId: owner.user.uid,
      kind: 'study',
      busy: true,
      provenance: {
        legacy: { kind: 'plan', id: 'incomplete' },
        sourceType: null,
        sourceId: null,
      },
    },
  ));

  const scheduleEventRef = doc(owner.db, 'schedule_events', 'plan:legacy-plan');
  await expectPermissionDenied('ScheduleEvent document/provenance identity mismatch', () => setDoc(
    scheduleEventRef,
    {
      ...scheduleEvent(owner.user.uid),
      provenance: {
        legacy: {
          kind: 'plan',
          id: 'different-plan',
        },
        sourceType: null,
        sourceId: null,
      },
    },
  ));
  await setDoc(scheduleEventRef, scheduleEvent(owner.user.uid));
  await setDoc(scheduleEventRef, { busy: false }, { merge: true });

  const monthScheduleEventRef = doc(
    owner.db,
    'schedule_events',
    'month-event:legacy-month-event',
  );
  await setDoc(monthScheduleEventRef, monthScheduleEvent(owner.user.uid));

  const completedMigration = {
    ...migrationLease(owner.user.uid, startedAt),
    status: 'completed',
    sourcePlanCount: 1,
    sourceMonthEventCount: 0,
    eventCount: 1,
    completedAt: new Date().toISOString(),
  };
  await setDoc(migrationRef, completedMigration);

  await setDoc(migrationRef, {
    ...completedMigration,
    completedAt: new Date(Date.now() + 1).toISOString(),
  });

  await expectPermissionDenied('completed migration cannot change verified counts', () => setDoc(
    migrationRef,
    {
      ...completedMigration,
      eventCount: 2,
      completedAt: new Date(Date.now() + 2).toISOString(),
    },
  ));

  await expectPermissionDenied('completed migration cannot return to migrating', () => setDoc(
    migrationRef,
    migrationLease(owner.user.uid, startedAt),
  ));

  const intruder = await createContext('intruder');
  contexts.push(intruder);
  await expectPermissionDenied('cross-user profile update', () => setDoc(
    doc(intruder.db, 'profiles', owner.user.uid),
    { username: 'Intruder' },
    { merge: true },
  ));
  await expectPermissionDenied('cross-user ScheduleEvent create', () => setDoc(
    doc(intruder.db, 'schedule_events', 'plan:foreign'),
    scheduleEvent(owner.user.uid, 'foreign'),
  ));

  const classIds = ['day-cancel-class-1', 'day-cancel-class-2'];
  for (const id of classIds) await setDoc(doc(owner.db, 'schedule_templates', id), {
    id, userId: owner.user.uid, title: 'Legacy template without exceptions', active: true,
  });
  const exclude = writeBatch(owner.db);
  for (const id of classIds) exclude.set(doc(owner.db, 'schedule_templates', id), { excludedDates: ['2026-10-05'] }, { merge: true });
  await exclude.commit();
  for (const id of classIds) {
    const row = (await getDoc(doc(owner.db, 'schedule_templates', id))).data();
    if (JSON.stringify(row.excludedDates) !== '["2026-10-05"]' || !row.active) throw new Error('Timetable date exception was not retained.');
  }
  await expectPermissionDenied('foreign timetable date exception', () => setDoc(
    doc(intruder.db, 'schedule_templates', classIds[0]), { excludedDates: ['2026-10-12'] }, { merge: true },
  ));
  const ownIntruderId = 'intruder-own-template';
  await setDoc(doc(intruder.db, 'schedule_templates', ownIntruderId), { id: ownIntruderId, userId: intruder.user.uid, excludedDates: [] });
  const mixedOwners = writeBatch(intruder.db);
  mixedOwners.set(doc(intruder.db, 'schedule_templates', ownIntruderId), { excludedDates: ['2026-10-12'] }, { merge: true });
  mixedOwners.set(doc(intruder.db, 'schedule_templates', classIds[0]), { excludedDates: ['2026-10-12'] }, { merge: true });
  await expectPermissionDenied('mixed-owner timetable cancellation batch', () => mixedOwners.commit());
  if ((await getDoc(doc(intruder.db, 'schedule_templates', ownIntruderId))).data().excludedDates.length !== 0) {
    throw new Error('Rejected timetable batch must be atomic.');
  }
  const restore = writeBatch(owner.db);
  for (const id of classIds) restore.set(doc(owner.db, 'schedule_templates', id), { excludedDates: [] }, { merge: true });
  await restore.commit();
  for (const id of classIds) if ((await getDoc(doc(owner.db, 'schedule_templates', id))).data().excludedDates.length !== 0) {
    throw new Error('Timetable date exception undo was not retained.');
  }

  console.log('Firestore profile and ScheduleEvent authority rules regression passed.');
} finally {
  await Promise.all(contexts.map(({ app }) => deleteApp(app)));
}
