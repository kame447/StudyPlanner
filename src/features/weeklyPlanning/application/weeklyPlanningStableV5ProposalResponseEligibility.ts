import {
  PROPOSAL_RESPONSE_MAX_PRESENTED_TEXT_BYTES,
  PROPOSAL_RESPONSE_MAX_USER_TEXT_BYTES,
} from '../../../../shared/proposalResponseDecision';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  isWeeklyPlanningQuestionPresentationUnaccompanied,
  resolveWeeklyPlanningQuestionPresentationFreshness,
} from '../intake/weeklyPlanningQuestionPresentation';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningProposalResponseCandidateV5 } from '../semantic/weeklyPlanningFocusedProposalResponseV5';
import type { WeeklyPlanningMessage } from '../types';

export type WeeklyPlanningProposalResponseEligibility =
  | { status: 'eligible'; candidate: WeeklyPlanningProposalResponseCandidateV5 }
  | { status: 'ineligible'; reason: string };

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Deterministic eligibility for the bounded proposal-response decision. Every
 * condition is machine state; the user's text is only bounded in size, never read.
 */
export function resolveWeeklyPlanningProposalResponseEligibilityV5(params: {
  previousState: PlanningIntakeState | undefined;
  inputStateRevision: number | undefined;
  messages: readonly WeeklyPlanningMessage[];
  graph: WeeklyPlanningFactGraphV5;
  userText: string;
  supplementalContext?: string;
  hasSelectedStarterTarget: boolean;
}): WeeklyPlanningProposalResponseEligibility {
  const ineligible = (reason: string) => ({ status: 'ineligible', reason }) as const;
  if (params.supplementalContext?.trim()) return ineligible('supplemental_context');
  if (params.hasSelectedStarterTarget) return ineligible('selected_starter_target');
  const userText = params.userText.trim();
  if (!userText || utf8Bytes(userText) > PROPOSAL_RESPONSE_MAX_USER_TEXT_BYTES) {
    return ineligible('user_text_size');
  }

  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: params.previousState,
    inputStateRevision: params.inputStateRevision,
    messages: params.messages,
    graphRevision: params.graph.revision,
  });
  if (freshness.status !== 'fresh') return ineligible(`presentation_${freshness.status}`);
  if (!isWeeklyPlanningQuestionPresentationUnaccompanied(freshness.presentation.content)) {
    return ineligible('presentation_accompanied');
  }
  const questionCode = decodeWeeklyPlanningStableV5QuestionSlot(
    freshness.questionContext.targetSlot,
  );
  if (questionCode !== 'learning_strategy_proposal') return ineligible('question_code');

  const records = params.previousState?.learningStrategyProposalRecords ?? [];
  const pending = records.filter((record) => record.status === 'pending');
  if (pending.length !== 1) return ineligible('pending_proposal_count');
  const proposal = pending[0];
  if (proposal.id !== freshness.questionContext.actionId) return ineligible('bound_proposal_mismatch');
  if (proposal.kind !== 'spaced_memory_practice') return ineligible('proposal_kind');
  const { min, max } = proposal.suggestedSessionMinutes;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min <= 0 || min > max) {
    return ineligible('proposal_minutes');
  }

  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const task = active.tasks.find((candidate) => candidate.id === proposal.taskId);
  if (!task?.title.trim()) return ineligible('proposal_task_inactive');
  if (!active.workloads.some((workload) => workload.id === proposal.workloadFactId)) {
    return ineligible('proposal_workload_inactive');
  }

  const presented = params.messages[params.messages.length - 1];
  const presentedText = presented.content.trim();
  if (!presentedText || utf8Bytes(presentedText) > PROPOSAL_RESPONSE_MAX_PRESENTED_TEXT_BYTES) {
    return ineligible('presented_text_size');
  }

  return {
    status: 'eligible',
    candidate: {
      proposalPublicId: proposal.id,
      inputRevision: freshness.presentation.planningStateRevision,
      presentedAssistantText: presentedText,
      proposal: {
        kind: 'spaced_memory_practice',
        taskTitle: task.title,
        sessionMinutes: { min, max },
      },
    },
  };
}
