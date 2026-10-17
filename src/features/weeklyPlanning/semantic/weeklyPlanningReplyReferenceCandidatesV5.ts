import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import type { WeeklyPlanningMessage } from '../types';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

export type ReplyReferenceSlotV5 =
  | 'task_title' | 'component_label' | 'quantity' | 'quantity_role'
  | 'duration_per_unit' | 'total_duration' | 'preferred_window';

export interface ReplyReferenceCandidateV5 {
  readonly key: string;
  readonly sourceMessageId: string;
  readonly sourceTurnId: string;
  readonly targetKind: 'task' | 'component' | 'workload';
  readonly targetFactId: string;
  readonly taskFactId: string;
  readonly componentPath: readonly string[];
  readonly slot: ReplyReferenceSlotV5;
  readonly operation: 'set_value';
  readonly label: string;
}

export interface ReplyReferenceSnapshotV5 {
  readonly graphRevision: number;
  readonly planningStateRevision: number;
  readonly conversationMessageIds: readonly string[];
  readonly candidates: readonly ReplyReferenceCandidateV5[];
}

export const REPLY_REFERENCE_SOURCE_TURN_LIMIT_V5 = 8;
export const REPLY_REFERENCE_CANDIDATE_LIMIT_V5 = 64;

type CandidateWithoutKey = Omit<ReplyReferenceCandidateV5, 'key'>;
type CandidateGraph = ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>;

function componentPath(graph: CandidateGraph, taskId: string, componentId: string | null): string[] | null {
  if (componentId === null) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  let current: string | null = componentId;
  while (current !== null) {
    if (seen.has(current)) return null;
    seen.add(current);
    const item = graph.components.filter(component => component.id === current && component.taskId === taskId);
    if (item.length !== 1 || !item[0].label.trim()) return null;
    result.unshift(item[0].label);
    current = item[0].parentComponentId;
    if (result.length > 16) return null;
  }
  return result;
}

function slotsFor(kind: CandidateWithoutKey['targetKind']): readonly ReplyReferenceSlotV5[] {
  switch (kind) {
    case 'task': return ['task_title', 'total_duration', 'preferred_window'];
    case 'component': return ['component_label', 'total_duration', 'preferred_window'];
    case 'workload': return ['quantity', 'quantity_role', 'duration_per_unit', 'total_duration'];
  }
}

function questionSlots(code: string | undefined): readonly ReplyReferenceSlotV5[] {
  if (code === 'stable_v5:missing_effort_estimate' || code === 'stable_v5:ambiguous_effort_estimate') {
    return ['duration_per_unit', 'total_duration'];
  }
  if (code === 'stable_v5:quantity_role_unresolved') return ['quantity_role'];
  return [];
}

/**
 * Builds a bounded, non-authoritative choice domain from committed facts and exact message IDs.
 * No Japanese text is parsed. A missing ancestor or oversized domain disables the entire route.
 */
export function createReplyReferenceSnapshotV5(input: {
  graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[];
  previousState?: PlanningIntakeState;
  inputStateRevision?: number;
  conversationId: string;
}): ReplyReferenceSnapshotV5 | null {
  if (!input.conversationId || !Number.isSafeInteger(input.graph.revision) || input.graph.revision < 0
    || typeof input.inputStateRevision !== 'number' || !Number.isSafeInteger(input.inputStateRevision) || input.inputStateRevision < 0
    || new Set(input.messages.map(message => message.id)).size !== input.messages.length) return null;
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(input.graph);
  if ([...graph.tasks, ...graph.components, ...graph.workloads]
    .some(fact => fact.source.conversationId !== input.conversationId)) return null;
  const selectedMessages = input.messages.filter(message => message.role === 'user')
    .slice(-REPLY_REFERENCE_SOURCE_TURN_LIMIT_V5);
  // The dialogue envelope stores "conversation:turn:N:user", while committed facts
  // record the same turn's "conversation:request:N". Only this machine-owned
  // sequence relationship may bind a historical utterance to its fact.
  const turnPrefix = input.conversationId + ':turn:';
  const userSuffix = ':user';
  const turnMessages = new Map<string, WeeklyPlanningMessage>();
  for (const message of selectedMessages) {
    if (!message.id.startsWith(turnPrefix) || !message.id.endsWith(userSuffix)
      || !message.content.trim()) continue;
    const sequence = message.id.slice(turnPrefix.length, -userSuffix.length);
    const value = Number(sequence);
    if (!Number.isSafeInteger(value) || value < 1 || String(value) !== sequence) continue;
    turnMessages.set(input.conversationId + ':request:' + sequence, message);
  }
  const tasks = new Map(graph.tasks.map(task => [task.id, task]));
  if (tasks.size !== graph.tasks.length) return null;

  const candidates: CandidateWithoutKey[] = [];
  const add = (messageId: string, turnId: string, kind: CandidateWithoutKey['targetKind'],
    targetFactId: string, taskId: string, path: string[], allowed?: readonly ReplyReferenceSlotV5[]) => {
    const task = tasks.get(taskId);
    if (!task || !task.title.trim()) return false;
    const slots = slotsFor(kind).filter(slot => allowed === undefined || allowed.includes(slot));
    for (const slot of slots) {
      candidates.push({
        sourceMessageId: messageId, sourceTurnId: turnId, targetKind: kind,
        targetFactId, taskFactId: taskId, componentPath: [...path], slot,
        operation: 'set_value',
        label: [task.title, ...path, kind === 'workload' ? '学習量' : '', slot].filter(Boolean).join(' / '),
      });
    }
    return true;
  };
  for (const task of graph.tasks) {
    const message = turnMessages.get(task.source.turnId);
    if (message && !add(message.id, task.source.turnId, 'task', task.id, task.id, [])) return null;
  }
  for (const component of graph.components) {
    const path = componentPath(graph, component.taskId, component.id);
    if (!path) return null;
    const message = turnMessages.get(component.source.turnId);
    if (message && !add(message.id, component.source.turnId, 'component',
      component.id, component.taskId, path)) return null;
  }
  for (const workload of graph.workloads) {
    const path = componentPath(graph, workload.taskId, workload.componentId);
    if (!path) return null;
    const message = turnMessages.get(workload.source.turnId);
    if (message && !add(message.id, workload.source.turnId, 'workload',
      workload.id, workload.taskId, path)) return null;
  }

  // Only the machine-bound pending question may be an assistant-turn anchor.
  // Other assistant prose has no authoritative slot identity.
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    messages: input.messages, graphRevision: graph.revision,
  });
  if (freshness.status === 'fresh') {
    const context = freshness.questionContext;
    const allowed = questionSlots(context.targetSlot);
    if (allowed.length > 0 && context.topicId) {
      const workload = graph.workloads.filter(item => item.id === context.topicId);
      if (workload.length === 1) {
        const path = componentPath(graph, workload[0].taskId, workload[0].componentId);
        if (!path || !add(freshness.presentation.assistantMessageId,
          freshness.presentation.turnId, 'workload', workload[0].id,
          workload[0].taskId, path, allowed)) return null;
      }
    }
  }

  if (candidates.length === 0 || candidates.length > REPLY_REFERENCE_CANDIDATE_LIMIT_V5) return null;
  // Different messages may refer to the same fact; they are separate semantic options.
  const keyed = candidates.map((candidate, index) => Object.freeze({
    ...candidate, componentPath: Object.freeze([...candidate.componentPath]),
    key: 'reply-ref:' + index,
  }));
  return Object.freeze({
    graphRevision: graph.revision,
    planningStateRevision: input.inputStateRevision!,
    conversationMessageIds: Object.freeze(input.messages.map(message => message.id)),
    candidates: Object.freeze(keyed),
  });
}

/**
 * A selected reference is merely a hint for the existing semantic extractor.
 * Value, unit, polarity, precision, corrections and independent meaning remain AI-owned.
 */
export function resolveReplyReferenceCandidateV5(
  snapshot: ReplyReferenceSnapshotV5,
  chosenKey: string,
  current: Parameters<typeof createReplyReferenceSnapshotV5>[0],
): ReplyReferenceCandidateV5 | null {
  const refreshed = createReplyReferenceSnapshotV5(current);
  if (!refreshed || JSON.stringify(refreshed) !== JSON.stringify(snapshot)) return null;
  const matches = snapshot.candidates.filter(candidate => candidate.key === chosenKey);
  return matches.length === 1 ? matches[0] : null;
}

/** Copies an already interpreted evidence span; does not infer a word, unit or intent. */
export function extractReplyReferenceEvidenceV5(
  userText: string, span: { start: number; end: number },
): string | null {
  const { start, end } = span;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end > userText.length || end <= start
    || (start > 0 && userText.charCodeAt(start) >= 0xdc00 && userText.charCodeAt(start) <= 0xdfff)
    || (end < userText.length && userText.charCodeAt(end) >= 0xdc00 && userText.charCodeAt(end) <= 0xdfff)) return null;
  const evidence = userText.slice(start, end);
  return evidence.trim() ? evidence : null;
}
