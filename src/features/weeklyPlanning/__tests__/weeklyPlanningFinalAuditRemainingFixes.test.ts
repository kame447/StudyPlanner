import { describe, expect, it } from 'vitest';
import {
  createMissingQuestionPlan,
  createWeeklyPlanningClarificationDecision,
} from '../dialogue/weeklyPlanningDialogueManager';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeMissing } from '../intake/weeklyPlanningIntakeTypes';
import { parseSetExamScopeCommand } from '../intake/weeklyPlanningScopeParsing';

describe('weekly planning remaining final-audit fixes', () => {
  it('renders at most one missing question so persisted context is complete', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      missing: ['fixed_events', 'sleep_cycle'] as PlanningIntakeMissing[],
    };

    expect(createMissingQuestionPlan(state)).toHaveLength(1);
  });

  it('explains why a bare meal/bath time needs a targeted repair', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      missing: ['meal_bath_constraints'] as PlanningIntakeMissing[],
    };
    const decision = createWeeklyPlanningClarificationDecision({
      state,
      target: 'unresolved_slot',
      ref: 'meal_bath_constraints',
      previousQuestionContext: {
        kind: 'missing',
        targetSlot: 'meal_bath_constraints',
        intent: 'ask_life_constraints',
      },
    });

    expect(decision.clarification?.explanation).toContain('食事かお風呂か');
    expect(decision.clarification?.explanation).toContain('食事の開始');
  });

  it('does not classify a generic subject count as an entrance-exam scope', () => {
    expect(parseSetExamScopeCommand(
      '来週は数学を1科目勉強する計画を立てたいです',
      undefined,
    )).toBeUndefined();
  });

  it('still accepts subject counts with explicit or existing exam context', () => {
    expect(parseSetExamScopeCommand(
      '院試の過去問は数学を1科目進めたいです',
      undefined,
    )).toBeDefined();
    expect(parseSetExamScopeCommand(
      '1科目です',
      {
        examType: '院試',
        fields: ['OS'],
        totalFields: 1,
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問はOSです'],
      },
    )).toBeDefined();
  });
});
