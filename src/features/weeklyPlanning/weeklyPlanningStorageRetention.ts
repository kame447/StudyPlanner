import type { PlanningState } from './types';

/** Opaque retention is separate from the normal checkpoint/index/trace namespaces. */
const RETENTION_PREFIX = 'studyplanner.weeklyPlanningUnreadable.v1.';
export const MAX_WEEKLY_PLANNING_RETAINED_BYTES = 2 * 1024 * 1024;

type SnapshotKind = 'stable_v5' | 'compatibility';
export interface WeeklyPlanningStoredConversation {
  conversationId: string | null;
  savedAt: string;
  active: boolean;
}
export interface WeeklyPlanningStorageSnapshot {
  ownerId: string;
  weekStartDate: string;
  kind: SnapshotKind;
  key: string;
  read: (raw: string) => WeeklyPlanningStoredConversation | null;
}
interface RetainedSnapshot {
  version: 1;
  ownerId: string;
  weekStartDate: string;
  sourceKind: SnapshotKind;
  raw: string;
  capturedAt: string;
}
export type WeeklyPlanningStorageRecoverySignal = {
  status: 'none' | 'unreadable' | 'conflict' | 'blocked' | 'recoverable' | 'restored';
  ownerId: string;
  weekStartDate: string;
};

export function hasActiveConversationState(state: PlanningState): boolean {
  return (state.conversationRequestSequence ?? 0) > 0
    || state.messages.length > 0
    || state.draftBlocks.length > 0
    || (state.previewCandidates?.length ?? 0) > 0
    || Boolean(state.intakeState)
    || Boolean(state.lastAssistantMessage);
}

export function conversationIdFromState(state: PlanningState): string | null {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const messageId = state.messages[index].id;
    const turnMarker = ':turn:';
    const markerIndex = messageId.indexOf(turnMarker);
    if (markerIndex > 0) return messageId.slice(0, markerIndex);
  }
  for (const block of state.draftBlocks) {
    const conversationId = block.behaviorMetadata?.conversationId?.trim()
      || block.behaviorMetadata?.previewMetadata?.conversationId?.trim();
    if (conversationId) return conversationId;
  }
  return null;
}

function retentionKey(ownerId: string, weekStartDate: string): string {
  return `${RETENTION_PREFIX}${encodeURIComponent(ownerId)}.${weekStartDate}`;
}
function readRetained(raw: string, ownerId: string, weekStartDate: string): RetainedSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).length !== 6 || entry.version !== 1 || entry.ownerId !== ownerId
      || entry.weekStartDate !== weekStartDate
      || (entry.sourceKind !== 'stable_v5' && entry.sourceKind !== 'compatibility')
      || typeof entry.raw !== 'string' || typeof entry.capturedAt !== 'string'
      || !Number.isFinite(Date.parse(entry.capturedAt))) return null;
    return entry as unknown as RetainedSnapshot;
  } catch { return null; }
}
function readConversation(snapshot: WeeklyPlanningStorageSnapshot, raw: string): WeeklyPlanningStoredConversation | null {
  try { return snapshot.read(raw); } catch { return null; }
}

/** Return false without touching the primary when the full backup cannot be verified. */
export function prepareWeeklyPlanningStorageMutation(snapshot: WeeklyPlanningStorageSnapshot): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(snapshot.key);
    if (raw === null || readConversation(snapshot, raw)) return true;
    const key = retentionKey(snapshot.ownerId, snapshot.weekStartDate);
    const previous = window.localStorage.getItem(key);
    const retained = previous === null ? null : readRetained(previous, snapshot.ownerId, snapshot.weekStartDate);
    // Unknown data cannot be ranked by capture time. Keep both the existing backup
    // and this primary when their bytes or source codec differ.
    if (previous !== null && (!retained || retained.sourceKind !== snapshot.kind || retained.raw !== raw)) return false;
    const entry: RetainedSnapshot = {
      version: 1, ownerId: snapshot.ownerId, weekStartDate: snapshot.weekStartDate,
      sourceKind: snapshot.kind, raw, capturedAt: new Date().toISOString(),
    };
    const backup = previous ?? JSON.stringify(entry);
    if (new TextEncoder().encode(backup).byteLength > MAX_WEEKLY_PLANNING_RETAINED_BYTES) return false;
    if (previous === null) {
      if (window.localStorage.getItem(key) !== null) return false;
      window.localStorage.setItem(key, backup);
    }
    if (window.localStorage.getItem(key) !== backup || window.localStorage.getItem(snapshot.key) !== raw) return false;
    window.localStorage.removeItem(snapshot.key);
    return window.localStorage.getItem(snapshot.key) === null;
  } catch { return false; }
}

export function clearWeeklyPlanningStorageSnapshot(snapshot: WeeklyPlanningStorageSnapshot): boolean {
  if (!prepareWeeklyPlanningStorageMutation(snapshot)) return false;
  try { window.localStorage.removeItem(snapshot.key); return true; } catch { return false; }
}

/** Read-only status; raw retained bytes never enter UI/AI/trace communication facts. */
export function inspectWeeklyPlanningStorageRecovery(params: {
  ownerId: string;
  weekStartDate: string;
  snapshots: readonly WeeklyPlanningStorageSnapshot[];
}): WeeklyPlanningStorageRecoverySignal {
  const signal = (status: WeeklyPlanningStorageRecoverySignal['status']) => ({
    status, ownerId: params.ownerId, weekStartDate: params.weekStartDate,
  });
  if (typeof window === 'undefined') return signal('none');
  try {
    const raw = window.localStorage.getItem(retentionKey(params.ownerId, params.weekStartDate));
    if (raw === null) {
      const protectedPrimary = params.snapshots.some(snapshot => {
        const primary = window.localStorage.getItem(snapshot.key);
        return primary !== null && !readConversation(snapshot, primary);
      });
      return signal(protectedPrimary ? 'blocked' : 'none');
    }
    const entry = readRetained(raw, params.ownerId, params.weekStartDate);
    if (!entry) return signal('blocked');
    const source = params.snapshots.find(snapshot => snapshot.kind === entry.sourceKind);
    const retained = source && readConversation(source, entry.raw);
    if (!retained) return signal('unreadable');
    for (const snapshot of params.snapshots) {
      const currentRaw = window.localStorage.getItem(snapshot.key);
      if (currentRaw === null) continue;
      const current = readConversation(snapshot, currentRaw);
      if (!current) return signal('blocked');
      if (current.active) return signal('conflict');
    }
    return signal('recoverable');
  } catch { return signal('blocked'); }
}

export function recoverQuarantinedWeeklyPlanningStorage(params: {
  ownerId: string;
  weekStartDate: string;
  snapshots: readonly WeeklyPlanningStorageSnapshot[];
}): WeeklyPlanningStorageRecoverySignal {
  const signal = (status: WeeklyPlanningStorageRecoverySignal['status']) => ({
    status, ownerId: params.ownerId, weekStartDate: params.weekStartDate,
  });
  if (typeof window === 'undefined') return signal('none');
  try {
    const key = retentionKey(params.ownerId, params.weekStartDate);
    const backup = window.localStorage.getItem(key);
    if (backup === null) return signal('none');
    const entry = readRetained(backup, params.ownerId, params.weekStartDate);
    if (!entry) return signal('blocked');
    const source = params.snapshots.find(snapshot => snapshot.kind === entry.sourceKind);
    const retained = source && readConversation(source, entry.raw);
    if (!source || !retained) return signal('unreadable');
    const observed = params.snapshots.map(snapshot => ({ snapshot, raw: window.localStorage.getItem(snapshot.key) }));
    const active: WeeklyPlanningStoredConversation[] = [];
    for (const { snapshot, raw } of observed) {
      if (raw === null) continue;
      const current = readConversation(snapshot, raw);
      if (!current) return signal('blocked');
      if (current.active) active.push(current);
    }
    if (active.length > 0) {
      if (retained.conversationId && active.every(current => retained.conversationId === current.conversationId
        && Date.parse(retained.savedAt) < Date.parse(current.savedAt))) {
        if (window.localStorage.getItem(key) === backup) window.localStorage.removeItem(key);
        return signal('none');
      }
      return signal('conflict');
    }
    if (observed.some(({ snapshot, raw }) => window.localStorage.getItem(snapshot.key) !== raw)) return signal('blocked');
    window.localStorage.setItem(source.key, entry.raw);
    if (window.localStorage.getItem(source.key) !== entry.raw
      || observed.some(({ snapshot, raw }) => snapshot.kind !== source.kind && window.localStorage.getItem(snapshot.key) !== raw)) return signal('blocked');
    try {
      if (window.localStorage.getItem(key) === backup) window.localStorage.removeItem(key);
    } catch {
      // Verified primary restoration is usable even when duplicate-copy cleanup fails.
    }
    return signal('restored');
  } catch { return signal('blocked'); }
}

/** Dedicated discovery, never part of ordinary migration or deletion scans. */
export function retainedWeeklyPlanningWeekStarts(ownerId: string): string[] {
  if (typeof window === 'undefined') return [];
  const prefix = `${RETENTION_PREFIX}${encodeURIComponent(ownerId)}.`;
  try {
    const weeks: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const week = key.slice(prefix.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(week)) weeks.push(week);
    }
    return weeks;
  } catch { return []; }
}
