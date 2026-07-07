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
});