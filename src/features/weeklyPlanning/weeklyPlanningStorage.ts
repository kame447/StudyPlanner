import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { PlanningState, WeeklyPlanDraftBlock, WeeklyPlanningMessage } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';

const STORAGE_VERSION = 2;
const MODES = new Set(['idle', 'collecting_tasks', 'draft_created', 'awaiting_approval', 'confirmed']);
const INTAKE_STATUSES = new Set([
  'idle', 'needs_scope', 'range_collected', 'scope_collected', 'needs_exam_info',
  'needs_year_range', 'needs_progress_clarification', 'needs_unit_rate',
  'needs_priority_policy', 'needs_life_constraints', 'draft_ready',
  'revision_pending', 'approved',
]);
const INTAKE_INTENTS = new Set([
  'weekly_study_planning', 'exam_prep_planning', 'regular_schedule', 'study_advice', 'unknown',
]);

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMessage(value: unknown): value is WeeklyPlanningMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && typeof value.createdAt === 'string';
}

function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.userId === 'string'
    && typeof value.date === 'string'
    && typeof value.startTime === 'string'
    && typeof value.endTime === 'string'
    && typeof value.title === 'string'
    && typeof value.subject === 'string'
    && typeof value.type === 'string'
    && typeof value.label === 'string'
    && value.source === 'ai'
    && value.status === 'draft'
    && typeof value.userEdited === 'boolean'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isPlanningIntakeState(value: unknown): value is PlanningIntakeState {
  if (!isRecord(value)) return false;
  if (!INTAKE_STATUSES.has(String(value.status)) || !INTAKE_INTENTS.has(String(value.intent))) {
    return false;
  }
  if (!isRecord(value.priorityPolicy) || typeof value.priorityPolicy.kind !== 'string') return false;
  return Array.isArray(value.tasks)
    && Array.isArray(value.progress)
    && Array.isArray(value.unitRates)
    && Array.isArray(value.constraints)
    && isStringArray(value.missing)
    && isStringArray(value.assumptions)
    && isStringArray(value.uncertainties)
    && isStringArray(value.questions)
    && typeof value.shouldCreateDraft === 'boolean'
    && value.shouldSavePlan === false
    && isStringArray(value.sourceTurns);
}

function isPlanningState(value: unknown): value is PlanningState {
  if (!isRecord(value)) return false;
  return typeof value.weekStartDate === 'string'
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 0
    && MODES.has(String(value.mode))
    && Array.isArray(value.draftBlocks)
    && value.draftBlocks.every(isDraftBlock)
    && (value.previewCandidates === undefined || Array.isArray(value.previewCandidates))
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && (value.intakeState === undefined || isPlanningIntakeState(value.intakeState))
    && typeof value.updatedAt === 'string';
}

function migrateLegacyPlanningState(value: unknown): PlanningState | null {
  if (!isRecord(value)) return null;
  const candidate = { ...value, revision: Number.isInteger(value.revision) ? value.revision : 0 };
  return isPlanningState(candidate) ? candidate : null;
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
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    intakeState: serializableIntakeState(state.intakeState),
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
    const storedState = isRecord(parsedValue)
      && parsedValue.version === STORAGE_VERSION
      && isPlanningState(parsedValue.state)
      ? parsedValue.state
      : migrateLegacyPlanningState(parsedValue);
    if (!storedState) return createInitialPlanningState(weekStartDate);
    return {
      ...storedState,
      weekStartDate,
      pendingTurn: undefined,
       pendingApproval: undefined,
       draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),
       previewCandidates: storedState.previewCandidates ?? [],

    };
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
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // localStorage is best effort; the in-memory session remains authoritative.
  }
}
