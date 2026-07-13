import { describe, expect, it } from 'vitest';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type {
  ConstraintSourceKind,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  InterpretedCommandCandidate,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
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

function plan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: 'バイト',
    subject: 'バイト',
    date: '2026-06-30',
    startTime: '20:00',
    endTime: '22:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function draftReadyState(): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'exam_prep_planning',
    examPrepScope: {
      examType: '院試',
      fields: ['数学'],
      totalFields: 1,
      totalYears: 1,
      yearRange: { startYear: 2020, endYear: 2020, sourceText: '2020' },
      strategyHint: 'field_first',
      unitModel: 'year_field_chunk',
      rawText: ['数学 2020'],
    },
    tasks: [],
    progress: [],
    unitRates: [
      {
        unit: 'year_field_chunk',
        minutesPerUnit: 60,
        source: 'user',
        uncertainty: 'low',
        rawText: '1年分1時間',
      },
    ],
    constraints: [],
    priorityPolicy: { kind: 'field_first', order: ['数学'] },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: [],
  };
}


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



function assumablePreviewState(): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'exam_prep_planning',
    pendingPlanningRange: {
      scope: {
        kind: 'next_week',
        label: '来週',
        startDate: '2026-07-20',
        endDate: '2026-07-26',
      },
      durationDays: 7,
      sourceText: '来週',
    },
    examPrepScope: {
      examType: '院試',
      fields: ['数学', 'ソフトウェア', 'ハードウェア', 'ネットワーク', '英語'],
      totalFields: 5,
      totalYears: 7,
      unitModel: 'year_field_chunk',
      rawText: ['院試の5分野を7年分'],
    },
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [
      'planning_start_date',
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
      'year_range',
      'progress',
      'completion_direction',
      'unit_duration_estimate',
      'priority_policy',
      'next_field_after_math',
      'life_constraints',
    ],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: ['来週、院試の過去問を5分野で7年分進めたい'],
  };
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


  it.each([
    '予定作りたい',
    '明日と明後日の予定立てたい',
  ])('opens the intake with planning period and learning-content questions: %s', (userText) => {
    const output = runTurn(undefined, userText);

    expect(output.state.intent).toBe('weekly_study_planning');
    expect(output.state.missing).toEqual(
      expect.arrayContaining(['planning_period', 'tasks_or_goals']),
    );
    expect(output.decision).toMatchObject({
      kind: 'ask_missing_info',
      messageKey: 'ask_planning_period',
      questionPlan: [
        expect.objectContaining({ targetSlot: 'planning_period', intent: 'ask_planning_period' }),
        expect.objectContaining({ targetSlot: 'tasks_or_goals', intent: 'ask_tasks_or_goals' }),
      ],
    });
    expect(output.decision.messageKey).not.toContain('cannot_create');
  });

  it('connects a begin turn to a later period answer without re-asking the begin intent', () => {
    const started = runTurn(undefined, '予定作りたい');
    const continued = runTurn(started.state, '来週の計画を立てたい');

    expect(continued.state.pendingPlanningRange?.scope.kind).toBe('next_week');
    expect(continued.state.missing).not.toContain('planning_period');
    expect(continued.decision.questionPlan).toEqual([
      expect.objectContaining({ targetSlot: 'planning_start_date' }),
      expect.objectContaining({ targetSlot: 'tasks_or_goals' }),
    ]);
  });

  it('does not seed redundant begin slots when one turn already includes range and exam scope', () => {
    const output = runTurn(
      undefined,
      '7日間、院試の数学の過去問を計画したい',
    );

    expect(output.state.range).toBeDefined();
    expect(output.state.examPrepScope).toBeDefined();
    expect(output.state.missing).not.toContain('planning_period');
    expect(output.state.missing).not.toContain('tasks_or_goals');
    expect(output.decision.questionPlan).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetSlot: 'planning_period' }),
        expect.objectContaining({ targetSlot: 'tasks_or_goals' }),
      ]),
    );
  });

  it('routes a pending next-week start utterance to start-date and learning-content questions', () => {
    const output = runTurn(undefined, '来週の予定を立てたい');

    expect(output.state.pendingPlanningRange?.scope.kind).toBe('next_week');
    expect(output.state.missing).toContain('planning_start_date');
    expect(output.state.missing).toContain('tasks_or_goals');
    expect(output.state.missing).not.toContain('planning_period');
    expect(output.decision.questionPlan).toEqual([
      expect.objectContaining({ targetSlot: 'planning_start_date' }),
      expect.objectContaining({ targetSlot: 'tasks_or_goals' }),
    ]);
    expect(output.decision.messageKey).toBe('ask_planning_start_date');
  });

  it('classifies an uninterpretable first turn as an open planning dialogue', () => {
    const output = runTurn(undefined, 'こんにちは');

    expect(output.state.intent).toBe('unknown');
    expect(output.decision.kind).toBe('open_planning_dialogue');
    expect(output.decision.messageKey).toBe('open_weekly_planning_dialogue');
  });

  it('keeps an empty AI candidate result on the same open-dialogue taxonomy without rules fallback', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'こんにちは',
      interpreter: fakeInterpreter([]),
    });

    expect(output.interpreterDiagnostics?.accepted).toEqual([]);
    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
    expect(output.decision.kind).toBe('open_planning_dialogue');
    expect(output.state.intent).toBe('unknown');
  });

  it('applies a provider begin command without requiring deterministic semantic parsing', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'start',
      interpreter: fakeInterpreter([{
        command: {
          type: 'begin_weekly_planning',
          sourceText: 'start',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(output.interpreterDiagnostics?.accepted).toEqual([
      expect.objectContaining({ type: 'begin_weekly_planning' }),
    ]);
    expect(output.state.missing).toEqual(
      expect.arrayContaining(['planning_period', 'tasks_or_goals']),
    );
    expect(output.decision.kind).toBe('ask_missing_info');
  });

  it('accepts a provider set_study_goal and reaches the capability-gap decision', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: '数学のテスト勉強したい',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_study_goal',
          goal: { title: '数学のテスト勉強', subject: '数学' },
          sourceText: '数学のテスト勉強したい',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(output.state.tasks).toEqual([
      expect.objectContaining({
        title: '数学のテスト勉強',
        subject: '数学',
        unit: 'unknown',
        requiresTimeEstimate: true,
      }),
    ]);
    expect(output.state.tasksSource).toBe('command');
    expect(output.state.missing).not.toContain('tasks_or_goals');
    expect(output.state.intent).toBe('weekly_study_planning');
    expect(output.decision).toMatchObject({
      kind: 'explain_capability_gap',
      messageKey: 'explain_weekly_planning_capability_gap',
    });
  });

  it('recovers a goal from a later provider turn without re-asking tasks_or_goals', async () => {
    const first = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: '数学のテスト勉強したい',
      interpreter: fakeInterpreter([]),
    });
    const second = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: first.state,
      userText: 'テスト勉強はゴールでしょ？',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_study_goal',
          goal: { title: '数学のテスト勉強', subject: '数学' },
          sourceText: 'テスト勉強はゴールでしょ？',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(first.decision.kind).toBe('open_planning_dialogue');
    expect(second.state.tasksSource).toBe('command');
    expect(second.state.tasks).toEqual([
      expect.objectContaining({ title: '数学のテスト勉強' }),
    ]);
    expect(second.state.missing).not.toContain('tasks_or_goals');
    expect(second.decision.kind).toBe('explain_capability_gap');
  });

  it('upserts a same-title goal and appends a different-title goal', async () => {
    const first = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'goal one',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_study_goal',
          goal: { title: '数学', subject: '数学', unit: 'hours', amount: 2 },
          sourceText: 'goal one',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });
    const second = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: first.state,
      userText: 'goal two',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_study_goal',
          goal: { title: '数学', subject: '数学', unit: 'hours', amount: 3 },
          sourceText: 'goal two',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }, {
        command: {
          type: 'set_study_goal',
          goal: { title: '英語', subject: '英語' },
          sourceText: 'goal two',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(second.state.tasks).toHaveLength(2);
    expect(second.state.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '数学', amount: 3 }),
      expect.objectContaining({ title: '英語' }),
    ]));
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
        kind: 'open_planning_dialogue',
        messageKey: 'open_weekly_planning_dialogue',
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
        ],
        questionPlan: [
          expect.objectContaining({ targetSlot: 'fixed_events', missing: ['fixed_events'] }),
          expect.objectContaining({ targetSlot: 'sleep_cycle', missing: ['sleep_cycle'] }),
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
        requiredFields: [
          'fixed_events',
          'sleep_cycle',
        ],
        shouldSavePlan: false,
      });
      expect(output.decision).toMatchObject({
        requiredFields: expect.not.arrayContaining(['tasks_or_goals']),
      });
    });

    it('does not ask fixed events or sleep again after a compound turn fills both slots', () => {
      const first = runTurn(
        undefined,
        '今日の19時から土日の終わりまで予定立てたい。英語を3時間、数学を2時間',
      );
      const second = runTurn(first.state, '固定予定はない。普段は8時に起きて、10時から勉強できる');

      expect(second.state.missing).not.toContain('fixed_events');
      expect(second.state.missing).not.toContain('sleep_cycle');
      expect(second.state.missing).toContain('meal_bath_constraints');
      expect(second.decision).toMatchObject({
        kind: 'ask_missing_info',
        requiredFields: ['meal_bath_constraints'],
        questionPlan: [
          expect.objectContaining({
            targetSlot: 'meal_bath_constraints',
            missing: ['meal_bath_constraints'],
          }),
        ],
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


  it('passes existing plans to the new intake dry-run generator as hard busy intervals', () => {
    const output = runWeeklyPlanningIntakePipeline({
      previousState: draftReadyState(),
      userText: 'この条件で作成',
      planningStartDate: '2026-06-30',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '20:30',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
      existingPlans: [
        plan({
          date: '2026-06-30',
          startTime: '20:00',
          endTime: '22:00',
        }),
      ],
    });

    expect(output.draftRequest).not.toBeNull();
    expect(output.draftCandidates).toEqual([]);
    expect(output.diagnostics?.unscheduledItems).toHaveLength(1);
    expect(output.diagnostics?.constraintConflicts).toEqual([]);
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
    expect(beforeNoFixedEvents.draftCandidates?.length).toBeGreaterThan(0);
    expect(beforeNoFixedEvents.diagnostics).not.toBeNull();
    expect(beforeNoFixedEvents.decision.kind).toBe('offer_dry_run_preview');
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

function timetableTemplate(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'tpl-1',
    userId: 'user-1',
    title: '授業',
    subject: '数学',
    type: 'study',
    weekday: 'thu',
    startTime: '13:00',
    endTime: '14:30',
    termId: 'default',
    memo: '',
    active: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeInterpreter(candidates: InterpretedCommandCandidate[]): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn() {
      return { candidates, parseRejections: [] };
    },
  };
}

function useConstraintSourceCandidate(params: {
  kind: ConstraintSourceKind;
  sourceText: string;
}): InterpretedCommandCandidate {
  return {
    command: {
      type: 'use_constraint_source',
      source: { kind: params.kind, selector: 'active' },
      sourceText: params.sourceText,
      confidence: 'high',
    },
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

function addFixedEventCandidate(sourceText: string): InterpretedCommandCandidate {
  return {
    command: {
      type: 'add_fixed_event',
      event: { start: '18:00', end: '20:30', hardness: 'hard' },
      sourceText,
      confidence: 'high',
    },
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

// fixed_events を含む missing 途中状態(WP-RP-001 の no-fixed-events 前)を作る。
function stateWithFixedEventsMissing(): PlanningIntakeState {
  const outputs = runWeekendExamSequence();
  const beforeNoFixedEvents = outputs[4];

  if (!beforeNoFixedEvents) {
    throw new Error('expected pre-no-fixed-events state');
  }

  expect(beforeNoFixedEvents.state.missing).toContain('fixed_events');
  return beforeNoFixedEvents.state;
}

describe('constraint source capability (use_constraint_source)', () => {
  // 「予定表の通り」の同義表現。すべて同じ use_constraint_source(timetable) に写像される前提。
  const timetablePhrasings = [
    '授業は予定表に記載されている通りにあります',
    '時間割に入っている予定を使って',
    '登録済みの授業を考慮して',
    'いつもの授業を避けて',
    '普段通りの授業があります',
  ];

  it('satisfies fixed_events when timetable is non-empty (use_constraint_source)', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: timetablePhrasings[0],
      scheduleTemplates: [timetableTemplate()],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({ kind: 'timetable', sourceText: timetablePhrasings[0] }),
      ]),
    });

    expect(output.state.missing).not.toContain('fixed_events');
    expect(output.state.constraintSourcesInUse).toEqual([
      { kind: 'timetable', selector: 'active' },
    ]);
  });

  it('maps every timetable phrasing to the same intent and the same resulting state', async () => {
    const baseState = stateWithFixedEventsMissing();

    const results = await Promise.all(
      timetablePhrasings.map((phrasing) =>
        runWeeklyPlanningIntakePipelineWithInterpreter({
          ...defaultPipelineInput,
          previousState: baseState,
          userText: phrasing,
          scheduleTemplates: [timetableTemplate()],
          interpreter: fakeInterpreter([
            useConstraintSourceCandidate({ kind: 'timetable', sourceText: phrasing }),
          ]),
        }),
      ),
    );

    // 表現ゆれに依らず missing と constraintSourcesInUse が同一(semantic level で同じ intent)。
    for (const result of results) {
      expect(result.state.missing).not.toContain('fixed_events');
      expect(result.state.constraintSourcesInUse).toEqual([
        { kind: 'timetable', selector: 'active' },
      ]);
    }
  });

  it('does not satisfy fixed_events and falls to confirmation when the timetable is empty', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: timetablePhrasings[0],
      scheduleTemplates: [],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({ kind: 'timetable', sourceText: timetablePhrasings[0] }),
      ]),
    });

    // 空ソースを鵜呑みにしない: fixed_events は残り、確認メモが積まれる。
    expect(output.state.missing).toContain('fixed_events');
    expect(output.state.constraintSourcesInUse ?? []).toEqual([]);
    expect(output.state.assumptions.some((note) => note.includes('見つかりませんでした'))).toBe(true);
  });

  it('satisfies fixed_events via the existing add_fixed_event capability for a time-explicit part-time job', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: '今日の夜18〜20:30でバイトがあります',
      interpreter: fakeInterpreter([addFixedEventCandidate('今日の夜18〜20:30でバイトがあります')]),
    });

    expect(output.state.missing).not.toContain('fixed_events');
    expect(output.state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'fixed_event', start: '18:00', hardness: 'hard' }),
      ]),
    );
  });

  it('resolves existing_plans source against the existing plan count', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: '登録済みの予定を考慮して',
      existingPlans: [plan({ date: '2026-06-30' })],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({ kind: 'existing_plans', sourceText: '登録済みの予定を考慮して' }),
      ]),
    });

    expect(output.state.missing).not.toContain('fixed_events');
    expect(output.state.constraintSourcesInUse).toEqual([
      { kind: 'existing_plans', selector: 'active' },
    ]);
  });


  it('clarifies ambiguous constraint source references before hard applying nano-style candidates', async () => {
    const previousState = stateWithFixedEventsMissing();
    const missingBefore = [...previousState.missing];
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: '入れてあるやつをそのまま考慮して',
      existingPlans: [plan({ date: '2026-06-30' })],
      scheduleTemplates: [timetableTemplate()],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({
          kind: 'existing_plans',
          sourceText: '入れてあるやつをそのまま考慮して',
        }),
      ]),
    });

    expect(output.state.missing).toEqual(missingBefore);
    expect(output.state.constraintSourcesInUse ?? []).toEqual([]);
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.interpreterDiagnostics?.clarificationRequests).toEqual([
      expect.objectContaining({
        type: 'request_clarification',
        target: 'unresolved_slot',
        ref: 'constraint_source',
      }),
    ]);
    expect(output.interpreterDiagnostics?.rejected).toEqual([
      expect.objectContaining({ reason: 'constraint-source-reference-multiple' }),
    ]);
  });

  it('clarifies ambiguous calendar wording when multiple constraint sources are active', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: 'カレンダーに入ってる予定を使って',
      existingPlans: [plan({ date: '2026-06-30' })],
      scheduleTemplates: [timetableTemplate()],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({
          kind: 'existing_plans',
          sourceText: 'カレンダーに入ってる予定を使って',
        }),
      ]),
    });

    expect(output.state.constraintSourcesInUse ?? []).toEqual([]);
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.interpreterDiagnostics?.clarificationRequests[0]).toEqual(
      expect.objectContaining({ target: 'unresolved_slot', ref: 'constraint_source' }),
    );
  });
});

describe('planning range reseed and confidence guards', () => {
  it('does not reseed answered scope when a pending range becomes explicit', () => {
    const firstOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const secondOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(secondOutput.state.examPrepScope).toBeDefined();
    expect(secondOutput.state.missing).not.toContain('tasks_or_goals');
    expect(secondOutput.state.missing).toEqual(expect.arrayContaining([
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
    ]));
    expect(secondOutput.decision.questionPlan?.some(
      (question) => question.targetSlot === 'tasks_or_goals',
    )).toBe(false);
  });

  it('does not reseed fixed events collected while the planning range is pending', () => {
    const firstOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const fixedEventOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: '日曜の13時から歯医者',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const rangeOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: fixedEventOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(rangeOutput.state.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_event', start: '13:00' }),
    ]));
    expect(rangeOutput.state.missing).not.toContain('fixed_events');
  });

  it('keeps an explicit range when a later turn only yields an inferred range', () => {
    const pendingOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const explicitOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: pendingOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const laterOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: { ...explicitOutput.state, missing: [] },
      userText: 'この一週間で数学を重点的にやりたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(laterOutput.state.range?.startDateTime).toBe('2026-07-15T00:00:00');
    expect(laterOutput.state.missing).not.toEqual(expect.arrayContaining([
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
    ]));
  });

  it('allows an explicit range to replace an existing explicit range', () => {
    const pendingOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const explicitOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: pendingOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const replacedOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: explicitOutput.state,
      userText: '7月20日から一週間で',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(replacedOutput.state.range).toMatchObject({
      startDateTime: '2026-07-20T00:00:00',
      confidence: 'explicit',
    });
  });

  it('keeps a future scope pending when one-week wording is repeated without a start day', () => {
    const firstOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const secondOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: 'この一週間で考えたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(secondOutput.state.range).toBeUndefined();
    expect(secondOutput.state.pendingPlanningRange?.scope.label).toBe('来週');
    expect(secondOutput.state.missing).toContain('planning_start_date');
  });
});

function requestClarificationCandidate(params: {
  sourceText: string;
  ref?: string;
}): InterpretedCommandCandidate {
  return {
    command: {
      type: 'request_clarification',
      target: 'referenced_term',
      ref: params.ref,
      sourceText: params.sourceText,
      confidence: 'high',
    },
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

describe('clarification semantic intent (request_clarification)', () => {
  // 聞き返しの同義表現。すべて同じ request_clarification に写像される前提。
  const clarificationPhrasings = [
    '固定の予定って何ですか？',
    'それってどういう意味？',
    '何を答えればいいの？',
  ];

  it('answers a term clarification without advancing state (missing unchanged)', async () => {
    const previousState = stateWithFixedEventsMissing();
    const missingBefore = [...previousState.missing];

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: clarificationPhrasings[0],
      interpreter: fakeInterpreter([
        requestClarificationCandidate({ sourceText: clarificationPhrasings[0], ref: 'fixed_events' }),
      ]),
    });

    expect(output.state.missing).toEqual(missingBefore);
    expect(output.state.uncertainties).toEqual([]);
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.explanation).toContain('固定の予定');
    // 直前の質問(fixed_events)が維持される。
    expect(output.decision.questionPlan?.some((question) => question.targetSlot === 'fixed_events')).toBe(true);
  });

  it('maps every clarification phrasing to the same intent and keeps state intact', async () => {
    const baseState = stateWithFixedEventsMissing();
    const missingBefore = [...baseState.missing];

    const results = await Promise.all(
      clarificationPhrasings.map((phrasing) =>
        runWeeklyPlanningIntakePipelineWithInterpreter({
          ...defaultPipelineInput,
          previousState: baseState,
          userText: phrasing,
          interpreter: fakeInterpreter([requestClarificationCandidate({ sourceText: phrasing, ref: 'fixed_events' })]),
        }),
      ),
    );

    for (const result of results) {
      expect(result.decision.kind).toBe('answer_clarification');
      expect(result.state.missing).toEqual(missingBefore);
    }
  });

  it('does not map a clarification to note_uncertainty or any answer command', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithFixedEventsMissing(),
      userText: clarificationPhrasings[0],
      interpreter: fakeInterpreter([
        requestClarificationCandidate({ sourceText: clarificationPhrasings[0], ref: '固定の予定' }),
      ]),
    });

    expect(output.state.uncertainties).toEqual([]);
    expect(output.state.unitRates).toEqual(stateWithFixedEventsMissing().unitRates);
    expect(output.decision.kind).toBe('answer_clarification');
  });

  it('keeps future weekly scope pending until a start day is clarified', () => {
    const firstOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(firstOutput.state.range).toBeUndefined();
    expect(firstOutput.state.pendingPlanningRange).toMatchObject({
      scope: { kind: 'next_week', label: '来週', startDate: '2026-07-13' },
      durationDays: 7,
    });
    expect(firstOutput.state.missing).toContain('planning_start_date');
    expect(firstOutput.state.questions).toContain('来週のどの日から計画を始めますか？');
    expect(firstOutput.decision).toMatchObject({
      kind: 'ask_missing_info',
      messageKey: 'ask_planning_start_date',
    });

    const secondOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(secondOutput.state.pendingPlanningRange).toBeUndefined();
    expect(secondOutput.state.range).toMatchObject({
      startDateTime: '2026-07-15T00:00:00',
      endDateTime: '2026-07-21T24:00:00',
    });
    expect(secondOutput.state.missing).not.toContain('planning_start_date');
  });

  it('uses resolved planning range as the scheduler window and first-day lower bound', () => {
    const output = runWeeklyPlanningIntakePipeline({
      previousState: {
        ...draftReadyState(),
        range: {
          startDateTime: '2026-07-15T16:00:00',
          endDateTime: '2026-07-21T24:00:00',
          calendarDayCount: 7,
          confidence: 'explicit',
        },
      },
      userText: 'この条件で作成',
      planningStartDate: '2026-07-10',
      planningDayCount: 7,
      sessionPolicy: {
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(output.draftCandidates?.[0]).toMatchObject({
      date: '2026-07-15',
      startTime: '16:00',
    });
  });

  it('applies accepted fixed events before returning a term clarification', async () => {
    const previousState = stateWithFixedEventsMissing();
    const clarification = requestClarificationCandidate({
      sourceText: '固定の予定って何ですか？',
      ref: 'fixed_events',
    });
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: '予定も伝えます。固定の予定って何ですか？',
      interpreter: fakeInterpreter([
        addFixedEventCandidate('予定も伝えます'),
        clarification,
      ]),
    });

    expect(output.state.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_event', start: '18:00', hardness: 'hard' }),
    ]));
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.explanation).toContain('固定の予定');
    expect(output.decision.questionPlan ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetSlot: 'fixed_events' }),
    ]));
    expect(output.interpreterDiagnostics?.accepted).toEqual([
      expect.objectContaining({ type: 'add_fixed_event' }),
    ]);
    expect(output.interpreterDiagnostics?.clarificationRequests).toEqual([
      expect.objectContaining({ type: 'request_clarification', ref: 'fixed_events' }),
    ]);
    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
  });

  it('keeps confirmation assumptions while answering a clarification in the same turn', async () => {
    const previousState = stateWithFixedEventsMissing();
    const confirmationCandidate: InterpretedCommandCandidate = {
      command: {
        type: 'add_fixed_event',
        event: { start: '18:00', end: '20:30', hardness: 'hard' },
        sourceText: '予定も伝えます',
        confidence: 'medium',
      },
      origin: 'ai_interpreter',
      needsConfirmation: true,
    };
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: '予定も伝えます。固定の予定って何ですか？',
      interpreter: fakeInterpreter([
        confirmationCandidate,
        requestClarificationCandidate({
          sourceText: '固定の予定って何ですか？',
          ref: 'fixed_events',
        }),
      ]),
    });

    expect(output.state.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_event', start: '18:00' }),
    ]));
    expect(output.state.assumptions).toEqual(expect.arrayContaining([
      expect.stringContaining('add_fixed_event'),
    ]));
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.questionPlan ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetSlot: 'fixed_events' }),
    ]));
    expect(output.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'add_fixed_event' }),
    ]);
  });

  it('does not apply low-confidence candidates without a clarification request', async () => {
    const previousState = stateWithFixedEventsMissing();
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: 'この条件について補足があります',
      interpreter: fakeInterpreter([{
        command: {
          type: 'add_fixed_event',
          event: { start: '18:00', end: '20:30', hardness: 'hard' },
          sourceText: 'この条件について補足があります',
          confidence: 'low',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(output.state.constraints).toEqual(previousState.constraints);
    expect(output.interpreterDiagnostics?.accepted).toEqual([]);
    expect(output.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([]);
    expect(output.interpreterDiagnostics?.clarifications).toHaveLength(1);
    expect(output.interpreterDiagnostics?.clarificationRequests).toEqual([]);
  });

});

describe('confirmed slots and AI planning range integration', () => {
  function planningRangeCandidate(
    rangeConfidence: 'explicit' | 'inferred',
  ): InterpretedCommandCandidate {
    return {
      command: {
        type: 'set_planning_range',
        range: {
          startDateTime: '2026-08-01T00:00:00',
          endDateTime: '2026-08-05T24:00:00',
          sourceText: '8月1日から5日間',
          confidence: rangeConfidence,
        },
        sourceText: '8月1日から5日間',
        confidence: 'high',
      },
      origin: 'ai_interpreter',
      needsConfirmation: false,
    };
  }

  function pendingScopeState(): PlanningIntakeState {
    return runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: '来週の計画を立てたい。院試の過去問を7年分、5分野やりたい。',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    }).state;
  }

  it('applies an explicit AI range whose start is inside the pending window', async () => { const output = await runWeeklyPlanningIntakePipelineWithInterpreter({ ...defaultPipelineInput, previousState: pendingScopeState(), userText: 'window range', planningStartDate: '2026-07-10', currentDateTime: '2026-07-10T15:30:00', interpreter: fakeInterpreter([{ command: { type: 'set_planning_range', range: { startDateTime: '2026-07-15T00:00:00', endDateTime: '2026-07-19T24:00:00', sourceText: 'window range', confidence: 'explicit' }, sourceText: 'window range', confidence: 'high' }, origin: 'ai_interpreter', needsConfirmation: false }]) }); expect(output.interpreterDiagnostics?.accepted).toEqual([expect.objectContaining({ type: 'set_planning_range' })]); expect(output.state.range?.startDateTime).toBe('2026-07-15T00:00:00'); expect(output.state.pendingPlanningRange).toBeUndefined(); });

  function pendingRangeCandidate(
    pending: unknown,
  ): InterpretedCommandCandidate {
    return {
      command: {
        type: 'set_pending_planning_range',
        pending,
        sourceText: 'pending range',
        confidence: 'high',
      } as unknown as InterpretedCommandCandidate['command'],
      origin: 'ai_interpreter',
      needsConfirmation: false,
    };
  }

  it('applies a provider pending next_week command through deterministic normalization', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'next week plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'next_week', label: 'next week' },
          sourceText: 'next week plan',
        }),
      ]),
    });

    expect(output.state.pendingPlanningRange).toMatchObject({
      scope: {
        kind: 'next_week',
        startDate: '2026-07-13',
        endDate: '2026-07-19',
      },
      durationDays: 7,
    });
    expect(output.state.missing).toContain('planning_start_date');
    expect(output.decision.messageKey).toBe('ask_planning_start_date');
  });

  it('accepts an explicit provider range after a normalized pending next_week command', async () => {
    const pending = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'next week plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'next_week', label: 'next week' },
          sourceText: 'next week plan',
        }),
      ]),
    });
    const resolved = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pending.state,
      userText: 'Wednesday',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_planning_range',
          range: {
            startDateTime: '2026-07-15T00:00:00',
            endDateTime: '2026-07-19T24:00:00',
            sourceText: 'Wednesday',
            confidence: 'explicit',
          },
          sourceText: 'Wednesday',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(resolved.state.pendingPlanningRange).toBeUndefined();
    expect(resolved.state.range?.startDateTime).toBe('2026-07-15T00:00:00');
  });

  it('keeps named future periods unresolved until an explicit range is supplied', async () => {
    const pending = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'summer break plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'named_future_period', label: 'summer break' },
          sourceText: 'summer break plan',
        }),
      ]),
    });

    expect(pending.state.pendingPlanningRange?.scope.startDate).toBeUndefined();
    expect(pending.state.pendingPlanningRange?.scope.endDate).toBeUndefined();

    const unresolved = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pending.state,
      userText: 'August 1',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        planningRangeCandidate('explicit'),
      ]),
    });

    expect(unresolved.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
    ]);
    expect(unresolved.state.range).toBeUndefined();
    expect(unresolved.state.pendingPlanningRange).toBeDefined();
  });

  it('rejects provider pending creation after a planning range is confirmed', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: {
        ...draftReadyState(),
        range: {
          startDateTime: '2026-07-01T00:00:00',
          endDateTime: '2026-07-07T24:00:00',
          sourceText: 'confirmed range',
          calendarDayCount: 7,
          confidence: 'explicit',
        },
      },
      userText: 'next week plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'next_week', label: 'next week' },
          sourceText: 'next week plan',
        }),
      ]),
    });

    expect(output.interpreterDiagnostics?.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
    expect(output.state.range?.startDateTime).toBe('2026-07-01T00:00:00');
  });

  it('accepts a timetable source while range is pending and keeps it after range resolution', async () => {
    const sourceOutput = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: '時間割の通りでお願いします',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      scheduleTemplates: [timetableTemplate()],
      interpreter: fakeInterpreter([
        useConstraintSourceCandidate({
          kind: 'timetable',
          sourceText: '時間割の通りでお願いします',
        }),
      ]),
    });

    expect(sourceOutput.state.constraintSourcesInUse).toEqual([
      { kind: 'timetable', selector: 'active' },
    ]);
    expect(sourceOutput.interpreterDiagnostics?.rejected).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]));

    const resolvedOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: sourceOutput.state,
      userText: '水曜日から',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    expect(resolvedOutput.state.missing).not.toContain('fixed_events');
  });

  it('still rejects AI fixed events after a hard fixed event was recorded', async () => {
    const fixedOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: '日曜の13時から歯医者',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    });
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: fixedOutput.state,
      userText: 'ほかにも予定があります',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([addFixedEventCandidate('ほかにも予定があります')]),
    });

    expect(output.interpreterDiagnostics?.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]));
  });

  it('treats a no-fixed-events declaration as confirmed on later turns', async () => {
    const rangeOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    });
    const noneOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: rangeOutput.state,
      userText: '固定の予定はありません',
    });
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: noneOutput.state,
      userText: 'ほかにも予定があります',
      interpreter: fakeInterpreter([addFixedEventCandidate('ほかにも予定があります')]),
    });

    expect(output.state.fixedEventsDeclaredNone).toBe(true);
    expect(output.interpreterDiagnostics?.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]));
  });

  it('keeps existing confirmed-slot derivation while ignoring missing proxies', async () => {
    const previousState: PlanningIntakeState = {
      ...draftReadyState(),
      status: 'needs_life_constraints',
      range: {
        startDateTime: '2026-07-10T00:00:00',
        endDateTime: '2026-07-16T24:00:00',
        calendarDayCount: 7,
        confidence: 'explicit',
      },
      progress: [{
        field: '数学',
        completedYears: [2020],
        ambiguity: 'none',
        rawText: '2020は完了',
      }],
      constraints: [
        { kind: 'fixed_event', start: '13:00', end: '14:00', hardness: 'hard' },
        { kind: 'sleep', start: '23:00', end: '07:00', hardness: 'hard' },
        { kind: 'meal', start: '19:00', durationMinutes: 30, hardness: 'hard' },
      ],
      missing: ['fixed_events', 'life_constraints', 'meal_bath_constraints'],
      shouldCreateDraft: false,
    };
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      expect(params.stateSummary.confirmedSlots).toEqual(expect.arrayContaining([
        'planning_range',
        'exam_scope',
        'year_range',
        'unit_duration_estimate',
        'priority_policy',
        'progress',
        'fixed_events',
        'life_constraints',
      ]));
      return { candidates: [], parseRejections: [] };
    };

    await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: 'この条件を詳しく確認してほしいです',
      interpreter: { interpretUserTurn },
    });
  });

  it('normalizes an AI planning range and schedules from its first date', async () => {
    const previousState: PlanningIntakeState = {
      ...draftReadyState(),
      status: 'needs_scope',
      constraints: [
        { kind: 'sleep', start: '23:00', end: '07:00', hardness: 'hard' },
        { kind: 'meal', start: '19:00', durationMinutes: 30, hardness: 'hard' },
      ],
      fixedEventsDeclaredNone: true,
      missing: ['planning_start_date'],
      shouldCreateDraft: false,
    };
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: '8月の前半を使いたいです',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([planningRangeCandidate('explicit')]),
    });

    expect(output.state.range?.calendarDayCount).toBe(5);
    expect(output.draftCandidates?.[0]?.date).toBe('2026-08-01');
  });

  it('keeps pending clarification for inferred AI ranges and exposes pending summary', async () => {
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      expect(params.stateSummary.pendingPlanningRange).toEqual({
        label: '来週',
        startDate: '2026-07-13',
        endDate: '2026-07-19',
      });
      return {
        candidates: [planningRangeCandidate('inferred')],
        parseRejections: [],
      };
    };
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: 'その期間でお願いします',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: { interpretUserTurn },
    });

    expect(output.state.range).toBeUndefined();
    expect(output.state.pendingPlanningRange?.scope.label).toBe('来週');
    expect(output.state.missing).toContain('planning_start_date');
    expect(output.interpreterDiagnostics?.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'pending-range-clarification' }),
    ]));
  });

  it('keeps explicit AI ranges in confirmation without applying over pending scope', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pendingScopeState(),
      userText: '開始日は別に指定したいです',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([planningRangeCandidate('explicit')]),
    });

    expect(output.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
    ]);
    expect(output.state.range).toBeUndefined();
    expect(output.state.pendingPlanningRange?.scope.label).toBe('来週');
    expect(output.state.missing).toContain('planning_start_date');
    expect(output.state.assumptions).toEqual(expect.arrayContaining([
      expect.stringContaining('set_planning_range'),
    ]));
  });
});

describe('Stage 1 interpreter grounding', () => {
  function stateWithUnitRateQuestion(): PlanningIntakeState {
    return {
      ...draftReadyState(),
      status: 'needs_unit_rate',
      unitRates: [],
      priorityPolicy: { kind: 'unknown' },
      missing: ['unit_duration_estimate'],
      shouldCreateDraft: false,
    };
  }

  it('supplies previous-state unit-rate questions as lastQuestions', async () => {
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      expect(params.stateSummary.lastQuestions).toEqual([
        { slotKey: 'unit_rate', intent: 'ask_unit_rate' },
      ]);
      return { candidates: [], parseRejections: [] };
    };

    await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: stateWithUnitRateQuestion(),
      userText: 'この質問に答えます',
      interpreter: { interpretUserTurn },
    });
  });

  it('omits lastQuestions on the first interpreter turn', async () => {
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      expect(params.stateSummary.lastQuestions).toBeUndefined();
      return { candidates: [], parseRejections: [] };
    };

    await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'この条件について相談があります',
      interpreter: { interpretUserTurn },
    });
  });

  it('applies an explicit tomorrow-and-day-after range returned by the interpreter', async () => {
    const previousState: PlanningIntakeState = {
      ...draftReadyState(),
      status: 'needs_scope',
      constraints: [
        { kind: 'sleep', start: '23:00', end: '07:00', hardness: 'hard' },
        { kind: 'meal', start: '19:00', durationMinutes: 30, hardness: 'hard' },
      ],
      fixedEventsDeclaredNone: true,
      missing: ['planning_start_date'],
      shouldCreateDraft: false,
    };
    const rangeCandidate: InterpretedCommandCandidate = {
      command: {
        type: 'set_planning_range',
        range: {
          startDateTime: '2026-07-11T00:00:00',
          endDateTime: '2026-07-12T24:00:00',
          sourceText: '明日と明後日',
          confidence: 'explicit',
        },
        sourceText: '明日と明後日',
        confidence: 'high',
      },
      origin: 'ai_interpreter',
      needsConfirmation: false,
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: '明日と明後日の予定を立てたい',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([rangeCandidate]),
    });

    expect(output.state.range).toMatchObject({
      startDateTime: '2026-07-11T00:00:00',
      endDateTime: '2026-07-12T24:00:00',
      calendarDayCount: 2,
    });
    expect(output.draftCandidates?.[0]?.date).toBe('2026-07-11');
  });

});

describe('Stage 2 bounded conversation grounding', () => {
  function interpreted(command: InterpretedCommandCandidate['command']): InterpretedCommandCandidate {
    return { command, origin: 'ai_interpreter', needsConfirmation: false };
  }

  it('forwards chronological recent turns separately from a short current answer', async () => {
    const recentTurns = [
      { role: 'user' as const, content: 'one unit takes about three hours' },
      { role: 'assistant' as const, content: 'how long does one unit take' },
    ];
    let callCount = 0;
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      callCount += 1;
      expect(params.userText).toBe('about three hours');
      expect(params.recentTurns).toEqual(recentTurns);
      return { candidates: [], parseRejections: [] };
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'about three hours',
      recentTurns,
      interpreter: { interpretUserTurn },
    });

    expect(callCount).toBe(1);
    expect(output.state.tasks).toEqual([]);
  });

  it('re-emits a missing prior priority fact from recent turns through validator and reducer', async () => {
    const recentTurns = [
      { role: 'user' as const, content: 'focus on hardware first' },
      { role: 'assistant' as const, content: 'which field should be prioritized' },
    ];
    const baseState = draftReadyState();
    const previousState: PlanningIntakeState = {
      ...baseState,
      examPrepScope: baseState.examPrepScope ? {
        ...baseState.examPrepScope,
        fields: ['hardware'],
        rawText: ['hardware'],
      } : undefined,
      priorityPolicy: { kind: 'unknown' },
      missing: ['priority_policy'],
      shouldCreateDraft: false,
    };
    const interpretUserTurn: WeeklyPlanningIntakeInterpreter['interpretUserTurn'] = async (params) => {
      expect(params.recentTurns).toEqual(recentTurns);
      return {
        candidates: [interpreted({
          type: 'set_priority_policy',
          policy: { kind: 'field_first', order: ['hardware'] },
          sourceText: 'as stated earlier',
          confidence: 'high',
        })],
        parseRejections: [],
      };
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: 'as stated earlier',
      recentTurns,
      interpreter: { interpretUserTurn },
    });

    expect(output.state.priorityPolicy).toEqual({ kind: 'field_first', order: ['hardware'] });
    expect(output.interpreterDiagnostics?.accepted).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
  });

  it('keeps a fact accepted several turns ago when history suggests an explicit correction', async () => {
    const previousState = draftReadyState();
    const recentTurns = [
      { role: 'user' as const, content: 'start with mathematics' },
      { role: 'assistant' as const, content: 'mathematics priority was accepted' },
      { role: 'user' as const, content: 'keep the other conditions' },
    ];
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState,
      userText: 'actually prioritize hardware',
      recentTurns,
      interpreter: fakeInterpreter([interpreted({
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['hardware'] },
        sourceText: 'actually prioritize hardware',
        confidence: 'high',
      })]),
    });

    expect(output.state.priorityPolicy).toEqual(previousState.priorityPolicy);
    expect(output.interpreterDiagnostics?.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
  });

  it('does not hard apply an ambiguous pronoun reference from recent turns', async () => {
    const recentTurns = [
      { role: 'user' as const, content: 'use the saved schedule source' },
      { role: 'assistant' as const, content: 'which schedule source do you mean' },
    ];
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'use that one',
      recentTurns,
      interpreter: fakeInterpreter([interpreted({
        type: 'request_clarification',
        target: 'unresolved_slot',
        ref: 'constraint_source',
        sourceText: 'use that one',
        confidence: 'high',
      })]),
    });

    expect(output.state.constraintSourcesInUse ?? []).toEqual([]);
    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.interpreterDiagnostics?.clarificationRequests).toEqual([
      expect.objectContaining({ type: 'request_clarification', ref: 'constraint_source' }),
    ]);
  });
  it('ignores recent turns in rules mode', () => {
    const withHistory = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      recentTurns: [{ role: 'assistant', content: 'history is not parsed in rules mode' }],
    });
    const withoutHistory = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    });

    expect(withHistory).toEqual(withoutHistory);
  });

  it('ignores recent turns when an interpreter exception switches the whole turn to rules fallback', async () => {
    const input = {
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      recentTurns: [{ role: 'assistant' as const, content: 'history remains grounding only' }],
    };
    const expected = runWeeklyPlanningIntakePipeline(input);
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...input,
      interpreter: {
        async interpretUserTurn() {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(output).toEqual(expected);
  });
});

describe('preview policy Stage 2', () => {
  it('promotes an assumed preview and replaces the unit-rate assumption through the next normal turn', () => {
    const initialState: PlanningIntakeState = {
      ...assumablePreviewState(),
      priorityPolicy: {
        kind: 'field_first',
        order: ['数学', 'ソフトウェア', 'ハードウェア', 'ネットワーク', '英語'],
      },
      missing: assumablePreviewState().missing.filter(
        (missing) => missing !== 'priority_policy' && missing !== 'next_field_after_math',
      ),
      sourceTurns: ['来週、院試の過去問を数学を含む5分野で7年分進めたい。数学を多めにやりたい'],
    };
    const firstOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: initialState,
      userText: '',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(firstOutput.decision.kind).toBe('offer_dry_run_preview');
    expect(firstOutput.draftCandidates?.length).toBeGreaterThan(0);
    expect(firstOutput.decision.summary?.previewAssumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'unit_duration_estimate', source: 'default' }),
      ]),
    );
    expect(firstOutput.decision.questionPlan?.length ?? 0).toBeLessThanOrEqual(1);
    expect(firstOutput.decision.questionPlan?.[0]?.targetSlot).toBe('unit_rate');

    const secondOutput = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: '1年分は3時間くらい',
      currentDateTime: '2026-07-10T15:30:00',
    });

    expect(secondOutput.state.unitRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minutesPerUnit: 180, source: 'user' }),
      ]),
    );
    expect(secondOutput.assumedDraft?.assumptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'unit_duration_estimate' }),
      ]),
    );
    expect(secondOutput.draftCandidates?.length).toBeGreaterThan(0);
    expect(secondOutput.draftCandidates?.[0]?.estimatedMinutes).toBe(180);
  });

});
