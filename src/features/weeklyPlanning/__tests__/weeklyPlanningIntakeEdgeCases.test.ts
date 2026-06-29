import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { applyWeeklyPlanningUserTurn } from '../intake/weeklyPlanningIntakeReducer';
import {
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';
import { WP_RP_001_WEEKEND_EXAM_EXPECTED } from '../testFixtures/weeklyPlanningGoldExpectations';
import {
  applyCompletionTextAfterKnownYearRange,
  applyDetailsTextAfterExamScope,
  applyWeekendExamReadyForDraftRequest,
  applyWeekendExamReadyForLifeConstraints,
  applyWeekendRangeAndExamScope,
  context,
} from './weeklyPlanningRoleplayTestHelpers';
describe('weekly planning intake edge cases', () => {
  it.each([
    ['数学の25〜21が終わったよ', [2025, 2024, 2023, 2022, 2021]],
    ['数学の21〜25が終わったよ', [2021, 2022, 2023, 2024, 2025]],
    ['数学の2025〜2021が終わったよ', [2025, 2024, 2023, 2022, 2021]],
    ['数学の25〜21は済んだ', [2025, 2024, 2023, 2022, 2021]],
    ['数学の25〜21は完了', [2025, 2024, 2023, 2022, 2021]],
    ['数学の25〜21はやった', [2025, 2024, 2023, 2022, 2021]],
    ['数学は25から21まで完了', [2025, 2024, 2023, 2022, 2021]],
  ])(
    'WP-RP-001-04 field scope resolution normalizes year ranges from %s',
    (completionText, expectedYears) => {
      const state = applyCompletionTextAfterKnownYearRange(completionText);

      expect(state.progress).toEqual([
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: expectedYears,
          ambiguity: 'none',
        }),
      ]);
      expect(state.missing).not.toContain('completion_direction');
    },
  );

  it('WP-RP-001-04 does not mark incomplete year ranges as completed', () => {
    const state = applyCompletionTextAfterKnownYearRange('25〜21が残ってる');

    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completedYears: undefined,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toContain('completion_direction');
  });

  it('WP-RP-001-04 does not expand individually mentioned years into a continuous range', () => {
    const state = applyCompletionTextAfterKnownYearRange('25と21が終わったよ');

    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completedYears: undefined,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toContain('completion_direction');
  });

  it('WP-RP-001-04 leaves two-digit completed year ranges ambiguous without an exam yearRange', () => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendRangeAndExamScope(),
      '25〜21が終わったよ',
      context,
    );

    expect(state.examPrepScope?.yearRange).toBeUndefined();
    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completedYears: undefined,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toContain('completion_direction');
  });
  it.each([
    [
      '2019〜2025を対象にする。数学の25〜21が終わったよ',
      [2025, 2024, 2023, 2022, 2021],
    ],
    [
      '2019〜2025を対象にする。まだ全体は終わってない。数学の25〜21は終わったよ',
      [2025, 2024, 2023, 2022, 2021],
    ],
  ])(
    'WP-RP-001-04 completion direction binds only the completed segment from %s',
    (detailsText, expectedYears) => {
      const state = applyDetailsTextAfterExamScope(detailsText);

      expect(state.progress).toEqual([
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: expectedYears,
          ambiguity: 'none',
        }),
      ]);
      expect(state.missing).not.toContain('completion_direction');
    },
  );

  it.each([
    '2019〜2025を対象にする。数学の25〜21は残ってる',
    '数学の25〜21は終わってない',
    '数学の25〜21はまだ終わってない',
    '数学の25〜21は完了していない',
    '数学の25〜21はやってない',
    '数学の25〜21をやる予定',
    '数学の25〜21が終わったら22をやる',
  ])('WP-RP-001-04 does not treat non-completion wording as completed: %s', (detailsText) => {
    const state = applyCompletionTextAfterKnownYearRange(detailsText);

    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completedYears: undefined,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toContain('completion_direction');
  });

  it.each(WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fieldScopedCompletionParaphrases)(
    'ML-eval field scope resolution accepts completion paraphrase: %s',
    (completionText) => {
      const state = applyCompletionTextAfterKnownYearRange(completionText);

      expect(state.progress).toEqual([
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: WP_RP_001_WEEKEND_EXAM_EXPECTED.completedYearsByField['数学・数理系'],
          ambiguity: 'none',
          rawText: completionText,
        }),
      ]);
      expect(state.missing).not.toContain('completion_direction');
    },
  );

  it.each(WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.nonCompletionPolarityExamples)(
    'ML-eval completion polarity resolution preserves ambiguity for: %s',
    (completionText) => {
      const state = applyCompletionTextAfterKnownYearRange(completionText);

      expect(state.progress).toEqual([
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: undefined,
          ambiguity: 'completion_direction',
        }),
      ]);
      expect(state.missing).toContain('completion_direction');
    },
  );

  it('ML-eval field scope resolution does not confirm completedYears without field scope', () => {
    const state = applyCompletionTextAfterKnownYearRange(
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fieldScopeAmbiguousCompletion,
    );

    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completedYears: undefined,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toContain('completion_direction');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });
  it.each([
    ['一分野の一年分は2時間くらい', true],
    ['一年分は2時間くらい', true],
    ['今日は2時間くらいしかない', false],
    [WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.unitRateExamples.unavailableDuration, false],
    ['数学を2時間やる', false],
    ['2時間くらいで終わるかも', false],
  ])('WP-RP-001 unit-rate parsing keeps duration attached to a study unit: %s', (text, shouldParse) => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendRangeAndExamScope(),
      text,
      context,
    );

    if (shouldParse) {
      expect(state.unitRates).toEqual([
        expect.objectContaining({
          unit: 'year_field_chunk',
          minutesPerUnit: 120,
        }),
      ]);
      expect(state.missing).not.toContain('unit_duration_estimate');
    } else {
      expect(state.unitRates).toEqual([]);
      expect(state.missing).toContain('unit_duration_estimate');
    }
  });

  it('WP-RP-001 priorityPolicy distinguishes field order from completion reports', () => {
    const afterScope = applyWeekendRangeAndExamScope();
    const ordered = applyWeeklyPlanningUserTurn(
      afterScope,
      '数学が終わったらソフトウェア',
      context,
    );
    const completionOnly = applyWeeklyPlanningUserTurn(afterScope, '数学は終わった', context);
    const unordered = applyWeeklyPlanningUserTurn(afterScope, '数学もソフトウェアもやる', context);
    const reverseOrder = applyWeeklyPlanningUserTurn(
      afterScope,
      '数学よりソフトウェアを優先したい',
      context,
    );

    expect(ordered.priorityPolicy).toEqual({
      kind: 'field_first',
      order: ['数学・数理系', 'ソフトウェア系'],
    });
    expect(completionOnly.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(unordered.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(reverseOrder.priorityPolicy).toEqual({
      kind: 'field_first',
      order: ['ソフトウェア系', '数学・数理系'],
    });
  });

  it('WP-RP-001 keeps life constraints separate from fixed event confirmation', () => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );

    expect(state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(state.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(state.missing).toContain('fixed_events');
    expect(state.status).toBe('needs_life_constraints');
    expect(state.shouldCreateDraft).toBe(false);
  });

  it('WP-RP-001 handles explicit fixed events and ambiguous fixed event candidates separately', () => {
    const baseState = applyWeekendExamReadyForLifeConstraints();
    const confirmed = applyWeeklyPlanningUserTurn(baseState, '15時から病院がある', context);
    const ambiguous = applyWeeklyPlanningUserTurn(baseState, 'ゼミがあるかも', context);

    expect(confirmed.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          start: '15:00',
          hardness: 'hard',
        }),
      ]),
    );
    expect(confirmed.missing).not.toContain('fixed_events');

    expect(ambiguous.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          hardness: 'soft',
        }),
      ]),
    );
    expect(ambiguous.missing).toContain('fixed_events');
  });
  it('ML-eval constraint classification keeps no fixed events and event candidates reproducible', () => {
    const baseState = applyWeekendExamReadyForLifeConstraints();
    const noFixedEvents = applyWeeklyPlanningUserTurn(
      baseState,
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.noFixedEvents,
      context,
    );
    const confirmed = applyWeeklyPlanningUserTurn(
      baseState,
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.confirmedFixedEvent,
      context,
    );
    const ambiguous = applyWeeklyPlanningUserTurn(
      baseState,
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.ambiguousFixedEvent,
      context,
    );

    expect(noFixedEvents.missing).not.toContain('fixed_events');
    expect(noFixedEvents.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(noFixedEvents.sourceTurns).toContain(
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.noFixedEvents,
    );
    expect(confirmed.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          start: '15:00',
          hardness: 'hard',
          rawText: WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.confirmedFixedEvent,
        }),
      ]),
    );
    expect(ambiguous.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          hardness: 'soft',
          rawText: WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.fixedEventExamples.ambiguousFixedEvent,
        }),
      ]),
    );
    expect(ambiguous.missing).toContain('fixed_events');
  });
  it('ML-eval stateless pipeline is deterministic for identical roleplay input sequences', () => {
    const runPipeline = () => {
      const finalState = applyWeekendExamReadyForDraftRequest();
      const request = createWeeklyDraftRequestFromIntakeState(finalState);
      const remainingWorkItems = request
        ? createRemainingWorkItemsFromDraftRequest(request)
        : null;

      return { finalState, request, remainingWorkItems };
    };

    expect(runPipeline()).toEqual(runPipeline());
  });
});
