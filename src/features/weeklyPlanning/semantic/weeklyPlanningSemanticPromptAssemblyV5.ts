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
  'Interpret current-turn meaning into semantic facts independently. Treat pendingQuestion as authoritative only for an actual answer; bind it to its exact target. It must not suppress other explicit contributions: emit them and leave an unanswered question pending; do not invent uncertainty for it.',
  'For accepted existingPublicId, keep established partner-specific title/contextLabel unless the user renames it.',
  'Quantity roles: target is an explicitly stated plan amount; remaining is unfinished; completed is done. Do not calculate target from total/completed. A stated numeric approximate progress value is valid workload state; use uncertainty only when its role or amount is genuinely unresolved. An effortEstimate may target the exact task, component, or workload localId.',
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
