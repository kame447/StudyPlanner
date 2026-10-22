import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../weeklyPlanningStableV5RuntimeSession';
import { saveOwnedWeeklyPlanningState } from '../../weeklyPlanningOwnedStorage';
import { readC5RuntimeGraph } from './controlledCommit';
import { c5ControllerHarness, OWNER, WEEK } from './controller.testUtils';
import { captureControlledCandidateFallback } from './controlledFallback';
let memory: ReturnType<typeof createMemoryStorageHarness>;
let restore: () => void;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-05T10:00:00Z');
  memory = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(memory.storage);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});
afterEach(() => { restore(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([false, true])('clean checkpoint rollback reaches one fallback with production persist dispatch=%s', async persist => {
  const h = c5ControllerHarness(); await h.present();
  const before = structuredClone(h.getState());
  const graph = structuredClone(readC5RuntimeGraph(OWNER, h.conversationId));
  const key = `studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`;
  const savedBefore = JSON.parse(memory.storage.getItem(key)!);
  vi.setSystemTime('2026-10-05T10:00:01Z');
  const set = memory.storage.setItem;
  vi.spyOn(memory.storage, 'setItem').mockImplementation((name, raw) => {
    // Reject only the attempted selected checkpoint, before mutation; ordinary rollback writes succeed.
    if (name === key && JSON.parse(raw).planningState.intakeState.c5SelectionLedger.consumed.length > 0)
      throw new Error('injected selected checkpoint write failure');
    set(name, raw);
  });
  const execute = vi.fn(async () => ({ state: before.intakeState!, message: 'ordinary reply', draftCandidates: [] }));
  const outcome = await h.submit('教材aは1問7分', { execute, dispatch(action) {
    const next = h.dispatch(action);
    // Exact production hook behavior: useWeeklyPlanningApplication.ts:199–204.
    if (persist && action.type !== 'commit_turn') saveOwnedWeeklyPlanningState(OWNER, next);
    return next;
  } });
  const savedAfter = JSON.parse(memory.storage.getItem(key)!);
  expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(graph);
  expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  expect({ ...savedAfter, savedAt: savedBefore.savedAt }).toEqual(savedBefore);
  console.info('AUDITOR_ROLLBACK', { persist, accepted: outcome.accepted, calls: execute.mock.calls.length,
    savedAtOnlyChanged: savedBefore.savedAt !== savedAfter.savedAt,
    newMessages: h.getState().messages.length - before.messages.length });
  expect(outcome.accepted).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(h.getState().messages.slice(before.messages.length).map(message => message.role)).toEqual(['user', 'assistant']);
  expect(h.getState().pendingApproval).toBeUndefined();
});

async function checkpointGuard(legacy = false) {
  const h = c5ControllerHarness(); await h.present();
  const snapshot = structuredClone(h.getState());
  const key = `studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`;
  const initial = JSON.parse(memory.storage.getItem(key)!);
  if (legacy) { delete initial.requiredCapabilities; memory.storage.setItem(key, JSON.stringify(initial)); }
  const pending = { conversationId: h.conversationId, requestId: 'guard-request', turnId: 'guard-turn',
    weekStartDate: WEEK, baseRevision: snapshot.revision, startedAt: '2026-10-05T10:00:01Z' };
  const begun = h.dispatch({ type: 'begin_turn', pending, userMessage: {
    id: `${pending.turnId}:user`, role: 'user', content: '教材aは1問7分', createdAt: pending.startedAt,
  } });
  const restore = captureControlledCandidateFallback({ ownerId: OWNER, snapshot, begun, pending,
    isCurrent: () => true, getState: h.getState, dispatch: h.dispatch });
  expect(restore).not.toBeNull();
  return { h, key, initial, restore: restore! };
}

it('accepts a validated timestamp-only rewrite and JSON key reordering, preserving the begun user turn', async () => {
  const { h, key, initial, restore } = await checkpointGuard();
  const { savedAt: _old, ...meaning } = initial;
  memory.storage.setItem(key, JSON.stringify({ savedAt: '2026-10-05T10:00:02Z', ...meaning }));
  const before = structuredClone(h.getState());
  expect(restore()).toBe(true);
  expect(h.getState()).toEqual(before);
});

it.each(['owner', 'conversation', 'week', 'graph', 'revision', 'ledger', 'messages', 'pending', 'unknown', 'invalid_savedAt', 'deleted', 'malformed'])(
  'blocks persisted %s changes while live graph/reducer/ledger remain unchanged', async field => {
    const { h, key, initial, restore } = await checkpointGuard();
    const before = structuredClone(h.getState());
    const graph = readC5RuntimeGraph(OWNER, h.conversationId);
    if (field === 'owner') initial.ownerId = 'another-owner';
    if (field === 'conversation') initial.conversationId = 'another-conversation';
    if (field === 'week') initial.weekStartDate = '2026-10-12';
    if (field === 'graph') initial.graph.revision++;
    if (field === 'revision') initial.planningState.revision++;
    if (field === 'ledger') initial.planningState.intakeState.c5SelectionLedger.lastEpoch++;
    if (field === 'messages') initial.planningState.messages[0].content = 'intervening message';
    if (field === 'pending') initial.planningState.pendingTurn = { requestId: 'intervening-request' };
    if (field === 'unknown') initial.planningState.futureCheckpointSentinel = 'intervening unknown field';
    if (field === 'invalid_savedAt') initial.savedAt = 'invalid';
    if (field === 'deleted') memory.storage.removeItem(key);
    else memory.storage.setItem(key, field === 'malformed' ? '{invalid' : JSON.stringify(initial));
    const changedBytes = memory.storage.getItem(key);
    expect(restore()).toBe(false);
    expect(memory.storage.getItem(key)).toBe(changedBytes);
    expect(h.getState()).toEqual(before);
    expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(graph);
  });

it('does not discard legacy fields from the comparison even when the decoder strips their authority', async () => {
  const { key, initial, restore } = await checkpointGuard(true);
  initial.planningState.intakeState.c5SelectionLedger.lastEpoch++;
  memory.storage.setItem(key, JSON.stringify(initial));
  expect(restore()).toBe(false);
});

it('keeps unreadable checkpoint state blocked', async () => {
  const { restore } = await checkpointGuard();
  vi.spyOn(memory.storage, 'getItem').mockImplementation(() => { throw new Error('unreadable'); });
  expect(restore()).toBe(false);
});
