import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate } from './weeklyPlanningInterpreterTypes';

function target(field: string, count: number, confidence: 'high' | 'medium' = 'high'):
  InterpretedCommandCandidate {
  const command: ParsedWeeklyPlanningCommand = {
    type: 'mark_completion_target',
    field,
    target: { kind: 'latest_n_years', count, rawText: field + count },
    sourceText: field + count,
    confidence,
  };
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: confidence === 'medium',
  };
}

describe('per-field progress validation', () => {
  it('accepts independent workload targets for different fields', () => {
    const result = validateInterpretedCandidates(
      [target('OS', 1), target('ネットワーク', 1), target('ヒューマンサイエンス', 2)],
      { knownFields: ['OS', 'ネットワーク', 'ヒューマンサイエンス'], confirmedSlots: [] },
    );

    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });

  it('keeps conflict arbitration local to the same field', () => {
    const result = validateInterpretedCandidates(
      [target('OS', 2, 'medium'), target('ネットワーク', 1), target('OS', 1)],
      { knownFields: ['OS', 'ネットワーク'], confirmedSlots: [] },
    );

    expect(result.accepted).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'OS' }),
      expect.objectContaining({ field: 'ネットワーク' }),
    ]));
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'conflicting-slot-lower-confidence' }),
    ]);
  });

  it('blocks only the field whose progress target is already confirmed', () => {
    const result = validateInterpretedCandidates(
      [target('OS', 1), target('ネットワーク', 1)],
      {
        knownFields: ['OS', 'ネットワーク'],
        confirmedSlots: ['progress:OS'],
      },
    );

    expect(result.accepted).toEqual([
      expect.objectContaining({ field: 'ネットワーク' }),
    ]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
  });
});
