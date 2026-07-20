import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from '../intake/weeklyPlanningInterpreterTypes';

function candidate(
  command: InterpretedCommandCandidate['command'],
  sourceUserText: string,
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
    sourceUserText,
  };
}

function summary(overrides: Partial<InterpreterStateSummary> = {}): InterpreterStateSummary {
  return {
    knownFields: [],
    confirmedSlots: [],
    ...overrides,
  };
}

describe('weekly planning final-audit candidate hardening', () => {
  it('turns a bare meal/bath time into a targeted clarification instead of dropping it', () => {
    const userText = '19時です';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'update_life_constraint',
        kind: 'meal',
        constraint: { start: '19:00', hardness: 'hard' },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary({
      lastQuestions: [{ slotKey: 'meal_bath_constraints', intent: 'ask_life_constraints' }],
    }));

    expect(result.accepted).toEqual([]);
    expect(result.clarificationRequests).toEqual([
      expect.objectContaining({
        type: 'request_clarification',
        target: 'unresolved_slot',
        ref: 'meal_bath_constraints',
      }),
    ]);
  });

  it('still accepts a meal time when the user identifies the constraint kind', () => {
    const userText = '夕食は19時です';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'update_life_constraint',
        kind: 'meal',
        constraint: { start: '19:00', hardness: 'hard' },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary());

    expect(result.accepted).toHaveLength(1);
    expect(result.clarificationRequests).toEqual([]);
  });

  it.each([3, 180])('does not ground bare unit-rate reply 3 as %i minutes', (minutesPerUnit) => {
    const userText = '3';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit,
          source: 'user',
        },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary({
      examScopeSummary: {
        fields: ['OS'],
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問 OS'],
      },
      lastQuestions: [{ slotKey: 'unit_rate', intent: 'ask_unit_rate' }],
    }));

    expect(result.accepted).toEqual([]);
    expect(result.clarificationRequests).toEqual([
      expect.objectContaining({ ref: 'unit_duration_estimate' }),
    ]);
  });

  it.each([
    ['partial order', ['OS']],
    ['tail permutation', ['OS', 'データベース', 'ネットワーク']],
  ])('rejects %s for an explicitly complete priority statement', (_label, order) => {
    const userText = 'OSから進め、次にネットワーク、最後にデータベースです';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary({ knownFields: ['OS', 'ネットワーク', 'データベース'] }));

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('accepts the complete priority order stated by the user', () => {
    const userText = 'OSから進め、次にネットワーク、最後にデータベースです';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['OS', 'ネットワーク', 'データベース'] },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary({ knownFields: ['OS', 'ネットワーク', 'データベース'] }));

    expect(result.accepted).toHaveLength(1);
  });

  it('removes inconsistent rawText before an accepted unit rate reaches state and renderer', () => {
    const userText = '3時間です';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 180,
          source: 'user',
          rawText: '30分',
        },
        confidence: 'high',
        sourceText: userText,
      }, userText),
    ], summary({
      examScopeSummary: {
        fields: ['OS'],
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問 OS'],
      },
      lastQuestions: [{ slotKey: 'unit_rate', intent: 'ask_unit_rate' }],
    }));

    expect(result.accepted).toEqual([
      expect.objectContaining({
        type: 'set_unit_rate',
        unitRate: expect.objectContaining({
          minutesPerUnit: 180,
          rawText: undefined,
        }),
      }),
    ]);
  });
});
