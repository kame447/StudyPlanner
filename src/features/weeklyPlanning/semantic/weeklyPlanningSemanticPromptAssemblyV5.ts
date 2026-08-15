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
  'publicStateSummary and recentConversation are context, not output. Emit only facts stated or changed in current userText; every sourceText must be supported by current userText. Do not replay inactive facts or episodic memory.',
  'Treat pendingQuestion as authoritative: resolve only its exact target and preserve accepted identity through exact existingPublicId.',
  'For an accepted existingPublicId, keep the established partner-specific title/contextLabel unless the user renames it.',
  'Quantity roles: target is the amount intended for this plan; remaining is the unfinished amount; completed is already done. An effortEstimate may target the exact task, component, or workload localId.',
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
