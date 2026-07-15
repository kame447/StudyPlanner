import { describe, expect, it } from 'vitest';
import { finalizeState } from './weeklyPlanningMissingStatus';
import type { PlanningIntakeState } from './weeklyPlanningIntakeTypes';

function stateWithFields(fields: string[]): PlanningIntakeState {
  return {
    status: 'needs_priority_policy',
    intent: 'exam_prep_planning',
    examPrepScope: {
      examType: '院試',
      fields,
      yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025~2019' },
      unitModel: 'year_field_chunk',
      rawText: ['scope'],
    },
    tasks: [],
    progress: [],
    unitRates: [{
      unit: 'year_field_chunk',
      minutesPerUnit: 180,
      source: 'user',
      rawText: '3時間',
    }],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: [],
  };
}

describe('weekly planning single-field priority', () => {
  it('selects the only field without asking a priority question', () => {
    const state = finalizeState(stateWithFields(['OSnetwork']));
    expect(state.priorityPolicy).toEqual({ kind: 'field_first', order: ['OSnetwork'] });
    expect(state.missing).not.toContain('priority_policy');
    expect(state.missing).not.toContain('next_field_after_math');
    expect(state.questions.join(' ')).not.toContain('優先');
  });

  it('keeps priority confirmation for multiple fields', () => {
    const state = finalizeState(stateWithFields(['数学', '英語']));
    expect(state.missing).toContain('priority_policy');
    expect(state.questions.join(' ')).toContain('優先');
  });
});
