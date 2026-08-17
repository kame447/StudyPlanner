import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticMeaningPolicyV5,
  createWeeklyPlanningSemanticUserContextPayloadV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

export interface WeeklyPlanningSemanticPromptInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  traceRequestId?: string;
}

const SEMANTIC_DELTA_CONTEXT_INSTRUCTION_V5 = [
  'publicStateSummary and recentConversation are context, not output. Emit only facts stated or changed in current userText; every sourceText must be supported by current userText. Do not replay unchanged facts; a new nested fact on an existing task/component needs only a minimal containing shell bound by exact existingPublicId.',
  'Interpret current userText clause-by-clause before using pendingQuestion. Emit every supported explicit contribution. pendingQuestion only binds clauses that actually answer it; it must not filter or suppress side contributions. Leave an unanswered pending question pending and do not create uncertainty merely to restate it.',
  'For an accepted existingPublicId, keep the established partner-specific title/contextLabel unless the user renames it.',
  'Quantity roles: target is the amount intended for this plan; remaining is the unfinished amount; completed is already done. Approximate current progress is workload state, not effort or durable concern; if no exact amount is supported, use uncertainty for completed/remaining amount. An effortEstimate may target the exact task, component, or workload localId.',
].join('\n');

export function createWeeklyPlanningSemanticBaseMessagesV5(
  input: WeeklyPlanningSemanticPromptInputV5,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticMeaningPolicyV5(),
        SEMANTIC_DELTA_CONTEXT_INSTRUCTION_V5,
      ].join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserContextPayloadV5(input) },
  ];
}
