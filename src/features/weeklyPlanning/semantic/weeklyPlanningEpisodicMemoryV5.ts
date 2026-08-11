import type { WeeklyPlanningMessage } from '../types';
import type {
  PlanningFactSourceV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_EPISODIC_MEMORY_VERSION_V5 =
  'weekly-planning-episodic-memory-v5' as const;

const DEFAULT_MAX_EPISODES = 8;
const DEFAULT_MAX_BYTES = 12 * 1024;
const MAX_USER_MESSAGE_CHARS = 1_600;
const MAX_SOURCE_EXCERPT_CHARS = 800;
const MAX_SOURCE_EXCERPTS_PER_EPISODE = 6;

export interface WeeklyPlanningEpisodicMemoryItemV5 {
  sourceRequestId: string;
  sourceSequence: number;
  factIds: string[];
  userMessage: string | null;
  sourceExcerpts: string[];
  recoveredFrom: 'conversation_log' | 'fact_source';
}

export interface WeeklyPlanningEpisodicMemoryV5 {
  version: typeof WEEKLY_PLANNING_EPISODIC_MEMORY_VERSION_V5;
  items: WeeklyPlanningEpisodicMemoryItemV5[];
}

interface ActiveSourcedFact {
  id: string;
  source: PlanningFactSourceV5;
}

function boundedText(value: string, maxChars: number): string {
  const normalized = value.trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars)}…`;
}

function requestSequence(value: string, conversationId: string): number | null {
  const requestPrefix = `${conversationId}:request:`;
  const turnPrefix = `${conversationId}:turn:`;
  const suffix = value.startsWith(requestPrefix)
    ? value.slice(requestPrefix.length)
    : value.startsWith(turnPrefix)
      ? value.slice(turnPrefix.length)
      : '';
  if (!/^[1-9]\d*$/.test(suffix)) return null;
  const sequence = Number(suffix);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function messageSequence(message: WeeklyPlanningMessage, conversationId: string): number | null {
  const prefix = `${conversationId}:turn:`;
  if (!message.id.startsWith(prefix)) return null;
  const remainder = message.id.slice(prefix.length);
  const separator = remainder.lastIndexOf(':');
  if (separator <= 0) return null;
  const role = remainder.slice(separator + 1);
  if (role !== 'user' && role !== 'assistant') return null;
  const sequenceText = remainder.slice(0, separator);
  if (!/^[1-9]\d*$/.test(sequenceText)) return null;
  const sequence = Number(sequenceText);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function activeSourcedFacts(graph: WeeklyPlanningFactGraphV5): ActiveSourcedFact[] {
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  const facts: ActiveSourcedFact[] = [
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
    ...graph.availabilityDeclarations,
    ...graph.constraintSourceRequests,
  ];
  return facts.filter((fact) => activeIds.has(fact.id));
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function buildWeeklyPlanningEpisodicMemoryV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[];
  recentMessages: readonly WeeklyPlanningMessage[];
  conversationId: string;
  priorityFactId?: string | null;
  maxEpisodes?: number;
  maxBytes?: number;
}): WeeklyPlanningEpisodicMemoryV5 {
  const recentSequences = new Set(
    params.recentMessages
      .map((message) => messageSequence(message, params.conversationId))
      .filter((sequence): sequence is number => sequence !== null),
  );
  const userMessagesBySequence = new Map<number, string>();
  params.messages.forEach((message) => {
    if (message.role !== 'user') return;
    const sequence = messageSequence(message, params.conversationId);
    if (sequence !== null) userMessagesBySequence.set(sequence, message.content);
  });

  const grouped = new Map<string, {
    sourceRequestId: string;
    sourceSequence: number;
    factIds: string[];
    sourceExcerpts: string[];
    priority: boolean;
  }>();
  activeSourcedFacts(params.graph).forEach((fact) => {
    if (fact.source.conversationId !== params.conversationId) return;
    const sequence = requestSequence(fact.source.turnId, params.conversationId);
    if (sequence === null || recentSequences.has(sequence)) return;
    const key = fact.source.turnId;
    const current = grouped.get(key) ?? {
      sourceRequestId: fact.source.turnId,
      sourceSequence: sequence,
      factIds: [],
      sourceExcerpts: [],
      priority: false,
    };
    if (!current.factIds.includes(fact.id)) current.factIds.push(fact.id);
    const excerpt = boundedText(fact.source.sourceText, MAX_SOURCE_EXCERPT_CHARS);
    if (excerpt && !current.sourceExcerpts.includes(excerpt)) {
      current.sourceExcerpts.push(excerpt);
    }
    if (params.priorityFactId === fact.id) current.priority = true;
    grouped.set(key, current);
  });

  const candidates = [...grouped.values()]
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority ? -1 : 1;
      if (left.factIds.length !== right.factIds.length) {
        return right.factIds.length - left.factIds.length;
      }
      return right.sourceSequence - left.sourceSequence;
    });

  const maxEpisodes = Math.max(0, Math.trunc(params.maxEpisodes ?? DEFAULT_MAX_EPISODES));
  const maxBytes = Math.max(0, Math.trunc(params.maxBytes ?? DEFAULT_MAX_BYTES));
  const items: WeeklyPlanningEpisodicMemoryItemV5[] = [];

  for (const candidate of candidates) {
    if (items.length >= maxEpisodes) break;
    const rawUserMessage = userMessagesBySequence.get(candidate.sourceSequence);
    const item: WeeklyPlanningEpisodicMemoryItemV5 = {
      sourceRequestId: candidate.sourceRequestId,
      sourceSequence: candidate.sourceSequence,
      factIds: candidate.factIds.slice().sort(),
      userMessage: rawUserMessage
        ? boundedText(rawUserMessage, MAX_USER_MESSAGE_CHARS)
        : null,
      sourceExcerpts: candidate.sourceExcerpts
        .slice(0, MAX_SOURCE_EXCERPTS_PER_EPISODE),
      recoveredFrom: rawUserMessage ? 'conversation_log' : 'fact_source',
    };
    const next = {
      version: WEEKLY_PLANNING_EPISODIC_MEMORY_VERSION_V5,
      items: [...items, item],
    };
    if (serializedBytes(next) > maxBytes) break;
    items.push(item);
  }

  return {
    version: WEEKLY_PLANNING_EPISODIC_MEMORY_VERSION_V5,
    items,
  };
}
