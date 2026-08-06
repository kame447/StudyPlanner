import type { PlanningState } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { parseWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';

export const WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION =
  'weekly-planning-resumable-conversation-v1' as const;

export interface WeeklyPlanningResumableConversationTurn {
  index: number;
  userText: string;
  assistantText: string;
  requestId: string;
  responseSource: string | null;
  graphRevision: number;
  createdAt: string;
}

export interface WeeklyPlanningResumableConversationCheckpoint {
  version: typeof WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION;
  ownerId: string;
  conversationId: string;
  weekStartDate: string;
  selectedDate: string;
  planningState: PlanningState;
  graph: WeeklyPlanningFactGraphV5;
  turns: WeeklyPlanningResumableConversationTurn[];
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isTurn(value: unknown): value is WeeklyPlanningResumableConversationTurn {
  return isRecord(value)
    && Number.isSafeInteger(value.index)
    && Number(value.index) >= 1
    && typeof value.userText === 'string'
    && value.userText.trim().length > 0
    && typeof value.assistantText === 'string'
    && typeof value.requestId === 'string'
    && value.requestId.trim().length > 0
    && (value.responseSource === null || typeof value.responseSource === 'string')
    && Number.isSafeInteger(value.graphRevision)
    && Number(value.graphRevision) >= 0
    && isTimestamp(value.createdAt);
}

export function parseWeeklyPlanningResumableConversationCheckpoint(
  raw: string,
): WeeklyPlanningResumableConversationCheckpoint {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('Checkpoint must be a JSON object.');
  if (parsed.version !== WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION) {
    throw new Error('Checkpoint version is unsupported.');
  }
  if (typeof parsed.ownerId !== 'string' || !parsed.ownerId.trim()) {
    throw new Error('Checkpoint ownerId is invalid.');
  }
  if (typeof parsed.conversationId !== 'string' || !parsed.conversationId.trim()) {
    throw new Error('Checkpoint conversationId is invalid.');
  }
  if (!isDate(parsed.weekStartDate) || !isDate(parsed.selectedDate)) {
    throw new Error('Checkpoint dates are invalid.');
  }
  if (!isRecord(parsed.planningState) || !isRecord(parsed.graph)) {
    throw new Error('Checkpoint state is missing.');
  }
  const graphResult = parseWeeklyPlanningFactGraphV5(JSON.stringify(parsed.graph));
  if (!graphResult.graph) throw new Error('Checkpoint graph is invalid.');
  if (!Array.isArray(parsed.turns) || !parsed.turns.every(isTurn)) {
    throw new Error('Checkpoint turns are invalid.');
  }
  if (!isTimestamp(parsed.savedAt)) throw new Error('Checkpoint savedAt is invalid.');
  const turns = parsed.turns as WeeklyPlanningResumableConversationTurn[];
  turns.forEach((turn, index) => {
    if (turn.index !== index + 1) throw new Error('Checkpoint turn indexes are not contiguous.');
  });
  const planningState = parsed.planningState as unknown as PlanningState;
  if (planningState.weekStartDate !== parsed.weekStartDate) {
    throw new Error('Checkpoint planningState week does not match.');
  }
  if (planningState.pendingTurn || planningState.pendingApproval) {
    throw new Error('Checkpoint contains an in-flight operation.');
  }
  return {
    version: WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
    ownerId: parsed.ownerId,
    conversationId: parsed.conversationId,
    weekStartDate: parsed.weekStartDate,
    selectedDate: parsed.selectedDate,
    planningState,
    graph: graphResult.graph,
    turns,
    savedAt: parsed.savedAt,
  };
}

export function serializeWeeklyPlanningResumableConversationCheckpoint(
  checkpoint: WeeklyPlanningResumableConversationCheckpoint,
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}
