import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';
import { createWeeklyPlanningDialogueMessage } from './weeklyPlanningDialogueMessages';

function decision(
  partial: Omit<WeeklyPlanningDialogueDecision, 'messageKey' | 'shouldSavePlan'>,
): WeeklyPlanningDialogueDecision {
  return {
    messageKey: partial.kind,
    shouldSavePlan: false,
    ...partial,
  };
}

describe('weekly planning dialogue messages', () => {
  it('renders missing-info prompts from questionPlan before legacy required fields', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'ask_missing_info',
      requiredFields: ['year_range', 'unit_rate'],
      questionPlan: [
        {
          kind: 'missing_life_constraint',
          targetSlot: 'fixed_events',
          missing: ['fixed_events'],
          intent: 'ask_fixed_events',
        },
        {
          kind: 'missing_life_constraint',
          targetSlot: 'sleep_cycle',
          missing: ['sleep_cycle'],
          intent: 'ask_life_constraints',
        },
      ],
      shouldCreateDraft: false,
    }));

    expect(message).toContain('固定予定');
    expect(message).toContain('睡眠時間');
    expect(message).not.toContain('対象年度');
    expect(message).not.toContain('目安時間');
  });

  it('keeps meal and bath constraints separate from broad life constraints in direct fallback', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'ask_missing_info',
      questionPlan: [
        {
          kind: 'missing_life_constraint',
          targetSlot: 'meal_bath_constraints',
          missing: ['meal_bath_constraints'],
          intent: 'ask_life_constraints',
        },
      ],
      shouldCreateDraft: false,
    }));

    expect(message).toContain('食事・風呂などの生活制約');
    expect(message).not.toContain('睡眠などの生活制約');
  });

  it('renders ambiguity confirmation messages', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'confirm_ambiguity',
      ambiguities: ['completed_years_without_field_scope'],
      shouldCreateDraft: false,
    }));

    expect(message).toContain('曖昧');
    expect(message).toContain('どの分野');
  });

  it('renders draft condition summaries without saving wording', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'confirm_draft_conditions',
      shouldCreateDraft: true,
      summary: {
        yearRange: { startYear: 2019, endYear: 2025, sourceText: '2019〜2025' },
        remainingWorkItemCount: 9,
        totalRequestedMinutes: 1080,
        fixedEventCount: 0,
      },
    }));

    expect(message).toContain('保存しません');
    expect(message).toContain('2019〜2025');
    expect(message).toContain('残り作業: 9件');
  });

  it('includes the up_to_reachable assumption note in the confirm_draft_conditions message', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'confirm_draft_conditions',
      shouldCreateDraft: true,
      summary: {
        yearRange: { startYear: 2019, endYear: 2025, sourceText: '2019〜2025' },
        remainingWorkItemCount: 9,
        assumptions: ['できるところまでを仮の completion target として扱います。'],
      },
    }));

    expect(message).toContain('保存しません');
    expect(message).toContain('仮の前提');
    expect(message).toContain('できるところまでを仮の completion target として扱います。');
  });

  it('omits the assumption note from confirm_draft_conditions when there are no assumptions', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'confirm_draft_conditions',
      shouldCreateDraft: true,
      summary: {
        yearRange: { startYear: 2019, endYear: 2025, sourceText: '2019〜2025' },
        remainingWorkItemCount: 9,
      },
    }));

    expect(message).not.toContain('仮の前提');
  });

  it('renders dry-run preview summaries', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'offer_dry_run_preview',
      shouldCreateDraft: true,
      summary: {
        remainingWorkItemCount: 9,
        totalRequestedMinutes: 1080,
        totalScheduledMinutes: 1080,
        unscheduledItemCount: 0,
      },
    }));

    expect(message).toContain('仮予定候補');
    expect(message).toContain('preview');
    expect(message).toContain('保存していません');
    expect(message).toContain('配置候補');
  });

  it('renders relax-constraints messages for unscheduled diagnostics', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'ask_relax_constraints',
      shouldCreateDraft: false,
      summary: {
        totalRequestedMinutes: 1080,
        totalScheduledMinutes: 120,
        unscheduledItemCount: 8,
      },
    }));

    expect(message).toContain('配置しきれません');
    expect(message).toContain('緩める');
  });

  it('renders cannot-create messages', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'cannot_create_draft',
      shouldCreateDraft: false,
    }));

    expect(message).toContain('作れません');
  });

  it('renders the open planning dialogue message without inventing a period', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'open_planning_dialogue',
      shouldCreateDraft: false,
    }));

    expect(message).toContain('どんな計画を作りたいか');
    expect(message).toContain('対象の期間');
    expect(message).not.toContain('整合性');
  });

  it('renders the non-exam capability gap with the supported exam shape', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'explain_capability_gap',
      shouldCreateDraft: false,
      summary: {
        fields: ['読書'],
      },
    }));

    expect(message).toContain('自動生成にはまだ対応していません');
    expect(message).toContain('年度×分野');
    expect(message).not.toContain('整合性が取れず');
  });

  it('uses a user-facing label for planning_start_date clarification questions', () => {
    const message = createWeeklyPlanningDialogueMessage(decision({
      kind: 'answer_clarification',
      questionPlan: [{
        kind: 'missing_slot',
        targetSlot: 'planning_start_date',
        missing: ['planning_start_date'],
        intent: 'ask_planning_start_date',
      }],
      shouldCreateDraft: false,
    }));

    expect(message).toContain('計画の開始日');
    expect(message).not.toContain('planning_start_date');
  });

  it('distinguishes structured preview assumptions and invites one follow-up correction', () => {
    const message = createWeeklyPlanningDialogueMessage({
      kind: 'offer_dry_run_preview',
      messageKey: 'offer_weekly_plan_dry_run_preview',
      questionPlan: [{
        kind: 'missing_slot',
        targetSlot: 'unit_rate',
        missing: ['unit_duration_estimate'],
        intent: 'ask_unit_rate',
      }],
      summary: {
        previewAssumptions: [
          {
            slot: 'unit_duration_estimate',
            source: 'default',
            description: '1年分・1分野あたり120分として仮置きします。',
          },
          {
            slot: 'year_range',
            source: 'derived',
            description: '対象年度は2020年から2026年までとして扱います。',
          },
        ],
      },
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });

    expect(message).toContain('未保存preview');
    expect(message).toContain('仮定: 1年分・1分野あたり120分として仮置きします。 ほか1件');
    expect(message).toContain('目安時間');
    expect(message).toContain('多すぎる・少なすぎる・曜日や配分を変えたい場合は教えてください。');
  });

});