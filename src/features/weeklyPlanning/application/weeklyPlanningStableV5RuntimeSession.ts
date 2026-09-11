import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  discardAllWeeklyPlanningStableV5GraphStagesForConversation,
  discardWeeklyPlanningStableV5GraphStage,
  hasWeeklyPlanningStableV5GraphStage,
  readWeeklyPlanningStableV5StagedGraph,
  resetWeeklyPlanningStableV5GraphStagesForTest,
  stageWeeklyPlanningStableV5Graph,
} from './weeklyPlanningStableV5GraphStaging';

export interface WeeklyPlanningStableV5RuntimeSession {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  updatedAt: number;
}

export interface WeeklyPlanningStableV5RuntimeGraphFinalizeReceipt {
  ownerId: string;
  conversationId: string;
  requestId: string;
  previousGraph: WeeklyPlanningFactGraphV5;
  previousUpdatedAt: number;
  finalizedGraph: WeeklyPlanningFactGraphV5;
  finalizedUpdatedAt: number;
}

export interface WeeklyPlanningStableV5RuntimeGraphFinalizeResult {
  session: WeeklyPlanningStableV5RuntimeSession;
  receipt: WeeklyPlanningStableV5RuntimeGraphFinalizeReceipt;
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

function sameGraphSnapshot(
  left: WeeklyPlanningFactGraphV5,
  right: WeeklyPlanningFactGraphV5,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    discardAllWeeklyPlanningStableV5GraphStagesForConversation(session.conversationId);
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

export function getWeeklyPlanningStableV5RuntimeSessionForOwner(
  ownerId: string,
): WeeklyPlanningStableV5RuntimeSession | null {
  const matching = [...sessions.values()]
    .filter((session) => session.ownerId === ownerId)
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
  discardAllWeeklyPlanningStableV5GraphStagesForConversation(params.conversationId);
  const hydrated: WeeklyPlanningStableV5RuntimeSession = {
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: structuredClone(params.graph),
    updatedAt: params.updatedAt ?? Date.now(),
  };
  sessions.set(params.conversationId, hydrated);
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
  stageWeeklyPlanningStableV5Graph(params);
  return cloneSession(session);
}

export function getWeeklyPlanningStableV5StagedGraph(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
}): WeeklyPlanningFactGraphV5 | null {
  const staged = readWeeklyPlanningStableV5StagedGraph(params);
  if (!staged || staged.ownerId !== params.ownerId) return null;
  if (staged.conversationId !== params.conversationId || staged.requestId !== params.requestId) {
    return null;
  }
  return structuredClone(staged.graph);
}

export function finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
}): WeeklyPlanningStableV5RuntimeGraphFinalizeResult {
  const staged = readWeeklyPlanningStableV5StagedGraph(params);
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
    updatedAt: Math.max(Date.now(), current.updatedAt + 1),
  };
  sessions.set(params.conversationId, next);
  discardWeeklyPlanningStableV5GraphStage(params);
  pruneSessions();
  return {
    session: cloneSession(next),
    receipt: {
      ownerId: params.ownerId,
      conversationId: params.conversationId,
      requestId: params.requestId,
      previousGraph: structuredClone(current.graph),
      previousUpdatedAt: current.updatedAt,
      finalizedGraph: structuredClone(next.graph),
      finalizedUpdatedAt: next.updatedAt,
    },
  };
}

export function rollbackWeeklyPlanningStableV5RuntimeGraphFinalize(
  receipt: WeeklyPlanningStableV5RuntimeGraphFinalizeReceipt,
): boolean {
  const current = sessions.get(receipt.conversationId);
  if (!current || current.ownerId !== receipt.ownerId) return false;
  if (current.updatedAt !== receipt.finalizedUpdatedAt
    || !sameGraphSnapshot(current.graph, receipt.finalizedGraph)) {
    return false;
  }
  sessions.set(receipt.conversationId, {
    ...current,
    graph: structuredClone(receipt.previousGraph),
    updatedAt: receipt.previousUpdatedAt,
  });
  return true;
}

export function finalizeWeeklyPlanningStableV5RuntimeGraph(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
}): WeeklyPlanningStableV5RuntimeSession {
  return finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt(params).session;
}

export function discardWeeklyPlanningStableV5StagedGraph(params: {
  conversationId: string;
  requestId: string;
}): void {
  discardWeeklyPlanningStableV5GraphStage(params);
}

export function hasWeeklyPlanningStableV5StagedGraph(params: {
  conversationId: string;
  requestId: string;
}): boolean {
  return hasWeeklyPlanningStableV5GraphStage(params);
}

export const hasWeeklyPlanningStableV5StagedGraphForTest =
  hasWeeklyPlanningStableV5StagedGraph;

export function clearWeeklyPlanningStableV5RuntimeSession(
  conversationId: string,
): void {
  sessions.delete(conversationId);
  discardAllWeeklyPlanningStableV5GraphStagesForConversation(conversationId);
}

export function clearWeeklyPlanningStableV5RuntimeSessionsForScope(params: {
  ownerId: string;
  weekStartDate: string;
}): void {
  for (const [conversationId, session] of sessions) {
    if (sameScope(session, params.ownerId, params.weekStartDate)) {
      sessions.delete(conversationId);
      discardAllWeeklyPlanningStableV5GraphStagesForConversation(conversationId);
    }
  }
}

export function clearWeeklyPlanningStableV5RuntimeSessionsForOwner(
  ownerId: string,
): void {
  for (const [conversationId, session] of sessions) {
    if (session.ownerId === ownerId) {
      sessions.delete(conversationId);
      discardAllWeeklyPlanningStableV5GraphStagesForConversation(conversationId);
    }
  }
}

export function resetWeeklyPlanningStableV5RuntimeSessionsForTest(): void {
  sessions.clear();
  resetWeeklyPlanningStableV5GraphStagesForTest();
}
