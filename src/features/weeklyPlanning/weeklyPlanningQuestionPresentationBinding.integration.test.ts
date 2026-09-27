import { describe, expect, it } from 'vitest';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from './application/weeklyPlanningStableV5SessionCodec';
import {
  resolveWeeklyPlanningQuestionPresentationFreshness,
  type WeeklyPlanningQuestionPresentationFreshness,
} from './intake/weeklyPlanningQuestionPresentation';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from './weeklyPlanningTurnExecutor';

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-09-28';
const CONVERSATION_ID = 'conversation-1';
const GRAPH_REVISION = 3;

function graph() {
  return { ...createEmptyWeeklyPlanningFactGraphV5(), revision: GRAPH_REVISION };
}

function intakeState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: ['分散学習の提案（1回15〜30分）について、採用するか教えてください。'],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    groundingRecords: [],
    repairAgenda: [],
    learningStrategyProposalRecords: [],
    sourceTurns: ['英単語を覚えたい'],
    lastQuestionContext: {
      kind: 'options',
      targetSlot: 'stable_v5:learning_strategy_proposal',
      intent: 'learning_strategy_proposal',
      topicId: 'workload-1',
      actionId: 'wpp_memory_abc',
    },
  };
}

function presentingResult(
  overrides: Partial<WeeklyPlanningTurnExecutionResult> = {},
): WeeklyPlanningTurnExecutionResult {
  return {
    state: intakeState(),
    message: '分散学習の提案（1回15〜30分）について、採用するか教えてください。',
    draftCandidates: [],
    stableV5Graph: graph(),
    responseSource: 'ai',
    questionPresentationContent: {
      responseSource: 'ai',
      currentTurnGrounding: 'none',
      selfRepairNotice: false,
    groundingContext: { proposed: 0, contested: 0 },
    previewPromotionControl: false,},
    ...overrides,
  };
}

function harness() {
  let state: PlanningState = createInitialPlanningState(WEEK_START);
  const session = createWeeklyPlanningControllerSession(OWNER_ID, WEEK_START, CONVERSATION_ID);
  const dispatch = (action: WeeklyPlanningAction) => {
    state = weeklyPlanningReducer(state, action);
    return state;
  };
  let observed: WeeklyPlanningQuestionPresentationFreshness | undefined;
  async function submit(
    userText: string,
    execute: () => Promise<WeeklyPlanningTurnExecutionResult>,
  ) {
    return submitWeeklyPlanningControlledTurn({
      session,
      ownerId: OWNER_ID,
      userText,
      getState: () => state,
      dispatch,
      async execute({ snapshot, pending }) {
        observed = resolveWeeklyPlanningQuestionPresentationFreshness({
          previousState: snapshot.intakeState,
          inputStateRevision: pending.baseRevision,
          messages: snapshot.messages,
          graphRevision: GRAPH_REVISION,
        });
        return execute();
      },
      now: () => '2026-09-28T09:00:00.000Z',
    });
  }
  return {
    getState: () => state,
    setState: (next: PlanningState) => { state = next; },
    dispatch,
    submit,
    observed: () => observed,
  };
}

describe('question presentation binding across the turn commit boundary', () => {
  it('stamps the committed assistant message, state revision, and graph revision', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());

    const state = h.getState();
    const lastMessage = state.messages[state.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(state.intakeState?.lastQuestionContext?.presentation).toEqual({
      version: 1,
      turnId: lastMessage.id.replace(/:assistant$/, ''),
      assistantMessageId: lastMessage.id,
      planningStateRevision: state.revision,
      graphRevision: GRAPH_REVISION,
      content: {
        responseSource: 'ai',
        currentTurnGrounding: 'none',
        selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 },
      previewPromotionControl: false,},
    });
  });

  it('lets the next turn see the presentation as fresh', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    await h.submit('いいえ', async () => presentingResult());

    expect(h.observed()).toMatchObject({
      status: 'fresh',
      questionContext: { actionId: 'wpp_memory_abc' },
    });
  });

  it('does not bind a result that did not describe its presentation', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult({
      questionPresentationContent: undefined,
    }));

    expect(h.getState().intakeState?.lastQuestionContext).not.toHaveProperty('presentation');
    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toEqual({ status: 'unbound' });
  });

  it('becomes stale after a message is appended outside the turn', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    h.dispatch({ type: 'set_last_assistant_message', message: '保存しました。' });
    await h.submit('いいえ', async () => presentingResult());

    expect(h.observed()).toEqual({ status: 'stale', reason: 'state_revision_mismatch' });
  });

  it('becomes stale after a failed turn keeps the old question', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    await expect(h.submit('えっと', async () => {
      throw new Error('provider unavailable');
    })).rejects.toThrow();
    expect(h.getState().intakeState?.lastQuestionContext?.actionId).toBe('wpp_memory_abc');

    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toEqual({ status: 'stale', reason: 'state_revision_mismatch' });
  });

  it('replaces the binding when the next turn presents again', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    const first = h.getState().intakeState?.lastQuestionContext?.presentation;
    await h.submit('もう一度', async () => ({
      ...presentingResult(),
      // A route that reuses the previous question context must not keep the old binding.
      state: h.getState().intakeState!,
    }));
    const second = h.getState().intakeState?.lastQuestionContext?.presentation;

    expect(second?.assistantMessageId).not.toBe(first?.assistantMessageId);
    expect(second?.planningStateRevision).toBe(h.getState().revision);
  });

  it('survives the Stable V5 checkpoint round trip and stays fresh after reload', async () => {
    const h = harness();
    await h.submit('英単語を覚えたい', async () => presentingResult());
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: graph(),
      planningState: h.getState(),
    });
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') return;

    const restored = parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify({
        version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
        ownerId: OWNER_ID,
        weekStartDate: WEEK_START,
        conversationId: CONVERSATION_ID,
        graph: graph(),
        planningState: preparation.planningState,
        savedAt: '2026-09-28T09:00:01.000Z',
      }),
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
    });
    expect(restored?.planningState.intakeState?.lastQuestionContext?.presentation)
      .toEqual(h.getState().intakeState?.lastQuestionContext?.presentation);

    h.dispatch({ type: 'load_state', state: restored!.planningState });
    await h.submit('いいえ', async () => presentingResult());
    expect(h.observed()).toMatchObject({ status: 'fresh' });
  });
});
