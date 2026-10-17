import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { isWeeklyPlanningQuestionPresentationDirect, resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import type { WeeklyPlanningMessage } from '../types';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { listReplyReferenceOpenSlotsV5, type ReplyReferenceCompilationV5 } from './weeklyPlanningReplyReferenceEligibilityV5';

export type ReplyReferenceSlotV5 =
  | 'task_title' | 'component_label' | 'quantity' | 'quantity_role'
  | 'duration_per_unit' | 'total_duration' | 'session_duration' | 'preferred_window';

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

export interface ReplyReferenceDialogueTurnV5 {
  readonly messageOrdinal: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ReplyReferenceSnapshotV5 {
  readonly graphRevision: number;
  readonly planningStateRevision: number;
  readonly conversationMessageIds: readonly string[];
  /** A role-ordered, bounded excerpt of real messages, not reconstructed AI instructions. */
  readonly dialogueHistory: readonly ReplyReferenceDialogueTurnV5[];
  /** Only a fresh, active, machine-bound question may supply an omitted reply target. */
  readonly pendingQuestion: {
    readonly messageOrdinal: number;
    readonly questionCode: string;
    readonly candidateKeys: readonly string[];
  } | null;
  /** Bounded private identity projection. Choice hashes this before building a manifest. */
  readonly pendingQuestionIdentity: ReturnType<typeof questionIdentity> | null;
  readonly candidates: readonly ReplyReferenceCandidateV5[];
  readonly diagnostics: ReplyReferenceDiagnosticsV5;
}

export interface ReplyReferenceDiagnosticsV5 {
  readonly reason: 'eligible' | 'pruned' | 'invalid_source' | 'missing_compilation' | 'stale_compilation'
    | 'no_open_slots' | 'no_anchored_candidates' | 'pending_over_limit' | 'group_menu' | 'invalid_request';
  readonly openSlotCount: number;
  readonly excludedAncestorCount: number;
  readonly candidateCountBeforePrune: number;
  readonly candidateCount: number;
  readonly prunedCount: number;
}

export interface ReplyReferenceSourceV5 {
  graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[];
  previousState?: PlanningIntakeState;
  inputStateRevision?: number;
  conversationId: string;
  compilation?: ReplyReferenceCompilationV5;
}

/** Presentation text/c5/proposals never enter this identity or a manifest source revision. */
function questionIdentity(context: NonNullable<PlanningIntakeState['lastQuestionContext']>) {
  const presentation = context.presentation!;
  return Object.freeze({ actionId: context.actionId ?? null, targetSlot: context.targetSlot ?? null,
    kind: context.kind, intent: context.intent ?? null, topicId: context.topicId ?? null,
    estimateForWorkloadFactId: context.estimateForWorkloadFactId ?? null, questionBasis: context.questionBasis ?? null,
    turnId: presentation.turnId, assistantMessageId: presentation.assistantMessageId,
    planningStateRevision: presentation.planningStateRevision, graphRevision: presentation.graphRevision });
}

export function boundReplyReferenceTextV5(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('');
}

export const REPLY_REFERENCE_SOURCE_TURN_LIMIT_V5 = 8;
export const REPLY_REFERENCE_CANDIDATE_LIMIT_V5 = 64;
export const REPLY_REFERENCE_DIALOGUE_RECENT_MESSAGE_LIMIT_V5 = 16;
export const REPLY_REFERENCE_DIALOGUE_MAX_CHARS_PER_MESSAGE_V5 = 600;

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

/**
 * Only current compiler issues create open destinations. Invalid ancestry excludes
 * that destination; unrelated valid destinations remain usable. No prose is parsed.
 */
export function buildReplyReferenceSnapshotV5(input: ReplyReferenceSourceV5): {
  snapshot: ReplyReferenceSnapshotV5 | null;
  diagnostics: ReplyReferenceDiagnosticsV5;
} {
  const counts = { openSlotCount: 0, excludedAncestorCount: 0, candidateCountBeforePrune: 0, candidateCount: 0, prunedCount: 0 };
  const disabled = (reason: ReplyReferenceDiagnosticsV5['reason']) => ({ snapshot: null,
    diagnostics: Object.freeze({ reason, ...counts }) });
  if (!input.conversationId || !Number.isSafeInteger(input.graph.revision) || input.graph.revision < 0
    || typeof input.inputStateRevision !== 'number' || !Number.isSafeInteger(input.inputStateRevision) || input.inputStateRevision < 0
    || new Set(input.messages.map(message => message.id)).size !== input.messages.length) return disabled('invalid_source');
  if (!input.compilation) return disabled('missing_compilation');
  if (input.compilation.graphRevision !== input.graph.revision) return disabled('stale_compilation');
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(input.graph);
  if ([...graph.tasks, ...graph.components, ...graph.workloads]
    .some(fact => fact.source.conversationId !== input.conversationId)) return disabled('invalid_source');
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
  if (tasks.size !== graph.tasks.length) return disabled('invalid_source');

  // A reference to an active task/component can address its existing descendants.
  // Prefer the fact's own utterance, then the nearest anchored ancestor. This is
  // formal graph ancestry, never a claim inferred from the words in the utterance.
  const sourceAnchor = (taskId: string, componentId: string | null, ownTurnId: string) => {
    const turnIds = [ownTurnId];
    const seen = new Set<string>();
    let current = componentId;
    while (current !== null) {
      if (seen.has(current)) return null;
      seen.add(current);
      const components = graph.components.filter(item => item.id === current && item.taskId === taskId);
      if (components.length !== 1) return null;
      turnIds.push(components[0].source.turnId);
      current = components[0].parentComponentId;
    }
    const task = tasks.get(taskId);
    if (!task) return null;
    turnIds.push(task.source.turnId);
    for (const turnId of turnIds) {
      const message = turnMessages.get(turnId);
      if (message) return { message, turnId };
    }
    return null;
  };

  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    messages: input.messages, graphRevision: graph.revision,
  });
  const pending = freshness.status === 'fresh' && isWeeklyPlanningQuestionPresentationDirect(freshness.presentation.content)
    ? freshness : null;
  const openSlots = listReplyReferenceOpenSlotsV5({ graph, compilation: input.compilation,
    pending: pending?.questionContext ?? null });
  counts.openSlotCount = openSlots.length;
  if (openSlots.length === 0) return disabled('no_open_slots');
  const pendingDestinations = new Set<string>();
  const destinations = new Map<string, CandidateWithoutKey>();
  for (const open of openSlots) {
    const workload = open.workload;
    const task = tasks.get(workload.taskId);
    const path = componentPath(graph, workload.taskId, workload.componentId);
    if (!task || !task.title.trim() || !path) { counts.excludedAncestorCount++; continue; }
    const matchesPending = pending !== null && pending.questionContext.topicId === workload.id
      && pending.questionContext.targetSlot === 'stable_v5:' + open.questionCode
      && (pending.questionContext.estimateForWorkloadFactId ?? null) === open.estimateForWorkloadFactId
      && (pending.questionContext.questionBasis ?? null) === open.questionBasis
      && (open.slot === 'quantity_role' || pending.questionContext.intent === open.slot);
    const anchor = sourceAnchor(workload.taskId, workload.componentId, workload.source.turnId)
      ?? (matchesPending ? { message: input.messages[input.messages.length - 1], turnId: pending!.presentation.turnId } : null);
    if (!anchor) continue;
    const destination = JSON.stringify(['workload', workload.id, open.slot]);
    if (matchesPending) pendingDestinations.add(destination);
    if (!destinations.has(destination)) destinations.set(destination, {
      sourceMessageId: anchor.message.id, sourceTurnId: anchor.turnId, targetKind: 'workload',
      targetFactId: workload.id, taskFactId: workload.taskId, componentPath: path,
      slot: open.slot, operation: 'set_value',
      label: boundReplyReferenceTextV5([task.title, ...path, '学習量', open.slot].join(' / '), 300),
    });
  }
  const uniqueCandidates = [...destinations.values()];
  counts.candidateCountBeforePrune = uniqueCandidates.length;
  if (uniqueCandidates.length === 0) return disabled('no_anchored_candidates');
  if (pendingDestinations.size > REPLY_REFERENCE_CANDIDATE_LIMIT_V5) return disabled('pending_over_limit');
  const ordinals = new Map(input.messages.map((message, index) => [message.id, index + 1]));
  const destinationKey = (candidate: CandidateWithoutKey) => JSON.stringify([candidate.targetKind, candidate.targetFactId, candidate.slot]);
  const retained = uniqueCandidates.sort((left, right) =>
    Number(pendingDestinations.has(destinationKey(right))) - Number(pendingDestinations.has(destinationKey(left)))
    || ordinals.get(right.sourceMessageId)! - ordinals.get(left.sourceMessageId)!
    || (destinationKey(left) < destinationKey(right) ? -1 : destinationKey(left) > destinationKey(right) ? 1 : 0))
    .slice(0, REPLY_REFERENCE_CANDIDATE_LIMIT_V5);
  counts.candidateCount = retained.length;
  counts.prunedCount = uniqueCandidates.length - retained.length;
  const diagnostics = Object.freeze({ reason: counts.prunedCount > 0 ? 'pruned' as const : 'eligible' as const, ...counts });

  // Preserve recent user/assistant context in its real chronological order, and include
  // older candidate anchors even when intervening assistant turns pushed them outside
  // the recent window. The bounded transcript is provider context, never state authority.
  const anchorMessageIds = new Set(retained.map(candidate => candidate.sourceMessageId));
  const recentMessageIds = new Set(input.messages.slice(-REPLY_REFERENCE_DIALOGUE_RECENT_MESSAGE_LIMIT_V5)
    .map(message => message.id));
  const dialogueHistory = input.messages.flatMap((message, index) => {
    if (!recentMessageIds.has(message.id) && !anchorMessageIds.has(message.id)) return [];
    const content = boundReplyReferenceTextV5(message.content, REPLY_REFERENCE_DIALOGUE_MAX_CHARS_PER_MESSAGE_V5);
    return [{
      messageOrdinal: index + 1,
      role: message.role,
      content,
    } satisfies ReplyReferenceDialogueTurnV5];
  });
  // At most 8 source-user anchors plus the latest 16 user/assistant messages.
  if (dialogueHistory.length > REPLY_REFERENCE_SOURCE_TURN_LIMIT_V5
    + REPLY_REFERENCE_DIALOGUE_RECENT_MESSAGE_LIMIT_V5) return disabled('invalid_source');
  const keyed = retained.map((candidate, index) => Object.freeze({
    ...candidate, componentPath: Object.freeze([...candidate.componentPath]),
    key: 'reply-ref:' + index,
  }));
  const pendingKeys = keyed.filter(candidate => pendingDestinations.has(destinationKey(candidate))).map(candidate => candidate.key);
  const hasPending = pending !== null && pendingKeys.length > 0;
  const snapshot: ReplyReferenceSnapshotV5 = Object.freeze({
    graphRevision: graph.revision,
    planningStateRevision: input.inputStateRevision!,
    conversationMessageIds: Object.freeze(input.messages.map(message => message.id)),
    dialogueHistory: Object.freeze(dialogueHistory.map(turn => Object.freeze(turn))),
    pendingQuestionIdentity: hasPending ? questionIdentity(pending.questionContext) : null,
    pendingQuestion: hasPending ? Object.freeze({
      messageOrdinal: ordinals.get(pending.presentation.assistantMessageId)!,
      questionCode: pending.questionContext.targetSlot!,
      candidateKeys: Object.freeze(pendingKeys),
    }) : null,
    candidates: Object.freeze(keyed),
    diagnostics,
  });
  return { snapshot, diagnostics };
}

export function createReplyReferenceSnapshotV5(input: ReplyReferenceSourceV5): ReplyReferenceSnapshotV5 | null {
  return buildReplyReferenceSnapshotV5(input).snapshot;
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
