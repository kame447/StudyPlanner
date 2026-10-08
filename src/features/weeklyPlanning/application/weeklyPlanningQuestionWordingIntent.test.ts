import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningStableQuestionV5 } from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import { scheduleCommunicationIntent, isExistingScheduleQuestion } from './weeklyPlanningFixedEventOnlyInteraction';
import { stableV5MissingSchedulableWorkQuestion, stableV5ScheduleQuestionText, typedStableV5RuntimeQuestionText } from './weeklyPlanningStableV5RuntimeQuestions';

const source = { conversationId: 'wording', turnId: 'turn', semanticLocalId: 'task', sourceText: 'synthetic', origin: 'user' as const };
const jargon = /作業|学習タスク|タスク|schedulable_work|task identity/u;

function graph(category?: 'study' | 'non_study', complete = false) {
  const value = createEmptyWeeklyPlanningFactGraphV5();
  if (!category) return value;
  value.tasks.push({ id: 'task', title: category === 'study' ? '数学' : '部活', category, source, createdRevision: 1 });
  // A target prevents a missing-progress question; complete state instead carries total/done.
  for (const role of complete ? ['scope_total', 'completed'] as const : ['target'] as const) {
    value.workloads.push({ id: role, taskId: 'task', componentId: null, quantityRole: role,
      amount: 10, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1 });
  }
  value.factLifecycles = [...value.tasks, ...value.workloads].map(fact => ({ factId: fact.id, status: 'active' as const,
    createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  return value;
}

describe('question wording from typed planning state', () => {
  it.each([
    [undefined, 'clarify_schedule_request'],
    ['study', 'identify_study_work'],
    ['non_study', 'register_event'],
  ] as const)('chooses the optional invitation for category %s', (category, purpose) => {
    const state = graph(category);
    expect(scheduleCommunicationIntent(createWeeklyPlanningActiveSchedulerGraphViewV5(state))).toBe(purpose);
    const question = stableV5MissingSchedulableWorkQuestion(state, 'interaction_v1');
    expect(question).toMatchObject({ intent: 'missing_task_identity', targetFactId: null });
    expect(question.message).toBe(stableV5ScheduleQuestionText(purpose));
    expect(question.message).not.toMatch(jargon);
  });

  it('requires active study evidence; a removed study task cannot choose the study category', () => {
    const state = graph('study');
    state.factLifecycles[0] = { ...state.factLifecycles[0], status: 'removed', terminalRevision: 2 };
    expect(scheduleCommunicationIntent(createWeeklyPlanningActiveSchedulerGraphViewV5(state))).toBe('clarify_schedule_request');
    expect(stableV5MissingSchedulableWorkQuestion(state).message).not.toContain('勉強');
  });

  it('preserves the existing progress target for study and non-study content', () => {
    for (const category of ['study', 'non_study'] as const) {
      const state = graph(category);
      state.workloads = [];
      const question = stableV5MissingSchedulableWorkQuestion(state, 'interaction_v1');
      expect(question).toMatchObject({ intent: 'existing_target_progress', targetFactId: 'task' });
      expect(question.message).toContain(state.tasks[0].title);
      expect(question.message).not.toMatch(jargon);
    }
  });

  it.each(['study', 'non_study'] as const)('acknowledges completed %s content without asking progress again', category => {
    const question = stableV5MissingSchedulableWorkQuestion(graph(category, true), 'interaction_v1');
    expect(question).toMatchObject({ intent: 'all_requested_work_complete', targetFactId: null });
    expect(question.message).toContain('終わっています');
    expect(question.message).not.toMatch(/今どこまで|何%|作業|学習タスク/u);
    expect(question.message.includes('勉強')).toBe(category === 'study');
  });

  it.each(['missing_commitment_date_scope', 'invalid_commitment_interval', 'constraint_source_unavailable', 'active_constraint_source_missing'] as const)
    ('keeps required existing-schedule detail %s', code => {
      const state = graph('non_study');
      const question: WeeklyPlanningStableQuestionV5 = { domain: 'work_item', code, factId: 'target', details: {} };
      expect(isExistingScheduleQuestion(code)).toBe(true);
      const text = typedStableV5RuntimeQuestionText(state, question, 'interaction_v1')!;
      expect(text).not.toMatch(jargon);
      expect(text).not.toContain('勉強');
      expect(text).not.toBe(stableV5ScheduleQuestionText('confirm_existing_schedule'));
    });

  it('uses an ordinary fallback label and relation question in interaction only', () => {
    const state = graph();
    state.uncertainties = [{ id: 'uncertain', targetFactId: 'missing', field: 'work_breakdown', reason: 'synthetic', source, createdRevision: 1 }];
    const question: WeeklyPlanningStableQuestionV5 = { domain: 'work_item', code: 'semantic_uncertainty', factId: 'uncertain', details: {} };
    expect(typedStableV5RuntimeQuestionText(state, question, 'interaction_v1')).not.toMatch(jargon);
    expect(typedStableV5RuntimeQuestionText(state, question, 'legacy_v5')).toContain('この作業');
    question.code = 'orphan_relation_task';
    expect(typedStableV5RuntimeQuestionText(state, question, 'interaction_v1')).not.toContain('タスク');
    expect(typedStableV5RuntimeQuestionText(state, question, 'legacy_v5')).toContain('タスク');
  });

  it('retains historical missing-work text for explicitly pinned legacy', () => {
    expect(stableV5MissingSchedulableWorkQuestion(graph(), 'legacy_v5').message).toContain('予定に入れる作業がまだありません');
    expect(stableV5MissingSchedulableWorkQuestion(graph('study', true), 'legacy_v5').message).toContain('指定された作業は完了済み');
  });
});
