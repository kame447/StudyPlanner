import { describe, expect, it } from 'vitest';
import type {
  PlanningIntakeState,
  WeeklyPlanningQuestionPresentation,
} from './weeklyPlanningIntakeTypes';
import {
  bindWeeklyPlanningQuestionPresentation,
  decodeWeeklyPlanningQuestionPresentation,
  isWeeklyPlanningQuestionPresentationUnaccompanied,
  resolveWeeklyPlanningQuestionPresentationFreshness,
} from './weeklyPlanningQuestionPresentation';
import type { WeeklyPlanningMessage } from '../types';

const CONTENT = {
  responseSource: 'ai',
  currentTurnGrounding: 'none',
  selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 },
  previewPromotionControl: false,
} as const;

function state(overrides: Partial<PlanningIntakeState> = {}): PlanningIntakeState {
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
    questions: ['分散学習の提案について、採用するか教えてください。'],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
    lastQuestionContext: {
      kind: 'options',
      targetSlot: 'stable_v5:learning_strategy_proposal',
      intent: 'learning_strategy_proposal',
      topicId: 'workload-1',
      actionId: 'wpp_memory_abc',
    },
    ...overrides,
  };
}

function presentation(
  overrides: Partial<WeeklyPlanningQuestionPresentation> = {},
): WeeklyPlanningQuestionPresentation {
  return {
    version: 1,
    turnId: 'turn-3',
    assistantMessageId: 'turn-3:assistant',
    planningStateRevision: 8,
    graphRevision: 4,
    content: { ...CONTENT },
    ...overrides,
  };
}

function boundState(overrides: Partial<WeeklyPlanningQuestionPresentation> = {}) {
  const base = state();
  return state({
    lastQuestionContext: { ...base.lastQuestionContext!, presentation: presentation(overrides) },
  });
}

function messages(lastId = 'turn-3:assistant', lastRole: 'user' | 'assistant' = 'assistant') {
  return [
    { id: 'turn-3:user', role: 'user', content: '英単語を覚えたい', createdAt: '2026-09-28T00:00:00.000Z' },
    { id: lastId, role: lastRole, content: '提案です。', createdAt: '2026-09-28T00:00:01.000Z' },
  ] satisfies WeeklyPlanningMessage[];
}

describe('question presentation binding', () => {
  it('binds the pending question to the presenting message and revisions', () => {
    const bound = bindWeeklyPlanningQuestionPresentation({
      state: state(),
      content: CONTENT,
      turnId: 'turn-3',
      assistantMessageId: 'turn-3:assistant',
      planningStateRevision: 8,
      graphRevision: 4,
    });
    expect(bound.lastQuestionContext).toEqual({
      ...state().lastQuestionContext,
      presentation: presentation(),
    });
  });

  it('leaves a state without a pending question unchanged', () => {
    const input = state({ lastQuestionContext: undefined });
    expect(bindWeeklyPlanningQuestionPresentation({
      state: input,
      content: CONTENT,
      turnId: 'turn-3',
      assistantMessageId: 'turn-3:assistant',
      planningStateRevision: 8,
      graphRevision: 4,
    })).toBe(input);
  });

  it.each([
    ['no presentation content', undefined, 4],
    ['no committed graph revision', CONTENT, undefined],
  ] as const)('drops a carried-over presentation when there is %s', (_label, content, graphRevision) => {
    const bound = bindWeeklyPlanningQuestionPresentation({
      state: boundState({ turnId: 'turn-1', assistantMessageId: 'turn-1:assistant' }),
      content,
      turnId: 'turn-3',
      assistantMessageId: 'turn-3:assistant',
      planningStateRevision: 8,
      graphRevision,
    });
    expect(bound.lastQuestionContext).toEqual(state().lastQuestionContext);
    expect(bound.lastQuestionContext).not.toHaveProperty('presentation');
  });

  it('does not bind an invalid revision', () => {
    const bound = bindWeeklyPlanningQuestionPresentation({
      state: state(),
      content: CONTENT,
      turnId: 'turn-3',
      assistantMessageId: 'turn-3:assistant',
      planningStateRevision: -1,
      graphRevision: 4,
    });
    expect(bound.lastQuestionContext).not.toHaveProperty('presentation');
  });

  it.each([
    ['unknown key', { ...presentation(), extra: true }],
    ['future version', { ...presentation(), version: 2 }],
    ['empty message id', presentation({ assistantMessageId: '' })],
    ['fractional revision', presentation({ planningStateRevision: 8.5 })],
    ['unknown response source', { ...presentation(), content: { ...CONTENT, responseSource: 'system' } }],
    ['unknown grounding mode', { ...presentation(), content: { ...CONTENT, currentTurnGrounding: 'maybe' } }],
    ['extra content key', { ...presentation(), content: { ...CONTENT, renderedText: 'はい' } }],
    ['missing content', { ...presentation(), content: undefined }],
    ['negative grounding count', { ...presentation(), content: { ...CONTENT, groundingContext: { proposed: -1, contested: 0 } } }],
    ['extra grounding key', { ...presentation(), content: { ...CONTENT, groundingContext: { proposed: 0, contested: 0, accepted: 1 } } }],
    ['non-boolean preview control', { ...presentation(), content: { ...CONTENT, previewPromotionControl: 'yes' } }],
    ['non-object', 'turn-3:assistant'],
  ])('rejects a persisted presentation with %s', (_label, value) => {
    expect(decodeWeeklyPlanningQuestionPresentation(value)).toBeNull();
  });
});

describe('question presentation accompaniment', () => {
  it('is unaccompanied only when no machine-known content shared the message', () => {
    expect(isWeeklyPlanningQuestionPresentationUnaccompanied(CONTENT)).toBe(true);
  });

  it.each([
    ['current-turn grounding', { currentTurnGrounding: 'recommended' }],
    ['required current-turn grounding', { currentTurnGrounding: 'required_before_resume' }],
    ['a self-repair notice', { selfRepairNotice: true }],
    ['a proposed grounding interpretation', { groundingContext: { proposed: 1, contested: 0 } }],
    ['a contested grounding interpretation', { groundingContext: { proposed: 0, contested: 1 } }],
    ['the preview promotion control', { previewPromotionControl: true }],
  ] as const)('is accompanied by %s', (_label, overrides) => {
    expect(isWeeklyPlanningQuestionPresentationUnaccompanied({ ...CONTENT, ...overrides }))
      .toBe(false);
  });
});

describe('question presentation freshness', () => {
  function resolve(params: {
    previousState?: PlanningIntakeState;
    inputStateRevision?: number;
    messages?: readonly WeeklyPlanningMessage[];
    graphRevision?: number;
  }) {
    return resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: 'previousState' in params ? params.previousState : boundState(),
      inputStateRevision: 'inputStateRevision' in params ? params.inputStateRevision : 8,
      messages: params.messages ?? messages(),
      graphRevision: params.graphRevision ?? 4,
    });
  }

  it('is fresh only when the presenting commit is still the latest state, message, and graph', () => {
    expect(resolve({})).toEqual({
      status: 'fresh',
      questionContext: boundState().lastQuestionContext,
      presentation: presentation(),
    });
  });

  it('reports no question when nothing is pending', () => {
    expect(resolve({ previousState: undefined })).toEqual({ status: 'no_question' });
    expect(resolve({ previousState: state({ lastQuestionContext: undefined }) }))
      .toEqual({ status: 'no_question' });
  });

  it('treats a session saved before presentation binding as unbound', () => {
    expect(resolve({ previousState: state() })).toEqual({ status: 'unbound' });
  });

  it('fails closed on a malformed persisted presentation', () => {
    const base = state();
    const tampered = state({
      lastQuestionContext: {
        ...base.lastQuestionContext!,
        presentation: { ...presentation(), planningStateRevision: '8' } as never,
      },
    });
    expect(resolve({ previousState: tampered })).toEqual({ status: 'malformed' });
  });

  it.each([
    ['the turn start revision is unknown', { inputStateRevision: undefined }, 'input_revision_unknown'],
    ['another mutation happened after the presenting commit', { inputStateRevision: 9 }, 'state_revision_mismatch'],
    ['the state was rolled back to an earlier revision', { inputStateRevision: 7 }, 'state_revision_mismatch'],
    ['a later assistant message replaced the presenting one', { messages: messages('turn-4:assistant') }, 'latest_message_mismatch'],
    ['the latest message is not from the assistant', { messages: messages('turn-3:assistant', 'user') }, 'latest_message_mismatch'],
    ['the conversation was cleared', { messages: [] }, 'latest_message_mismatch'],
    ['the semantic graph moved', { graphRevision: 5 }, 'graph_revision_mismatch'],
  ] as const)('is stale when %s', (_label, overrides, reason) => {
    expect(resolve(overrides)).toEqual({ status: 'stale', reason });
  });
});
