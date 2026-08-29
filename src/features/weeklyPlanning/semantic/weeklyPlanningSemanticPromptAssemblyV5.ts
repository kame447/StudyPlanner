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
  'Context is not output. Emit only current userText changes; each sourceText must be supported by current userText. Do not replay unchanged facts. New nested facts on existing entities need only a minimal shell with exact existingPublicId.',
  'registeredMaterials are context; resolve aliases/progress, never replay saved facts. If user explicitly selects all remaining work for one unique match, emit one remaining workload from saved remainingUnits/unit without copying saved scope_total/completed facts.',
  'Interpret each current-turn contribution independently. pendingQuestion binds only actual answers to its exact target; it cannot suppress other explicit contributions or invent uncertainty.',
  'Keep an accepted existingPublicId title/contextLabel unless user renames it.',
  'Quantity roles: target=plan amount; remaining=unfinished; completed=done. Do not derive target from total/completed. effortEstimate targets the exact task/component/workload localId.',
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
