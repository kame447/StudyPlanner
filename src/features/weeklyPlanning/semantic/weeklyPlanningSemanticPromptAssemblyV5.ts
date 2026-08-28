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
  'registeredMaterials in publicStateSummary are StudyPlanner-owned known bookshelf facts. Use name, catalogTitle, and aliases to resolve a material mention such as 金フレ without asking the user what the material is. Treat stored progress/units/targetDate as known context when deciding whether clarification is necessary, but do not copy unchanged registered material fields into the current-turn semantic delta and do not treat them as scheduler placement decisions.',
  'Interpret current-turn meaning into semantic facts independently. Treat pendingQuestion as authoritative only for an actual answer; bind it to its exact target. It must not suppress other explicit contributions: emit them and leave an unanswered question pending; do not invent uncertainty for it.',
  'For accepted existingPublicId, keep established partner-specific title/contextLabel unless the user renames it.',
  'Quantity roles: target is the amount intended for this plan; remaining is the unfinished amount; completed is done. Approximate current progress is workload state. Do not derive target from total/completed. An effortEstimate may target the exact task, component, or workload localId.',
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
