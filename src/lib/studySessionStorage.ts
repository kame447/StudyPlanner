import { createId } from './id';
import type { ActualDraft } from '../types/domain';
import type { TrackerState } from './actualTracking';
import type { PomodoroSettings, ResolvedPomodoroSettings } from './pomodoroSession';
import type { StudySessionTarget } from './studySessionTarget';

export interface StudySessionSnapshot {
  version: 1;
  sessionId: string;
  userId: string;
  initialTarget: StudySessionTarget;
  target: StudySessionTarget;
  tracker: TrackerState;
  phase: 'timer' | 'record';
  studyMode: 'normal' | 'pomodoro';
  pomodoroSettings: PomodoroSettings;
  activePomodoro: ResolvedPomodoroSettings | null;
  pomodoroCompletedAt: number | null;
  recordedElapsedMs: number | null;
  recordDraft: ActualDraft | null;
  unplannedTitle: string;
  unplannedSubject: string;
  unplannedMaterialId: string;
  progressInput: string;
  observationProgressInput: string;
  needsDateAdjustment: boolean;
  requiresInspection: boolean;
}

const key = (userId: string) => `studyplanner.activeSession.v1.${encodeURIComponent(userId)}`;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullableNumber = (value: unknown) => value === null || number(value);
function ownedTarget(value: unknown, userId: string): boolean {
  if (!object(value)) return false;
  if (value.kind === 'unplanned') return value.userId === userId;
  if (value.kind !== 'planned' || !object(value.plan) || value.plan.userId !== userId) return false;
  const plan = value.plan;
  return ['id', 'title', 'subject', 'date', 'startTime', 'endTime', 'memo'].every(field => typeof plan[field] === 'string');
}
function validSnapshot(value: unknown, userId: string): value is StudySessionSnapshot {
  if (!object(value) || value.version !== 1 || value.userId !== userId || !ownedTarget(value.initialTarget, userId) || !ownedTarget(value.target, userId)) return false;
  if (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || value.sessionId.length === 0 || value.sessionId.length > 128)) return false;
  if (!object(value.tracker) || !number(value.tracker.anchorMs) || !nullableNumber(value.tracker.runningFromMs) || !number(value.tracker.elapsedBeforeMs)) return false;
  if (!['timer', 'record'].includes(String(value.phase)) || !['normal', 'pomodoro'].includes(String(value.studyMode))) return false;
  if (!object(value.pomodoroSettings) || !['25-5', '50-10', 'custom'].includes(String(value.pomodoroSettings.preset)) || !(value.pomodoroSettings.setCount === null || (Number.isInteger(value.pomodoroSettings.setCount) && Number(value.pomodoroSettings.setCount) >= 1 && Number(value.pomodoroSettings.setCount) <= 12))) return false;
  if (value.pomodoroSettings.preset === 'custom' && !['customFocusMinutes', 'customBreakMinutes'].every(field => Number.isInteger((value.pomodoroSettings as Record<string, unknown>)[field]) && Number((value.pomodoroSettings as Record<string, unknown>)[field]) >= 1 && Number((value.pomodoroSettings as Record<string, unknown>)[field]) <= 1440)) return false;
  if (value.studyMode === 'normal' && value.activePomodoro !== null) return false;
  if (value.studyMode === 'pomodoro') {
    const settings = value.activePomodoro;
    if (!object(settings) || !['focusMs', 'breakMs', 'cycleMs'].every(field => number(settings[field]) && Number(settings[field]) > 0) || !['totalSets', 'targetDurationMs', 'stopAfterMs'].every(field => nullableNumber(settings[field]))) return false;
  }
  if (!nullableNumber(value.pomodoroCompletedAt) || !nullableNumber(value.recordedElapsedMs)) return false;
  if (!['unplannedTitle', 'unplannedSubject', 'unplannedMaterialId', 'progressInput', 'observationProgressInput'].every(field => typeof value[field] === 'string')) return false;
  if (typeof value.needsDateAdjustment !== 'boolean' || typeof value.requiresInspection !== 'boolean') return false;
  if (value.recordDraft !== null) {
    if (!object(value.recordDraft) || typeof value.recordDraft.isAlignedToPlan !== 'boolean' || value.recordDraft.userId !== userId || !['title', 'subject', 'note', 'actualStartTime', 'actualEndTime', 'occurrenceDate'].every(field => typeof (value.recordDraft as Record<string, unknown>)[field] === 'string')) return false;
  } else if (value.phase === 'record') return false;
  return true;
}

export function readStudySession(userId: string): StudySessionSnapshot | null {
  if (!userId) return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key(userId)) ?? 'null');
    return validSnapshot(value, userId) ? { ...value, sessionId: value.sessionId ?? `legacy:${value.tracker.anchorMs}` } : null;
  } catch { return null; }
}

export function writeStudySession(snapshot: StudySessionSnapshot): boolean {
  try {
    window.localStorage.setItem(key(snapshot.userId), JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

export function clearStudySession(userId: string, sessionId?: string): void {
  if (sessionId !== undefined && readStudySession(userId)?.sessionId !== sessionId) return;
  try { window.localStorage.removeItem(key(userId)); } catch { /* Storage can be unavailable. */ }
}

// A separate session-specific marker cannot be overwritten by stale snapshot
// edits. Retain it after success or ambiguity; deleting it could replay a tab.
const dispatchKey = (userId: string, sessionId: string) => `${key(userId)}.dispatch.${encodeURIComponent(sessionId)}`;
export function supportsStudySessionRecovery(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.locks);
}
export function createStudySessionIdentity(userId: string): { sessionId: string; persistent: boolean } {
  const sessionId = createId('study-session');
  try {
    if (!supportsStudySessionRecovery()) throw new Error('unavailable');
    const storage = window.localStorage;
    const probeKey = `${key(userId)}.probe.${sessionId}`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return { sessionId, persistent: true };
  } catch {
    // No recoverable snapshot is published, so this fresh in-memory session
    // retains ordinary recording even where durable recovery is unavailable.
    return { sessionId, persistent: false };
  }
}
export async function saveStudySessionOnce(
  userId: string, sessionId: string, save: () => Promise<void>, isNotDispatched: (error: unknown) => boolean,
): Promise<void> {
  if (!supportsStudySessionRecovery()) throw new Error('この復元した計測は安全に保存できません。対応ブラウザで開き直してください。');
  await navigator.locks.request(dispatchKey(userId, sessionId), async () => {
    const storage = window.localStorage;
    const marker = dispatchKey(userId, sessionId);
    if (storage.getItem(marker) !== null) throw new Error('この計測は別の画面ですでに保存が開始されています。');
    try { storage.setItem(marker, 'dispatched'); }
    catch { throw new Error('保存結果の重複確認を記録できません。元の計測を再送せず、記録を確認してください。'); }
    try { await save(); }
    catch (error) {
      if (isNotDispatched(error)) {
        try { storage.removeItem(marker); } catch { /* Keep the fail-closed marker. */ }
      }
      throw error;
    }
  });
}
