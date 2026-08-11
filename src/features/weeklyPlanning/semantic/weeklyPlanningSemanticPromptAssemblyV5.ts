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
  'You alone interpret user meaning and context; deterministic code validates structure/state and handles scheduling, safety, persistence.',
  'Current SemanticDocument is a delta. publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText. If current userText states no planning window, planningWindow must be null. Every sourceText must be supported by current userText, not prior turns.',
  'episodicMemory is active-fact provenance for current cross-turn references only; never replay it or revive inactive facts.',
  'Treat publicStateSummary.pendingQuestion as authoritative and never infer its target from assistant wording. For a pending clarification, resolve only that exact target with fresh localIds; never place public Fact IDs in targetLocalId. If unresolved, emit uncertainty. For work_breakdown return only that existingPublicId task with its current structure, not unrelated accepted state or the old uncertainty.',
  'Quantity roles: target means the amount intended for this plan; remaining means the full unfinished amount; completed means the amount already done. A stated full total is not itself remaining. When the same current-turn statement gives both a full total and a completed amount for the same work and unit, derive the unfinished difference as remaining and keep completed as completed; never label the full total as remaining. For quantity_role_unresolved, return only the minimal local task/workload answer. Never keep uncertainty for a resolved role.',
  'For semantic_uncertainty, answer only unresolved target; if ambiguous, emit uncertainty.',
  'An effortEstimate may target the exact task, component, or workload localId.',
  'Use localIds within response; existingPublicId only for accepted cross-turn identity. create_plan authorizes creation without replaying facts.',
  'Do not emit application/scheduling/readiness/preview/save commands or prose.',
].join('\n');

const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive dates use separate allowed_date constraints.',
  'Weekdays use weekday:<english-day>, never custom:<original phrase>.',
  'Recurring workload periods require matching recurrence; recurring weekdays use one weekly recurrence.',
  'Relations require task localIds and explicit scheduling meaning; workload size alone is not a relation.',
  'Clock fields require explicit clocks; use namedTimePeriod or exact clocks, not both.',
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