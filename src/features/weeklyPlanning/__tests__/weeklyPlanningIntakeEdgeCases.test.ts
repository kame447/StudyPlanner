import { describe, expect, it } from 'vitest';
import {
  toLifeConstraintFromAddFixedEventCommand,
  toLifeConstraintFromAddUnavailableCommand,
  toExamScopeFromSetExamScopeCommand,
  toLifeConstraintFromUpdateLifeConstraintCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
  toPriorityPolicyFromSetPriorityPolicyCommand,
  toStudyProgressFromMarkCompletedUnitsCommand,
  toStudyProgressFromNoteProgressBoundaryCommand,
  toUnitRateFromSetUnitRateCommand,
} from '../intake/weeklyPlanningCommandAdapter';
import {
  parseMarkCompletedUnitsCommand,
  parseNoteProgressBoundaryCommand,
} from '../intake/weeklyPlanningCompletionParsing';
import { getLifeConstraintIdentity } from '../intake/weeklyPlanningConstraintIdentity';
import { parseConstraintCommands } from '../intake/weeklyPlanningConstraintParsing';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { applyWeeklyPlanningUserTurn } from '../intake/weeklyPlanningIntakeReducer';
import { parseSetPriorityPolicyCommand } from '../intake/weeklyPlanningPriorityParsing';
import { parseSetExamScopeCommand, parseSetPlanningRangeCommand } from '../intake/weeklyPlanningScopeParsing';
import { parseSetUnitRateCommand } from '../intake/weeklyPlanningUnitRateParsing';
import {
  isHardUnavailableExpression,
  isUncertainAvailabilityExpression,
  parseAddUnavailableCommand,
  resolveUnavailableDaypartRange,
} from '../intake/weeklyPlanningUnavailableParsing';
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

  it('Phase 9.2 parses explicit fixed-event additions but keeps uncertain events unconfirmed', () => {
    const baseState = applyWeekendExamReadyForLifeConstraints();
    const confirmed = applyWeeklyPlanningUserTurn(
      baseState,
      '\u65e5\u66dc\u306e13\u6642\u304b\u3089\u6b6f\u533b\u8005',
      context,
    );
    const ambiguous = applyWeeklyPlanningUserTurn(
      baseState,
      '\u65e5\u66dc\u306e13\u6642\u304b\u3089\u6b6f\u533b\u8005\u304b\u3082',
      context,
    );

    expect(confirmed.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          date: '2026-06-28',
          start: '13:00',
          hardness: 'hard',
        }),
      ]),
    );
    expect(confirmed.missing).not.toContain('fixed_events');
    expect(ambiguous.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          date: '2026-06-28',
          start: '13:00',
          hardness: 'soft',
        }),
      ]),
    );
    expect(ambiguous.missing).toContain('fixed_events');
  });

  it('Phase 9.2 updates timed life constraints but does not replace them with vague wording', () => {
    const draftReady = applyWeekendExamReadyForDraftRequest();
    const updatedBath = applyWeeklyPlanningUserTurn(
      draftReady,
      '\u304a\u98a8\u5442\u306f22\u6642\u306b\u5909\u66f4',
      context,
    );
    const vagueBath = applyWeeklyPlanningUserTurn(draftReady, '\u591c\u306b\u98a8\u5442', context);

    expect(updatedBath.constraints.filter((constraint) => constraint.kind === 'bath')).toEqual([
      expect.objectContaining({ start: '22:00', hardness: 'hard' }),
    ]);
    expect(vagueBath.constraints.filter((constraint) => constraint.kind === 'bath')).toEqual(
      draftReady.constraints.filter((constraint) => constraint.kind === 'bath'),
    );
  });

  it('Phase 9.2 updates priority only for known fields', () => {
    const draftReady = applyWeekendExamReadyForDraftRequest();
    const softwareFirst = applyWeeklyPlanningUserTurn(
      draftReady,
      '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u3092\u5148\u306b\u3057\u305f\u3044',
      context,
    );
    const unknownField = applyWeeklyPlanningUserTurn(
      draftReady,
      '\u82f1\u8a9e\u3092\u5148\u306b\u3057\u305f\u3044',
      context,
    );

    expect(softwareFirst.priorityPolicy.kind === 'field_first'
      ? softwareFirst.priorityPolicy.order
      : undefined).toEqual(['\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u7cfb', '\u6570\u5b66\u30fb\u6570\u7406\u7cfb']);
    expect(unknownField.priorityPolicy).toEqual(draftReady.priorityPolicy);
  });

  it('Phase 9.4a exposes small unavailable parsing helpers for daypart and uncertainty boundaries', () => {
    expect(resolveUnavailableDaypartRange('\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067')).toMatchObject({
      start: '16:00',
      end: '19:00',
    });
    expect(isHardUnavailableExpression('\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067')).toBe(true);
    expect(isUncertainAvailabilityExpression('\u591c\u306f\u4f7f\u3048\u306a\u3044\u304b\u3082')).toBe(true);
    expect(isHardUnavailableExpression('\u591c\u306f\u4f7f\u3048\u306a\u3044\u304b\u3082')).toBe(false);
  });

  it('Phase 9.4a keeps equivalent unavailable constraint identity independent from raw text', () => {
    expect(getLifeConstraintIdentity({
      kind: 'unavailable',
      start: '16:00',
      end: '19:00',
      hardness: 'hard',
      rawText: '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067',
    })).toBe(getLifeConstraintIdentity({
      kind: 'unavailable',
      start: '16:00',
      end: '19:00',
      hardness: 'hard',
      rawText: '\u5915\u65b9\u306f\u9664\u5916',
    }));
  });
  it('Phase 9.5 parses unavailable text as an add_unavailable command before domain conversion', () => {
    const command = parseAddUnavailableCommand(
      '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067',
      context,
    );

    expect(command).toMatchObject({
      type: 'add_unavailable',
      range: {
        start: '16:00',
        end: '19:00',
        hardness: 'hard',
      },
      confidence: 'high',
      sourceSegment: '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067',
    });
    expect(command ? toLifeConstraintFromAddUnavailableCommand(command) : undefined).toMatchObject({
      kind: 'unavailable',
      start: '16:00',
      end: '19:00',
      hardness: 'hard',
    });
  });

  it('Phase 9.5 keeps ambiguous unavailable text out of add_unavailable commands', () => {
    expect(parseAddUnavailableCommand('\u591c\u306f\u4f7f\u3048\u306a\u3044\u304b\u3082', context)).toBeUndefined();
  });
  it('Phase 9.7 parses planning range and exam scope as commands before domain application', () => {
    const rangeCommand = parseSetPlanningRangeCommand(
      '\u4eca\u65e519\u6642\u304b\u3089\u571f\u65e5\u306e\u7d42\u308f\u308a\u307e\u3067\u4e88\u5b9a\u7acb\u3066\u305f\u3044',
      context,
    );
    const scopeCommand = parseSetExamScopeCommand(
      '\u9662\u8a66\u30675\u5206\u91ce\u30017\u5e74\u5206\u3092\u3084\u308a\u305f\u3044\n\u7b2c1\u90e8 \u6570\u5b66\u30fb\u6570\u7406\u7cfb',
      undefined,
    );

    expect(rangeCommand).toMatchObject({
      type: 'set_planning_range',
      range: {
        startDateTime: '2026-06-26T19:00:00',
        endDateTime: '2026-06-28T24:00:00',
        confidence: 'explicit',
      },
    });
    expect(rangeCommand ? toPlanningRangeFromSetPlanningRangeCommand(rangeCommand) : undefined)
      .toMatchObject({ startDateTime: '2026-06-26T19:00:00' });
    expect(scopeCommand).toMatchObject({
      type: 'set_exam_scope',
      scope: {
        examType: '\u9662\u8a66',
        totalFields: 5,
        totalYears: 7,
        fields: ['\u6570\u5b66\u30fb\u6570\u7406\u7cfb'],
        unitModel: 'year_field_chunk',
      },
    });
    expect(scopeCommand ? toExamScopeFromSetExamScopeCommand(scopeCommand) : undefined)
      .toMatchObject({ examType: '\u9662\u8a66', totalFields: 5, totalYears: 7 });
  });
  it('Phase 9.6 parses fixed events and life constraints as commands before domain conversion', () => {
    const fixedEventCommand = parseConstraintCommands(
      '\u65e5\u66dc\u306e13\u6642\u304b\u3089\u6b6f\u533b\u8005',
      context,
    )[0];
    const lifeConstraintCommand = parseConstraintCommands(
      '\u304a\u98a8\u5442\u306f22\u6642\u306b\u5909\u66f4',
      context,
    )[0];

    expect(fixedEventCommand).toMatchObject({
      type: 'add_fixed_event',
      event: {
        date: '2026-06-28',
        start: '13:00',
        durationMinutes: 60,
        hardness: 'hard',
      },
    });
    expect(fixedEventCommand && fixedEventCommand.type === 'add_fixed_event'
      ? toLifeConstraintFromAddFixedEventCommand(fixedEventCommand)
      : undefined).toMatchObject({
        kind: 'fixed_event',
        date: '2026-06-28',
        start: '13:00',
        hardness: 'hard',
      });
    expect(lifeConstraintCommand).toMatchObject({
      type: 'update_life_constraint',
      kind: 'bath',
      constraint: {
        start: '22:00',
        durationMinutes: 30,
        hardness: 'hard',
      },
    });
    expect(lifeConstraintCommand && lifeConstraintCommand.type === 'update_life_constraint'
      ? toLifeConstraintFromUpdateLifeConstraintCommand(lifeConstraintCommand)
      : undefined).toMatchObject({
        kind: 'bath',
        start: '22:00',
        hardness: 'hard',
      });
  });

  it('Phase 9.6 parses priority, completed units, and unit rate as commands before domain conversion', () => {
    const draftReady = applyWeekendExamReadyForDraftRequest();
    const fields = draftReady.examPrepScope?.fields ?? [];
    const priorityCommand = parseSetPriorityPolicyCommand(
      '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u3092\u5148\u306b\u3057\u305f\u3044',
      fields,
      draftReady.priorityPolicy.kind === 'field_first' ? draftReady.priorityPolicy.order : [],
    );
    const completedCommand = parseMarkCompletedUnitsCommand(
      '\u6570\u5b66\u306e2020\u3082\u7d42\u308f\u3063\u3066\u305f',
      draftReady.examPrepScope?.yearRange,
      fields,
    );
    const unitRateCommand = parseSetUnitRateCommand(
      '\u4e00\u5e74\u5206\u306f2\u6642\u9593\u304f\u3089\u3044',
      draftReady.examPrepScope,
    );

    expect(priorityCommand).toMatchObject({ type: 'set_priority_policy' });
    expect(priorityCommand ? toPriorityPolicyFromSetPriorityPolicyCommand(priorityCommand) : undefined)
      .toMatchObject({ kind: 'field_first' });
    expect(completedCommand).toMatchObject({
      type: 'mark_completed_units',
      field: '\u6570\u5b66\u30fb\u6570\u7406\u7cfb',
      completedYears: [2020],
      mergeMode: 'append',
    });
    expect(completedCommand ? toStudyProgressFromMarkCompletedUnitsCommand(completedCommand) : undefined)
      .toMatchObject({
        field: '\u6570\u5b66\u30fb\u6570\u7406\u7cfb',
        completedYears: [2020],
        ambiguity: 'none',
      });
    expect(unitRateCommand).toMatchObject({
      type: 'set_unit_rate',
      unitRate: {
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
      },
    });
    expect(unitRateCommand ? toUnitRateFromSetUnitRateCommand(unitRateCommand) : undefined)
      .toMatchObject({ unit: 'year_field_chunk', minutesPerUnit: 120 });
  });


  it('Phase 9.7 parses ambiguous progress boundary as a command before domain conversion', () => {
    const draftReady = applyWeekendExamReadyForDraftRequest();
    const fields = draftReady.examPrepScope?.fields ?? [];
    const text = '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u7d42\u308f\u3063\u3066\u308b';
    const sourceSegment = '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u7d42\u308f';
    const command = parseNoteProgressBoundaryCommand(text, fields);

    expect(command).toMatchObject({
      type: 'note_progress_boundary',
      field: '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f',
      boundaryYear: 2021,
      ambiguity: 'completion_direction',
      sourceText: text,
      sourceSegment,
      confidence: 'medium',
    });
    expect(command ? toStudyProgressFromNoteProgressBoundaryCommand(command) : undefined)
      .toMatchObject({
        field: '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f',
        completionBoundaryYear: 2021,
        ambiguity: 'completion_direction',
        rawText: sourceSegment,
      });
  });

  it.each([
    '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u7d42\u308f\u3063\u3066\u306a\u3044',
    '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u304c2021\u307e\u3067\u7d42\u308f\u3063\u305f\u3089\u6570\u5b66\u3092\u3084\u308b',
    '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u3084\u308b\u4e88\u5b9a',
  ])('Phase 9.7 does not create progress boundary commands for non-completed expressions: %s', (text) => {
    const draftReady = applyWeekendExamReadyForDraftRequest();
    const fields = draftReady.examPrepScope?.fields ?? [];

    expect(parseNoteProgressBoundaryCommand(text, fields)).toBeUndefined();
  });

  it('Phase 9.7 applies ambiguous progress boundary commands through the reducer path', () => {
    const text = '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u7d42\u308f\u3063\u3066\u308b';
    const sourceSegment = '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f2021\u307e\u3067\u7d42\u308f';
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForDraftRequest(),
      text,
      context,
    );

    expect(state.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u306f',
          completionBoundaryYear: 2021,
          ambiguity: 'completion_direction',
          rawText: sourceSegment,
        }),
      ]),
    );
    expect(state.missing).toContain('completion_direction');
  });

  it.each([
    ['\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067', { start: '16:00', end: '19:00' }],
    ['\u5348\u524d\u306f\u4f7f\u308f\u306a\u3044\u3067', { start: '08:00', end: '12:00' }],
    ['14\u6642\u304b\u308916\u6642\u306f\u4f7f\u308f\u306a\u3044\u3067', { start: '14:00', end: '16:00' }],
    ['15\u6642\u4ee5\u964d\u306f\u4f7f\u308f\u306a\u3044\u3067', { start: '15:00', end: '24:00' }],
  ])('Phase 9.3 parses hard unavailable time ranges: %s', (text, expected) => {
    const state = applyWeeklyPlanningUserTurn(applyWeekendExamReadyForDraftRequest(), text, context);

    expect(state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unavailable',
          hardness: 'hard',
          ...expected,
        }),
      ]),
    );
  });

  it.each([
    ['\u65e5\u66dc\u306f\u7a7a\u3051\u3066', '2026-06-28'],
    ['7\u67083\u65e5\u306f\u4f7f\u308f\u306a\u3044\u3067', '2026-07-03'],
    ['2026-07-03\u306f\u4f7f\u308f\u306a\u3044\u3067', '2026-07-03'],
  ])('Phase 9.3 parses hard unavailable days within the planning range: %s', (text, expectedDate) => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForDraftRequest(),
      text,
      { ...context, planningDayCount: 8 },
    );

    expect(state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unavailable',
          date: expectedDate,
          start: '00:00',
          end: '24:00',
          hardness: 'hard',
        }),
      ]),
    );
  });

  it('Phase 9.3 does not create hard unavailable constraints for dates outside the planning range', () => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForDraftRequest(),
      '2026-07-04\u306f\u4f7f\u308f\u306a\u3044\u3067',
      { ...context, planningDayCount: 8 },
    );

    expect(state.constraints).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unavailable', date: '2026-07-04' }),
      ]),
    );
  });

  it.each([
    '\u591c\u306f\u4f7f\u3048\u306a\u3044\u304b\u3082',
    '\u3067\u304d\u308c\u3070\u5348\u524d\u306f\u907f\u3051\u305f\u3044',
    '\u65e5\u66dc\u306f\u7a7a\u3051\u305f\u3044\u304b\u3082',
    '\u91d1\u66dc\u306f\u5fae\u5999',
    '\u4e88\u5b9a\u304c\u5165\u308b\u304b\u3082',
  ])('Phase 9.3 keeps ambiguous unavailable wording out of hard constraints: %s', (text) => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForDraftRequest(),
      text,
      { ...context, planningDayCount: 8 },
    );

    expect(state.constraints).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unavailable', hardness: 'hard' }),
      ]),
    );
  });

  it('Phase 9.3 does not duplicate the same unavailable constraint across repeated turns', () => {
    const once = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForDraftRequest(),
      '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067',
      context,
    );
    const twice = applyWeeklyPlanningUserTurn(once, '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067', context);

    expect(twice.constraints.filter((constraint) =>
      constraint.kind === 'unavailable' && constraint.start === '16:00' && constraint.end === '19:00',
    )).toHaveLength(1);
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
