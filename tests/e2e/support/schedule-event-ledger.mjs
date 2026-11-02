// What the emulator specs claim about saved schedule events, as checks that return their violations
// (an empty list means the claim holds). Scoped to one user and one target (title text, optionally a date),
// so other specs' documents in the shared emulator never count. The same checks run in the real-API and
// the synthetic emulator specs, and schedule-event-ledger.spec.mjs proves they fail on a duplicated save
// and on a save before approval.
const AUTH = 'http://127.0.0.1:9199';

const text = (field) => field?.stringValue ?? null;

/** Firestore REST documents of schedule_events as plain records. */
export function scheduleEventRecords(documents) {
  return documents.map(({ fields = {} }) => ({
    id: text(fields.id), userId: text(fields.userId), title: text(fields.title), date: text(fields.date),
    startTime: text(fields.startTime), endTime: text(fields.endTime),
  }));
}

/** The user's saved events whose title contains the target text (and, when given, on the target date). */
export function savedFor(documents, { userId, title, date }) {
  return scheduleEventRecords(documents)
    .filter((record) => record.userId === userId && record.title?.includes(title) && (!date || record.date === date))
    .sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
}

/** Identity and placement of a saved target; what must not change once it is saved. */
export const placement = (records) => records.map(({ id, date, startTime, endTime }) => ({ id, date, startTime, endTime }));

export function notSavedYet(documents, target) {
  const found = savedFor(documents, target);
  return found.length ? [`${target.title}: ${found.length} saved before approval (${found.map(({ id }) => id).join(', ')})`] : [];
}

export function savedExactlyOnce(documents, target) {
  const found = savedFor(documents, target);
  return found.length === 1 ? [] : [`${target.title}: expected exactly 1 saved event, found ${found.length}`];
}

/** Saved at least once; a legitimate split into several blocks passes. */
export function savedAtLeastOnce(documents, target) {
  return savedFor(documents, target).length ? [] : [`${target.title}: nothing saved`];
}

/** The same events, with the same ids and placement, as an earlier snapshot of the target. */
export function unchangedSince(before, documents, target) {
  const now = placement(savedFor(documents, target));
  return JSON.stringify(now) === JSON.stringify(before)
    ? [] : [`${target.title}: saved events changed from ${JSON.stringify(before)} to ${JSON.stringify(now)}`];
}

/** The signed-in account's id, as the Auth emulator knows it (schedule_events documents carry it as userId). */
export async function emulatorUserId(request, { email, password }) {
  const response = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    { data: { email, password, returnSecureToken: true } });
  if (!response.ok()) throw new Error(`Auth emulator sign-in failed: ${response.status()}`);
  return (await response.json()).localId;
}
