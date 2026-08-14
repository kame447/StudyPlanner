import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticMeaningPolicyV5,
  createWeeklyPlanningSemanticUserContextPayloadV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';
import {
  readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5,
} from './weeklyPlanningWorkBreakdownResponseContractV5';

export interface WeeklyPlanningSemanticPromptInputV5 {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  traceRequestId?: string;
}

const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'deterministic code validates representation/state and owns readiness, scheduling, preview, save, and persistence. Do not emit application, scheduling, readiness, preview, save commands.',
  'Current SemanticDocument is a delta: publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText; every sourceText must be supported by current userText. Never replay inactive facts or episodic memory.',
  'Treat pendingQuestion as authoritative: answer only its exact target with fresh localIds. Preserve established partner-specific title/contextLabel on existingPublicId unless the user renames it.',
  'Quantity roles: target is the amount intended for this plan; remaining is the unfinished amount; completed is already done. When total and completed match the same work/unit, derive remaining. An effortEstimate may target the exact task, component, or workload localId.',
  'External sources: use only when explicitly requested; do not reproduce or invent external events.',
  'create_plan authorizes creation; it does not authorize replaying accepted facts.',
].join('\n');

function contextualInstructionV5(
  input: WeeklyPlanningSemanticPromptInputV5,
): string | null {
  const workBreakdownTarget = readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(
    input.publicStateSummary,
  );
  if (!workBreakdownTarget) return null;
  return `Answer only pending work_breakdown target ${workBreakdownTarget}; bind that existingPublicId and emit only current-turn structure for it.`;
}

export function createWeeklyPlanningSemanticBaseMessagesV5(
  input: WeeklyPlanningSemanticPromptInputV5,
): ChatMessage[] {
  const contextualInstruction = contextualInstructionV5(input);
  return [
    {
      role: 'system',
      content: [
        createWeeklyPlanningSemanticMeaningPolicyV5(),
        AI_OWNERSHIP_INSTRUCTION_V5,
        contextualInstruction,
      ].filter((value): value is string => Boolean(value)).join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserContextPayloadV5(input) },
  ];
}
