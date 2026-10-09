import { compactWeeklyPlanningApprovalRecovery, expandWeeklyPlanningApprovalRecovery } from './planning/weeklyPlanningApprovalRecovery';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import { isPersistedWeeklyPlanningState } from './weeklyPlanningStateCodec';

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

export function decodeWeeklyPlanningStatePayload(
  parsedValue: unknown,
  weekStartDate: string,
): PlanningState {
  const storedState = isRecord(parsedValue) && 'version' in parsedValue
    ? parsedValue.version === STORAGE_VERSION
      ? parseStoredPlanningState(parsedValue.state)
      : null
    : migrateLegacyPlanningState(parsedValue);
  if (!storedState) return createInitialPlanningState(weekStartDate);
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

export function loadWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId, weekStartDate));
    if (!rawValue) return createInitialPlanningState(weekStartDate);
    const parsedValue: unknown = JSON.parse(rawValue);
    return decodeWeeklyPlanningStatePayload(parsedValue, weekStartDate);
  } catch {
    return createInitialPlanningState(weekStartDate);
  }
}

export function saveWeeklyPlanningState(userId: string, state: PlanningState): void {
  if (typeof window === 'undefined') return;
  const serializableState = serializablePlanningState(state);

  try {
    const key = getStorageKey(userId, state.weekStartDate);
    if (
      serializableState.draftBlocks.length === 0
      && (serializableState.previewCandidates?.length ?? 0) === 0
      && serializableState.messages.length === 0
      && !serializableState.intakeState
    ) {
      window.localStorage.removeItem(key);
      return;
    }
    const envelope: StoredPlanningStateV2 = { version: STORAGE_VERSION, state: serializableState };
    window.localStorage.setItem(key, JSON.stringify({ ...envelope, state: compactWeeklyPlanningApprovalRecovery(serializableState) }));
  } catch {
    // localStorage is best effort; the in-memory session remains authoritative.
  }
}
