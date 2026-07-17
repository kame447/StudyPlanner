import { describe, expect, it } from 'vitest';
import { finalizeState } from './weeklyPlanningMissingStatus';
import type { PlanningIntakeState } from './weeklyPlanningIntakeTypes';

function stateWithFields(fields: string[], totalFields = fields.length): PlanningIntakeState {
  return {
    status: 'needs_priority_policy',
    intent: 'exam_prep_planning',
    examPrepScope: {
      examType: '院試',
      fields,
      totalFields,
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
  it('selects the only confirmed field without asking a priority question', () => {
    const state = finalizeState(stateWithFields(['OSnetwork']));
    expect(state.priorityPolicy).toEqual({ kind: 'field_first', order: ['OSnetwork'] });
    expect(state.priorityPolicySource).toBe('derived_single_field');
    expect(state.missing).not.toContain('priority_policy');
    expect(state.missing).not.toContain('next_field_after_math');
    expect(state.questions.join(' ')).not.toContain('優先');
  });

  it('does not derive a single-field priority while totalFields says another field remains', () => {
    const state = finalizeState(stateWithFields(['数学'], 2));
    expect(state.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(state.priorityPolicySource).toBeUndefined();
    expect(state.missing).toContain('priority_policy');
  });

  it('keeps priority confirmation for multiple fields', () => {
    const state = finalizeState(stateWithFields(['数学', '英語']));
    expect(state.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(state.missing).toContain('priority_policy');
    expect(state.questions.join(' ')).toContain('優先');
  });

  it('reopens priority when a derived single-field policy later becomes multi-field', () => {
    const single = finalizeState(stateWithFields(['数学']));
    expect(single.priorityPolicy).toEqual({ kind: 'field_first', order: ['数学'] });

    const multi = finalizeState({
      ...single,
      examPrepScope: {
        ...single.examPrepScope!,
        fields: ['数学', '英語'],
        totalFields: 2,
      },
    });

    expect(multi.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(multi.priorityPolicySource).toBeUndefined();
    expect(multi.missing).toContain('priority_policy');
  });
});
