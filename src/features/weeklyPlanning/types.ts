import type { PlanType } from '../../types/domain';

export type AiInputMode = 'chat' | 'weekly_planning';

export type WeeklyPlanningMode =
  | 'idle'
  | 'collecting_tasks'
  | 'draft_created'
  | 'awaiting_approval'
  | 'confirmed';

export type WeeklyPlanDraftStatus = 'draft' | 'approved' | 'discarded';

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
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyPlanningMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface PlanningState {
  weekStartDate: string;
  mode: WeeklyPlanningMode;
  draftBlocks: WeeklyPlanDraftBlock[];
  messages: WeeklyPlanningMessage[];
  lastAssistantMessage?: string;
  updatedAt: string;
}

export type WeeklyPlanningAction =
  | { type: 'load_state'; state: PlanningState }
  | { type: 'add_draft_blocks'; blocks: WeeklyPlanDraftBlock[] }
  | { type: 'remove_draft_block'; blockId: string }
  | { type: 'remove_draft_blocks'; blockIds: string[] }
  | { type: 'clear_draft_blocks' }
  | { type: 'mark_draft_block_user_edited'; blockId: string }
  | { type: 'append_message'; message: WeeklyPlanningMessage }
  | { type: 'set_last_assistant_message'; message: string };
