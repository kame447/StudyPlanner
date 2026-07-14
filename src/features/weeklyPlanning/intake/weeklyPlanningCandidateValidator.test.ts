import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import {
  validateInterpretedCandidates,
} from './weeklyPlanningCandidateValidator';
import type {
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from './weeklyPlanningInterpreterTypes';

const PROPERTY_SEED = 20260714;
const PROPERTY_RUNS = 60;

function candidate(
  command: ParsedWeeklyPlanningCommand,
  needsConfirmation = false,
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation,
  };
}

function baseSummary(): InterpreterStateSummary {
  return {
    knownFields: ['数学', '英語'],
    confirmedSlots: [],
  };
}

function studyGoalCandidate(params: {
  title: string;
  subject: string;
  confidence: 'high' | 'medium';
}): InterpretedCommandCandidate {
  return candidate({
    type: 'set_study_goal',
    goal: { title: params.title, subject: params.subject },
    sourceText: params.subject,
    confidence: params.confidence,
  }, params.confidence === 'medium');
}

const goalTitleArbitrary = fc
  .array(fc.constantFrom('数', '学', '英', '語', 'A', '1'), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join(''));

const distinctGoalTitlesArbitrary = fc.uniqueArray(goalTitleArbitrary, {
  minLength: 2,
  maxLength: 2,
  selector: (title) => title.trim().normalize('NFKC').replace(/\s+/gu, ' '),
});

function fullWidthAscii(value: string): string {
  return value.replace(/[A-Z0-9]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0xfee0));
}

describe('weekly planning candidate validator contract', () => {
  it.each([
    ['missing title', { goal: {} }, 'invalid-command-shape'],
    ['empty title', { goal: { title: '   ' } }, 'invalid-command-shape'],
    ['invalid unit', { goal: { title: 'dollars', unit: 'dollars' } }, 'invalid-unit'],
    ['negative amount', { goal: { title: 'negative', amount: -1 } }, 'invalid-goal-amount'],
    ['number sourceText', { goal: { title: '数学' }, sourceText: 42 }, 'invalid-command-shape'],
    ['object subject', { goal: { title: '数学', subject: {} } }, 'invalid-command-shape'],
    ['unknown goal property', { goal: { title: '数学', extra: true } }, 'invalid-command-shape'],
    ['overlong title', { goal: { title: 'a'.repeat(201) } }, 'invalid-command-shape'],
    ['overlong sourceText', { goal: { title: '数学' }, sourceText: 'a'.repeat(4001) }, 'invalid-command-shape'],
  ])('rejects set_study_goal with %s', (_label, payload, reason) => {
    const command = {
      type: 'set_study_goal',
      sourceText: 'goal',
      ...payload,
      confidence: 'high',
    } as unknown as ParsedWeeklyPlanningCommand;
    const result = validateInterpretedCandidates([candidate(command)], baseSummary());

    expect(result.accepted).toEqual([]);
    expect(result.acceptedWithConfirmation).toEqual([]);
    expect(result.clarifications).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason }),
    ]);
  });
});

describe('weekly planning candidate validator properties', () => {
  it('selects the higher confidence candidate independently of normalized-title form and input order', () => {
    fc.assert(fc.property(
      goalTitleArbitrary,
      fc.boolean(),
      (title, reverseOrder) => {
        const high = studyGoalCandidate({ title, subject: 'high', confidence: 'high' });
        const medium = studyGoalCandidate({
          title: `  ${fullWidthAscii(title)}\u3000`,
          subject: 'medium',
          confidence: 'medium',
        });
        const candidates = reverseOrder ? [medium, high] : [high, medium];
        const original = structuredClone(candidates);
        const result = validateInterpretedCandidates(candidates, baseSummary());

        expect(result.accepted).toEqual([high.command]);
        expect(result.acceptedWithConfirmation).toEqual([]);
        expect(result.rejected).toEqual([
          expect.objectContaining({
            candidate: medium,
            reason: 'conflicting-slot-lower-confidence',
          }),
        ]);
        expect(candidates).toEqual(original);
      },
    ), { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS });
  });

  it('keeps different goal identities in their confidence buckets regardless of input order', () => {
    fc.assert(fc.property(
      distinctGoalTitlesArbitrary,
      fc.boolean(),
      ([highTitle, mediumTitle], reverseOrder) => {
        const high = studyGoalCandidate({ title: highTitle, subject: 'high', confidence: 'high' });
        const medium = studyGoalCandidate({ title: mediumTitle, subject: 'medium', confidence: 'medium' });
        const candidates = reverseOrder ? [medium, high] : [high, medium];
        const result = validateInterpretedCandidates(candidates, baseSummary());

        expect(result.accepted).toEqual([high.command]);
        expect(result.acceptedWithConfirmation).toEqual([medium.command]);
        expect(result.rejected).toEqual([]);
      },
    ), { seed: PROPERTY_SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('preserves a valid candidate when an unrelated candidate is invalid', () => {
    fc.assert(fc.property(
      goalTitleArbitrary,
      fc.boolean(),
      (title, invalidFirst) => {
        const valid = studyGoalCandidate({ title, subject: 'valid', confidence: 'high' });
        const invalid = candidate({
          type: 'set_study_goal',
          goal: { title: '' },
          sourceText: 'invalid',
          confidence: 'high',
        });
        const candidates = invalidFirst ? [invalid, valid] : [valid, invalid];
        const result = validateInterpretedCandidates(candidates, baseSummary());

        expect(result.accepted).toEqual([valid.command]);
        expect(result.rejected).toEqual([
          expect.objectContaining({ candidate: invalid }),
        ]);
      },
    ), { seed: PROPERTY_SEED + 2, numRuns: PROPERTY_RUNS });
  });

  it('keeps one accepted command and deterministic rejections for repeated candidates', () => {
    fc.assert(fc.property(
      goalTitleArbitrary,
      fc.integer({ min: 1, max: 8 }),
      (title, repetitions) => {
        const item = studyGoalCandidate({ title, subject: 'same', confidence: 'high' });
        const repeated = Array.from({ length: repetitions }, () => structuredClone(item));
        const result = validateInterpretedCandidates(repeated, baseSummary());

        expect(result.accepted).toEqual([item.command]);
        expect(result.rejected).toHaveLength(repetitions - 1);
        expect(result.rejected.every(({ reason }) => reason === 'conflicting-slot-lower-confidence')).toBe(true);
      },
    ), { seed: PROPERTY_SEED + 3, numRuns: PROPERTY_RUNS });
  });

});
