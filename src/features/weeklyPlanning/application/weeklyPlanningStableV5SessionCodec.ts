import { isPersistedWeeklyPlanningState, MAX_WEEKLY_PLANNING_STORED_MESSAGES } from '../weeklyPlanningStateCodec';
import { compactWeeklyPlanningApprovalRecovery, expandWeeklyPlanningApprovalRecovery } from '../planning/weeklyPlanningApprovalRecovery';
import type { PlanningState } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { parseWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { validC5SessionRecords } from './c5LocalSelection/basis';

export const WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION =
  'studyplanner-weekly-planning-stable-v5-session-v1' as const;
export const WEEKLY_PLANNING_C5_SESSION_CAPABILITY = 'c5-local-selection-v1' as const;

export const MAX_WEEKLY_PLANNING_STORED_SESSION_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = MAX_WEEKLY_PLANNING_STORED_MESSAGES;

export interface WeeklyPlanningStableV5PersistedSession {
  version: typeof WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION;
  /** Older strict readers reject this extension instead of silently dropping consumption. */
  requiredCapabilities?: readonly [typeof WEEKLY_PLANNING_C5_SESSION_CAPABILITY];
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
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

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    conversationRequestSequence: state.conversationRequestSequence ?? 0,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    previewCandidates: state.previewCandidates ?? [],
    messages: state.messages.slice(-MAX_MESSAGES),
    intakeState,
  })) as PlanningState;
}

function isEmptySession(state: PlanningState, graph: WeeklyPlanningFactGraphV5): boolean {
  return graph.revision === 0
    && (state.conversationRequestSequence ?? 0) === 0
    && state.messages.length === 0
    && state.draftBlocks.length === 0
    && (state.previewCandidates?.length ?? 0) === 0
    && !state.intakeState;
}

function createPersistedEnvelope(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
}): WeeklyPlanningStableV5PersistedSession {
  return {
    version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
    ...(params.planningState.intakeState?.c5SelectionLedger
      ? { requiredCapabilities: [WEEKLY_PLANNING_C5_SESSION_CAPABILITY] as const } : {}),
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: params.graph,
    planningState: params.planningState,
    savedAt: params.savedAt,
  };
}

function serializeEnvelopeWithinBudget(
  envelope: WeeklyPlanningStableV5PersistedSession,
): string | null {
  try {
    const raw = JSON.stringify({ ...envelope, planningState: compactWeeklyPlanningApprovalRecovery(envelope.planningState) });
    return new TextEncoder().encode(raw).byteLength <= MAX_WEEKLY_PLANNING_STORED_SESSION_BYTES
      ? raw
      : null;
  } catch {
    return null;
  }
}

export function parseWeeklyPlanningStableV5PersistedSession(params: {
  raw: string;
  ownerId: string;
  weekStartDate: string;
}): WeeklyPlanningStableV5PersistedSession | null {
  if (new TextEncoder().encode(params.raw).byteLength > MAX_WEEKLY_PLANNING_STORED_SESSION_BYTES) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(params.raw);
    if (!isRecord(value)
      || !hasOnlyKeys(value, [
        'version',
        'ownerId',
        'weekStartDate',
        'conversationId',
        'graph',
        'planningState',
        'savedAt',
        'requiredCapabilities',
      ])
      || value.version !== WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION
      || (value.requiredCapabilities !== undefined && (!Array.isArray(value.requiredCapabilities)
        || value.requiredCapabilities.length !== 1 || value.requiredCapabilities[0] !== WEEKLY_PLANNING_C5_SESSION_CAPABILITY))
      || value.ownerId !== params.ownerId
      || value.weekStartDate !== params.weekStartDate
      || !isNonEmptyString(value.conversationId)
      || !isTimestamp(value.savedAt)
      || !isRecord(value.graph)) {
      return null;
    }
    value.planningState = expandWeeklyPlanningApprovalRecovery(value.planningState);
    // V1 never grants selection authority, even if extension-shaped data was injected.
    if (value.requiredCapabilities === undefined && isRecord(value.planningState)
      && isRecord(value.planningState.intakeState)) {
      const { c5SelectionLedger: _ledger, ...intake } = value.planningState.intakeState;
      if (isRecord(intake.lastQuestionContext)) {
        const { c5: _snapshot, ...question } = intake.lastQuestionContext;
        intake.lastQuestionContext = question;
      }
      value.planningState = { ...value.planningState, intakeState: intake };
    }
    const parsedGraph = parseWeeklyPlanningFactGraphV5(JSON.stringify(value.graph));
    if (!parsedGraph.graph
      || !graphBelongsToConversation(parsedGraph.graph, value.conversationId)
      || !isPersistedWeeklyPlanningState(value.planningState, {
        kind: 'stable_v5_session_v1',
        ownerId: params.ownerId,
        weekStartDate: params.weekStartDate,
        conversationId: value.conversationId,
        graphRevision: parsedGraph.graph.revision,
      })) {
      return null;
    }
    if (!validC5SessionRecords(value.planningState.intakeState, params.ownerId, value.conversationId)) return null;
    return {
      version: value.version,
      ...(value.requiredCapabilities !== undefined ? { requiredCapabilities: [WEEKLY_PLANNING_C5_SESSION_CAPABILITY] as const } : {}),
      ownerId: params.ownerId,
      weekStartDate: params.weekStartDate,
      conversationId: value.conversationId,
      graph: parsedGraph.graph,
      planningState: {
        ...value.planningState,
        conversationRequestSequence: value.planningState.conversationRequestSequence ?? 0,
        pendingTurn: undefined,
        pendingApproval: undefined,
      },
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

/** Validate external in-memory snapshots through the same compact wire contract as storage. */
export function validateWeeklyPlanningStableV5SessionSnapshot(
  value: unknown,
  ownerId: string,
): WeeklyPlanningStableV5PersistedSession | null {
  if (!isRecord(value) || !isDate(value.weekStartDate) || !isRecord(value.planningState)
    || !validateWeeklyPlanningFactGraphValueV5(value.graph).graph) return null;
  const raw = serializeEnvelopeWithinBudget(value as unknown as WeeklyPlanningStableV5PersistedSession);
  return raw ? parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId, weekStartDate: value.weekStartDate }) : null;
}

export type WeeklyPlanningStableV5CheckpointPreparation =
  | { status: 'invalid' }
  | { status: 'empty' }
  | { status: 'ready'; planningState: PlanningState };

export function prepareWeeklyPlanningStableV5Checkpoint(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  includeEmpty?: boolean;
}): WeeklyPlanningStableV5CheckpointPreparation {
  if (params.planningState.pendingTurn || params.planningState.pendingApproval) {
    return { status: 'invalid' };
  }
  if (params.planningState.weekStartDate !== params.weekStartDate) {
    return { status: 'invalid' };
  }
  if (!validateWeeklyPlanningFactGraphValueV5(params.graph).graph) {
    return { status: 'invalid' };
  }
  if (!graphBelongsToConversation(params.graph, params.conversationId)) {
    return { status: 'invalid' };
  }
  if (!validC5SessionRecords(params.planningState.intakeState, params.ownerId, params.conversationId)) return { status: 'invalid' };
  const planningState = serializablePlanningState(params.planningState);
  if (!params.includeEmpty && isEmptySession(planningState, params.graph)) {
    return { status: 'empty' };
  }
  if (!isPersistedWeeklyPlanningState(planningState, {
    kind: 'stable_v5_session_v1',
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graphRevision: params.graph.revision,
  })) {
    return { status: 'invalid' };
  }
  return { status: 'ready', planningState };
}

export function largestWeeklyPlanningStableV5Checkpoint(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
}): { raw: string; messageCount: number } | null {
  const messages = params.planningState.messages;
  let low = 0;
  let high = messages.length;
  let best: { raw: string; messageCount: number } | null = null;

  while (low <= high) {
    const messageCount = Math.floor((low + high) / 2);
    const candidateState: PlanningState = {
      ...params.planningState,
      messages: messageCount > 0 ? messages.slice(-messageCount) : [],
    };
    const raw = serializeEnvelopeWithinBudget(createPersistedEnvelope({
      ...params,
      planningState: candidateState,
    }));
    if (raw) {
      best = { raw, messageCount };
      low = messageCount + 1;
    } else {
      high = messageCount - 1;
    }
  }

  return best;
}

export function serializeWeeklyPlanningStableV5CheckpointWithMessageCount(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
  messageCount: number;
}): string | null {
  const candidateState: PlanningState = {
    ...params.planningState,
    messages: params.messageCount > 0
      ? params.planningState.messages.slice(-params.messageCount)
      : [],
  };
  return serializeEnvelopeWithinBudget(createPersistedEnvelope({
    ...params,
    planningState: candidateState,
  }));
}
