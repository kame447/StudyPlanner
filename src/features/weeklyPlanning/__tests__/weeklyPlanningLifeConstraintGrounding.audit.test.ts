import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate } from '../intake/weeklyPlanningInterpreterTypes';

function sleepCandidate(
  sourceText: string,
  start: string,
  end: string,
): InterpretedCommandCandidate {
  return {
    command: {
      type: 'update_life_constraint',
      kind: 'sleep',
      constraint: { start, end, hardness: 'hard' },
      sourceText,
      confidence: 'high',
    },
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

const EMPTY_SUMMARY = { knownFields: [], confirmedSlots: [] };

describe('weekly planning typed life-constraint validation boundary', () => {
  it('accepts a structurally valid typed life constraint', () => {
    const result = validateInterpretedCandidates([
      sleepCandidate('23時から7時まで寝ます', '23:00', '07:00'),
    ], EMPTY_SUMMARY);

    expect(result.accepted).toEqual([
      expect.objectContaining({
        type: 'update_life_constraint',
        kind: 'sleep',
        constraint: expect.objectContaining({ start: '23:00', end: '07:00' }),
      }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('does not reinterpret source text to rewrite or reject typed times', () => {
    const command = sleepCandidate(
      '睡眠は23時から7時、夕食は19時から20時です',
      '19:00',
      '20:00',
    );
    const result = validateInterpretedCandidates([command], EMPTY_SUMMARY);

    expect(result.accepted).toEqual([command.command]);
    expect(result.rejected).toEqual([]);
  });

  it('still rejects structurally invalid clock values', () => {
    const result = validateInterpretedCandidates([
      sleepCandidate('睡眠時間', '25:00', '07:00'),
    ], EMPTY_SUMMARY);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-time' }),
    ]);
  });
});
