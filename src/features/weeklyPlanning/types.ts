import type { PlanType } from '../../types/domain';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PreviewAssumptionDependency,
  WeeklyPreviewMetadata,
} from './planning/weeklyPlanningApprovalTypes';

export type AiInputMode = 'chat' | 'weekly_planning';

export type WeeklyPlanningMode =
  | 'idle'
  | 'collecting_tasks'
  | 'draft_created'
  | 'awaiting_approval'
  | 'confirmed';

export type WeeklyPlanDraftStatus = 'draft' | 'approved' | 'discarded';

export type WeeklyPlanningReasoningKey =
  | 'explicit-duration'
  | 'explicit-unit-rate'
  | 'accepted-assumption-duration';

export interface WeeklyPlanningBehaviorMetadata {
  conversationId?: string;
  stateRevision: number;
  sourceFactRefs: string[];
  usedAssumptionProposalRefs: string[];
  acceptedAssumptionDependencies?: PreviewAssumptionDependency[];
  taskRef: string;
  opportunityTags: string[];
  reasoningKey: WeeklyPlanningReasoningKey;
  compatibility: {
    workItemSemantic: 'behavior_aware_task';
    schedulerInputSource: 'exam_prep_request';
    candidateSource: 'weekly_exam_prep';
  };
  previewMetadata?: WeeklyPreviewMetadata;
}

export interface WeeklyPlanDraftBlock {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  type: PlanType;
  label: string;
  materialId?: string | null;
  materialName?: string;
  memo?: string;
  source: 'ai';
  status: WeeklyPlanDraftStatus;
  userEdited: boolean;
  behaviorMetadata?: WeeklyPlanningBehaviorMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyPlanningMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface WeeklyPlanningPendingTurn {
  conversationId: string;
  turnId: string;
  requestId: string;
  weekStartDate: string;
  baseRevision: number;
  startedAt: string;
}

export interface WeeklyPlanningPendingApproval {
  requestId: string;
  weekStartDate: string;
  baseRevision: number;
  blockIds: string[];
  startedAt: string;
}

export interface PlanningState {
  weekStartDate: string;
  revision: number;
  mode: WeeklyPlanningMode;
  draftBlocks: WeeklyPlanDraftBlock[];
  previewCandidates?: WeeklyDraftCandidate[];
  messages: WeeklyPlanningMessage[];
  intakeState?: PlanningIntakeState;
  pendingTurn?: WeeklyPlanningPendingTurn;
  pendingApproval?: WeeklyPlanningPendingApproval;
  lastAssistantMessage?: string;
  updatedAt: string;
}

export type WeeklyPlanningAction =
  | { type: 'load_state'; state: PlanningState }
  | { type: 'add_draft_blocks'; blocks: WeeklyPlanDraftBlock[] }
  | { type: 'remove_draft_block'; blockId: string }
  | { type: 'remove_draft_blocks'; blockIds: string[] }
  | { type: 'clear_draft_blocks' }
  | { type: 'remove_preview_candidate'; candidateId: string }
  | { type: 'mark_draft_block_user_edited'; blockId: string }
  | { type: 'append_message'; message: WeeklyPlanningMessage }
  | { type: 'set_intake_state'; state: PlanningIntakeState | null }
  | { type: 'clear_conversation' }
  | { type: 'reset_session' }
  | { type: 'set_last_assistant_message'; message: string }
  | {
      type: 'begin_turn';
      pending: WeeklyPlanningPendingTurn;
      userMessage: WeeklyPlanningMessage;
    }
  | {
      type: 'commit_turn';
      pending: WeeklyPlanningPendingTurn;
      intakeState: PlanningIntakeState;
      assistantMessage: WeeklyPlanningMessage;
      draftCandidates?: WeeklyDraftCandidate[];
    }
  | {
      type: 'fail_turn';
      pending: WeeklyPlanningPendingTurn;
      assistantMessage: WeeklyPlanningMessage;
    }
  | { type: 'cancel_turn'; pending: WeeklyPlanningPendingTurn }
  | { type: 'begin_approval'; pending: WeeklyPlanningPendingApproval }
  | {
      type: 'complete_approval';
      pending: WeeklyPlanningPendingApproval;
      completedBlockIds: string[];
      assistantMessage: WeeklyPlanningMessage;
    }
  | { type: 'fail_approval'; pending: WeeklyPlanningPendingApproval };
