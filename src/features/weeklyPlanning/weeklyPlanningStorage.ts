import { compactWeeklyPlanningApprovalRecovery, expandWeeklyPlanningApprovalRecovery } from './planning/weeklyPlanningApprovalRecovery';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import { isPersistedWeeklyPlanningState } from './weeklyPlanningStateCodec';
import {
  conversationIdFromState,
  hasActiveConversationState,
  prepareWeeklyPlanningStorageMutation,
  type WeeklyPlanningStorageSnapshot,
} from './weeklyPlanningStorageRetention';

const STORAGE_VERSION = 2;

interface StoredPlanningStateV2 {
  version: 2;
  state: PlanningState;
}

function getStorageKey(userId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function sanitizeStoredIntakeState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { assumptionProposalRecords: _sessionOnlyRecords, ...sanitized } = value;
  return sanitized;
}

function sanitizeStoredPlanningState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const {
    pendingTurn: _pendingTurn,
    pendingApproval: _pendingApproval,
    ...sanitized
  } = value;
  return {
    ...sanitized,
    conversationRequestSequence: sanitized.conversationRequestSequence ?? 0,
    previewCandidates: sanitized.previewCandidates ?? [],
    intakeState: sanitized.intakeState === undefined
      ? undefined
      : sanitizeStoredIntakeState(sanitized.intakeState),
  };
}

function parseStoredPlanningState(value: unknown): PlanningState | null {
  const sanitized = sanitizeStoredPlanningState(expandWeeklyPlanningApprovalRecovery(value));
  return isPersistedWeeklyPlanningState(sanitized, { kind: 'compat_v2' }) ? sanitized : null;
}

function migrateLegacyPlanningState(value: unknown): PlanningState | null {
  if (!isRecord(value)) return null;
  return parseStoredPlanningState({
    ...value,
    revision: isNonNegativeInteger(value.revision) ? value.revision : 0,
    previewCandidates: value.previewCandidates ?? [],
  });
}

function serializableIntakeState(
  intakeState: PlanningState['intakeState'],
): PlanningState['intakeState'] {
  if (!intakeState) return undefined;
  const { assumptionProposalRecords: _sessionOnlyRecords, ...serializable } = intakeState;
  return serializable;
}

function serializablePlanningState(state: PlanningState): PlanningState {
  const { pendingTurn: _pendingTurn, pendingApproval: _pendingApproval, ...serializable } = state;
  return {
    ...serializable,
    conversationRequestSequence: state.conversationRequestSequence ?? 0,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    previewCandidates: state.previewCandidates ?? [],
    intakeState: serializableIntakeState(state.intakeState),
  };
}

export function tryDecodeWeeklyPlanningStatePayload(
  parsedValue: unknown,
  weekStartDate: string,
): PlanningState | null {
  const storedState = isRecord(parsedValue) && 'version' in parsedValue
    ? parsedValue.version === STORAGE_VERSION
      ? parseStoredPlanningState(parsedValue.state)
      : null
    : migrateLegacyPlanningState(parsedValue);
  if (!storedState) return null;
  return {
    ...storedState,
    weekStartDate,
    conversationRequestSequence: storedState.conversationRequestSequence ?? 0,
    pendingTurn: undefined,
    pendingApproval: undefined,
    draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),
    previewCandidates: storedState.previewCandidates ?? [],
    intakeState: storedState.intakeState
      ? sanitizeStoredIntakeState(storedState.intakeState) as PlanningIntakeState
      : undefined,
  };
}

export function decodeWeeklyPlanningStatePayload(parsedValue: unknown, weekStartDate: string): PlanningState {
  return tryDecodeWeeklyPlanningStatePayload(parsedValue, weekStartDate) ?? createInitialPlanningState(weekStartDate);
}

export function parseWeeklyPlanningCompatibilitySnapshot(raw: string, userId: string, weekStartDate: string): PlanningState | null {
  try {
    let payload: unknown = JSON.parse(raw);
    if (isRecord(payload) && payload.version === 3) {
      if (Object.keys(payload).length !== 3 || payload.ownerId !== userId || !('payload' in payload)) return null;
      payload = payload.payload;
    }
    const state = tryDecodeWeeklyPlanningStatePayload(payload, weekStartDate);
    if (!state || (state.approvalRecovery && state.approvalRecovery.operation.userId !== userId)
      || state.draftBlocks.some(block => block.userId !== userId
        || (block.behaviorMetadata?.previewMetadata && block.behaviorMetadata.previewMetadata.authorizedUserId !== userId))) return null;
    return state;
  } catch { return null; }
}

export function getWeeklyPlanningCompatibilityStorageSnapshot(userId: string, weekStartDate: string): WeeklyPlanningStorageSnapshot {
  return {
    ownerId: userId, weekStartDate, kind: 'compatibility', key: getStorageKey(userId, weekStartDate),
    read: raw => {
      const state = parseWeeklyPlanningCompatibilitySnapshot(raw, userId, weekStartDate);
      if (!state) return null;
      return { conversationId: conversationIdFromState(state), savedAt: state.updatedAt, active: hasActiveConversationState(state) };
    },
  };
}

export function loadWeeklyPlanningState(userId: string, weekStartDate: string): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);
  const snapshot = getWeeklyPlanningCompatibilityStorageSnapshot(userId, weekStartDate);
  try {
    const raw = window.localStorage.getItem(snapshot.key);
    if (raw === null) return createInitialPlanningState(weekStartDate);
    const state = parseWeeklyPlanningCompatibilitySnapshot(raw, userId, weekStartDate);
    if (state) return state;
    prepareWeeklyPlanningStorageMutation(snapshot);
  } catch {
    // A read failure is not evidence that a checkpoint can be removed.
  }
  return createInitialPlanningState(weekStartDate);
}

export function saveWeeklyPlanningState(userId: string, state: PlanningState): boolean {
  if (typeof window === 'undefined') return false;
  const serializableState = serializablePlanningState(state);
  const snapshot = getWeeklyPlanningCompatibilityStorageSnapshot(userId, state.weekStartDate);
  if (!prepareWeeklyPlanningStorageMutation(snapshot)) return false;
  try {
    if (serializableState.draftBlocks.length === 0 && (serializableState.previewCandidates?.length ?? 0) === 0
      && serializableState.messages.length === 0 && !serializableState.intakeState) {
      window.localStorage.removeItem(snapshot.key);
      return true;
    }
    const envelope: StoredPlanningStateV2 = { version: STORAGE_VERSION, state: serializableState };
    window.localStorage.setItem(snapshot.key, JSON.stringify({ ...envelope, state: compactWeeklyPlanningApprovalRecovery(serializableState) }));
    return true;
  } catch { return false; }
}
