import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from './weeklyPlanningInterpreterTypes';

function candidate(command: ParsedWeeklyPlanningCommand): InterpretedCommandCandidate {
  return { command, origin: 'ai_interpreter', needsConfirmation: false };
}

const scopeCommand: ParsedWeeklyPlanningCommand = {
  type: 'set_exam_scope',
  scope: {
    examType: '院試',
    fields: ['OSnetwork'],
    totalFields: 1,
    totalYears: 7,
    yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025~2019' },
    unitModel: 'year_field_chunk',
    rawText: ['OSnetwork 2025~2019'],
  },
  sourceText: 'OSnetworkが2025~2019の7年分ある',
  confidence: 'high',
};

describe('weekly planning exam scope enrichment', () => {
  it('accepts fields that enrich a deterministic year-only scope', () => {
    const summary: InterpreterStateSummary = {
      knownFields: [],
      examScopeSummary: {
        fields: [],
        yearRange: { startYear: 2025, endYear: 2019 },
      },
      confirmedSlots: ['year_range'],
    };

    const result = validateInterpretedCandidates([candidate(scopeCommand)], summary);
    expect(result.accepted).toEqual([scopeCommand]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a candidate that changes confirmed fields while adding a year range', () => {
    const command = {
      ...scopeCommand,
      scope: { ...scopeCommand.scope, fields: ['英語'] },
    } satisfies ParsedWeeklyPlanningCommand;
    const summary: InterpreterStateSummary = {
      knownFields: ['OSnetwork'],
      examScopeSummary: { fields: ['OSnetwork'] },
      confirmedSlots: ['exam_scope'],
    };

    const result = validateInterpretedCandidates([candidate(command)], summary);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
  });
});
