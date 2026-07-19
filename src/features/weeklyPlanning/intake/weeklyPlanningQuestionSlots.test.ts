import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
import type {
  PlanningIntakeMissing,
  PlanningIntakeState,
} from './weeklyPlanningIntakeTypes';
import {
  deterministicQuestionsForState,
  QUESTION_PLAN_SLOT_ORDER,
  QUESTION_SLOT_DEFINITION_BY_MISSING,
  statusForMissing,
  vocabularyHintForSlot,
} from './weeklyPlanningQuestionSlots';

const ALL_MISSING_SLOTS: PlanningIntakeMissing[] = [
  'planning_period',
  'planning_start_date',
  'planning_duration',
  'tasks_or_goals',
  'fixed_events',
  'sleep_cycle',
  'meal_bath_constraints',
  'year_range',
  'progress',
  'completion_direction',
  'unit_duration_estimate',
  'priority_policy',
  'next_field_after_math',
  'life_constraints',
];

describe('weekly planning question slot registry', () => {
  it('covers every PlanningIntakeMissing slot with the required question metadata', () => {
    expect(Object.keys(QUESTION_SLOT_DEFINITION_BY_MISSING).sort()).toEqual(
      [...ALL_MISSING_SLOTS].sort(),
    );

    for (const slot of ALL_MISSING_SLOTS) {
      const definition = QUESTION_SLOT_DEFINITION_BY_MISSING[slot];

      expect(definition.missing).toContain(slot);
      expect(definition.targetSlot).not.toBe('');
      expect(definition.intent).not.toBe('');
      expect(definition.kind).not.toBe('');
      expect('status' in definition).toBe(true);
      expect(definition.termExplanation).not.toBe('');
      expect(definition.vocabularyHint).not.toBe('');
      expect(definition.userLabel).not.toBe('');
      expect(definition.fallbackQuestion({})).not.toBe('');
    }
  });

  it('keeps status priority separate from question-plan order', () => {
    expect(statusForMissing(['year_range', 'completion_direction'])).toBe(
      'needs_progress_clarification',
    );
    expect(QUESTION_PLAN_SLOT_ORDER.map((definition) => definition.targetSlot)).toEqual([
      'planning_period',
      'planning_start_date',
      'planning_duration',
      'tasks_or_goals',
      'year_range',
      'completion_direction',
      'progress',
      'unit_rate',
      'priority_policy',
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
      'life_constraints',
    ]);
  });

  it('keeps dynamic deterministic missing-question text in the registry', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      missing: ['planning_start_date', 'priority_policy'] as PlanningIntakeMissing[],
      pendingPlanningRange: {
        durationDays: 7,
        sourceText: '来週',
        scope: {
          kind: 'next_week',
          label: '来週',
          windowStartDate: '2026-07-13',
          windowEndDate: '2026-07-19',
        },
      },
    };

    expect(deterministicQuestionsForState(state)).toEqual([
      '来週の計画は、いつから始めますか？',
      '来週で優先する分野や進める順番を教えてください。',
    ]);
  });

  it('uses controlled vocabulary for target years and exam unit-rate questions', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      examPrepScope: {
        fields: ['OSnetwork'],
        unitModel: 'year_field_chunk',
        rawText: ['OSnetwork'],
      },
      missing: ['unit_duration_estimate'],
    };
    const yearRangeDefinition = QUESTION_SLOT_DEFINITION_BY_MISSING.year_range;
    const unitRateDefinition = QUESTION_SLOT_DEFINITION_BY_MISSING.unit_duration_estimate;

    expect(yearRangeDefinition.deterministicQuestion(state)).toBe(
      '対象年度は何年から何年までですか？',
    );
    expect(unitRateDefinition.deterministicQuestion(state)).toBe(
      '1年分・1分野あたりの目安時間を教えてください。',
    );
    expect(unitRateDefinition.fallbackQuestion({
      unitRateBasisLabel: '1年分・1分野あたり',
    })).toBe('1年分・1分野あたりの目安時間を教えてください。');
    expect(vocabularyHintForSlot('unit_rate', {
      unitRateBasisLabel: '1年分・1分野あたり',
    })).toBe('1年分・1分野あたりの目安時間');
  });

  it('classifies every missing slot for preview synthesis', () => {
    expect(
      Object.fromEntries(
        ALL_MISSING_SLOTS.map((slot) => [
          slot,
          QUESTION_SLOT_DEFINITION_BY_MISSING[slot].previewPolicy,
        ]),
      ),
    ).toEqual({
      planning_period: 'assumable',
      planning_start_date: 'assumable',
      planning_duration: 'assumable',
      tasks_or_goals: 'blocking',
      fixed_events: 'assumable',
      sleep_cycle: 'assumable',
      meal_bath_constraints: 'assumable',
      year_range: 'assumable',
      progress: 'deferrable',
      completion_direction: 'deferrable',
      unit_duration_estimate: 'assumable',
      priority_policy: 'assumable',
      next_field_after_math: 'assumable',
      life_constraints: 'assumable',
    });
  });

});
