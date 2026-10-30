import { clearUserPlanningContextForOwnerV1 } from '../features/userPlanningContext/userPlanningContextSpace';

const sharedArrays = [
  'studyplanner.plans', 'studyplanner.actuals', 'studyplanner.dayNotes', 'studyplanner.monthEvents',
  'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1',
  'studyplanner.scheduleTemplates.v1', 'studyplanner.timetableTerms.v1', 'studyplanner.timetablePeriods.v1',
  'studyplanner.scheduleEvents.v1', 'studyplanner.scheduleEventMigrations.v1',
  'studyplanner.users', 'studyplanner.local.passwords',
  'studyplanner-weekly-planning-trace-sessions-v1', 'studyplanner-weekly-planning-trace-entries-v1',
];
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const owned = (value: unknown, uid: string) => record(value) && (value.userId === uid || value.ownerId === uid);

/** Enumerated application stores only; never clear the origin or another user's data. */
export function clearAccountBrowserStorage(uid: string, local: Storage, session: Storage): void {
  const encoded = encodeURIComponent(uid);
  const exact = new Set([
    `studyplanner.accountDeletionStarted.v1.${encoded}`, `studyplanner.activeSession.v1.${encoded}`, `studyplanner.studyRestDays.v1:${encoded}`,
    `studyplanner-weekly-approval-ledger-v2.${encoded}`, `studyplanner-weekly-personalization-v1:${encoded}`,
    `studyplanner.durableWeeklyTurn.v1:${encoded}`, `studyplanner.aiPlanning.chats.v1.${uid}`,
    `studyplanner.weeklyPlanning.activeSession.${uid}`, `studyplanner.userPlanningContext.${uid}`,
    ...['month-timetable', 'day-timetable', 'study-progress'].map(name => `study-planner-${name}:${encoded}`),
  ]);
  const prefixes = [
    `studyplanner.activeSession.v1.${encoded}.dispatch.`, `studyplanner.activeSession.v1.${encoded}.probe.`,
    `studyplanner.weeklyPlanning.${uid}.`, `studyplanner.weeklyPlanning.stableV5.${uid}.`,
    `studyplanner.weeklyPlanningUnreadable.v1.${encoded}.`, `studyplanner.aiPlanning.chat.v1.${uid}.`,
    `studyplanner.aiPlanning.chatSearch.v1.${uid}.`, `studyplanner:material-detail:v1:${uid}:`,
    `studyplanner.classAttendance.v1:${encoded}:`, `studyplanner.weeklyPlanning.trace.stableV5.${encoded}::`,
    `studyplanner.weeklyPlanning.trace.serverHandle.v1.${encoded}::`, `studyplanner.startup-schedule.v1:${encoded}:`,
  ];
  const keys = Array.from({ length: local.length }, (_, index) => local.key(index)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (exact.has(key) || prefixes.some(prefix => key.startsWith(prefix))) local.removeItem(key);
  }
  for (const key of sharedArrays) {
    const raw = local.getItem(key);
    if (!raw) continue;
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) continue;
    const remaining = values.filter(value => !owned(value, uid) && !(key === 'studyplanner.users' && record(value) && value.id === uid));
    if (remaining.length !== values.length) {
      if (remaining.length) local.setItem(key, JSON.stringify(remaining)); else local.removeItem(key);
    }
  }
  for (const [key, field] of [
    ['studyplanner-weekly-approval-ledger-v1', 'operations'],
    ['studyplanner.weeklyPlanning.trace.outbox.v1', 'items'],
  ] as const) {
    const raw = local.getItem(key);
    if (!raw) continue;
    const envelope: unknown = JSON.parse(raw);
    if (!record(envelope) || !Array.isArray(envelope[field])) continue;
    const values = envelope[field];
    const remaining = values.filter(value => !owned(value, uid) && !(record(value) && owned(value.input, uid)));
    if (remaining.length !== values.length) {
      if (remaining.length) local.setItem(key, JSON.stringify({ ...envelope, [field]: remaining })); else local.removeItem(key);
    }
  }
  if (local.getItem('studyplanner.session') === uid) local.removeItem('studyplanner.session');
  for (const key of ['laplance.inquiry-receipt.v1', 'studyplanner.aiPlanning.moduleRecovery.v1']) {
    const raw = session.getItem(key);
    if (!raw) continue;
    const value: unknown = JSON.parse(raw);
    if (owned(value, uid) || (record(value) && owned(value.binding, uid))) session.removeItem(key);
  }
}

export async function clearAccountLocalData(uid: string): Promise<void> {
  clearAccountBrowserStorage(uid, window.localStorage, window.sessionStorage);
  clearUserPlanningContextForOwnerV1(uid);
  // Firestore uses memory cache; no application IndexedDB database or persistent
  // Firestore cache is enabled. SDK sign-out clears the auth session, then the
  // caller reloads to dispose Firestore/React drafts and module memory.
}
