import { describe, expect, it } from 'vitest';
import {
  composeWeeklyPlanningInteractionFallbackText,
  WEEKLY_PLANNING_INTERACTION_DUPLICATE_SUBMISSION_TEXT,
  WEEKLY_PLANNING_INTERACTION_UNEXPECTED_FAILURE_TEXT,
  weeklyPlanningInteractionProviderUnavailableText,
} from './weeklyPlanningInteractionFallbackText';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5CommunicationGoal,
} from './weeklyPlanningStableV5DialogueContracts';

/**
 * The interaction architecture's emergency wording (renderer unavailable or rejected). These
 * tests check its contract, not one sentence: every situation still tells the user what is
 * being asked, nothing exposes the app's internals, and a semantic failure never asks for a
 * resend.
 */
const INTERNAL_PROCESS_WORDING = /予定条件|安全に|反映していません|確認中の質問|保留中|構造化|正規化|処理|システム|validation|pending|provider|retry|state|AI/u;
const QUESTION = '数学の問題集は1問あたりどれくらい時間がかかりますか？';
const GOALS: WeeklyPlanningStableV5CommunicationGoal[] = [
  'ask_question', 'report_status', 'present_preview', 'explain_question', 'acknowledge_aside', 'resume_question', 'clarify_turn',
];

function context(goal: WeeklyPlanningStableV5CommunicationGoal, overrides: Partial<WeeklyPlanningStableV5CommunicationContext> = {}) {
  const asks = goal === 'ask_question' || goal === 'explain_question' || goal === 'resume_question' || goal === 'clarify_turn';
  return {
    goal,
    questionPurposes: asks ? ['estimate_time_to_fit_available_time'] : [],
    askQuestion: asks,
    laterNeeds: [],
    statusReason: goal === 'report_status' ? 'ready_to_create_preview' : null,
    planningDetailsNotApplied: false,
    consultationDeferred: false,
    previewDisclosure: null,
    ...overrides,
  } as WeeklyPlanningStableV5CommunicationContext;
}

function compose(communication: WeeklyPlanningStableV5CommunicationContext, extra: { questionCode?: string | null; applicationText?: string } = {}) {
  return composeWeeklyPlanningInteractionFallbackText({
    communication,
    questionText: communication.askQuestion ? QUESTION : '',
    questionCode: extra.questionCode ?? (communication.askQuestion ? 'missing_effort_estimate' : null),
    previewCount: 3,
    previewPromotionControlLabel: 'この内容で仮予定にする',
    groundingNote: '',
    applicationText: extra.applicationText ?? '',
  });
}

describe('interaction emergency wording', () => {
  it('never exposes internal vocabulary, for every goal and flag combination', () => {
    for (const goal of GOALS) {
      for (const planningDetailsNotApplied of [false, true]) {
        for (const consultationDeferred of [false, true]) {
          const text = compose(context(goal, {
            planningDetailsNotApplied,
            consultationDeferred,
            previewDisclosure: goal === 'present_preview' ? { omittedWorkLabels: ['英語'] } : null,
          }));
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toMatch(INTERNAL_PROCESS_WORDING);
        }
      }
    }
    for (const text of [
      weeklyPlanningInteractionProviderUnavailableText(null),
      weeklyPlanningInteractionProviderUnavailableText(QUESTION),
      WEEKLY_PLANNING_INTERACTION_DUPLICATE_SUBMISSION_TEXT,
      WEEKLY_PLANNING_INTERACTION_UNEXPECTED_FAILURE_TEXT,
    ]) expect(text).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('keeps the asked question for every question-carrying goal and drops it for an aside', () => {
    for (const goal of ['ask_question', 'explain_question', 'resume_question', 'clarify_turn'] as const) {
      expect(compose(context(goal))).toContain(QUESTION);
    }
    expect(compose(context('acknowledge_aside'))).not.toContain(QUESTION);
  });

  it('never asks for a resend after a semantic failure; a provider failure does', () => {
    expect(compose(context('clarify_turn'))).not.toMatch(/送って|送り直|言い換え/u);
    expect(compose(context('clarify_turn', { askQuestion: false, questionPurposes: [] }))).not.toMatch(/送って|送り直|言い換え/u);
    expect(weeklyPlanningInteractionProviderUnavailableText(null)).toMatch(/もう一度送って/u);
    expect(weeklyPlanningInteractionProviderUnavailableText(QUESTION)).toContain(QUESTION);
  });

  it('discloses every omitted work label and the preview control', () => {
    const text = compose(context('present_preview', { previewDisclosure: { omittedWorkLabels: ['英語', '物理'] } }));
    expect(text).toContain('3件');
    expect(text).toContain('この内容で仮予定にする');
    expect(text).toContain('英語');
    expect(text).toContain('物理');
  });

  it('says that advice is not answered and invites restating unapplied details', () => {
    const text = compose(context('explain_question', { consultationDeferred: true, planningDetailsNotApplied: true }));
    expect(text).toContain('ご相談');
    expect(text).toContain('もう一度教えて');
  });

  it('replaces the capacity-shortfall question with ordinary wording', () => {
    const text = compose(context('ask_question'), { questionCode: 'insufficient_capacity' });
    expect(text).toContain('入りきりませんでした');
    expect(text).not.toContain(QUESTION);
  });

  it('keeps the application message only for a status without a typed reason', () => {
    expect(compose(context('report_status', { statusReason: null }), { applicationText: '次の条件を確認します。' }))
      .toBe('次の条件を確認します。');
    expect(compose(context('report_status', { statusReason: 'preview_unchanged' }), { applicationText: 'ignored' }))
      .not.toContain('ignored');
  });
});
