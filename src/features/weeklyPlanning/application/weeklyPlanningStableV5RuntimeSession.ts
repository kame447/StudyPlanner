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

export function getOrCreateWeeklyPlanningStableV5RuntimeSession(params: {
  ownerId: string;
  conversationId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  const existing = sessions.get(params.conversationId);
  if (existing && existing.ownerId === params.ownerId) return cloneSession(existing);

  const created: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, created);
  pruneSessions();
  return cloneSession(created);
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
  const next: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    graph: structuredClone(params.graph),
    updatedAt: Date.now(),
  };
  sessions.set(params.conversationId, next);
  publishWeeklyPlanningSessionRuntime({
    conversationId: params.conversationId,
    stateRevision: params.graph.revision,
    proposalRecords: [],
  });
  pruneSessions();
  return cloneSession(next);
}

export function clearWeeklyPlanningStableV5RuntimeSession(
  conversationId: string,
): void {
  sessions.delete(conversationId);
  clearApprovalRuntimeForConversation(conversationId);
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
