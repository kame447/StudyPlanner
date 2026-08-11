import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticSystemPromptV5,
  createWeeklyPlanningSemanticUserPromptV5,
} from './weeklyPlanningSemanticDocumentV5';

export interface WeeklyPlanningSemanticPromptInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  traceRequestId?: string;
}

const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'You alone interpret user meaning and context; deterministic code only validates structure, safety, state consistency, scheduling, and persistence boundaries.',
  'Current SemanticDocument is a delta. publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText; when current userText does not state a planning window, planningWindow must be null. Every sourceText must be supported by current userText, not prior turns.',
  'publicStateSummary.episodicMemory is bounded user-origin evidence recovered from provenance of currently active facts. Use it only to resolve cross-turn reference, entity continuity, or the meaning of current userText. It is not a request to replay old facts, and superseded/removed facts must not be reconstructed from memory.',
  'Treat publicStateSummary.pendingQuestion as authoritative and never infer its target from assistant wording. For a pending clarification, resolve only that exact target with fresh localIds; never place public Fact IDs in targetLocalId. If unresolved, emit uncertainty. For work_breakdown return only that existingPublicId task with its current structure, not unrelated accepted state or the old uncertainty.',
  'Quantity roles: target means the amount intended for this plan; remaining means the full unfinished amount; completed means the amount already done. A stated full total is not itself remaining. When the same current-turn statement gives both a full total and a completed amount for the same work and unit, derive the unfinished difference as remaining and keep completed as completed; never label the full total as remaining. For quantity_role_unresolved, return only the minimal local task/workload answer. Never keep uncertainty for a resolved role.',
  'For semantic_uncertainty, answer only the unresolved semantic target; if ambiguity remains, keep uncertainty rather than guessing.',
  'An effortEstimate may target the exact task, component, or workload localId supported by the current answer.',
  'Use localIds for response-local references and exact existingPublicId only for accepted cross-turn entity identity. Creation authorization uses planningIntent create_plan without replaying accepted facts.',
  'Do not invent or emit application commands, scheduling/readiness/preview/save decisions, or prose.',
].join('\n');

const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive explicit dates use separate allowed_date constraints.',
  'Standard weekday date constraints must use weekday:<english-day>; never custom:<original phrase>.',
  'Recurring workload periods require matching recurrence; recurring weekdays use one weekly recurrence.',
  'Task relations require task localIds and explicit scheduling meaning; workload size alone is not a relation.',
  'Clock fields need explicit clocks; use namedTimePeriod or exact clocks, not both.',
].join('\n');

export function createWeeklyPlanningSemanticBaseMessagesV5(
  input: WeeklyPlanningSemanticPromptInputV5,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticSystemPromptV5(),
        AI_OWNERSHIP_INSTRUCTION_V5,
        TEMPORAL_STRUCTURE_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserPromptV5(input) },
  ];
}
