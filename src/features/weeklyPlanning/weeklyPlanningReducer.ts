import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

export function createInitialPlanningState(weekStartDate: string): PlanningState {
  return {
    weekStartDate,
    mode: 'idle',
    draftBlocks: [],
    messages: [],
    updatedAt: nowIso(),
  };
}

function withUpdatedAt(state: PlanningState): PlanningState {
  return {
    ...state,
    updatedAt: nowIso(),
  };
}

function getPendingDraftBlocks(blocks: WeeklyPlanDraftBlock[]): WeeklyPlanDraftBlock[] {
  return blocks.filter((block) => block.status === 'draft');
}

export function weeklyPlanningReducer(
  state: PlanningState,
  action: WeeklyPlanningAction,
): PlanningState {
  switch (action.type) {
    case 'load_state':
      return action.state;

    case 'add_draft_blocks': {
      if (action.blocks.length === 0) {
        return state;
      }

      return withUpdatedAt({
        ...state,
        mode: 'awaiting_approval',
        draftBlocks: [...getPendingDraftBlocks(state.draftBlocks), ...action.blocks],
      });
    }

    case 'remove_draft_block':
      return withUpdatedAt({
        ...state,
        draftBlocks: state.draftBlocks.filter((block) => block.id !== action.blockId),
        mode:
          state.draftBlocks.filter((block) => block.id !== action.blockId).length > 0
            ? state.mode
            : 'idle',
      });

    case 'remove_draft_blocks': {
      const blockIds = new Set(action.blockIds);
      const nextBlocks = state.draftBlocks.filter((block) => !blockIds.has(block.id));

      return withUpdatedAt({
        ...state,
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? state.mode : 'idle',
      });
    }

    case 'clear_draft_blocks':
      return withUpdatedAt({
        ...state,
        draftBlocks: [],
        mode: 'idle',
      });

    case 'mark_draft_block_user_edited':
      return withUpdatedAt({
        ...state,
        draftBlocks: state.draftBlocks.map((block) =>
          block.id === action.blockId
            ? { ...block, userEdited: true, updatedAt: nowIso() }
            : block,
        ),
      });

    case 'append_message':
      return withUpdatedAt({
        ...state,
        mode: state.mode === 'idle' ? 'collecting_tasks' : state.mode,
        messages: [...state.messages, action.message],
      });

    case 'set_last_assistant_message':
      return withUpdatedAt({
        ...state,
        lastAssistantMessage: action.message,
        messages: [
          ...state.messages,
          {
            id: `weekly-planning-message-${Date.now()}`,
            role: 'assistant',
            content: action.message,
            createdAt: nowIso(),
          } satisfies WeeklyPlanningMessage,
        ],
      });

    default:
      return state;
  }
}
