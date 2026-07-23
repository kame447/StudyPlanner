import type { PlanningState } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  parseWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphValidatorV5';

export const WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION =
  'studyplanner-weekly-planning-stable-v5-session-v1' as const;

const MAX_STORED_SESSION_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CONTENT_LENGTH = 20_000;
const MAX_DRAFT_BLOCKS = 500;
const MAX_PREVIEW_CANDIDATES = 500;

export interface WeeklyPlanningStableV5PersistedSession {
  version: typeof WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION;
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
}

function storageKey(ownerId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.stableV5.${ownerId}.${weekStartDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string'
    && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || value === '24:00');
}

function isMessage(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'role', 'content', 'createdAt'])
    && isNonEmptyString(value.id)
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && value.content.length <= MAX_MESSAGE_CONTENT_LENGTH
    && isTimestamp(value.createdAt);
}

function isDraftBlock(value: unknown, ownerId: string, conversationId: string): boolean {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id)
    || value.userId !== ownerId
    || !isDate(value.date)
    || !isTime(value.startTime)
    || !isTime(value.endTime)
    || typeof value.title !== 'string'
    || typeof value.subject !== 'string'
    || value.source !== 'ai'
    || value.status !== 'draft'
    || typeof value.userEdited !== 'boolean'
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
  ) {
    return false;
  }
  if (value.behaviorMetadata === undefined) return true;
  if (!isRecord(value.behaviorMetadata)) return false;
  const metadataConversationId = value.behaviorMetadata.conversationId;
  if (metadataConversationId !== undefined && metadataConversationId !== conversationId) {
    return false;
  }
  const previewMetadata = value.behaviorMetadata.previewMetadata;
  if (previewMetadata !== undefined) {
    if (!isRecord(previewMetadata)) return false;
    if (previewMetadata.authorizedUserId !== ownerId) return false;
    if (
      previewMetadata.conversationId !== undefined
      && previewMetadata.conversationId !== conversationId
    ) {
      return false;
    }
  }
  return true;
}

function isStableV5Metadata(value: unknown, graphRevision: number): boolean {
  if (!isRecord(value)) return false;
  return value.runtime === 'stable_v5'
    && isNonNegativeInteger(value.graphRevision)
    && value.graphRevision <= graphRevision
    && isNonEmptyString(value.taskId)
    && Array.isArray(value.sourceFactRefs)
    && value.sourceFactRefs.every(isNonEmptyString)
    && (value.planType === 'study' || value.planType === 'other');
}

function isPreviewCandidate(value: unknown, graphRevision: number): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.stableKey)
    && !value.stableKey.includes('..')
    && isDate(value.date)
    && isTime(value.startTime)
    && isTime(value.endTime)
    && isPositiveInteger(value.durationMinutes)
    && typeof value.title === 'string'
    && typeof value.field === 'string'
    && typeof value.year === 'number'
    && Number.isInteger(value.year)
    && isPositiveInteger(value.estimatedMinutes)
    && value.source === 'weekly_exam_prep'
    && value.approvalStatus === 'unapproved'
    && isNonEmptyString(value.workItemKey)
    && isStableV5Metadata(value.stableV5Metadata, graphRevision);
}

function isPlanningState(
  value: unknown,
  ownerId: string,
  weekStartDate: string,
  conversationId: string,
  graphRevision: number,
): value is PlanningState {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    'weekStartDate',
    'revision',
    'mode',
    'draftBlocks',
    'previewCandidates',
    'messages',
    'intakeState',
    'lastAssistantMessage',
    'updatedAt',
  ])) {
    return false;
  }
  const modes = new Set([
    'idle',
    'collecting_tasks',
    'draft_created',
    'awaiting_approval',
    'confirmed',
  ]);
  return value.weekStartDate === weekStartDate
    && isNonNegativeInteger(value.revision)
    && modes.has(String(value.mode))
    && Array.isArray(value.draftBlocks)
    && value.draftBlocks.length <= MAX_DRAFT_BLOCKS
    && value.draftBlocks.every((block) => isDraftBlock(block, ownerId, conversationId))
    && Array.isArray(value.previewCandidates)
    && value.previewCandidates.length <= MAX_PREVIEW_CANDIDATES
    && value.previewCandidates.every((candidate) =>
      isPreviewCandidate(candidate, graphRevision))
    && Array.isArray(value.messages)
    && value.messages.length <= MAX_MESSAGES
    && value.messages.every(isMessage)
    && (value.intakeState === undefined || isRecord(value.intakeState))
    && (value.lastAssistantMessage === undefined
      || typeof value.lastAssistantMessage === 'string')
    && isTimestamp(value.updatedAt);
}

function graphBelongsToConversation(
  graph: WeeklyPlanningFactGraphV5,
  conversationId: string,
): boolean {
  const sourcedFacts = [
    ...graph.planningWindows,
    ...graph.tasks,
    ...graph.studyContexts,
    ...graph.components,
    ...graph.workloads,
    ...graph.effortEstimates,
    ...graph.temporalConstraints,
    ...graph.taskDateRules,
    ...graph.recurrences,
    ...graph.relations,
    ...graph.uncertainties,
    ...graph.correctionIntents,
    ...graph.decisionIntents,
    ...graph.availabilityDeclarations,
    ...graph.constraintSourceRequests,
  ];
  return sourcedFacts.every((fact) => fact.source.conversationId === conversationId);
}

function serializablePlanningState(state: PlanningState): PlanningState {
  const {
    pendingTurn: _pendingTurn,
    pendingApproval: _pendingApproval,
    ...withoutPending
  } = state;
  const intakeState = state.intakeState
    ? (() => {
        const {
          assumptionProposalRecords: _sessionOnlyRecords,
          ...serializable
        } = state.intakeState;
        return serializable;
      })()
    : undefined;
  return JSON.parse(JSON.stringify({
    ...withoutPending,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    previewCandidates: state.previewCandidates ?? [],
    intakeState,
  })) as PlanningState;
}

function isEmptySession(
  state: PlanningState,
  graph: WeeklyPlanningFactGraphV5,
): boolean {
  return graph.revision === 0
    && state.messages.length === 0
    && state.draftBlocks.length === 0
    && (state.previewCandidates?.length ?? 0) === 0
    && !state.intakeState;
}

export function loadWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): WeeklyPlanningStableV5PersistedSession | null {
  if (typeof window === 'undefined') return null;
  const key = storageKey(params.ownerId, params.weekStartDate);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (new TextEncoder().encode(raw).byteLength > MAX_STORED_SESSION_BYTES) {
      window.localStorage.removeItem(key);
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)
      || !hasOnlyKeys(value, [
        'version',
        'ownerId',
        'weekStartDate',
        'conversationId',
        'graph',
        'planningState',
        'savedAt',
      ])
      || value.version !== WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION
      || value.ownerId !== params.ownerId
      || value.weekStartDate !== params.weekStartDate
      || !isNonEmptyString(value.conversationId)
      || !isTimestamp(value.savedAt)
      || !isRecord(value.graph)) {
      window.localStorage.removeItem(key);
      return null;
    }
    const parsedGraph = parseWeeklyPlanningFactGraphV5(JSON.stringify(value.graph));
    if (!parsedGraph.graph
      || !graphBelongsToConversation(parsedGraph.graph, value.conversationId)
      || !isPlanningState(
        value.planningState,
        params.ownerId,
        params.weekStartDate,
        value.conversationId,
        parsedGraph.graph.revision,
      )) {
      window.localStorage.removeItem(key);
      return null;
    }
    return {
      version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
      ownerId: params.ownerId,
      weekStartDate: params.weekStartDate,
      conversationId: value.conversationId,
      graph: parsedGraph.graph,
      planningState: {
        ...value.planningState,
        pendingTurn: undefined,
        pendingApproval: undefined,
      },
      savedAt: value.savedAt,
    };
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function saveWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
}): boolean {
  if (typeof window === 'undefined') return false;
  if (params.planningState.pendingTurn || params.planningState.pendingApproval) return false;
  if (params.planningState.weekStartDate !== params.weekStartDate) return false;
  if (!graphBelongsToConversation(params.graph, params.conversationId)) return false;

  const key = storageKey(params.ownerId, params.weekStartDate);
  const planningState = serializablePlanningState(params.planningState);
  if (isEmptySession(planningState, params.graph)) {
    window.localStorage.removeItem(key);
    return true;
  }
  if (!isPlanningState(
    planningState,
    params.ownerId,
    params.weekStartDate,
    params.conversationId,
    params.graph.revision,
  )) {
    return false;
  }

  const envelope: WeeklyPlanningStableV5PersistedSession = {
    version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: params.graph,
    planningState,
    savedAt: new Date().toISOString(),
  };
  try {
    const raw = JSON.stringify(envelope);
    if (new TextEncoder().encode(raw).byteLength > MAX_STORED_SESSION_BYTES) return false;
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(params.ownerId, params.weekStartDate));
  } catch {
    // localStorage is best effort; the in-memory session is cleared independently.
  }
}

export function getWeeklyPlanningStableV5SessionStorageKeyForTest(
  ownerId: string,
  weekStartDate: string,
): string {
  return storageKey(ownerId, weekStartDate);
}
