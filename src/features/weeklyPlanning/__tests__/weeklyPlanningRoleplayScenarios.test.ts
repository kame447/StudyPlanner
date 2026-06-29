import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { createWeeklyDraftCandidatesFromRemainingWorkItems } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WEEKLY_PLANNING_INTAKE_EVALUATION_CASES,
  WP_RP_001_WEEKEND_EXAM_EXPECTED,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';

const context = {
  selectedDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
};

function applyWeekendRangeAndExamScope() {
  const afterRange = applyWeeklyPlanningUserTurn(
    createInitialPlanningIntakeState(),
    WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterRange,
    WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
    context,
  );
}

function applyCompletionTextAfterKnownYearRange(completionText: string) {
  return applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    '7年分は2019〜2025\n' + completionText,
    context,
  );
}

function applyDetailsTextAfterExamScope(detailsText: string) {
  return applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    detailsText,
    context,
  );
}

function applyWeekendExamReadyForLifeConstraints() {
  const afterDetails = applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterDetails,
    WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
    context,
  );
}

function applyWeekendExamReadyForDraftRequest() {
  const afterLifeConstraints = applyWeeklyPlanningUserTurn(
    applyWeekendExamReadyForLifeConstraints(),
    WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterLifeConstraints,
    WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
    context,
  );
}

describe('weekly planning roleplay scenarios', () => {
  it('WP-RP-001-01 stores today 19:00 through the end of Sunday as a planning range', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );

    expect(state).toMatchObject({
      intent: 'weekly_study_planning',
      status: 'needs_scope',
      range: {
        startDateTime: '2026-06-26T19:00:00',
        endDateTime: '2026-06-28T24:00:00',
        confidence: 'explicit',
      },
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
    expect(state.missing).toEqual(
      expect.arrayContaining([
        'tasks_or_goals',
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
      ]),
    );
  });

  it('WP-RP-001-02 structures exam scope without inferring the concrete year range', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );

    expect(state.intent).toBe('exam_prep_planning');
    expect(state.status).toBe('needs_progress_clarification');
    expect(state.examPrepScope).toMatchObject({
      examType: '院試',
      fields: [
        '数学・数理系',
        'ソフトウェア系',
        'ハードウェア系',
        'OS とネットワーク',
        'ヒューマンサイエンス系',
      ],
      totalFields: 5,
      totalYears: 7,
      strategyHint: 'field_first',
      unitModel: 'year_field_chunk',
      unitCountHint: 35,
    });
    expect(state.examPrepScope?.yearRange).toBeUndefined();
    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completionBoundaryYear: 2021,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toEqual(
      expect.arrayContaining([
        'year_range',
        'completion_direction',
        'unit_duration_estimate',
      ]),
    );
    expect(state.questions.join('\n')).toContain('7年分は何年から何年までですか');
    expect(state.questions.join('\n')).toContain('2021まで完了');
    expect(state.shouldCreateDraft).toBe(false);
  });

  it('WP-RP-001-03 keeps a user-provided year-field unit rate while missing data still blocks draft creation', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterScope,
      WP_RP_001_WEEKEND_EXAM_TURNS.unitRateOnly,
      context,
    );

    expect(state.unitRates).toEqual([
      expect.objectContaining({
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
        uncertainty: 'medium',
      }),
    ]);
    expect(state.missing).not.toContain('unit_duration_estimate');
    expect(state.missing).toEqual(
      expect.arrayContaining(['year_range', 'completion_direction']),
    );
    expect(state.shouldCreateDraft).toBe(false);
    expect(state.shouldSavePlan).toBe(false);
  });

  it("WP-RP-001-04 keeps year range, completed years, and field-first priority", () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );
    const afterDetails = applyWeeklyPlanningUserTurn(
      afterScope,
      WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterDetails,
      WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
      context,
    );

    expect(state.examPrepScope?.yearRange).toEqual({
      startYear: 2019,
      endYear: 2025,
      sourceText: "2019〜2025",
    });
    expect(state.progress).toEqual([
      expect.objectContaining({
        field: "数学・数理系",
        completionBoundaryYear: 2021,
        completedYears: [2025, 2024, 2023, 2022, 2021],
        ambiguity: "none",
      }),
    ]);
    expect(state.unitRates).toEqual([
      expect.objectContaining({
        unit: "year_field_chunk",
        minutesPerUnit: 120,
        source: "user",
      }),
    ]);
    expect(state.priorityPolicy).toEqual({
      kind: "field_first",
      order: ["数学・数理系", "ソフトウェア系"],
    });
    expect(state.missing).not.toContain("year_range");
    expect(state.missing).not.toContain("completion_direction");
    expect(state.missing).not.toContain("unit_duration_estimate");
    expect(state.missing).not.toContain("priority_policy");
    expect(state.missing).not.toContain("next_field_after_math");
    expect(state.status).toBe("needs_life_constraints");
    expect(state.shouldCreateDraft).toBe(false);
    expect(state.shouldSavePlan).toBe(false);
  });
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
  it('WP-RP-001 Phase 2 creates a draft request from the final draft_ready intake state', () => {
    const state = applyWeekendExamReadyForDraftRequest();
    const request = createWeeklyDraftRequestFromIntakeState(state);

    expect(state.status).toBe('draft_ready');
    expect(request).toMatchObject({
      examPrepScope: {
        yearRange: {
          startYear: 2019,
          endYear: 2025,
          sourceText: '2019〜2025',
        },
      },
      progress: [
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: [2025, 2024, 2023, 2022, 2021],
        }),
      ],
      unitRate: {
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
      },
      priorityPolicy: {
        kind: 'field_first',
        order: ['数学・数理系', 'ソフトウェア系'],
      },
      fixedEvents: [],
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.fixedEvents).toEqual([]);
  });

  it('WP-RP-001 Phase 2 does not create a draft request before the intake is draft_ready', () => {
    const state = applyWeekendExamReadyForLifeConstraints();

    expect(state.status).toBe('needs_life_constraints');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 does not create a draft request when only life constraints are collected', () => {
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
    expect(state.missing).toContain('fixed_events');
    expect(state.status).not.toBe('draft_ready');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 keeps fixed events separate from life constraints in the draft request', () => {
    const afterLifeConstraints = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );
    const withFixedEvent = applyWeeklyPlanningUserTurn(
      afterLifeConstraints,
      '15時から病院がある',
      context,
    );
    const request = createWeeklyDraftRequestFromIntakeState(withFixedEvent);

    expect(withFixedEvent.status).toBe('draft_ready');
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(request?.fixedEvents).toEqual([
      expect.objectContaining({
        kind: 'fixed_event',
        start: '15:00',
        hardness: 'hard',
      }),
    ]);
    expect(request?.shouldSavePlan).toBe(false);
  });
  it('WP-RP-001 Phase 2.5 creates remaining work items from the draft request', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const result = createRemainingWorkItemsFromDraftRequest(request);
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');
    const softwareItems = result.items.filter((item) => item.field === 'ソフトウェア系');

    expect(mathItems.map((item) => item.year)).toEqual([2020, 2019]);
    expect(softwareItems.map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
    expect(mathItems.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(softwareItems.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(mathItems.every((item) => item.unit === 'year_field_chunk')).toBe(true);
    expect(softwareItems.every((item) => item.source === 'exam_prep_request')).toBe(true);
    expect(result.items.findIndex((item) => item.field === '数学・数理系')).toBeLessThan(
      result.items.findIndex((item) => item.field === 'ソフトウェア系'),
    );
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

  it('ML-eval remaining work item correctness preserves scheduler input invariants', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const result = createRemainingWorkItemsFromDraftRequest(request);
    const completedYears = new Set(
      request.progress.flatMap((progress) =>
        progress.field === '数学・数理系' ? progress.completedYears : [],
      ),
    );
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');
    const softwareItems = result.items.filter((item) => item.field === 'ソフトウェア系');
    const allYears = result.items.map((item) => item.year);
    const firstSoftwareIndex = result.items.findIndex((item) => item.field === 'ソフトウェア系');
    let lastMathIndex = -1;

    result.items.forEach((item, index) => {
      if (item.field === '数学・数理系') {
        lastMathIndex = index;
      }
    });

    expect(mathItems.some((item) => completedYears.has(item.year))).toBe(false);
    expect(softwareItems.map((item) => item.year)).toEqual(
      WP_RP_001_WEEKEND_EXAM_EXPECTED.remainingYearsByField['ソフトウェア系'],
    );
    expect(result.items.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(Math.min(...allYears)).toBeGreaterThanOrEqual(2019);
    expect(Math.max(...allYears)).toBeLessThanOrEqual(2025);
    expect(lastMathIndex).toBeLessThan(firstSoftwareIndex);
    expect(result.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
        expect.objectContaining({ kind: 'fixed_event' }),
      ]),
    );
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
  it('WP-RP-001 Phase 2.5 does not apply fieldless completedYears to every field', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const fieldlessRequest = {
      ...request,
      progress: request.progress.map((progress) => ({
        ...progress,
        field: undefined,
      })),
    };
    const result = createRemainingWorkItemsFromDraftRequest(fieldlessRequest);
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');

    expect(result.ambiguities).toContain('completed_years_without_field_scope');
    expect(mathItems.map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
  });
  it('WP-RP-001 Phase 3 dry-runs draft candidates from final intake without saving', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const remainingWorkItems = createRemainingWorkItemsFromDraftRequest(request);
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      remainingWorkItems: remainingWorkItems.items,
      constraints: request.constraints,
      fixedEvents: request.fixedEvents,
      planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
      planningDayCount: 3,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.slice(0, 9).map((candidate) => ({
      field: candidate.field,
      year: candidate.year,
      durationMinutes: candidate.durationMinutes,
      approvalStatus: candidate.approvalStatus,
      source: candidate.source,
    }))).toEqual([
      { field: '数学・数理系', year: 2020, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: '数学・数理系', year: 2019, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2025, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2024, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2023, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2022, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2021, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2020, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2019, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
    ]);
    expect(result.candidates.some((candidate) => candidate.field === '数学・数理系' && candidate.year === 2025)).toBe(false);
    expect(result.candidates.some((candidate) => candidate.field === '数学・数理系' && candidate.year === 2021)).toBe(false);
    expect(result.diagnostics.totalRequestedMinutes).toBe(3600);
    expect(result.diagnostics.totalScheduledMinutes).toBeLessThanOrEqual(result.diagnostics.totalRequestedMinutes);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
    expect(result.diagnostics.lifeConstraintConflicts).toEqual([]);
    expect(result.diagnostics.fieldOrderPreserved).toBe(true);
    expect(result.diagnostics.completedYearsExcluded).toBe(true);
    expect(result.diagnostics.shouldSavePlan).toBe(false);
  });
  it('WP-RP-001-05 resolves life constraints, then explicit no fixed events, before draft creation', () => {
    const afterLifeConstraints = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );

    expect(afterLifeConstraints.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'meal',
          date: '2026-06-26',
          end: '19:00',
          hardness: 'hard',
        }),
        expect.objectContaining({
          kind: 'bath',
          durationMinutes: 30,
          hardness: 'soft',
        }),
        expect.objectContaining({
          kind: 'buffer',
          durationMinutes: 30,
          hardness: 'soft',
        }),
      ]),
    );
    expect(afterLifeConstraints.missing).toContain('fixed_events');
    expect(afterLifeConstraints.missing).not.toContain('sleep_cycle');
    expect(afterLifeConstraints.missing).not.toContain('meal_bath_constraints');
    expect(afterLifeConstraints.status).toBe('needs_life_constraints');
    expect(afterLifeConstraints.shouldCreateDraft).toBe(false);
    expect(afterLifeConstraints.shouldSavePlan).toBe(false);

    const state = applyWeeklyPlanningUserTurn(
      afterLifeConstraints,
      WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
      context,
    );

    expect(state.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(state.missing).not.toContain('fixed_events');
    expect(state.status).toBe('draft_ready');
    expect(state.shouldCreateDraft).toBe(true);
    expect(state.shouldSavePlan).toBe(false);
  });
});
