import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveStudySessionOnce, createStudySessionIdentity, clearStudySession, readStudySession, writeStudySession, type StudySessionSnapshot } from './studySessionStorage';
import { createDefaultPomodoroSettings } from './pomodoroSession';

let values: Map<string, string>;
const snapshot = (): StudySessionSnapshot => ({
  version: 1, sessionId: '100', userId: 'owner', initialTarget: { kind: 'unplanned', userId: 'owner' },
  target: { kind: 'unplanned', userId: 'owner' }, tracker: { anchorMs: 100, runningFromMs: 100, elapsedBeforeMs: 0 },
  phase: 'timer', studyMode: 'normal', pomodoroSettings: createDefaultPomodoroSettings(), activePomodoro: null,
  pomodoroCompletedAt: null, recordedElapsedMs: null, recordDraft: null,
  unplannedTitle: '', unplannedSubject: '', unplannedMaterialId: '', progressInput: '', observationProgressInput: '',
  needsDateAdjustment: false, requiresInspection: false,
});
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => vi.unstubAllGlobals());
it('round trips owner-scoped state and clears only its owner', () => {
  expect(writeStudySession(snapshot())).toBe(true);
  expect(readStudySession('owner')).toEqual(snapshot());
  expect(readStudySession('other')).toBeNull();
  clearStudySession('other'); expect(readStudySession('owner')).not.toBeNull();
  clearStudySession('owner'); expect(readStudySession('owner')).toBeNull();
});
it.each([
  { version: 2 }, { userId: 'other' }, { target: { kind: 'unplanned', userId: 'other' } },
  { tracker: { anchorMs: 100, runningFromMs: 'invalid', elapsedBeforeMs: 0 } },
  { phase: 'record' }, { studyMode: 'pomodoro', activePomodoro: null },
  { recordDraft: { userId: 'other' } }, { pomodoroSettings: { preset: 'custom', setCount: 1, customFocusMinutes: 0, customBreakMinutes: 5 } },
])('rejects invalid or mismatched state %j', invalid => {
  values.set('studyplanner.activeSession.v1.owner', JSON.stringify({ ...snapshot(), ...invalid }));
  expect(readStudySession('owner')).toBeNull();
});
it('handles blocked storage without crashing', () => {
  Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked'); } });
  expect(readStudySession('owner')).toBeNull();
  expect(writeStudySession(snapshot())).toBe(false);
  expect(() => clearStudySession('owner')).not.toThrow();
});

function enableLocks() {
  const tails = new Map<string, Promise<unknown>>();
  vi.stubGlobal('navigator', { locks: { request: (name: string, work: () => Promise<unknown>) => {
    const result = (tails.get(name) ?? Promise.resolve()).then(work);
    tails.set(name, result.catch(() => {}));
    return result;
  } } });
}
it('serializes simultaneous saves of one session and keeps its marker after success', async () => {
  enableLocks();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const save = vi.fn(() => pending);
  const first = saveStudySessionOnce('owner', 'one', save, () => false);
  const second = saveStudySessionOnce('owner', 'one', save, () => false);
  const rejected = expect(second).rejects.toThrow('すでに保存');
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(1);
  finish(); await first; await rejected;
  expect(save).toHaveBeenCalledTimes(1);
});
it('permits distinct sessions to save in reverse order and keeps owner scope separate', async () => {
  enableLocks(); const save = vi.fn(async () => {});
  await saveStudySessionOnce('owner', 'newer', save, () => false);
  await saveStudySessionOnce('owner', 'older', save, () => false);
  await saveStudySessionOnce('other', 'newer', save, () => false);
  expect(save).toHaveBeenCalledTimes(3);
});
it('releases only confirmed pre-dispatch rejection and retains uncertain failures', async () => {
  enableLocks(); const rejected = new Error('admission');
  await expect(saveStudySessionOnce('owner', 'one', async () => { throw rejected; }, error => error === rejected)).rejects.toThrow('admission');
  await expect(saveStudySessionOnce('owner', 'one', async () => { throw new Error('network'); }, () => false)).rejects.toThrow('network');
  const save = vi.fn(async () => {});
  await expect(saveStudySessionOnce('owner', 'one', save, () => false)).rejects.toThrow('すでに保存');
  expect(save).not.toHaveBeenCalled();
});
it('never dispatches when durable duplicate protection fails but permits fresh memory identity', async () => {
  enableLocks();
  window.localStorage.setItem = () => { throw new Error('quota'); };
  expect(createStudySessionIdentity('owner').persistent).toBe(false);
  const save = vi.fn(async () => {});
  await expect(saveStudySessionOnce('owner', 'one', save, () => false)).rejects.toThrow('重複確認');
  expect(save).not.toHaveBeenCalled();
});
it('migrates legacy snapshots to a stable identity across repeated reads', () => {
  const { sessionId: _omitted, ...legacy } = snapshot();
  values.set('studyplanner.activeSession.v1.owner', JSON.stringify(legacy));
  expect(readStudySession('owner')?.sessionId).toBe('legacy:100');
  expect(readStudySession('owner')?.sessionId).toBe('legacy:100');
});

it('does not clear another active snapshot when an older session completes', () => {
  writeStudySession({ ...snapshot(), sessionId: 'newer' });
  clearStudySession('owner', 'older');
  expect(readStudySession('owner')?.sessionId).toBe('newer');
  clearStudySession('owner', 'newer');
  expect(readStudySession('owner')).toBeNull();
});

it('refuses to replace a different active session snapshot', () => {
  const current = { ...snapshot(), sessionId: 'current' };
  expect(writeStudySession(current)).toBe(true);
  expect(writeStudySession({ ...snapshot(), sessionId: 'retained' })).toBe(false);
  expect(readStudySession('owner')).toEqual(current);
});

it('does not recreate a dispatched session snapshot after its recovery slot is cleared', async () => {
  enableLocks();
  const retained = snapshot();
  writeStudySession(retained);
  await saveStudySessionOnce('owner', retained.sessionId, async () => {}, () => false);
  clearStudySession('owner', retained.sessionId);
  expect(writeStudySession(retained)).toBe(false);
  expect(readStudySession('owner')).toBeNull();
});

it('continues updating the current snapshot and permits a fresh session after discard', () => {
  const original = snapshot();
  expect(writeStudySession(original)).toBe(true);
  const edited = { ...original, unplannedTitle: '編集した学習' };
  expect(writeStudySession(edited)).toBe(true);
  expect(readStudySession('owner')).toEqual(edited);
  clearStudySession('owner', original.sessionId);
  expect(writeStudySession({ ...snapshot(), sessionId: 'next' })).toBe(true);
  expect(readStudySession('owner')?.sessionId).toBe('next');
});

it('preserves the inspection snapshot during an uncertain dispatch and permits updates after pre-dispatch rejection', async () => {
  enableLocks();
  const inspection = { ...snapshot(), requiresInspection: true };
  writeStudySession(inspection);
  const rejected = new Error('admission');
  await expect(saveStudySessionOnce('owner', inspection.sessionId, async () => { throw rejected; }, error => error === rejected)).rejects.toThrow('admission');
  expect(writeStudySession(snapshot())).toBe(true);
  expect(readStudySession('owner')?.requiresInspection).toBe(false);
  writeStudySession(inspection);
  await expect(saveStudySessionOnce('owner', inspection.sessionId, async () => { throw new Error('network'); }, () => false)).rejects.toThrow('network');
  expect(writeStudySession(snapshot())).toBe(false);
  expect(readStudySession('owner')).toEqual(inspection);
});
