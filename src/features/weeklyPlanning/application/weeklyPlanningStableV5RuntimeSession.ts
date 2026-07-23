import {
  clearWeeklyPlanningSessionRuntime,
  getWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';

export interface WeeklyPlanningStableV5RuntimeSession {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  updatedAt: number;
}

interface StagedWeeklyPlanningStableV5Graph {
  ownerId: string;
  conversationId: string;
  requestId: string;
  graph: WeeklyPlanningFactGraphV5;
}

const MAX_RUNTIME_SESSIONS = 24;
const sessions = new Map<string, WeeklyPlanningStableV5RuntimeSession>();
const stagedGraphs = new Map<string, StagedWeeklyPlanningStableV5Graph>();

function stagedKey(conversationId: string, requestId: string): string {
  return `${conversationId}:${requestId}`;
}

function cloneSession(
  session: WeeklyPlanningStableV5RuntimeSession,
): WeeklyPlanningStableV5RuntimeSession {
  return {
    ...session,
    graph: structuredClone(session.graph),
  };
}

function sameScope(
  session: WeeklyPlanningStableV5RuntimeSession,
  ownerId: string,
  weekStartDate: string,
): boolean {
  return session.ownerId === ownerId && session.weekStartDate === weekStartDate;
}

function pruneSessions(): void {
  if (sessions.size <= MAX_RUNTIME_SESSIONS) return;
  const oldest = [...sessions.values()]
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(0, sessions.size - MAX_RUNTIME_SESSIONS);
  oldest.forEach((session) => {
    sessions.delete(session.conversationId);
    discardAllStagedGraphsForConversation(session.conversationId);
  });
}

function clearApprovalRuntimeForConversation(conversationId: string): void {
  if (getWeeklyPlanningSessionRuntime()?.conversationId === conversationId) {
    clearWeeklyPlanningSessionRuntime();
  }
}

function publishSession(session: WeeklyPlanningStableV5RuntimeSession): void {
  publishWeeklyPlanningSessionRuntime({
    conversationId: session.conversationId,
    stateRevision: session.graph.revision,
    proposalRecords: [],
  });
}

function requestIdFromGraph(
  graph: WeeklyPlanningFactGraphV5,
  conversationId: string,
): string {
  const turnKey = graph.appliedTurnKeys[graph.appliedTurnKeys.length - 1]?.trim();
  if (!turnKey) throw new Error('Stable V5 staged graph is missing its request id.');
  const prefix = `${conversationId}:`;
  if (!turnKey.startsWith(prefix) || turnKey.length <= prefix.length) {
    throw new Error('Stable V5 staged graph conversation does not match its turn key.');
  }
  return turnKey.slice(prefix.length);
}

function discardAllStagedGraphsForConversation(conversationId: string): void {
  const prefix = `${conversationId}:`;
  for (const key of stagedGraphs.keys()) {
    if (key.startsWith(prefix)) stagedGraphs.delete(key);
  }
}

export function getWeeklyPlanningStableV5RuntimeSession(
  conversationId: string,
): WeeklyPlanningStableV5RuntimeSession | null {
  const session = sessions.get(conversationId);
  return session ? cloneSession(session) : null;
}

export function getWeeklyPlanningStableV5RuntimeSessionForScope(params: {
  ownerId: string;
  weekStartDate: string;
}): WeeklyPlanningStableV5RuntimeSession | null {
  const matching = [...sessions.values()]
    .filter((session) => sameScope(session, params.ownerId, params.weekStartDate))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return matching ? cloneSession(matching) : null;
}

export function getOrCreateWeeklyPlanningStableV5RuntimeSession(params: {
  ownerId: string;
  conversationId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  const existing = sessions.get(params.conversationId);
  if (existing) {
    if (existing.ownerId !== params.ownerId) {
      throw new Error('Stable V5 runtime session owner mismatch.');
    }
    return cloneSession(existing);
  }

  const created: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    weekStartDate: '',
    conversationId: params.conversationId,
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, created);
  pruneSessions();
  return cloneSession(created);
}

export function bindWeeklyPlanningStableV5RuntimeSessionScope(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  const current = sessions.get(params.conversationId);
  if (current && current.ownerId !== params.ownerId) {
    throw new Error('Stable V5 runtime session owner mismatch.');
  }
  if (current && current.weekStartDate && current.weekStartDate !== params.weekStartDate) {
    throw new Error('Stable V5 runtime session week mismatch.');
  }
  const next: WeeklyPlanningStableV5RuntimeSession = current
    ? {
        ...current,
        weekStartDate: params.weekStartDate,
        updatedAt: Date.now(),
      }
    : {
        ownerId: params.ownerId,
        weekStartDate: params.weekStartDate,
        conversationId: params.conversationId,
        graph: createEmptyWeeklyPlanningFactGraphV5(),
        updatedAt: Date.now(),
      };
  sessions.set(params.conversationId, next);
  pruneSessions();
  return cloneSession(next);
}

export function hydrateWeeklyPlanningStableV5RuntimeSession(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  updatedAt?: number;
}): WeeklyPlanningStableV5RuntimeSession {
  const existing = sessions.get(params.conversationId);
  if (existing && existing.ownerId !== params.ownerId) {
    throw new Error('Stable V5 runtime session owner mismatch.');
  }
  if (existing && existing.weekStartDate && existing.weekStartDate !== params.weekStartDate) {
    throw new Error('Stable V5 runtime session week mismatch.');
  }
  discardAllStagedGraphsForConversation(params.conversationId);
  const hydrated: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: structuredClone(params.graph),
    updatedAt: params.updatedAt ?? Date.now(),
  };
  sessions.set(params.conversationId, hydrated);
  publishSession(hydrated);
  pruneSessions();
  return cloneSession(hydrated);
}

export function commitWeeklyPlanningStableV5RuntimeGraph(params: {
  ownerId: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
}): WeeklyPlanningStableV5RuntimeSession {
  const current = sessions.get(params.conversationId);
  if (current && current.ownerId !== params.ownerId) {
    throw new Error('Stable V5 runtime session owner mismatch.');
  }
  const session = current ?? getOrCreateWeeklyPlanningStableV5RuntimeSession({
    ownerId: params.ownerId,
    conversationId: params.conversationId,
  });
  const requestId = requestIdFromGraph(params.graph, params.conversationId);
  stagedGraphs.set(stagedKey(params.conversationId, requestId), {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    requestId,
    graph: structuredClone(params.graph),
  });
  return cloneSession(session);
}

export function finalizeWeeklyPlanningStableV5RuntimeGraph(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  const key = stagedKey(params.conversationId, params.requestId);
  const staged = stagedGraphs.get(key);
  if (!staged) throw new Error('Stable V5 staged graph was not found.');
  if (staged.ownerId !== params.ownerId) {
    throw new Error('Stable V5 staged graph owner mismatch.');
  }
  const current = sessions.get(params.conversationId);
  if (!current || current.ownerId !== params.ownerId) {
    throw new Error('Stable V5 runtime session owner mismatch.');
  }
  const next: WeeklyPlanningStableV5RuntimeSession = {
    ...current,
    graph: structuredClone(staged.graph),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, next);
  stagedGraphs.delete(key);
  publishSession(next);
  pruneSessions();
  return cloneSession(next);
}

export function discardWeeklyPlanningStableV5StagedGraph(params: {
  conversationId: string;
  requestId: string;
}): void {
  stagedGraphs.delete(stagedKey(params.conversationId, params.requestId));
}

export function hasWeeklyPlanningStableV5StagedGraph(params: {
  conversationId: string;
  requestId: string;
}): boolean {
  return stagedGraphs.has(stagedKey(params.conversationId, params.requestId));
}

export function clearWeeklyPlanningStableV5RuntimeSession(
  conversationId: string,
): void {
  sessions.delete(conversationId);
  discardAllStagedGraphsForConversation(conversationId);
  clearApprovalRuntimeForConversation(conversationId);
}

export function clearWeeklyPlanningStableV5RuntimeSessionsForScope(params: {
  ownerId: string;
  weekStartDate: string;
}): void {
  for (const [conversationId, session] of sessions) {
    if (sameScope(session, params.ownerId, params.weekStartDate)) {
      sessions.delete(conversationId);
      discardAllStagedGraphsForConversation(conversationId);
      clearApprovalRuntimeForConversation(conversationId);
    }
  }
}

export function clearWeeklyPlanningStableV5RuntimeSessionsForOwner(
  ownerId: string,
): void {
  for (const [conversationId, session] of sessions) {
    if (session.ownerId === ownerId) {
      sessions.delete(conversationId);
      discardAllStagedGraphsForConversation(conversationId);
      clearApprovalRuntimeForConversation(conversationId);
    }
  }
}

export function resetWeeklyPlanningStableV5RuntimeSessionsForTest(): void {
  sessions.clear();
  stagedGraphs.clear();
  clearWeeklyPlanningSessionRuntime();
}
