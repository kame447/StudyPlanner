import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from '../intake/weeklyPlanningInterpreterTypes';

function candidate(
  command: InterpretedCommandCandidate['command'],
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

function summary(overrides: Partial<InterpreterStateSummary> = {}): InterpreterStateSummary {
  return {
    knownFields: [],
    confirmedSlots: [],
    ...overrides,
  };
}

describe('weekly planning typed candidate hardening', () => {
  it('accepts a structurally valid life constraint without reparsing sourceText', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'update_life_constraint',
        kind: 'meal',
        constraint: { start: '19:00', hardness: 'hard' },
        confidence: 'high',
        sourceText: '19時です',
      }),
    ], summary());

    expect(result.accepted).toEqual([
      expect.objectContaining({ type: 'update_life_constraint', kind: 'meal' }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('accepts a positive typed unit rate independently of its display evidence', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 180,
          source: 'user',
          rawText: '3です',
        },
        confidence: 'high',
        sourceText: '3です',
      }),
    ], summary());

    expect(result.accepted).toEqual([
      expect.objectContaining({
        type: 'set_unit_rate',
        unitRate: expect.objectContaining({ minutesPerUnit: 180, rawText: '3です' }),
      }),
    ]);
  });

  it('rejects a non-positive typed unit rate by value range', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_unit_rate',
        unitRate: { unit: 'year_field_chunk', minutesPerUnit: 0, source: 'user' },
        confidence: 'high',
        sourceText: '0分です',
      }),
    ], summary());

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-unit-rate-minutes' }),
    ]);
  });

  it('accepts a complete typed priority order for known fields', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['OS', 'ネットワーク', '数学'] },
        confidence: 'high',
        sourceText: '優先順を指定しました',
      }),
    ], summary({ knownFields: ['OS', 'ネットワーク', '数学'] }));

    expect(result.accepted).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
  });

  it('requires confirmation when a typed priority policy references an unknown field', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['数学', 'OS'] },
        confidence: 'high',
        sourceText: '優先順を指定しました',
      }),
    ], summary({ knownFields: ['OS', 'ネットワーク'] }));

    expect(result.accepted).toEqual([]);
    expect(result.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
  });

  it('rejects a relative constraint whose typed anchor reference is unavailable', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'add_relative_constraint',
        anchorRef: 'constraint:missing',
        relation: 'after',
        offsetMinutes: 0,
        durationMinutes: 10,
        kind: 'commute',
        confidence: 'high',
        sourceText: '移動時間を追加',
      }),
    ], summary({ constraintAnchors: [] }));

    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'relative-constraint-anchor-unavailable' }),
    ]);
  });

  it('rejects invalid calendar values without consulting sourceText', () => {
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_study_goal',
        goal: {
          title: '小テスト対策',
          deadlineDeclared: true,
          deadlineDate: '2026-02-30',
        },
        confidence: 'high',
        sourceText: '期限を設定',
      }),
    ], summary());

    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-deadline-date' }),
    ]);
  });
});
