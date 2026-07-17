import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import { applyWeeklyPlanningCommands, createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from './weeklyPlanningInterpreterTypes';

function candidate(command: unknown): InterpretedCommandCandidate {
  return { command: command as never, origin: 'ai_interpreter', needsConfirmation: false };
}

const baseSummary: InterpreterStateSummary = { knownFields: [], confirmedSlots: [] };

describe('weekly planning review core fixes', () => {
  it('applies safe scope enrichment end to end without losing confirmed attributes', () => {
    const existing = {
      examType: '院試',
      fields: ['数学', '英語'],
      totalFields: 2,
      totalYears: 6,
      strategyHint: 'field_first' as const,
      unitModel: 'year_field_chunk' as const,
      unitCountHint: 12,
      rawText: ['既存'],
    };
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: {
        ...existing,
        fields: ['英語', '数学'],
        yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' },
        rawText: ['追加'],
      },
      sourceText: '2025〜2020',
      confidence: 'high',
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

    const state = applyWeeklyPlanningCommands({
      ...createInitialPlanningIntakeState(),
      examPrepScope: existing,
    }, [command]);
    expect(state.examPrepScope).toMatchObject({
      ...existing,
      rawText: ['既存', '追加'],
      yearRange: { startYear: 2025, endYear: 2020 },
    });
  });
});
