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
  'publicStateSummary and recentConversation are context, not output. Emit only facts stated or changed in current userText; sourceText must be grounded in current userText. Do not replay inactive facts or episodic memory.',
  'pendingQuestion is authoritative when present: resolve only its exact target, keep accepted identity through exact existingPublicId, and use fresh localIds for current-turn facts.',
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
