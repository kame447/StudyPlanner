import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './application/weeklyPlanningStableV5RuntimeSession';
import { clearWeeklyPlanningStableV5PersistedSession, getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from './application/weeklyPlanningStableV5SessionStorage';
import * as sessionCodec from './application/weeklyPlanningStableV5SessionCodec';
import { MAX_WEEKLY_PLANNING_RETAINED_BYTES, recoverQuarantinedWeeklyPlanningStorage } from './weeklyPlanningStorageRetention';
import { getWeeklyPlanningCompatibilityStorageSnapshot } from './weeklyPlanningStorage';
import { getWeeklyPlanningStorageRecoverySignal, loadOwnedWeeklyPlanningState, saveOwnedWeeklyPlanningState } from './weeklyPlanningOwnedStorage';
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

  it('leaves the primary snapshot and active index intact when quarantine quota is unavailable', () => {
    const raw = futureRaw();
    const index = harness.values.get(INDEX);
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
    expect(harness.values.get(INDEX)).toBe(index);
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
  it.each(['missing', 'empty'] as const)('a future codec restores exact bytes with an %s active index', indexKind => {
    const raw = futureRaw();
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    if (indexKind === 'missing') harness.values.delete(INDEX);
    enableFutureCodec();
    const recovered = loadOwnedWeeklyPlanningState(OWNER, WEEK);
    expect(recovered.messages).toEqual(state().messages);
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(harness.values.has(QUARANTINE)).toBe(false);
    expect(getWeeklyPlanningStorageRecoverySignal(OWNER, WEEK).status).toBe('none');
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

  it('retains only the newest captured unreadable snapshot for each owner/week', () => {
    futureRaw();
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    const latest = futureRaw('future-version');
    loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(retainedRaw())).toBe(digest(latest));
    expect([...harness.values.keys()].filter(key => key.startsWith('studyplanner.weeklyPlanningUnreadable.'))).toEqual([QUARANTINE]);
  });

  it('unavailable primary reads never authorize removal, overwrite or index reset', () => {
    const raw = futureRaw();
    const index = harness.values.get(INDEX);
    const original = harness.storage.getItem.bind(harness.storage);
    harness.storage.getItem = key => { if (key === stableKey) throw new Error('unavailable'); return original(key); };
    loadOwnedWeeklyPlanningState(OWNER, WEEK);
    saveOwnedWeeklyPlanningState(OWNER, createInitialPlanningState(WEEK));
    clearWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(digest(harness.values.get(stableKey))).toBe(digest(raw));
    expect(harness.values.get(INDEX)).toBe(index);
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
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual(state().messages);
    vi.restoreAllMocks();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(digest(retainedRaw())).toBe(digest(raw));
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
    const original = harness.storage.setItem.bind(harness.storage);
    harness.storage.setItem = (key, value) => {
      if (key === stableKey) throw new DOMException('quota', 'QuotaExceededError');
      original(key, value);
    };
    enableFutureCodec();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).messages).toEqual([]);
    expect(digest(retainedRaw())).toBe(digest(raw));
    harness.storage.setItem = original;
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
