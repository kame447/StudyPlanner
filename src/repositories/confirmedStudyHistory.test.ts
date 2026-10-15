import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actual, deferred, event, plan } from './localPersistenceConcurrency.testUtils';
import { createConfirmedStudyHistory } from './confirmedStudyHistory';
import { scheduleEventFromMonthEvent, scheduleEventFromPlan } from '../domain/scheduleEvent';

const sdk = vi.hoisted(() => ({ docs: vi.fn(), serverDocs: vi.fn(), doc: vi.fn(), set: vi.fn(), transaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (collection: object, ...constraints: object[]) => ({ collection, constraints }),
  getDocs: sdk.docs, getDocsFromServer: sdk.serverDocs, getDocFromServer: sdk.doc,
  setDoc: sdk.set, runTransaction: sdk.transaction, deleteDoc: vi.fn(), deleteField: vi.fn(), onSnapshot: vi.fn(),
  writeBatch: () => ({ set: vi.fn(), delete: vi.fn(), commit: async () => undefined }),
}));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({}), getFirestoreDb: () => ({}) }));
vi.mock('./firebaseAuthRepository', () => ({ createFirebaseAuthRepository: () => ({}) }));
vi.mock('./observedPlannerRepository', () => ({ createObservedPlannerRepository: (repository: unknown) => repository }));
import { createFirebaseRepositories } from './firebaseRepositories';

const clean = { fromCache: false, hasPendingWrites: false };
const snapshot = (value: unknown) => ({ metadata: clean, exists: () => value !== null, data: () => value });
const rows = (owner = 'owner') => [actual({ userId: owner, planId: null, occurrenceDate: '2026-10-08' })];
const monthEvents = (owner = 'owner') => [event({ id: 'job', userId: owner, title: '塾バイト' })];
const plans = (owner = 'owner') => [plan({ userId: owner })];
const list = (source: { collection: { name: string }; constraints: Array<{ field: string; value: string }> }) => {
  const owner = source.constraints.find(item => item.field === 'userId')!.value;
  const kind = source.constraints.find(item => item.field === 'provenance.legacy.kind')?.value;
  const values = source.collection.name === 'actuals' ? rows(owner)
    : [...plans(owner).map(scheduleEventFromPlan), ...monthEvents(owner).map(scheduleEventFromMonthEvent)]
      .filter(row => !kind || row.provenance.legacy.kind === kind);
  return { metadata: clean, docs: values.map(row => ({ id: row.id, data: () => row })) };
};
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00'));
  sdk.docs.mockImplementation(async query => list(query)); sdk.serverDocs.mockImplementation(async query => list(query));
  sdk.doc.mockImplementation(async ref => snapshot(ref.collection === 'schedule_event_migrations'
    ? { schemaVersion: 1, migrationVersion: 1, status: 'completed', userId: ref.id } : null));
  sdk.set.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

async function startup(bundle = createFirebaseRepositories(), owner = 'owner') {
  const [schedule, actuals] = await Promise.all([bundle.plannerRepository.getScheduleSnapshot(owner), bundle.plannerRepository.getActuals(owner)]);
  return { bundle, hint: { ...schedule, actuals } };
}

describe('complete startup read evidence, without a second history fetch', () => {
  it('uses existing unbounded owner queries after normalization: initial/reopen history +0, rest +1', async () => {
    const { bundle, hint } = await startup();
    expect(sdk.docs).toHaveBeenCalledTimes(2);
    expect(sdk.docs.mock.calls.map(([q]) => q.constraints)).toEqual([
      [{ field: 'userId', op: '==', value: 'owner' }], [{ field: 'userId', op: '==', value: 'owner' }],
    ]);
    const before = sdk.doc.mock.calls.length;
    const history = await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    expect(history).toMatchObject({ historyComplete: true, plans: hint.plans, actuals: hint.actuals });
    expect(sdk.serverDocs).not.toHaveBeenCalled();
    expect(sdk.doc).toHaveBeenCalledTimes(before + 1);
    expect(bundle.studyStreakRepository.peek?.('owner', hint)).toBe(history);
    await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    expect(sdk.serverDocs).not.toHaveBeenCalled();
    expect(sdk.doc).toHaveBeenCalledTimes(before + 2);
    expect(bundle.studyStreakRepository.peek?.('other', hint)).toBeNull();
    const other = await startup(bundle, 'other');
    await bundle.studyStreakRepository.read('other', { hint: other.hint, today: '2026-10-09' });
    expect(sdk.serverDocs).not.toHaveBeenCalled();
  });

  it.each([{ ...clean, fromCache: true }, { ...clean, hasPendingWrites: true }, undefined])('does not reuse unconfirmed metadata %j or consume when server confirmation fails', async metadata => {
    sdk.docs.mockImplementation(async query => ({ ...list(query), metadata }));
    const { bundle, hint } = await startup();
    sdk.serverDocs.mockRejectedValue(new Error('offline'));
    await expect(bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' })).rejects.toThrow('offline');
    expect(sdk.serverDocs).toHaveBeenCalledTimes(2);
    expect(sdk.transaction).not.toHaveBeenCalled();
  });

  it('refreshes a new local day, rejects old-owner reuse, and never authorizes a spend after an Actual write', async () => {
    const { bundle, hint } = await startup();
    const history = await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    await bundle.plannerRepository.upsertActual(actual({ planId: null }));
    await expect(bundle.studyStreakRepository.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
    expect(sdk.transaction).not.toHaveBeenCalled();
    await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    expect(sdk.serverDocs).toHaveBeenCalledTimes(2);
    await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-10' });
    expect(sdk.serverDocs).toHaveBeenCalledTimes(4);
    await bundle.studyStreakRepository.read('other', { hint: { plans: plans('other'), actuals: rows('other'), monthEvents: monthEvents('other') }, today: '2026-10-10' });
    expect(sdk.serverDocs).toHaveBeenCalledTimes(6);
  });

  it('retains the display on a failed refresh but requires a new full confirmation before another spend', async () => {
    const { bundle, hint } = await startup();
    const before = await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    sdk.serverDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09', refresh: true })).rejects.toThrow('offline');
    expect(bundle.studyStreakRepository.peek?.('owner', hint)).toBe(before);
    await expect(bundle.studyStreakRepository.useRestDay(before, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
    await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
    expect(sdk.serverDocs).toHaveBeenCalledTimes(4);
    await expect(bundle.studyStreakRepository.useRestDay(before, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
  });

  it('does not restore an older generation or another owner from a delayed read', async () => {
    const receipt = createConfirmedStudyHistory(() => '2026-10-09');
    receipt.confirmMigration('owner');
    receipt.beginRead('owner', 'plans')([], clean); receipt.beginRead('owner', 'monthEvents')([], clean);
    const late = receipt.beginRead('owner', 'actuals');
    const latest = receipt.beginRead('owner', 'actuals');
    latest(rows(), clean); late([], clean);
    expect(receipt.read('owner', { plans: [], actuals: rows(), monthEvents: [] }, '2026-10-09')).not.toBeNull();
    receipt.beginRead('other', 'plans')([], clean); late(rows(), clean);
    expect(receipt.read('owner', { plans: [], actuals: rows(), monthEvents: [] }, '2026-10-09')).toBeNull();
    expect(receipt.read('other', { plans: [], actuals: rows('other'), monthEvents: [] }, '2026-10-09')).toBeNull();
  });

  it('invalidates on a failed replacement read and both sides of a pending mutation', async () => {
    const receipt = createConfirmedStudyHistory(() => '2026-10-09');
    const publish = () => { receipt.confirmMigration('owner'); receipt.beginRead('owner', 'plans')([], clean); receipt.beginRead('owner', 'monthEvents')([], clean); receipt.beginRead('owner', 'actuals')(rows(), clean); };
    const hint = { plans: [], actuals: rows(), monthEvents: [] }; publish();
    expect(receipt.read('owner', hint, '2026-10-09')).not.toBeNull();
    receipt.beginRead('owner', 'actuals'); // failed read never publishes
    expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
    publish();
    const pending = deferred<void>(), writing = receipt.duringMutation('owner', () => pending.promise);
    publish(); expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
    pending.resolve(); await writing;
    expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
  });
});

it.each(['upsert', 'delete', 'recurring'] as const)('invalidates issued history after a major-event %s mutation', async kind => {
  const { bundle, hint } = await startup();
  const history = await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
  if (kind === 'upsert') await bundle.plannerRepository.upsertMonthEvent(event({ id: 'job' }));
  else if (kind === 'delete') await bundle.plannerRepository.deleteMonthEvent('owner', 'job');
  else await bundle.plannerRepository.applyRecurringMonthEventMutation('owner', [event({ id: 'job' })]);
  await expect(bundle.studyStreakRepository.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
  expect(sdk.transaction).not.toHaveBeenCalled();
  await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
  expect(sdk.serverDocs).toHaveBeenCalledTimes(2);
});

it('requires confirmed complete major-event evidence and ignores stale or unconfirmed replacements', () => {
  const receipt = createConfirmedStudyHistory(() => '2026-10-09');
  const hint = { plans: [], actuals: rows(), monthEvents: monthEvents() };
  receipt.confirmMigration('owner');
  receipt.beginRead('owner', 'plans')([], clean);
  receipt.beginRead('owner', 'actuals')(hint.actuals, clean);
  expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
  receipt.beginRead('owner', 'monthEvents')(hint.monthEvents, { ...clean, fromCache: true });
  expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
  receipt.beginRead('owner', 'monthEvents')(hint.monthEvents, { ...clean, hasPendingWrites: true });
  expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
  const stale = receipt.beginRead('owner', 'monthEvents');
  receipt.beginRead('owner', 'monthEvents')(hint.monthEvents, clean);
  stale([], clean);
  expect(receipt.read('owner', hint, '2026-10-09')).not.toBeNull();
  expect(receipt.read('owner', { ...hint, monthEvents: [] }, '2026-10-09')).toBeNull();
  receipt.beginRead('owner', 'monthEvents'); // A failed replacement never publishes.
  expect(receipt.read('owner', hint, '2026-10-09')).toBeNull();
});

it('keeps startup and reopen free of duplicate history queries and exposes the bounded cost after a MonthEvent-only refresh', async () => {
  const { bundle, hint } = await startup();
  expect(sdk.docs.mock.calls.map(([query]) => [query.collection.name, list(query).docs.length])
    .sort(([left], [right]) => String(left).localeCompare(String(right))))
    .toEqual([['actuals', 1], ['schedule_events', 2]]);
  const beforeRestReads = sdk.doc.mock.calls.filter(([reference]) => reference.collection === 'study_rest_days').length;
  await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
  await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
  expect(sdk.serverDocs).not.toHaveBeenCalled();
  expect(sdk.doc.mock.calls.filter(([reference]) => reference.collection === 'study_rest_days')).toHaveLength(beforeRestReads + 2);

  await bundle.plannerRepository.upsertMonthEvent(event({ id: 'job' }));
  const refreshedEvents = await bundle.plannerRepository.getMonthEvents('owner');
  expect(sdk.docs).toHaveBeenCalledTimes(3);
  const partialQuery = sdk.docs.mock.calls[2][0];
  expect(partialQuery.constraints).toContainEqual({ field: 'provenance.legacy.kind', op: '==', value: 'month-event' });
  expect(list(partialQuery).docs).toHaveLength(1);
  const beforeFullRead = sdk.doc.mock.calls.length;
  const latestHint = { ...hint, monthEvents: refreshedEvents };
  await bundle.studyStreakRepository.read('owner', { hint: latestHint, today: '2026-10-09' });
  // One Actual query and one full schedule query; compared with a Plan-only
  // fallback, the additional returned documents are precisely the MonthEvents.
  expect(sdk.serverDocs.mock.calls.map(([query]) => [query.collection.name, list(query).docs.length]))
    .toEqual([['actuals', 1], ['schedule_events', 2]]);
  expect(sdk.doc.mock.calls.slice(beforeFullRead).map(([reference]) => reference.collection))
    .toEqual(['schedule_event_migrations', 'study_rest_days']);
  await bundle.studyStreakRepository.read('owner', { hint: latestHint, today: '2026-10-09' });
  expect(sdk.serverDocs).toHaveBeenCalledTimes(2);
  expect(sdk.docs).toHaveBeenCalledTimes(3);
});

it('revokes previously issued spend authority on both sides of an in-flight major-event write', async () => {
  const { bundle, hint } = await startup();
  const history = await bundle.studyStreakRepository.read('owner', { hint, today: '2026-10-09' });
  const pending = deferred<void>();
  sdk.set.mockReturnValueOnce(pending.promise);
  const saving = bundle.plannerRepository.upsertMonthEvent(event({ id: 'job' }));
  await expect(bundle.studyStreakRepository.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
  pending.resolve(); await saving;
  await expect(bundle.studyStreakRepository.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow('変更');
  expect(sdk.transaction).not.toHaveBeenCalled();
});
