import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';
import {
  runWeeklyPlanningIntakePipeline,
  runWeeklyPlanningIntakePipelineWithInterpreter,
} from './weeklyPlanningIntakePipeline';

const defaultPipelineInput = {
  planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  planningDayCount: 7,
  sessionPolicy: {
    firstDayStartTime: '19:00',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    breakMinutes: 0,
  },
};

function runTurn(previousState: PlanningIntakeState | undefined, userText: string) {
  return runWeeklyPlanningIntakePipeline({
    ...defaultPipelineInput,
    previousState,
    userText,
  });
}

function runZeroProgressWeekendExamSequence() {
  const turns = [
    WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    [
      'とりあえず、院試進めたいよね',
      '5分野あって',
      '第 1 部　数学・数理系',
      '第 2 部　ソフトウェア系',
      '第 3 部　ハードウェア系',
      '第 4 部　OS とネットワーク',
      '第 5 部　ヒューマンサイエンス系',
      '七年分ある',
    ].join('\n'),
    [
      '7年分は2019〜2025',
      '一分野の一年分は3時間くらい',
    ].join('\n'),
    WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
    WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
    WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
  ];
  const outputs = [];
  let previousState: PlanningIntakeState | undefined;

  for (const userText of turns) {
    const output = runTurn(previousState, userText);
    outputs.push(output);
    previousState = output.state;
  }

  return outputs;
}

function runWeekendExamSequence() {
  const turns = [
    WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
    WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
    WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
    WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
    WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
  ];
  const outputs = [];
  let previousState: PlanningIntakeState | undefined;

  for (const userText of turns) {
    const output = runTurn(previousState, userText);
    outputs.push(output);
    previousState = output.state;
  }

  return outputs;
}

describe('weekly planning intake pipeline', () => {

  it('keeps the async interpreter entrypoint identical when no interpreter is injected', async () => {
    const input = {
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    };

    await expect(runWeeklyPlanningIntakePipelineWithInterpreter(input)).resolves.toEqual(
      runWeeklyPlanningIntakePipeline(input),
    );
  });


  describe('legacy fallback via pipeline', () => {
    it('keeps branch A assessment for a first weekly pipeline turn', () => {
      const output = runTurn(undefined, '\u6765\u9031\u3001\u82f1\u8a9e\u30923\u6642\u9593\u3001\u6570\u5b66\u30922\u6642\u9593');

      expect(output.state.intent).toBe('weekly_study_planning');
      expect(output.state.status).toBe('needs_life_constraints');
      expect(output.state.tasks).toEqual([
        {
          title: '\u82f1\u8a9e',
          subject: '\u82f1\u8a9e',
          unit: 'minutes',
          amount: 180,
          rawText: '\u82f1\u8a9e\u30923\u6642\u9593',
          requiresTimeEstimate: false,
        },
        {
          title: '\u6570\u5b66',
          subject: '\u6570\u5b66',
          unit: 'minutes',
          amount: 120,
          rawText: '\u6570\u5b66\u30922\u6642\u9593',
          requiresTimeEstimate: false,
        },
      ]);
      expect(output.state.missing).toEqual(['life_constraints']);
      expect(output.state.sourceTurns).toEqual([
        '\u6765\u9031\u3001\u82f1\u8a9e\u30923\u6642\u9593\u3001\u6570\u5b66\u30922\u6642\u9593',
      ]);
      expect(output.draftRequest).toBeNull();
      expect(output.remainingWorkItems).toBeNull();
      expect(output.draftCandidates).toBeNull();
      expect(output.diagnostics).toBeNull();
      expect(output.decision).toMatchObject({
        kind: 'ask_missing_info',
        requiredFields: ['life_constraints'],
        shouldCreateDraft: false,
        shouldSavePlan: false,
      });
      expect(output.state.shouldSavePlan).toBe(false);
    });

    it('keeps branch A inactive for first pipeline turns without a weekly keyword', () => {
      const output = runTurn(undefined, '\u82f1\u8a9e\u30923\u6642\u9593\u3001\u6570\u5b66\u30922\u6642\u9593');

      expect(output.state.intent).toBe('unknown');
      expect(output.state.status).toBe('idle');
      expect(output.state.tasks).toEqual([]);
      expect(output.state.missing).toEqual([]);
      expect(output.state.sourceTurns).toEqual([
        '\u82f1\u8a9e\u30923\u6642\u9593\u3001\u6570\u5b66\u30922\u6642\u9593',
      ]);
      expect(output.draftRequest).toBeNull();
      expect(output.remainingWorkItems).toBeNull();
      expect(output.draftCandidates).toBeNull();
      expect(output.diagnostics).toBeNull();
      expect(output.decision).toMatchObject({
        kind: 'cannot_create_draft',
        shouldCreateDraft: false,
        shouldSavePlan: false,
      });
      expect(output.state.shouldSavePlan).toBe(false);
    });

    it('documents the first-turn pipeline truthiness difference for setup-command legacy fallback', () => {
      // Reducer direct-call regression passes previousState: undefined and keeps
      // tasks empty for this same text. The pipeline passes an initial state into
      // the reducer, so branch B currently sees a truthy previousState and merges
      // the duration tasks on the first user-visible turn.
      const output = runTurn(
        undefined,
        '\u4eca\u65e5\u306e19\u6642\u304b\u3089\u571f\u65e5\u306e\u7d42\u308f\u308a\u307e\u3067\u4e88\u5b9a\u7acb\u3066\u305f\u3044\u3002\u82f1\u8a9e\u30923\u6642\u9593\u3001\u6570\u5b66\u30922\u6642\u9593',
      );

      expect(output.state.intent).toBe('weekly_study_planning');
      expect(output.state.status).toBe('needs_life_constraints');
      expect(output.state.range).toMatchObject({
        startDateTime: '2026-06-26T19:00:00',
        endDateTime: '2026-06-28T24:00:00',
        confidence: 'explicit',
      });
      expect(output.state.tasks).toEqual([
        {
          title: '\u82f1\u8a9e',
          subject: '\u82f1\u8a9e',
          unit: 'minutes',
          amount: 180,
          rawText: '\u82f1\u8a9e\u30923\u6642\u9593',
          requiresTimeEstimate: false,
        },
        {
          title: '\u6570\u5b66',
          subject: '\u6570\u5b66',
          unit: 'minutes',
          amount: 120,
          rawText: '\u6570\u5b66\u30922\u6642\u9593',
          requiresTimeEstimate: false,
        },
      ]);
      expect(output.state.missing).toEqual([
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
      ]);
      expect(output.state.missing).not.toContain('tasks_or_goals');
      expect(output.draftRequest).toBeNull();
      expect(output.remainingWorkItems).toBeNull();
      expect(output.draftCandidates).toBeNull();
      expect(output.diagnostics).toBeNull();
      expect(output.decision).toMatchObject({
        kind: 'ask_missing_info',
        requiredFields: [
          'fixed_events',
          'sleep_cycle',
          'life_constraints',
        ],
        shouldCreateDraft: false,
        shouldSavePlan: false,
      });
      expect(output.state.shouldSavePlan).toBe(false);
    });

    it('legacy fallback removes tasks_or_goals missing after branch B fills first-turn setup tasks', () => {
      const output = runTurn(
        undefined,
        '今日の19時から土日の終わりまで予定立てたい。英語を3時間、数学を2時間',
      );

      expect(output.state.intent).toBe('weekly_study_planning');
      expect(output.state.tasks).toHaveLength(2);
      expect(output.state.tasks.map((task) => task.title)).toEqual(['英語', '数学']);
      expect(output.state.missing).toEqual([
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
      ]);
      expect(output.state.missing).not.toContain('tasks_or_goals');
      expect(output.state.status).toBe('needs_life_constraints');
      expect(output.decision).toMatchObject({
        kind: 'ask_missing_info',
        requiredFields: expect.arrayContaining([
          'fixed_events',
          'sleep_cycle',
          'life_constraints',
        ]),
        shouldSavePlan: false,
      });
      expect(output.decision).toMatchObject({
        requiredFields: expect.not.arrayContaining(['tasks_or_goals']),
      });
    });

    it('legacy fallback merges a second pipeline turn into the previous weekly state', () => {
      const first = runTurn(undefined, '来週、英語を3時間、数学を2時間');
      const second = runTurn(first.state, 'あと物理を2時間');

      expect(second.state.intent).toBe('weekly_study_planning');
      expect(second.state.tasks).toEqual([
        {
          title: '英語',
          subject: '英語',
          unit: 'minutes',
          amount: 180,
          rawText: '英語を3時間',
          requiresTimeEstimate: false,
        },
        {
          title: '数学',
          subject: '数学',
          unit: 'minutes',
          amount: 120,
          rawText: '数学を2時間',
          requiresTimeEstimate: false,
        },
        {
          title: 'あと物理',
          subject: 'あと物理',
          unit: 'minutes',
          amount: 120,
          rawText: 'あと物理を2時間',
          requiresTimeEstimate: false,
        },
      ]);
      expect(second.state.missing).toEqual(['life_constraints']);
      expect(second.state.sourceTurns).toEqual([
        '来週、英語を3時間、数学を2時間',
        'あと物理を2時間',
      ]);
      expect(second.decision).toMatchObject({
        kind: 'ask_missing_info',
        requiredFields: ['life_constraints'],
        shouldSavePlan: false,
      });
    });

  });

  it('returns ask_missing_info for an under-specified first utterance', () => {
    const output = runTurn(undefined, WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly);

    expect(output.state.missing.length).toBeGreaterThan(0);
    expect(output.draftRequest).toBeNull();
    expect(output.remainingWorkItems).toBeNull();
    expect(output.draftCandidates).toBeNull();
    expect(output.diagnostics).toBeNull();
    expect(output.decision).toMatchObject({
      kind: 'ask_missing_info',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('returns confirm_ambiguity when fieldless completedYears would otherwise reach planning', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    const fieldlessState: PlanningIntakeState = {
      ...finalOutput.state,
      progress: finalOutput.state.progress.map((progress) => ({
        ...progress,
        field: undefined,
      })),
    };
    const output = runTurn(fieldlessState, 'この条件で進めて');

    expect(output.state.missing).toEqual([]);
    expect(output.draftRequest).not.toBeNull();
    expect(output.remainingWorkItems?.ambiguities).toContain(
      'completed_years_without_field_scope',
    );
    expect(output.decision).toMatchObject({
      kind: 'confirm_ambiguity',
      ambiguities: ['completed_years_without_field_scope'],
      shouldSavePlan: false,
    });
  });

  it('runs the WP-RP-001 sequence through dry-run preview without saving', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    expect(finalOutput.state.status).toBe('draft_ready');
    expect(finalOutput.draftRequest).not.toBeNull();
    expect(finalOutput.remainingWorkItems?.items.length).toBeGreaterThan(0);
    expect(finalOutput.draftCandidates?.length).toBeGreaterThan(0);
    expect(finalOutput.diagnostics?.shouldSavePlan).toBe(false);
    expect(finalOutput.decision).toMatchObject({
      kind: 'offer_dry_run_preview',
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
  });

  it('keeps draftRequest null while fixed events are still unconfirmed', () => {
    const outputs = runWeekendExamSequence();
    const beforeNoFixedEvents = outputs[4];

    expect(beforeNoFixedEvents.state.missing).toContain('fixed_events');
    expect(beforeNoFixedEvents.draftRequest).toBeNull();
    expect(beforeNoFixedEvents.remainingWorkItems).toBeNull();
    expect(beforeNoFixedEvents.draftCandidates).toBeNull();
    expect(beforeNoFixedEvents.diagnostics).toBeNull();
    expect(beforeNoFixedEvents.decision.kind).toBe('ask_missing_info');
  });

  it('moves zero-progress exam prep past cannot_create_draft in the pipeline', () => {
    const outputs = runZeroProgressWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    expect(finalOutput.state.status).toBe('draft_ready');
    expect(finalOutput.state.progress).toEqual([]);
    expect(finalOutput.draftRequest?.progress).toEqual([]);
    expect(finalOutput.remainingWorkItems?.items).toHaveLength(35);
    expect(finalOutput.remainingWorkItems?.items.every((item) => item.estimatedMinutes === 180)).toBe(true);
    expect(finalOutput.decision).toMatchObject({
      kind: 'ask_relax_constraints',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('creates draftRequest after explicit no-fixed-events confirmation', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    expect(finalOutput.state.missing).not.toContain('fixed_events');
    expect(finalOutput.draftRequest?.fixedEvents).toEqual([]);
    expect(finalOutput.draftRequest?.shouldSavePlan).toBe(false);
  });

  it('returns ask_relax_constraints when dry-run leaves unscheduled items', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: finalState,
      userText: 'この条件で進めて',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '19:00',
        dayEndTime: '20:00',
        breakMinutes: 0,
      },
    });

    expect(output.diagnostics?.unscheduledItems.length).toBeGreaterThan(0);
    expect(output.decision).toMatchObject({
      kind: 'ask_relax_constraints',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });




  it('updates remaining work items and dry-run candidates after a preview-stage completed year revision', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const mathField = finalState.examPrepScope?.fields.find((field) =>
      field.includes('\u6570\u5b66'),
    );

    if (!mathField) {
      throw new Error('expected math field');
    }

    const output = runTurn(finalState, '\u3084\u3063\u3071\u308a\u6570\u5b66\u306e2020\u3082\u7d42\u308f\u3063\u3066\u305f');
    const mathProgress = output.state.progress.find(
      (progress) => progress.field === mathField,
    );
    const mathItems = output.remainingWorkItems?.items.filter(
      (item) => item.field === mathField,
    );

    expect(mathProgress?.completedYears).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
    expect(mathItems?.map((item) => item.year)).toEqual([2019]);
    expect(output.draftCandidates?.some(
      (candidate) => candidate.field === mathField && candidate.year === 2020,
    )).toBe(false);
    expect(output.draftCandidates?.length).toBeGreaterThan(0);
    expect(output.decision).toMatchObject({
      kind: 'offer_dry_run_preview',
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
  });

  it('does not turn fieldless completed year revisions into draft changes', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const mathField = finalState.examPrepScope?.fields.find((field) =>
      field.includes('\u6570\u5b66'),
    );

    if (!mathField) {
      throw new Error('expected math field');
    }

    const output = runTurn(finalState, '2020\u3082\u7d42\u308f\u3063\u3066\u305f');
    const mathProgress = output.state.progress.find(
      (progress) => progress.field === mathField,
    );

    expect(mathProgress?.completedYears).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(output.remainingWorkItems?.items.filter(
      (item) => item.field === mathField,
    ).map((item) => item.year)).toEqual([2020, 2019]);
    expect(output.decision.shouldSavePlan).toBe(false);
  });


  it('adds a fixed event revision after preview and regenerates dry-run candidates without saving', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runTurn(finalState, '\u91d1\u66dc\u306e16\u6642\u304b\u3089\u30d0\u30a4\u30c8');

    expect(output.state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fixed_event',
          date: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
          start: '16:00',
          durationMinutes: 60,
          hardness: 'hard',
        }),
      ]),
    );
    expect(output.draftRequest?.fixedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'fixed_event', start: '16:00' }),
      ]),
    );
    expect(output.draftCandidates?.length).toBeGreaterThan(0);
    expect(output.decision.shouldSavePlan).toBe(false);
  });

  it('updates an existing life constraint after preview without duplicating the same kind', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runTurn(finalState, '\u98a8\u5442\u306f21\u6642\u306b\u3057\u3066');
    const bathConstraints = output.state.constraints.filter(
      (constraint) => constraint.kind === 'bath',
    );

    expect(bathConstraints).toEqual([
      expect.objectContaining({
        kind: 'bath',
        date: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
        start: '21:00',
        durationMinutes: 30,
        hardness: 'hard',
      }),
    ]);
    expect(output.draftRequest?.constraints.filter(
      (constraint) => constraint.kind === 'bath',
    )).toEqual([
      expect.objectContaining({ kind: 'bath', start: '21:00' }),
    ]);
    expect(output.draftCandidates?.length).toBeGreaterThan(0);
    expect(output.decision.shouldSavePlan).toBe(false);
  });

  it('updates field-first priority after preview and regenerates remaining work item order', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const softwareField = finalState.examPrepScope?.fields.find((field) =>
      field.includes('\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2'),
    );

    if (!softwareField) {
      throw new Error('expected software field');
    }

    const output = runTurn(finalState, '\u30bd\u30d5\u30c8\u30a6\u30a7\u30a2\u3092\u5148\u306b\u3057\u305f\u3044');

    expect(output.state.priorityPolicy).toMatchObject({
      kind: 'field_first',
      order: expect.arrayContaining([softwareField]),
    });
    expect(output.state.priorityPolicy.kind === 'field_first'
      ? output.state.priorityPolicy.order
      : undefined).toEqual([softwareField, finalState.examPrepScope?.fields.find((field) =>
        field.includes('\u6570\u5b66'),
      )]);
    expect(output.remainingWorkItems?.items[0]?.field).toBe(softwareField);
    expect(output.draftCandidates?.[0]?.field).toBe(softwareField);
    expect(output.decision.shouldSavePlan).toBe(false);
  });

  it('adds unavailable time constraints after preview and regenerates candidates without scheduling inside the blocked range', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runTurn(finalState, '\u5915\u65b9\u306f\u4f7f\u308f\u306a\u3044\u3067');
    const overlapsEvening = output.draftCandidates?.some((candidate) => {
      const [startHour, startMinute] = candidate.startTime.split(':').map(Number);
      const [endHour, endMinute] = candidate.endTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      return startMinutes < 19 * 60 && 16 * 60 < endMinutes;
    });

    expect(output.state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unavailable',
          start: '16:00',
          end: '19:00',
          hardness: 'hard',
        }),
      ]),
    );
    expect(output.draftRequest?.fixedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unavailable', start: '16:00', end: '19:00' }),
      ]),
    );
    expect(output.draftCandidates?.length).toBeGreaterThan(0);
    expect(overlapsEvening).toBe(false);
    expect(output.decision.shouldSavePlan).toBe(false);
  });

  it('adds unavailable whole-day constraints after preview and keeps draft generation unsaved', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: finalState,
      userText: '7\u67083\u65e5\u306f\u4f7f\u308f\u306a\u3044\u3067',
      planningDayCount: 8,
    });

    expect(output.state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unavailable',
          date: '2026-07-03',
          start: '00:00',
          end: '24:00',
          hardness: 'hard',
        }),
      ]),
    );
    expect(output.draftRequest?.fixedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unavailable', date: '2026-07-03' }),
      ]),
    );
    expect(output.diagnostics?.shouldSavePlan).toBe(false);
    expect(output.decision.shouldSavePlan).toBe(false);
  });
  it('is deterministic for the same input sequence', () => {
    expect(runWeekendExamSequence()).toEqual(runWeekendExamSequence());
  });
});