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

const MAX_RUNTIME_SESSIONS = 24;
const sessions = new Map<string, WeeklyPlanningStableV5RuntimeSession>();

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
  oldest.forEach((session) => sessions.delete(session.conversationId));
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
  weekStartDate: string;
  conversationId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  const existing = sessions.get(params.conversationId);
  if (existing) {
    if (!sameScope(existing, params.ownerId, params.weekStartDate)) {
      throw new Error('Stable V5 runtime session scope mismatch.');
    }
    return cloneSession(existing);
  }

  const created: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, created);
  pruneSessions();
  return cloneSession(created);
}

export function hydrateWeeklyPlanningStableV5RuntimeSession(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  updatedAt?: number;
}): WeeklyPlanningStableV5RuntimeSession {
  const existing = sessions.get(params.conversationId);
  if (existing && !sameScope(existing, params.ownerId, params.weekStartDate)) {
    throw new Error('Stable V5 runtime session scope mismatch.');
  }
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
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
}): WeeklyPlanningStableV5RuntimeSession {
  const current = sessions.get(params.conversationId);
  if (current && !sameScope(current, params.ownerId, params.weekStartDate)) {
    throw new Error('Stable V5 runtime session scope mismatch.');
  }
  const next: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: structuredClone(params.graph),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, next);
  publishSession(next);
  pruneSessions();
  return cloneSession(next);
}

export function clearWeeklyPlanningStableV5RuntimeSession(
  conversationId: string,
): void {
  sessions.delete(conversationId);
  clearApprovalRuntimeForConversation(conversationId);
}

export function clearWeeklyPlanningStableV5RuntimeSessionsForScope(params: {
  ownerId: string;
  weekStartDate: string;
}): void {
  for (const [conversationId, session] of sessions) {
    if (sameScope(session, params.ownerId, params.weekStartDate)) {
      sessions.delete(conversationId);
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
      clearApprovalRuntimeForConversation(conversationId);
    }
  }
}

export function resetWeeklyPlanningStableV5RuntimeSessionsForTest(): void {
  sessions.clear();
  clearWeeklyPlanningSessionRuntime();
}
