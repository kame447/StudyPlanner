import { describe, expect, it } from 'vitest';
import {
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextSnapshotV1,
} from '../../userPlanningContext/userPlanningContextTypes';
import {
  validateUserPlanningContextSnapshotV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import type { PlanningState } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { parseWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';

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
  userPlanningContext: UserPlanningContextSnapshotV1;
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
  const userPlanningContext = parsed.userPlanningContext === undefined
    ? createEmptyUserPlanningContextSnapshotV1(parsed.ownerId)
    : parsed.userPlanningContext;
  if (!validateUserPlanningContextSnapshotV1(userPlanningContext, parsed.ownerId)) {
    throw new Error('Checkpoint user planning context is invalid.');
  }
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
    userPlanningContext,
    turns,
    savedAt: parsed.savedAt,
  };
}

export function serializeWeeklyPlanningResumableConversationCheckpoint(
  checkpoint: WeeklyPlanningResumableConversationCheckpoint,
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}

function checkpoint(): WeeklyPlanningResumableConversationCheckpoint {
  return {
    version: WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
    ownerId: 'owner-1',
    conversationId: 'conversation-1',
    weekStartDate: '2026-08-03',
    selectedDate: '2026-08-06',
    planningState: createInitialPlanningState('2026-08-03'),
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    userPlanningContext: createEmptyUserPlanningContextSnapshotV1('owner-1'),
    turns: [],
    savedAt: '2026-08-06T14:00:00.000Z',
  };
}

describe('weeklyPlanningResumableConversationCheckpoint', () => {
  it('round-trips a valid checkpoint', () => {
    const value = checkpoint();
    expect(parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toEqual(value);
  });

  it('rejects a checkpoint with a non-contiguous transcript', () => {
    const value = checkpoint();
    value.turns = [{
      index: 2,
      userText: '予定を立てたいです',
      assistantText: 'いつまでの予定ですか？',
      requestId: 'request-2',
      responseSource: 'ai',
      graphRevision: 1,
      createdAt: '2026-08-06T14:01:00.000Z',
    }];
    expect(() => parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toThrow('turn indexes are not contiguous');
  });

  it('rejects an in-flight planning state', () => {
    const value = checkpoint();
    value.planningState.pendingTurn = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      weekStartDate: '2026-08-03',
      baseRevision: 0,
      startedAt: '2026-08-06T14:00:00.000Z',
    };
    expect(() => parseWeeklyPlanningResumableConversationCheckpoint(
      serializeWeeklyPlanningResumableConversationCheckpoint(value),
    )).toThrow('in-flight operation');
  });
});
