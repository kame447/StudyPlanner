import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

export function createInitialPlanningState(weekStartDate: string): PlanningState {
  return {
    weekStartDate,
    revision: 0,
    mode: 'idle',
    draftBlocks: [],
    messages: [],
    updatedAt: nowIso(),
  };
}

function withMutation(state: PlanningState, next: Omit<PlanningState, 'revision' | 'updatedAt'>): PlanningState {
  return {
    ...next,
    revision: state.revision + 1,
    updatedAt: nowIso(),
  };
}

function getPendingDraftBlocks(blocks: WeeklyPlanDraftBlock[]): WeeklyPlanDraftBlock[] {
  return blocks.filter((block) => block.status === 'draft');
}

function samePendingTurn(
  current: WeeklyPlanningPendingTurn | undefined,
  expected: WeeklyPlanningPendingTurn,
): boolean {
  return Boolean(
    current
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

function samePendingApproval(
  current: WeeklyPlanningPendingApproval | undefined,
  expected: WeeklyPlanningPendingApproval,
): boolean {
  return Boolean(
    current
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

function canCommitTurn(state: PlanningState, pending: WeeklyPlanningPendingTurn): boolean {
  return samePendingTurn(state.pendingTurn, pending)
    && state.weekStartDate === pending.weekStartDate
    && state.revision === pending.baseRevision + 1;
}

function canCommitApproval(
  state: PlanningState,
  pending: WeeklyPlanningPendingApproval,
): boolean {
  return samePendingApproval(state.pendingApproval, pending)
    && state.weekStartDate === pending.weekStartDate
    && state.revision === pending.baseRevision + 1;
}

function appendAssistantMessage(
  state: PlanningState,
  message: WeeklyPlanningMessage,
): Pick<PlanningState, 'messages' | 'lastAssistantMessage'> {
  return {
    messages: [...state.messages, message],
    lastAssistantMessage: message.content,
  };
}

export function weeklyPlanningReducer(
  state: PlanningState,
  action: WeeklyPlanningAction,
): PlanningState {
  if (
    state.pendingApproval
    && action.type !== 'load_state'
    && action.type !== 'complete_approval'
    && action.type !== 'fail_approval'
  ) {
    return state;
  }

  if (
    state.pendingTurn
    && action.type !== 'load_state'
    && action.type !== 'commit_turn'
    && action.type !== 'fail_turn'
    && action.type !== 'cancel_turn'
  ) {
    return state;
  }

  switch (action.type) {
    case 'load_state':
      return action.state;

    case 'begin_turn':
      if (
        state.pendingTurn
        || state.pendingApproval
        || action.pending.weekStartDate !== state.weekStartDate
        || action.pending.baseRevision !== state.revision
      ) {
        return state;
      }
      return withMutation(state, {
        ...state,
        mode: state.mode === 'idle' ? 'collecting_tasks' : state.mode,
        messages: [...state.messages, action.userMessage],
        pendingTurn: action.pending,
      });

    case 'commit_turn':
      if (!canCommitTurn(state, action.pending)) return state;
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        intakeState: action.intakeState,
        pendingTurn: undefined,
      });

    case 'fail_turn':
      if (!canCommitTurn(state, action.pending)) return state;
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        pendingTurn: undefined,
      });

    case 'cancel_turn':
      if (!samePendingTurn(state.pendingTurn, action.pending)) return state;
      return withMutation(state, {
        ...state,
        pendingTurn: undefined,
      });

    case 'begin_approval': {
      const currentIds = new Set(getPendingDraftBlocks(state.draftBlocks).map((block) => block.id));
      if (
        state.pendingTurn
        || state.pendingApproval
        || action.pending.weekStartDate !== state.weekStartDate
        || action.pending.baseRevision !== state.revision
        || action.pending.blockIds.length === 0
        || action.pending.blockIds.some((blockId) => !currentIds.has(blockId))
      ) {
        return state;
      }
      return withMutation(state, {
        ...state,
        pendingApproval: action.pending,
      });
    }

    case 'complete_approval': {
      if (!canCommitApproval(state, action.pending)) return state;
      const completedIds = new Set(action.completedBlockIds);
      const nextBlocks = state.draftBlocks.filter((block) => !completedIds.has(block.id));
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? 'awaiting_approval' : 'idle',
        pendingApproval: undefined,
      });
    }

    case 'fail_approval':
      if (!samePendingApproval(state.pendingApproval, action.pending)) return state;
      return withMutation(state, {
        ...state,
        pendingApproval: undefined,
      });

    case 'add_draft_blocks': {
      if (action.blocks.length === 0) return state;
      return withMutation(state, {
        ...state,
        mode: 'awaiting_approval',
        draftBlocks: [...getPendingDraftBlocks(state.draftBlocks), ...action.blocks],
      });
    }

    case 'remove_draft_block': {
      const nextBlocks = state.draftBlocks.filter((block) => block.id !== action.blockId);
      if (nextBlocks.length === state.draftBlocks.length) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? state.mode : 'idle',
      });
    }

    case 'remove_draft_blocks': {
      const blockIds = new Set(action.blockIds);
      const nextBlocks = state.draftBlocks.filter((block) => !blockIds.has(block.id));
      if (nextBlocks.length === state.draftBlocks.length) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? state.mode : 'idle',
      });
    }

    case 'clear_draft_blocks':
      if (state.draftBlocks.length === 0) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: [],
        mode: 'idle',
      });

    case 'mark_draft_block_user_edited': {
      const exists = state.draftBlocks.some((block) => block.id === action.blockId);
      if (!exists) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: state.draftBlocks.map((block) =>
          block.id === action.blockId
            ? { ...block, userEdited: true, updatedAt: nowIso() }
            : block,
        ),
      });
    }

    case 'append_message':
      return withMutation(state, {
        ...state,
        mode: state.mode === 'idle' ? 'collecting_tasks' : state.mode,
        messages: [...state.messages, action.message],
      });

    case 'set_intake_state':
      return withMutation(state, {
        ...state,
        intakeState: action.state ?? undefined,
      });

    case 'clear_conversation':
      return withMutation(state, {
        ...state,
        mode: state.draftBlocks.length > 0 ? 'awaiting_approval' : 'idle',
        messages: [],
        intakeState: undefined,
        pendingTurn: undefined,
        lastAssistantMessage: undefined,
      });

    case 'reset_session':
      return withMutation(state, {
        ...state,
        mode: 'idle',
        draftBlocks: [],
        messages: [],
        intakeState: undefined,
        pendingTurn: undefined,
        lastAssistantMessage: undefined,
      });

    case 'set_last_assistant_message':
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, {
          id: `weekly-planning-message-${Date.now()}`,
          role: 'assistant',
          content: action.message,
          createdAt: nowIso(),
        }),
      });

    default:
      return state;
  }
}
