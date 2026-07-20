import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate } from '../intake/weeklyPlanningInterpreterTypes';

function sleepCandidate(
  userText: string,
  start: string,
  end: string,
): InterpretedCommandCandidate {
  return {
    command: {
      type: 'update_life_constraint',
      kind: 'sleep',
      constraint: {
        start,
        end,
        hardness: 'hard',
      },
      sourceText: userText,
      confidence: 'high',
    },
    origin: 'ai_interpreter',
    needsConfirmation: false,
    sourceUserText: userText,
  };
}

const EMPTY_SUMMARY = {
  knownFields: [],
  confirmedSlots: [],
};

describe('weekly planning life-constraint grounding audit regressions', () => {
  it('keeps the valid Japanese hour-only range grounded as exact whole hours', () => {
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

  it('accepts explicitly written zero minutes as the exact whole-hour range', () => {
const result = validateInterpretedCandidates([
  sleepCandidate('23時00分から7時00分まで寝ます', '23:00', '07:00'),
], EMPTY_SUMMARY);

expect(result.accepted).toHaveLength(1);
expect(result.rejected).toEqual([]);
        });


  it.each([
    ['swapped endpoints', '23時から7時まで寝ます', '07:00', '23:00'],
    ['invented minutes', '23時から7時まで寝ます', '23:30', '07:45'],
    ['discarded explicit minutes', '23時30分から7時まで寝ます', '23:00', '07:00'],
    [
      'times taken from another life-constraint clause',
      '睡眠は23時から7時、夕食は19時から20時です',
      '19:00',
      '20:00',
    ],
  ])('rejects %s', (_label, userText, start, end) => {
    const result = validateInterpretedCandidates([
      sleepCandidate(userText, start, end),
    ], EMPTY_SUMMARY);

    expect(result.accepted).toEqual([]);
    expect(result.acceptedWithConfirmation).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });
});
