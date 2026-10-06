import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type {
  PlanningIntakeState,
  WeeklyPlanningLearningStrategyProposalRecord,
  WeeklyPlanningQuestionContext,
} from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { freshnessForTest } from '../testUtils/weeklyPlanningFreshPresentationTestUtils';
import { createWeeklyPlanningConversationRecoveryOutput } from './weeklyPlanningConversationRecovery';

const SHOWN_AI_TEXT = 'SHOWN-AI-RENDERED-ACK-AND-QUESTION';

function graphWithWorkloadlessTask() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 2;
  graph.tasks = [{
    id: 'task-1', category: 'study', title: '英語の長文',
    source: { conversationId: 'c', turnId: 't', semanticLocalId: 'task', sourceText: '英語の長文', origin: 'user' },
    createdRevision: 1,
  }];
  graph.factLifecycles = [
    { factId: 'task-1', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
  ];
  return graph;
}

function stateWith(context: WeeklyPlanningQuestionContext, extra: Partial<PlanningIntakeState> = {}): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    status: 'revision_pending',
    questions: [SHOWN_AI_TEXT],
    lastQuestionContext: context,
    ...extra,
  };
}

function recover(state: PlanningIntakeState, failure: 'provider' | 'semantic' = 'semantic') {
  const graph = graphWithWorkloadlessTask();
  const fixture = freshnessForTest({ state, graphRevision: graph.revision });
  return createWeeklyPlanningConversationRecoveryOutput({
    failure,
    previousState: fixture.state,
    userText: 'えっと',
    graph,
    pendingQuestionPresentation: fixture.freshness,
  });
}

const proposal: WeeklyPlanningLearningStrategyProposalRecord = {
  id: 'proposal-1', kind: 'spaced_memory_practice', taskId: 'task-1', workloadFactId: 'wl-1', scope: 'week',
  status: 'pending', suggestedSessionMinutes: { min: 15, max: 25 }, createdRevision: 2,
  proposedAtTurnId: 't', decidedAtTurnId: null,
};

describe('conversational recovery re-presents only deterministic application text', () => {
  it('re-presents the typed missing-work question, never the previously shown message', () => {
    const output = recover(stateWith({
      kind: 'missing', targetSlot: 'stable_v5:missing_schedulable_work', intent: 'existing_target_progress', topicId: 'task-1',
    }));
    expect(output.message).toContain('英語の長文');
    expect(output.message).not.toContain(SHOWN_AI_TEXT);
    expect(output.interactionOutcome).toEqual({ kind: 'recover', failure: 'semantic', representedQuestion: true });
    expect(output.questionPresentationContent?.responseSource).toBe('deterministic_fallback');
    expect(output.questionPresentationGraphRevision).toBe(2);
  });

  it('re-presents the typed proposal question for a fresh pending proposal', () => {
    const output = recover(stateWith({
      kind: 'options', targetSlot: 'stable_v5:learning_strategy_proposal', intent: 'learning_strategy_proposal',
      topicId: 'wl-1', actionId: 'proposal-1',
    }, { learningStrategyProposalRecords: [proposal] }), 'provider');
    expect(output.message).toContain('分散学習の提案');
    expect(output.message).not.toContain(SHOWN_AI_TEXT);
    expect(output.interactionOutcome).toMatchObject({ failure: 'provider', representedQuestion: true });
  });

  it.each([
    ['a proposal that is no longer pending', {
      kind: 'options' as const, targetSlot: 'stable_v5:learning_strategy_proposal', topicId: 'wl-1', actionId: 'gone',
    }],
    ['a missing-work question whose target moved on', {
      kind: 'missing' as const, targetSlot: 'stable_v5:missing_schedulable_work', topicId: 'other-task',
    }],
    ['a code without typed text', {
      kind: 'missing' as const, targetSlot: 'stable_v5:some_future_code', topicId: 'task-1',
    }],
  ])('fails closed for %s: no question text, no presentation binding', (_name, context) => {
    const output = recover(stateWith(context, { learningStrategyProposalRecords: [proposal] }));
    expect(output.message).not.toContain(SHOWN_AI_TEXT);
    expect(output.interactionOutcome).toMatchObject({ kind: 'recover', representedQuestion: false });
    expect(output.questionPresentationContent).toBeUndefined();
  });

  it('never re-presents or rebinds a question whose presentation was not fresh', () => {
    const graph = graphWithWorkloadlessTask();
    const output = createWeeklyPlanningConversationRecoveryOutput({
      failure: 'semantic',
      previousState: stateWith({ kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'wl-1' }),
      userText: 'うん',
      graph,
      pendingQuestionPresentation: { status: 'unbound' },
    });
    expect(output.interactionOutcome).toMatchObject({ representedQuestion: false });
    expect(output.questionPresentationContent).toBeUndefined();
    expect(output.message).not.toContain('どれくらい時間');
  });
});
