import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import { applyWeeklyPlanningCommands, createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
import { finalizeState } from './weeklyPlanningMissingStatus';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from './weeklyPlanningInterpreterTypes';

function candidate(command: unknown): InterpretedCommandCandidate {
  return { command: command as never, origin: 'ai_interpreter', needsConfirmation: false };
}

const baseSummary: InterpreterStateSummary = { knownFields: [], confirmedSlots: [] };

describe('weekly planning review core fixes', () => {
  it('rejects duplicate exam fields instead of dropping a confirmed field', () => {
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: { fields: ['数学', '数学'], yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' }, rawText: ['数学'] },
      sourceText: '数学',
      confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: ['数学', '英語'],
      confirmedSlots: ['exam_scope'],
      examScopeSummary: { fields: ['数学', '英語'], rawText: ['数学と英語'] },
    });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('invalid-command-shape');
  });

  it('preserves every confirmed exam scope attribute while enriching a missing year range', () => {
    const existing = {
      examType: '院試', fields: ['数学', '英語'], totalFields: 2, totalYears: 6,
      strategyHint: 'field_first' as const, unitModel: 'year_field_chunk' as const,
      unitCountHint: 12, rawText: ['既存'],
    };
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: {
        examType: '院試', fields: ['英語', '数学'], totalFields: 2, totalYears: 6,
        yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' },
        strategyHint: 'field_first', unitModel: 'year_field_chunk', unitCountHint: 12, rawText: ['追加'],
      },
      sourceText: '2025〜2020', confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: existing.fields,
      confirmedSlots: ['exam_scope'],
      examScopeSummary: existing,
    });
    expect(result.rejected).toEqual([]);
    const command = result.accepted[0];
    expect(command?.type).toBe('set_exam_scope');
    if (command?.type !== 'set_exam_scope') throw new Error('missing command');
    expect(command.scope).toMatchObject({
      ...existing,
      rawText: ['既存', '追加'],
      yearRange: { startYear: 2025, endYear: 2020 },
    });
    const state = applyWeeklyPlanningCommands({ ...createInitialPlanningIntakeState(), examPrepScope: existing }, [command]);
    expect(state.examPrepScope).toMatchObject({
      ...existing,
      rawText: ['既存', '追加'],
      yearRange: { startYear: 2025, endYear: 2020 },
    });
  });

  it('rejects conflicting confirmed exam attributes', () => {
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: { examType: '別試験', fields: ['数学'], rawText: ['変更'] },
      sourceText: '変更', confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: ['数学'], confirmedSlots: ['exam_scope'],
      examScopeSummary: { examType: '院試', fields: ['数学'], rawText: ['既存'] },
    });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('confirmed-slot-overwrite');
  });

  it.each([
    { type: 'set_priority_policy', policy: { kind: 'field_first' }, sourceText: '数学優先', confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: [null] }, sourceText: '数学優先', confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: null, confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: '数学優先', confidence: null },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: '数学優先' },
  ])('rejects malformed required command fields %#', (command) => {
    const result = validateInterpretedCandidates([candidate(command)], { ...baseSummary, knownFields: ['数学'] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('invalid-command-shape');
  });

  it('does not auto-confirm priority when totalFields says more fields remain', () => {
    const state = finalizeState({
      ...createInitialPlanningIntakeState(),
      examPrepScope: { fields: ['数学'], totalFields: 2, rawText: ['数学ほか'] },
      unitRates: [{ unit: 'year_field_chunk', minutesPerUnit: 60, source: 'user' }],
      missing: [],
    });
    expect(state.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(state.missing).toContain('priority_policy');
  });

  it('reopens priority when a derived single-field policy later becomes multi-field', () => {
    const single = finalizeState({
      ...createInitialPlanningIntakeState(),
      examPrepScope: { fields: ['数学'], totalFields: 1, rawText: ['数学'] },
      unitRates: [{ unit: 'year_field_chunk', minutesPerUnit: 60, source: 'user' }],
      missing: [],
    });
    const multi = finalizeState({
      ...single,
      examPrepScope: { ...single.examPrepScope!, fields: ['数学', '英語'], totalFields: 2 },
    });
    expect(multi.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(multi.missing).toContain('priority_policy');
  });
});
