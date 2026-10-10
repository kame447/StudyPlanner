import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession } from './weeklyPlanningTurnController';
import { resetWeeklyPlanningApplicationSession } from './application/weeklyPlanningSessionLifecycle';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './application/weeklyPlanningStableV5RuntimeSession';
import { clearWeeklyPlanningStableV5PersistedSession, getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from './application/weeklyPlanningStableV5SessionStorage';
import * as sessionCodec from './application/weeklyPlanningStableV5SessionCodec';
import { MAX_WEEKLY_PLANNING_RETAINED_BYTES, recoverQuarantinedWeeklyPlanningStorage } from './weeklyPlanningStorageRetention';
import { getWeeklyPlanningCompatibilityStorageSnapshot } from './weeklyPlanningStorage';
import { canRestoreOwnedWeeklyPlanningSession, getWeeklyPlanningStorageRecoverySignal, loadOwnedWeeklyPlanningState, saveOwnedWeeklyPlanningState } from './weeklyPlanningOwnedStorage';
import { loadWeeklyPlanningState, saveWeeklyPlanningState } from './weeklyPlanningStorage';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage, createWeeklyPlanningTestDraftBlock, type MemoryStorageHarness } from './testUtils/weeklyPlanningApplicationTestHarness';

const OWNER = 'preservation-owner';
const WEEK = '2026-10-05';
const NEXT_WEEK = '2026-10-12';
const CONVERSATION = 'preservation-conversation';
const INDEX = `studyplanner.weeklyPlanning.activeSession.${OWNER}`;
const COMPAT = `studyplanner.weeklyPlanning.${OWNER}.${WEEK}`;
const QUARANTINE = `studyplanner.weeklyPlanningUnreadable.v1.${encodeURIComponent(OWNER)}.${WEEK}`;
const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
const digest = (raw: string | undefined) => createHash('sha256').update(raw ?? '').digest('hex');

function state(weekStartDate = WEEK, conversationId = CONVERSATION) {
  return weeklyPlanningReducer(createInitialPlanningState(weekStartDate), {
    type: 'append_message', message: {
      id: `${conversationId}:turn:1:user`, role: 'user', content: 'Synthetic retained conversation',
      createdAt: '2026-10-08T00:00:00.000Z',
    },
  });
}

let harness: MemoryStorageHarness;
let restore: () => void;
beforeEach(() => {
  harness = createMemoryStorageHarness();
  restore = installWeeklyPlanningTestStorage(harness.storage);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});
afterEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore(); vi.restoreAllMocks(); });

function futureRaw(kind: 'unknown-field' | 'future-version' | 'malformed' = 'unknown-field') {
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
    graph: createEmptyWeeklyPlanningFactGraphV5(),
  });
  saveOwnedWeeklyPlanningState(OWNER, state());
  const parsed = JSON.parse(harness.values.get(stableKey)!);
  if (kind === 'unknown-field') parsed.planningState.futureStateField = { sentinel: 'future-state-data' };
  if (kind === 'future-version') parsed.version = 'future-weekly-planning-session-v2';
  const raw = kind === 'malformed' ? '{unreadable snapshot' : JSON.stringify(parsed);
  harness.values.set(stableKey, raw);
  return raw;
}

function enableFutureCodec() {
  const currentParser = sessionCodec.parseWeeklyPlanningStableV5PersistedSession;
  vi.spyOn(sessionCodec, 'parseWeeklyPlanningStableV5PersistedSession').mockImplementation(params => {
    try {
      const parsed = JSON.parse(params.raw);
      const normalized = structuredClone(parsed);
      delete normalized.planningState.futureStateField;
      if (normalized.version === 'future-weekly-planning-session-v2') normalized.version = sessionCodec.WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION;
      const validated = currentParser({ ...params, raw: JSON.stringify(normalized) });
      // Simulate a schema extension, retaining every field, after all current validations pass.
      return validated ? parsed : null;
    } catch { return null; }
  });
}

function retainedRaw() {
  const stored = harness.values.get(QUARANTINE);
  return stored ? JSON.parse(stored).raw as string : undefined;
}

describe('unreadable weekly-planning snapshot retention', () => {
  it.each(['unknown-field', 'future-version', 'malformed'] as const)('quarantines a rejected %s snapshot without interpreting or losing its bytes', kind => {
    const raw = futureRaw(kind);
    expect(loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBeNull();
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.has(stableKey)).toBe(false);
  });

  it('retains a same-version future snapshot across owned load, empty autosave and a new conversation', () => {
    const raw = futureRaw();
    const blank = loadOwnedWeeklyPlanningState(OWNER, WEEK);
    expect(blank.messages).toEqual([]);
    saveOwnedWeeklyPlanningState(OWNER, blank);
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER, weekStartDate: WEEK, conversationId: 'new-conversation',
      graph: createEmptyWeeklyPlanningFactGraphV5(),
    });
    saveOwnedWeeklyPlanningState(OWNER, state(WEEK, 'new-conversation'));
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages[0].id).toContain('new-conversation');
  });

  it('leaves the primary snapshot intact and records empty selection when quarantine quota is unavailable', () => {
    const raw = futureRaw();
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      if (key === QUARANTINE) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    saveWeeklyPlanningStableV5PersistedSession({
      ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
      graph: createEmptyWeeklyPlanningFactGraphV5(), planningState: state(),
    });
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(JSON.parse(harness.values.get(INDEX)!)).toMatchObject({ weekStartDate: null, conversationId: null });
  });

  it('preserves an unreadable compatibility payload before empty or nonempty saves', () => {
    const raw = JSON.stringify({ version: 2, state: { ...state(), futureStateField: 'future-compat-data' } });
    harness.values.set(COMPAT, raw);
    expect(loadWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    saveWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    saveWeeklyPlanningState(OWNER, state());
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(loadWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
  });

  it('keeps protected snapshots separate from owner/week migration and approved plans', () => {
    const raw = futureRaw();
    const plans = JSON.stringify({ ids: ['approved-plan-1'], title: 'untouched' });
    harness.values.set('studyplanner.plans.preservation-owner', plans);
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState('other-owner', state(NEXT_WEEK, 'other-conversation'));
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(NEXT_WEEK));
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.get('studyplanner.plans.preservation-owner')).toBe(plans);
    expect(loadOwnedWeeklyPlanningState('other-owner', NEXT_WEEK).messages[0].id).toContain('other-conversation');
  });
  it.each(['missing', 'invalid', 'foreign', 'empty'] as const)('a future codec respects the %s active index without losing retained bytes', indexKind => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    if (indexKind === 'missing') harness.values.delete(INDEX);
    if (indexKind === 'invalid') harness.values.set(INDEX, '{invalid navigation metadata');
    if (indexKind === 'foreign') harness.values.set(INDEX, JSON.stringify({
      version: 1, ownerId: 'other-owner', weekStartDate: null, conversationId: null,
    }));
    enableFutureCodec();
    const recovered = loadOwnedWeeklyPlanningState(OWNER, WEEK);
    if (indexKind !== 'empty') {
      expect(recovered.messages).toEqual(state().messages);
      expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
      expect(harness.values.has(QUARANTINE)).toBe(false);
      expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('none');
    } else {
      expect(recovered.messages).toEqual([]);
      saveOwnedWeeklyPlanningState(OWNER, recovered);
      expect(harness.values.has(stableKey)).toBe(false);
      expect(retainedRaw()).toBe(raw);
      expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('recoverable');
    }
  });

  it.each([
    [undefined, true],
    ['{invalid index', false],
    [JSON.stringify({ version: 99, ownerId: OWNER, weekStartDate: null, conversationId: null }), false],
    [JSON.stringify({ version: 1, ownerId: 'another-owner', weekStartDate: null, conversationId: null }), false],
    [JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION }), true],
    [JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: null, conversationId: null }), false],
  ] as const)('permits hydration only for a missing or valid selected owned session without changing metadata (%s)', (raw, expected) => {
    if (raw !== undefined) harness.values.set(INDEX, raw);
    const before = new Map(harness.values);
    expect(canRestoreOwnedWeeklyPlanningSession(OWNER)).toBe(expected);
    expect(harness.values).toEqual(before);
  });

  it.each(['load', 'empty-save', 'nonempty-save'] as const)('preserves all bytes when the initial selection read is unavailable (%s)', operation => {
    futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    enableFutureCodec();
    const before = new Map(harness.values);
    const original = harness.storage.getItem.bind(harness.storage);
    const write = vi.spyOn(harness.storage, 'setItem');
    const remove = vi.spyOn(harness.storage, 'removeItem');
    let faultObserved = false;
    harness.storage.getItem = key => {
      if (key === INDEX && !faultObserved) { faultObserved = true; throw new Error('first index read unavailable'); }
      return original(key);
    };
    if (operation === 'load') expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    else saveOwnedWeeklyPlanningState(OWNER, operation === 'empty-save' ? createInitialPlanningState(WEEK) : state());
    expect(faultObserved).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(harness.values).toEqual(before);
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(harness.values).toEqual(before);
  });

  it('does not permit hydration from an unavailable index read', () => {
    harness.values.set(INDEX, JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: null, conversationId: null }));
    const before = new Map(harness.values);
    const original = harness.storage.getItem.bind(harness.storage);
    harness.storage.getItem = key => { if (key === INDEX) throw new Error('unavailable'); return original(key); };
    expect(canRestoreOwnedWeeklyPlanningSession(OWNER)).toBe(false);
    expect(harness.values).toEqual(before);
  });

  it('does not resurrect an unreadable conversation after explicit reset when a future codec can read it', () => {
    const raw = futureRaw();
    let liveState = state();
    const reset = resetWeeklyPlanningApplicationSession({
      session: createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION), ownerId: OWNER,
      getState: () => liveState,
      dispatch: action => { liveState = weeklyPlanningReducer(liveState, action); return liveState; },
    });
    expect(reset.messages).toEqual([]);
    saveOwnedWeeklyPlanningState(OWNER, reset);
    const emptyIndex = harness.values.get(INDEX);
    const retainedEnvelope = harness.values.get(QUARANTINE);
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(harness.values.get(INDEX)).toBe(emptyIndex);
    expect(harness.values.has(stableKey)).toBe(false);
    expect(harness.values.get(QUARANTINE)).toBe(retainedEnvelope);
    expect(retainedRaw()).toBe(raw);
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('recoverable');
  });

  it('a future codec keeps a different active conversation and exposes a typed conflict', () => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK,
      conversationId: 'replacement', graph: createEmptyWeeklyPlanningFactGraphV5() });
    saveOwnedWeeklyPlanningState(OWNER, state(WEEK, 'replacement'));
    const activeRaw = harness.values.get(stableKey);
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages[0].id).toContain('replacement');
    expect(digest(harness.values.get(stableKey))).toBe(digest(activeRaw));
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK)).toEqual({ status: 'conflict', ownerId: OWNER, weekStartDate: WEEK });
  });

  it.each([['older', '2026-10-09T00:00:00Z', false], ['newer', '2026-10-07T00:00:00Z', true], ['equal', '2026-10-08T00:00:00Z', true]] as const)(
    'handles a %s retained copy of the same conversation without replacing the active checkpoint', (_kind, activeSavedAt, keepCopy) => {
      const future = JSON.parse(futureRaw());
      future.savedAt = '2026-10-08T00:00:00Z';
      harness.values.set(stableKey, JSON.stringify(future));
      loadOwnedWeeklyPlanningState(OWNER, WEEK);
      saveOwnedWeeklyPlanningState(OWNER, state());
      const current = JSON.parse(harness.values.get(stableKey)!);
      current.savedAt = activeSavedAt;
      const activeRaw = JSON.stringify(current);
      harness.values.set(stableKey, activeRaw);
      enableFutureCodec();
      loadOwnedWeeklyPlanningState(OWNER, WEEK);
      expect(harness.values.get(stableKey)).toBe(activeRaw);
      expect(harness.values.has(QUARANTINE)).toBe(keepCopy);
    },
  );

  it('a readable compatibility conversation blocks restoration of a retained Stable checkpoint', () => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    saveOwnedWeeklyPlanningState(OWNER, state(WEEK, 'compat-replacement'));
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages[0].id).toContain('compat-replacement');
    expect(harness.values.has(stableKey)).toBe(false);
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('conflict');
  });

  it('restores a compatibility copy byte-for-byte through the same codec boundary', () => {
    const readable = JSON.stringify({ version: 2, state: state() });
    harness.values.set(QUARANTINE, JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: WEEK,
      sourceKind: 'compatibility', raw: readable, capturedAt: '2026-10-08T00:00:00Z' }));
    const outcome = recoverQuarantinedWeeklyPlanningStorage({ ownerId: OWNER, weekStartDate: WEEK,
      snapshots: [getWeeklyPlanningCompatibilityStorageSnapshot(OWNER, WEEK)] });
    expect(outcome.status).toBe('restored');
    expect(harness.values.get(COMPAT)).toBe(readable);
    expect(harness.values.has(QUARANTINE)).toBe(false);
  });

  it('quota protects only the affected week, allowing another week and owner to persist', () => {
    const raw = futureRaw();
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      if (key === QUARANTINE) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    saveOwnedWeeklyPlanningState(OWNER, state(NEXT_WEEK, 'next-week'));
    saveOwnedWeeklyPlanningState('other-owner', state(WEEK, 'other-owner-chat'));
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(loadOwnedWeeklyPlanningState(OWNER, NEXT_WEEK).messages[0].id).toContain('next-week');
    expect(loadOwnedWeeklyPlanningState('other-owner', WEEK).messages[0].id).toContain('other-owner-chat');
  });

  it('an oversized unreadable snapshot stays in place instead of being truncated or overwritten', () => {
    const raw = 'x'.repeat(MAX_WEEKLY_PLANNING_RETAINED_BYTES);
    harness.values.set(stableKey, raw);
    clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(harness.values.has(QUARANTINE)).toBe(false);
  });

  it('failed backup readback leaves the original untouched', () => {
    const raw = futureRaw();
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => original(key, key === QUARANTINE ? 'failed readback' : value);
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
  });

  it('a concurrent primary change during backup cannot be erased by the stale observation', () => {
    const raw = futureRaw();
    const changedRaw = raw + ' ';
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      original(key, value);
      if (key === QUARANTINE) harness.values.set(stableKey, changedRaw);
    };
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(harness.values.get(stableKey))).toBe(digest(changedRaw));
    expect(digest(retainedRaw())).toBe(digest(raw));
  });

  it('preserves the first retention and a distinct later unreadable snapshot instead of replacing either', () => {
    const first = futureRaw();
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    const firstEnvelope = harness.values.get(QUARANTINE);
    const latest = futureRaw('future-version');
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    saveOwnedWeeklyPlanningState(OWNER, state(WEEK, 'replacement'));
    expect(digest(retainedRaw())).toBe(digest(first));
    expect(digest(harness.values.get(stableKey))).toBe(digest(latest));
    expect(clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBe(false);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    expect(harness.values.get(QUARANTINE)).toBe(firstEnvelope);
    expect(retainedRaw()).toBe(first);
    expect(harness.values.get(stableKey)).toBe(latest);
    expect(JSON.parse(harness.values.get(INDEX)!)).toMatchObject({ weekStartDate: null, conversationId: null });
    expect([...harness.values.keys()].filter(key => key.startsWith('studyplanner.weeklyPlanningUnreadable.'))).toEqual([QUARANTINE]);
  });

  it.each(['stable-first', 'compatibility-first'] as const)(
    'preserves both unreadable formats through load, reset and week cleanup with %s retention', firstKind => {
      const stableRaw = futureRaw();
      const compatRaw = JSON.stringify({ version: 2, state: { ...state(), futureStateField: 'other-unreadable-conversation' } });
      harness.values.set(COMPAT, compatRaw);
      if (firstKind === 'stable-first') loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
      else loadWeeklyPlanningState(OWNER, WEEK);
      const firstEnvelope = harness.values.get(QUARANTINE);
      const protectedKey = firstKind === 'stable-first' ? COMPAT : stableKey;
      const protectedRaw = firstKind === 'stable-first' ? compatRaw : stableRaw;
      loadOwnedWeeklyPlanningState(OWNER, WEEK);
      let liveState = state();
      const reset = resetWeeklyPlanningApplicationSession({
        session: createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION), ownerId: OWNER,
        getState: () => liveState,
        dispatch: action => { liveState = weeklyPlanningReducer(liveState, action); return liveState; },
      });
      expect(reset.messages).toEqual([]);
      saveOwnedWeeklyPlanningState(OWNER, reset);
      expect(digest(harness.values.get(QUARANTINE))).toBe(digest(firstEnvelope));
      expect(digest(harness.values.get(protectedKey))).toBe(digest(protectedRaw));
      expect(JSON.parse(harness.values.get(INDEX)!)).toMatchObject({ weekStartDate: null, conversationId: null });
      expect(harness.values.get(QUARANTINE)).toBe(firstEnvelope);
      expect(harness.values.get(protectedKey)).toBe(protectedRaw);
      saveOwnedWeeklyPlanningState(OWNER, state(NEXT_WEEK));
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      expect(loadOwnedWeeklyPlanningState(OWNER, NEXT_WEEK).messages).toEqual(state(NEXT_WEEK).messages);
      expect(harness.values.get(QUARANTINE)).toBe(firstEnvelope);
      expect(harness.values.get(protectedKey)).toBe(protectedRaw);
    },
  );

  it('reuses an identical retained snapshot without rewriting its envelope when writes are unavailable', () => {
    const raw = futureRaw();
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    const envelope = harness.values.get(QUARANTINE);
    harness.values.set(stableKey, raw);
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      if (key === QUARANTINE) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    expect(clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBe(true);
    expect(harness.values.has(stableKey)).toBe(false);
    expect(harness.values.get(QUARANTINE)).toBe(envelope);
  });

  it('does not equate identical unreadable bytes from different source formats', () => {
    const raw = '{opaque unknown format';
    harness.values.set(stableKey, raw);
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    const envelope = harness.values.get(QUARANTINE);
    harness.values.set(COMPAT, raw);
    loadWeeklyPlanningState(OWNER, WEEK);
    expect(saveWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK))).toBe(false);
    expect(harness.values.get(COMPAT)).toBe(raw);
    expect(harness.values.get(QUARANTINE)).toBe(envelope);
  });

  it.each(['{unreadable retention envelope', JSON.stringify({ version: 99, futureEnvelope: 'retained data' })])(
    'preserves both an unrecognized retention envelope and the unreadable primary', retainedEnvelope => {
      const raw = futureRaw();
      harness.values.set(QUARANTINE, retainedEnvelope);
      expect(clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBe(false);
      expect(harness.values.get(stableKey)).toBe(raw);
      expect(harness.values.get(QUARANTINE)).toBe(retainedEnvelope);
    },
  );

  it('refuses capture when another retention envelope appears before the write', () => {
    const raw = futureRaw();
    const appeared = JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: WEEK,
      sourceKind: 'compatibility', raw: 'another unreadable conversation', capturedAt: '2026-10-08T00:00:00Z' });
    const original = harness.storage.getItem.bind(harness.storage);
    let retentionReads = 0;
    harness.storage.getItem = key => {
      if (key === QUARANTINE && ++retentionReads === 2) harness.values.set(QUARANTINE, appeared);
      return original(key);
    };
    expect(clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBe(false);
    expect(harness.values.get(stableKey)).toBe(raw);
    expect(harness.values.get(QUARANTINE)).toBe(appeared);
  });

  it('does not remove the primary when its identical retained copy changes before readback', () => {
    const raw = futureRaw();
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    harness.values.set(stableKey, raw);
    const changed = JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate: WEEK,
      sourceKind: 'stable_v5', raw: 'another unreadable conversation', capturedAt: '2026-10-08T00:00:00Z' });
    const original = harness.storage.getItem.bind(harness.storage);
    let retentionReads = 0;
    harness.storage.getItem = key => {
      if (key === QUARANTINE && ++retentionReads === 2) harness.values.set(QUARANTINE, changed);
      return original(key);
    };
    expect(clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })).toBe(false);
    expect(harness.values.get(stableKey)).toBe(raw);
    expect(harness.values.get(QUARANTINE)).toBe(changed);
  });

  it('unavailable primary reads never authorize payload removal or overwrite when empty selection is recorded', () => {
    const raw = futureRaw();
    const original = harness.storage.getItem.bind(harness.storage);
    harness.storage.getItem = key => { if (key === stableKey) throw new Error('unavailable'); return original(key); };
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(JSON.parse(harness.values.get(INDEX)!)).toMatchObject({ weekStartDate: null, conversationId: null });
  });

  it('direct empty Stable saves quarantine unknown data instead of treating it as empty', () => {
    const raw = futureRaw();
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK,
      conversationId: CONVERSATION, graph: createEmptyWeeklyPlanningFactGraphV5(),
      planningState: createInitialPlanningState(WEEK) })).toBe(true);
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.has(stableKey)).toBe(false);
  });

  it('previous-week cleanup quarantines unknown data only after the new week was saved', () => {
    const raw = futureRaw();
    saveOwnedWeeklyPlanningState(OWNER, state(NEXT_WEEK));
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.has(stableKey)).toBe(false);
    expect(loadOwnedWeeklyPlanningState(OWNER, NEXT_WEEK).weekStartDate).toBe(NEXT_WEEK);
  });

  it('failed Stable save fallback quarantines an unreadable old snapshot before compatibility save', () => {
    const raw = futureRaw();
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK,
      conversationId: CONVERSATION, graph: { ...createEmptyWeeklyPlanningFactGraphV5(), revision: -1 } });
    saveOwnedWeeklyPlanningState(OWNER, state());
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.has(stableKey)).toBe(false);
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
  });

  it.each([
    { version: 3, ownerId: 'foreign-owner', payload: { version: 2, state: state() } },
    { version: 3, ownerId: OWNER, payload: { version: 2, state: { ...state(), draftBlocks: [createWeeklyPlanningTestDraftBlock({ id: 'foreign-draft', userId: 'foreign-owner' })] } } },
    { version: 3, ownerId: OWNER, payload: { version: 2, state: { ...state(), futureStateField: 'future' } } },
  ])('owner and state-validation rejects preserve compatibility raw bytes', envelope => {
    const raw = JSON.stringify(envelope);
    harness.values.set(COMPAT, raw);
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(harness.values.has(COMPAT)).toBe(false);
  });

  it('wrong-owner incoming state cannot erase an existing snapshot', () => {
    const raw = futureRaw();
    const incoming = { ...state(), draftBlocks: [createWeeklyPlanningTestDraftBlock({ id: 'wrong-owner', userId: 'foreign-owner' })] };
    saveOwnedWeeklyPlanningState(OWNER, incoming);
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
  });

  it('empty-string corruption is retained just like malformed JSON', () => {
    harness.values.set(stableKey, '');
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(retainedRaw()).toBe('');
    expect(harness.values.has(stableKey)).toBe(false);
  });

  it('repeated rollback and roll-forward retains the same opaque bytes', () => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    harness.values.delete(INDEX);
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    vi.restoreAllMocks();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(digest(retainedRaw())).toBe(digest(raw));
    harness.values.delete(INDEX);
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
  });

  it('a different active compatibility conversation prevents stale-copy disposal', () => {
    const future = JSON.parse(futureRaw());
    future.savedAt = '2026-10-08T00:00:00Z';
    const raw = JSON.stringify(future);
    harness.values.set(stableKey, raw);
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, state());
    const active = JSON.parse(harness.values.get(stableKey)!);
    active.savedAt = '2026-10-09T00:00:00Z';
    harness.values.set(stableKey, JSON.stringify(active));
    saveWeeklyPlanningState(OWNER, state(WEEK, 'other-active-format'));
    enableFutureCodec();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('conflict');
  });

  it('restore quota failure leaves the retained copy available for a later load', () => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    harness.values.delete(INDEX);
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      if (key === stableKey) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(digest(retainedRaw())).toBe(digest(raw));
    harness.storage.setItem = original;
    harness.values.delete(INDEX);
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
  });

  it('compatibility-only save quarantines a future Stable snapshot before changing active authority', () => {
    const raw = futureRaw();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    saveOwnedWeeklyPlanningState(OWNER, state(WEEK, 'compatibility-new-work'));
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages[0].id).toContain('compatibility-new-work');
    expect(digest(retainedRaw())).toBe(digest(raw));
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('conflict');
  });

  it('a verified restore remains usable if retained-copy cleanup fails', () => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    harness.values.delete(INDEX);
    const original = harness.storage.removeItem.bind(harness.storage);
    harness.storage.removeItem = key => { if (key === QUARANTINE) throw new Error('cleanup unavailable'); original(key); };
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(digest(retainedRaw())).toBe(digest(raw));
  });

  it('normal active-week saves succeed with retained snapshots from other weeks occupying quota', () => {
    const retainedKeys = ['2026-09-21', '2026-09-28'].map(week => `studyplanner.weeklyPlanningUnreadable.v1.${OWNER}.${week}`);
    for (const key of retainedKeys) {
      const weekStartDate = key.slice(-10);
      harness.values.set(key, JSON.stringify({ version: 1, ownerId: OWNER, weekStartDate,
        sourceKind: 'stable_v5', raw: 'future'.repeat(60_000), capturedAt: '2026-10-08T00:00:00Z' }));
    }
    const before = retainedKeys.map(key => digest(harness.values.get(key)));
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      const contents = new Map(harness.values).set(key, value);
      const bytes = [...contents.values()].reduce((total, raw) => total + new TextEncoder().encode(raw).byteLength, 0);
      if (bytes > 1024 * 1024) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    saveOwnedWeeklyPlanningState(OWNER, state());
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    expect(retainedKeys.map(key => digest(harness.values.get(key)))).toEqual(before);
  });

});
