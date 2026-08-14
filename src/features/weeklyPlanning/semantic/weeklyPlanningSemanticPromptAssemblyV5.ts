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
  'You interpret meaning; deterministic code owns validation, state, scheduling, safety, and persistence.',
  'SemanticDocument is a current-turn delta. Use prior state/conversation only to resolve references; sourceText must come from current userText. Never replay inactive facts or episodic memory.',
  'pendingQuestion is authoritative: answer only its exact target with fresh localIds. If unresolved, emit uncertainty. Preserve existingPublicId identity/title unless the user renames it.',
  'Quantity roles: target is planned amount, remaining unfinished, completed done; when total and completed are stated for the same work/unit, derive remaining. Effort may target a task, component, or workload.',
  'Use existingPublicId only for accepted cross-turn identity. create_plan authorizes creation; it does not authorize replaying accepted facts.',
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
