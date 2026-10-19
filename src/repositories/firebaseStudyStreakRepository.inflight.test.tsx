import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { scheduleEventFromMonthEvent, scheduleEventFromPlan } from '../domain/scheduleEvent';
import { useStudyStreak } from '../hooks/useStudyStreak';
import { addDays } from '../lib/date';
import { actual, deferred, event, plan } from './localPersistenceConcurrency.testUtils';
import { createConfirmedStudyHistory } from './confirmedStudyHistory';
import type { StudyHistoryHint, StudyRestState } from './studyStreakRepository';

const sdk = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), transaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (source: object, ...conditions: object[]) => ({ ...source, conditions }),
  getDocFromServer: sdk.getDoc, getDocsFromServer: sdk.getDocs,
  runTransaction: (_db: unknown, callback: unknown) => sdk.transaction(callback),
}));
import { createFirebaseStudyStreakRepository } from './firebaseStudyStreakRepository';

const today = '2026-10-09';
const metadata = { fromCache: false, hasPendingWrites: false };
const snapshot = (data: unknown) => ({ metadata, exists: () => data !== null, data: () => data });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let hint: StudyHistoryHint;
let gate: ReturnType<typeof deferred<void>> | null;
let stored: StudyRestState | null;
let documents: number;
beforeEach(() => {
  vi.clearAllMocks(); gate = null; stored = null; documents = 0;
  hint = { plans: [], monthEvents: [], actuals: [actual({ planId: null, occurrenceDate: '2026-10-07' })] };
  sdk.getDoc.mockImplementation(async reference => {
    const value = reference.collection === 'schedule_event_migrations'
      ? { schemaVersion: 1, migrationVersion: 1, status: 'completed' } : stored;
    if (value !== null) documents += 1;
    return snapshot(clone(value));
  });
  sdk.getDocs.mockImplementation(async query => {
    const owner = query.conditions.find((condition: { field: string }) => condition.field === 'userId').value;
    const values = (query.collection === 'actuals' ? hint.actuals
      : [...hint.plans.map(scheduleEventFromPlan), ...hint.monthEvents.map(scheduleEventFromMonthEvent)])
      .map(row => ({ ...row, userId: owner }));
    documents += values.length;
    await gate?.promise;
    return { metadata, docs: values.map(row => ({ id: row.id, data: () => clone(row) })) };
  });
  sdk.transaction.mockImplementation(async callback => {
    let next = stored;
    const result = await callback({ get: async () => snapshot(stored), set: (_ref: unknown, value: StudyRestState) => { next = value; } });
    stored = next;
    return result;
  });
});
const options = () => ({ hint, today });
const repository = (receipt?: ReturnType<typeof createConfirmedStudyHistory>) => createFirebaseStudyStreakRepository({} as Firestore, receipt);
const counts = () => ({ queries: sdk.getDocs.mock.calls.length, directReads: sdk.getDoc.mock.calls.length, returnedDocuments: documents });

describe('unsettled identical streak confirmation', () => {
  it('shares the real hook restart after a save, without truncating the 1000-row history', async () => {
    hint = {
      actuals: Array.from({ length: 1000 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: '2026-10-07' })),
      plans: Array.from({ length: 999 }, (_, index) => plan({ id: `p${index}`, date: '2010-01-01' })),
      monthEvents: [event({ id: 'old-repeat', date: '2000-01-01', endDate: '2000-01-01', repeat: 'weekly', repeatUntil: null })],
    };
    stored = { schemaVersion: 1, userId: 'owner', revision: 0, dates: [] };
    const receipt = createConfirmedStudyHistory(() => today);
    receipt.confirmMigration('owner');
    for (const slice of ['plans', 'actuals', 'monthEvents'] as const) receipt.beginRead('owner', slice)(hint[slice], metadata);
    const repo = repository(receipt), read = vi.spyOn(repo, 'read');
    await repo.read('owner', options());
    await receipt.duringMutation('owner', async () => { hint.actuals[0] = { ...hint.actuals[0], note: 'saved' }; });
    sdk.getDoc.mockClear(); sdk.getDocs.mockClear(); documents = 0; gate = deferred();
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ source }: { source: StudyHistoryHint }) {
      state = useStudyStreak('owner', today, repo, source); return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness source={hint} />); });
    await act(async () => renderer.update(<Harness source={clone(hint)} />));
    const observed = counts();
    await act(async () => gate!.resolve());
    expect(state).toMatchObject({ status: 'ready', refreshing: false, readError: null, saveError: null });
    const accepted = await read.mock.results[read.mock.results.length - 1].value;
    expect(accepted).toMatchObject({ monthEvents: [expect.objectContaining({ id: 'old-repeat', date: '2000-01-01', repeat: 'weekly' })] });
    expect(accepted.actuals).toHaveLength(1000);
    expect(accepted.plans).toHaveLength(999);
    expect(sdk.transaction).not.toHaveBeenCalled();
    for (const [query] of sdk.getDocs.mock.calls) expect(query.conditions).toEqual([{ field: 'userId', op: '==', value: 'owner' }]);
    act(() => renderer.unmount());
    console.info('STREAK_OVERLAP_COUNTS', JSON.stringify(observed));
    expect(observed).toEqual({ queries: 2, directReads: 2, returnedDocuments: 2002 });
  });

  it('shares only unsettled reads; settled reopen still confirms the rest document', async () => {
    const repo = repository(); gate = deferred();
    const first = repo.read('owner', options()), second = repo.read('owner', { ...options(), hint: clone(hint) });
    expect(counts()).toMatchObject({ queries: 2, directReads: 2 });
    gate.resolve(); const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);
    expect(await repo.read('owner', options())).not.toBe(left);
    expect(counts()).toMatchObject({ queries: 2, directReads: 3 });
  });

  it.each(['owner', 'day', 'actual', 'plan', 'major-event', 'force'] as const)('does not share when %s changes', async kind => {
    const repo = repository(); gate = deferred();
    const previous = repo.read('owner', options()); const previousResult = previous.catch(error => error);
    const nextHint = clone(hint);
    if (kind === 'actual') nextHint.actuals[0].note = 'changed';
    if (kind === 'plan') nextHint.plans.push(plan());
    if (kind === 'major-event') nextHint.monthEvents.push(event());
    const next = repo.read(kind === 'owner' ? 'other' : 'owner', {
      hint: nextHint, today: kind === 'day' ? '2026-10-10' : today, refresh: kind === 'force',
    });
    expect(counts()).toMatchObject({ queries: 4, directReads: 4 });
    gate.resolve(); await next;
    expect(await previousResult).toEqual(expect.objectContaining({ message: expect.stringContaining('変更') }));
  });

  it('does not share two explicit forced refreshes or a read after an intervening different owner', async () => {
    const repo = repository(); gate = deferred();
    const calls = [repo.read('owner', { ...options(), refresh: true }), repo.read('owner', { ...options(), refresh: true }),
      repo.read('other', options()), repo.read('owner', options())];
    const settled = Promise.allSettled(calls);
    expect(counts()).toMatchObject({ queries: 8, directReads: 8 });
    gate.resolve();
    expect((await settled).map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected', 'fulfilled']);
  });

  it('rejects all joined reads after mutation and makes the new generation fetch again', async () => {
    const receipt = createConfirmedStudyHistory(() => today), repo = repository(receipt); gate = deferred();
    const old = Promise.allSettled([repo.read('owner', options()), repo.read('owner', options())]);
    const writeGate = deferred(); const writing = receipt.duringMutation('owner', () => writeGate.promise);
    await expect(repo.read('owner', options())).rejects.toThrow('変更');
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    writeGate.resolve(); await writing;
    const latest = repo.read('owner', options());
    expect(sdk.getDocs).toHaveBeenCalledTimes(4);
    gate.resolve(); const history = await latest;
    expect((await old).map(result => result.status)).toEqual(['rejected', 'rejected']);
    await receipt.duringMutation('owner', async () => undefined);
    await expect(repo.useRestDay(history, '2026-10-08', today)).rejects.toThrow('変更');
    expect(sdk.transaction).not.toHaveBeenCalled();
  });

  it('does not treat an absent hint as a supplied hint, or a forced read as joinable', async () => {
    const repo = repository(); gate = deferred();
    const calls = [repo.read('owner', { today }), repo.read('owner', options()),
      repo.read('owner', { ...options(), refresh: true }), repo.read('owner', options())];
    const result = Promise.allSettled(calls);
    expect(sdk.getDocs).toHaveBeenCalledTimes(8);
    gate.resolve();
    expect((await result).map(item => item.status)).toEqual(['rejected', 'rejected', 'rejected', 'fulfilled']);
  });

  it('does not clear a newer pending confirmation when a superseded read rejects', async () => {
    const repo = repository(), oldGate = deferred(), latestGate = deferred();
    gate = oldGate;
    const old = repo.read('owner', options()).catch(error => error);
    hint = { ...hint, actuals: [actual({ planId: null, note: 'changed' })] };
    gate = latestGate;
    const latest = repo.read('owner', options());
    oldGate.reject(new Error('offline'));
    expect(await old).toEqual(expect.objectContaining({ message: 'offline' }));
    const joined = repo.read('owner', options());
    expect(sdk.getDocs).toHaveBeenCalledTimes(4);
    latestGate.resolve();
    const [left, right] = await Promise.all([latest, joined]);
    expect(left).toBe(right);
  });

  it('lets only the latest real-hook lifetime spend after a joined read resolves', async () => {
    hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
    const repo = repository(); gate = deferred();
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ source }: { source: StudyHistoryHint }) { state = useStudyStreak('owner', today, repo, source); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness source={hint} />); });
    await act(async () => renderer.update(<Harness source={clone(hint)} />));
    await act(async () => gate!.resolve());
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    expect(sdk.transaction).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({ revision: 1, dates: ['2026-10-08'] });
    expect(state.model).toMatchObject({ earnedTickets: 1, availableTickets: 0, protectedDates: ['2026-10-08'] });
    expect(state).toMatchObject({ readError: null, saveError: null, refreshing: false });
    act(() => renderer.unmount());
  });

  it.each(['mutation', 'input-abort'] as const)('does not commit after %s interrupts a transaction from joined history', async reason => {
    hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
    const receipt = createConfirmedStudyHistory(() => today), repo = repository(receipt);
    gate = deferred();
    const transactionGate = deferred(), set = vi.fn();
    sdk.transaction.mockImplementation(async callback => callback({
      get: async () => { await transactionGate.promise; return snapshot(null); }, set,
    }));
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ source }: { source: StudyHistoryHint }) { state = useStudyStreak('owner', today, repo, source); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness source={hint} />); });
    await act(async () => renderer.update(<Harness source={clone(hint)} />));
    await act(async () => gate!.resolve());
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    expect(sdk.transaction).toHaveBeenCalledTimes(1);
    expect(state.saving).toBe(true);
    if (reason === 'mutation') await receipt.duringMutation('owner', async () => undefined);
    else {
      hint = { ...hint, actuals: hint.actuals.slice(0, 6) };
      await act(async () => renderer.update(<Harness source={hint} />));
    }
    await act(async () => transactionGate.resolve());
    expect(set).not.toHaveBeenCalled();
    expect(stored).toBeNull();
    if (reason === 'mutation') expect(state.saveError).toContain('変更');
    else expect(state.model?.earnedTickets).toBe(0);
    act(() => renderer.unmount());
  });

  it('retires rejected shared reads and retries with fresh server confirmation', async () => {
    const repo = repository(); gate = deferred();
    const result = Promise.allSettled([repo.read('owner', options()), repo.read('owner', options())]);
    gate.reject(new Error('permission-denied'));
    expect((await result).map(item => item.status)).toEqual(['rejected', 'rejected']);
    gate = null;
    const history = await repo.read('owner', options());
    expect(history.actuals).toHaveLength(1);
    expect(counts()).toMatchObject({ queries: 4, directReads: 4 });
  });

  it.each([{ ...metadata, fromCache: true }, { ...metadata, hasPendingWrites: true }])('does not certify shared uncertain snapshots %j', async uncertain => {
    const repo = repository(); gate = deferred();
    sdk.getDocs.mockImplementation(async () => { await gate?.promise; return { metadata: uncertain, docs: [] }; });
    const result = Promise.allSettled([repo.read('owner', options()), repo.read('owner', options())]);
    gate.resolve();
    expect((await result).map(item => item.status)).toEqual(['rejected', 'rejected']);
    expect(repo.peek?.('owner', hint)).toBeNull();
    expect(sdk.transaction).not.toHaveBeenCalled();
  });

  it('retires the pending read across a rest-day transaction and reads its committed state', async () => {
    hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
    const repo = repository(), history = await repo.read('owner', options());
    const restGate = deferred();
    sdk.getDoc.mockImplementationOnce(async () => { const value = snapshot(stored); await restGate.promise; return value; });
    const beforeSave = repo.read('owner', options());
    await repo.useRestDay(history, '2026-10-08', today);
    const afterSave = await repo.read('owner', options());
    expect(afterSave.restDays).toEqual([{ date: '2026-10-08' }]);
    restGate.resolve(); await beforeSave;
    expect(repo.peek?.('owner', afterSave)).toBe(afterSave);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    expect(stored).toMatchObject({ revision: 1, dates: ['2026-10-08'] });
  });
});

it.each(['unmount', 'owner', 'inactive'] as const)('does not stage a rest-day write after %s commits before passive cleanup', async boundary => {
  hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
  const repo = repository(), transactionGate = deferred(), set = vi.fn();
  sdk.transaction.mockImplementation(async callback => callback({
    get: async () => { await transactionGate.promise; return snapshot(null); }, set,
  }));
  function Harness({ owner = 'owner', active = true }: { owner?: string; active?: boolean }) {
    useStudyStreak(owner, today, repo, hint, active); return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  expect(sdk.transaction).toHaveBeenCalledOnce();
  if (boundary === 'unmount') renderer.unmount();
  else renderer.update(<Harness owner={boundary === 'owner' ? 'other' : 'owner'} active={boundary !== 'inactive'} />);
  transactionGate.resolve();
  await Promise.allSettled(sdk.transaction.mock.results.map(result => result.value));
  try { expect(set).not.toHaveBeenCalled(); }
  finally { await act(async () => { renderer.unmount(); }); }
});

it('rejects a transaction callback retry after the hook unmounts at commit', async () => {
  hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
  const repo = repository(), retryGate = deferred(), get = vi.fn(async () => snapshot(null)), set = vi.fn();
  sdk.transaction.mockImplementation(async callback => {
    await callback({ get, set }); // Simulate a conflicted attempt; no server commit.
    await retryGate.promise;
    return callback({ get, set });
  });
  function Harness() { useStudyStreak('owner', today, repo, hint); return null; }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  expect(get).toHaveBeenCalledOnce();
  expect(set).toHaveBeenCalledOnce();
  renderer.unmount();
  retryGate.resolve();
  const result = await Promise.allSettled(sdk.transaction.mock.results.map(item => item.value));
  try {
    expect(result[0].status).toBe('rejected');
    expect(get).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
    expect(stored).toBeNull();
  } finally { await act(async () => {}); }
});

it('allows a new same-owner hook to use the shared read after the previous mount retires', async () => {
  hint.actuals = Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
  const repo = repository(); gate = deferred();
  let state!: ReturnType<typeof useStudyStreak>;
  function Harness() { state = useStudyStreak('owner', today, repo, hint); return null; }
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<Harness />); });
  renderer.unmount();
  await act(async () => { renderer = create(<Harness />); });
  expect(sdk.getDocs).toHaveBeenCalledTimes(2);
  await act(async () => gate!.resolve());
  expect(sdk.transaction).toHaveBeenCalledOnce();
  expect(stored).toMatchObject({ revision: 1, dates: ['2026-10-08'] });
  expect(state).toMatchObject({ status: 'ready', refreshing: false, readError: null, saveError: null });
  act(() => renderer.unmount());
});


describe('explicit retry lifetime', () => {
  it('reuses newly confirmed history after one successful explicit retry', async () => {
    hint = {
      actuals: Array.from({ length: 1000 }, (_, index) => actual({ id: `a${index}`, planId: null, occurrenceDate: '2026-10-07' })),
      plans: [plan({ id: 'old-plan', date: '2010-01-01' })],
      monthEvents: [event({ id: 'old-repeat', date: '2000-01-01', endDate: '2000-01-01', repeat: 'weekly', repeatUntil: null })],
    };
    stored = { schemaVersion: 1, userId: 'owner', revision: 0, dates: [] };
    const receipt = createConfirmedStudyHistory(() => today);
    const publish = () => {
      receipt.confirmMigration('owner');
      for (const slice of ['plans', 'actuals', 'monthEvents'] as const) receipt.beginRead('owner', slice)(hint[slice], metadata);
    };
    publish();
    const repo = repository(receipt), read = vi.spyOn(repo, 'read');
    sdk.getDoc.mockRejectedValueOnce(new Error('offline'));
    let state!: ReturnType<typeof useStudyStreak>;
    function Harness({ source }: { source: StudyHistoryHint }) { state = useStudyStreak('owner', today, repo, source); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Harness source={hint} />); });
    expect(state).toMatchObject({ status: 'error', readError: 'offline' });
    await act(async () => state.retry());
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[read.mock.calls.length - 1]?.[1]?.refresh).toBe(true);
    expect(state).toMatchObject({ status: 'ready', refreshing: false, readError: null });
    await receipt.duringMutation('owner', async () => {
      hint = { ...hint, actuals: hint.actuals.map((row, index) => index === 0 ? { ...row, note: 'saved' } : row) };
    });
    publish();
    sdk.getDoc.mockClear(); sdk.getDocs.mockClear(); documents = 0;
    await act(async () => renderer.update(<Harness source={hint} />));
    const observed = counts();
    const accepted = await read.mock.results[read.mock.results.length - 1].value;
    expect(read.mock.calls[read.mock.calls.length - 1]?.[1]?.refresh).toBe(false);
    expect(accepted.actuals).toHaveLength(1000);
    expect(accepted.plans[0].date).toBe('2010-01-01');
    expect(accepted.monthEvents[0]).toMatchObject({ date: '2000-01-01', repeat: 'weekly' });
    expect(accepted.actuals[0].note).toBe('saved');
    expect(state).toMatchObject({ status: 'ready', refreshing: false, readError: null });
    expect(sdk.transaction).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    console.info('STREAK_AFTER_RETRY_COUNTS', JSON.stringify(observed));
    expect(observed).toEqual({ queries: 0, directReads: 1, returnedDocuments: 1 });
  });
});
