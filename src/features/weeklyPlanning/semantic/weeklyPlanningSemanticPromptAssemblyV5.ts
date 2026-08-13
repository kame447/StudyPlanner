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
  'You interpret user meaning and context; deterministic code validates representation/state and handles scheduling, safety, and persistence.',
  'Current SemanticDocument is a delta. publicStateSummary/recentConversation are context, not facts to copy. Emit only facts stated or changed in current userText; every sourceText must be supported by current userText.',
  'episodicMemory is provenance for current cross-turn references only; never replay it or revive inactive facts.',
  'Treat publicStateSummary.pendingQuestion as authoritative. Resolve only its exact target with fresh localIds; if meaning remains ambiguous, emit uncertainty instead of guessing.',
  'For existingPublicId, keep partner-specific title/contextLabel unless the user renames it.',
  'Quantity roles: target is the amount intended for this plan; remaining is the unfinished amount; completed is already done. If one statement gives total and completed amounts for the same work/unit, derive remaining as total minus completed.',
  'An effortEstimate may target the exact task, component, or workload localId.',
  'Use existingPublicId only for accepted cross-turn identity. create_plan authorizes creation without replaying accepted facts.',
  'Do not emit application, scheduling, readiness, preview, save commands, or prose.',
].join('\n');

const CROSS_FACT_INSTRUCTION_V5 = [
  'Non-consecutive allowed dates remain separate date constraints rather than an invented continuous range.',
  'A recurring workload needs matching recurrence semantics.',
].join('\n');

function contextualInstructionV5(
  input: WeeklyPlanningSemanticPromptInputV5,
): string | null {
  const workBreakdownTarget = readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(
    input.publicStateSummary,
  );
  if (!workBreakdownTarget) return null;
  return `This turn answers work_breakdown for exact accepted task ${workBreakdownTarget}. Return only that task, bind existingPublicId to it, and represent only structure supported by current userText; do not replay unrelated accepted state or the old uncertainty.`;
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
        CROSS_FACT_INSTRUCTION_V5,
        contextualInstruction,
      ].filter((value): value is string => Boolean(value)).join('\n'),
    },
    { role: 'user', content: createWeeklyPlanningSemanticUserContextPayloadV5(input) },
  ];
}
