import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';

export interface StagedWeeklyPlanningStableV5Graph {
  ownerId: string;
  conversationId: string;
  requestId: string;
  graph: WeeklyPlanningFactGraphV5;
}

const stagedGraphs = new Map<string, StagedWeeklyPlanningStableV5Graph>();

function stagedKey(conversationId: string, requestId: string): string {
  return `${conversationId}:${requestId}`;
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

export function stageWeeklyPlanningStableV5Graph(params: {
  ownerId: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
}): string {
  const requestId = requestIdFromGraph(params.graph, params.conversationId);
  stagedGraphs.set(stagedKey(params.conversationId, requestId), {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    requestId,
    graph: structuredClone(params.graph),
  });
  return requestId;
}

export function readWeeklyPlanningStableV5StagedGraph(params: {
  conversationId: string;
  requestId: string;
}): StagedWeeklyPlanningStableV5Graph | null {
  const staged = stagedGraphs.get(stagedKey(params.conversationId, params.requestId));
  return staged
    ? { ...staged, graph: structuredClone(staged.graph) }
    : null;
}

export function discardWeeklyPlanningStableV5GraphStage(params: {
  conversationId: string;
  requestId: string;
}): void {
  stagedGraphs.delete(stagedKey(params.conversationId, params.requestId));
}

export function hasWeeklyPlanningStableV5GraphStage(params: {
  conversationId: string;
  requestId: string;
}): boolean {
  return stagedGraphs.has(stagedKey(params.conversationId, params.requestId));
}

export function discardAllWeeklyPlanningStableV5GraphStagesForConversation(
  conversationId: string,
): void {
  const prefix = `${conversationId}:`;
  for (const key of stagedGraphs.keys()) {
    if (key.startsWith(prefix)) stagedGraphs.delete(key);
  }
}

export function resetWeeklyPlanningStableV5GraphStagesForTest(): void {
  stagedGraphs.clear();
}
