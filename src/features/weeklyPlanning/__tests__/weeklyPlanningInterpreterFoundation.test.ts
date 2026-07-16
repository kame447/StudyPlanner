import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import {
  createDialogueRenderInput,
  renderWeeklyPlanningDialogueMessage,
  type WeeklyPlanningDialogueRenderer,
} from '../dialogue/weeklyPlanningDialogueRenderer';
import {
  createSystemPrompt,
  createUserPrompt,
} from '../intake/weeklyPlanningAiInterpreter';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import {
  applyWeeklyPlanningCommands,
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import {
  normalizeSetPendingPlanningRangeCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
} from '../intake/weeklyPlanningCommandAdapter';
import type {
  InterpretedCommandCandidate,
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import type { PlanningIntakeMissing, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  deriveMissingForPlanningRange,
  hasConfirmedFixedEvents,
  hasConfirmedLifeConstraints,
} from '../intake/weeklyPlanningMissingStatus';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import {
  runWeeklyPlanningIntakePipeline,
  runWeeklyPlanningIntakePipelineWithInterpreter,
} from '../pipeline/weeklyPlanningIntakePipeline';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';

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

const evaluationCase = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation;

function setExamScopeCommand(confidence: 'high' | 'medium' | 'low' = 'high'): ParsedWeeklyPlanningCommand {
  return {
    type: 'set_exam_scope',
    scope: {
      examType: '院試',
      fields: [...evaluationCase.fields],
      totalFields: evaluationCase.fields.length,
      totalYears: 7,
      yearRange: {
        startYear: 2025,
        endYear: 2019,
        sourceText: '2025〜2019',
      },
      strategyHint: 'field_first',
      unitModel: 'year_field_chunk',
      rawText: [evaluationCase.freeTextExamScopeAndPriority],
    },
    sourceText: evaluationCase.freeTextExamScopeAndPriority,
    confidence,
  };
}

function priorityCommand(confidence: 'high' | 'medium' | 'low' = 'medium'): ParsedWeeklyPlanningCommand {
  return {
    type: 'set_priority_policy',
    policy: {
      kind: 'field_first',
      order: [...evaluationCase.priorityOrder],
    },
    sourceText: evaluationCase.freeTextExamScopeAndPriority,
    sourceSegment: '数学から始めて最後がヒューマンサイエンスかな',
    confidence,
  };
}

function unitRateCommand(minutesPerUnit: number, confidence: 'high' | 'medium' | 'low' = 'high'): ParsedWeeklyPlanningCommand {
  return {
    type: 'set_unit_rate',
    unitRate: {
      unit: 'year_field_chunk',
      minutesPerUnit,
      source: 'user',
      uncertainty: confidence === 'medium' ? 'medium' : 'low',
      rawText: `${minutesPerUnit}R`,
    },
    sourceText: `${minutesPerUnit}R`,
    confidence,
  };
}

function setPendingPlanningRangeCommand(
  pending: unknown,
): Extract<ParsedWeeklyPlanningCommand, { type: 'set_pending_planning_range' }> {
  return {
    type: 'set_pending_planning_range',
    pending,
    sourceText: 'pending range',
    confidence: 'high',
  } as unknown as Extract<ParsedWeeklyPlanningCommand, { type: 'set_pending_planning_range' }>;
}

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

function baseSummary(overrides: Partial<InterpreterStateSummary> = {}): InterpreterStateSummary {
  return {
    knownFields: ['数学', 'OS'],
    confirmedSlots: [],
    ...overrides,
  };
}

describe('weekly planning AI foundation without real AI', () => {
  it('applies fake interpreter command candidates through validator and reducer for the first evaluation case', async () => {
    const afterRange = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    });
    const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: [
        candidate(setExamScopeCommand('high')),
        candidate(priorityCommand('medium'), true),
      ],
      parseRejections: [],
    }));

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: afterRange.state,
      userText: evaluationCase.freeTextExamScopeAndPriority,
      interpreter: { interpretUserTurn },
    });

    expect(interpretUserTurn).toHaveBeenCalledTimes(1);
    expect(output.state.examPrepScope).toMatchObject({
      fields: evaluationCase.fields,
      yearRange: { startYear: 2025, endYear: 2019 },
      unitModel: 'year_field_chunk',
    });
    expect(output.state.priorityPolicy).toEqual({
      kind: 'field_first',
      order: evaluationCase.priorityOrder,
    });
    expect(output.state.missing).not.toContain('tasks_or_goals');
    expect(output.state.missing).not.toContain('year_range');
    expect(output.state.assumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('set_priority_policy'),
      ]),
    );
    expect(output.interpreterDiagnostics?.accepted).toHaveLength(1);
    expect(output.interpreterDiagnostics?.acceptedWithConfirmation).toHaveLength(1);
    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
  });

  it('applies complete AI planning range, exam scope, and priority commands through the pipeline', async () => {
    const commands = WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.completeCommandResponse.candidates.map(
      (item) => candidate(item.command as ParsedWeeklyPlanningCommand, item.needsConfirmation),
    );
    const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: commands,
      parseRejections: [],
    }));

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: evaluationCase.freeTextExamScopeAndPriority,
      interpreter: { interpretUserTurn },
    });

    expect(output.state.range).toMatchObject({
      startDateTime: '2026-07-06',
      endDateTime: '2026-07-12',
    });
    expect(output.state.examPrepScope).toMatchObject({
      fields: evaluationCase.fields,
      yearRange: { startYear: 2025, endYear: 2019 },
      unitModel: 'year_field_chunk',
    });
    expect(output.state.priorityPolicy).toEqual({
      kind: 'field_first',
      order: evaluationCase.priorityOrder,
    });
    expect(output.interpreterDiagnostics?.accepted.map((command) => command.type)).toEqual([
      'set_planning_range',
      'set_exam_scope',
    ]);
    expect(output.interpreterDiagnostics?.acceptedWithConfirmation.map((command) => command.type)).toEqual([
      'set_priority_policy',
    ]);
  });

  it('passes the full compound regression turn to AI and retains every command meaning', async () => { const hardware = String.fromCodePoint(0x30cf,0x30fc,0x30c9,0x30a6,0x30a7,0x30a2); const userText = [String.fromCodePoint(0x4eca,0x65e5,0x660e,0x65e5,0x306e,0x8a08,0x753b,0x3092,0x7acb,0x3066,0x305f,0x3044),String.fromCodePoint(0x3084,0x308b,0x3053,0x3068,0x306f,0x9662,0x8a66,0x306e,0x904e,0x53bb,0x554f,0x3067,0x3001,0x30cf,0x30fc,0x30c9,0x30a6,0x30a7,0x30a2,0x5206,0x91ce,0x3092,0x4e3b,0x306b,0x3084,0x308b),String.fromCodePoint(0x5e74,0x5ea6,0x306f)+'2024~2019'].join(String.fromCodePoint(0x0a)); const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({ candidates: [candidate({ type: 'set_planning_range', range: { startDateTime: '2026-07-10T00:00:00', endDateTime: '2026-07-11T24:00:00', confidence: 'explicit' }, sourceText: userText, confidence: 'high' }),candidate({ type: 'set_exam_scope', scope: { examType: String.fromCodePoint(0x9662,0x8a66), fields: [hardware], totalFields: 1, totalYears: 6, yearRange: { startYear: 2024, endYear: 2019, sourceText: '2024~2019' }, strategyHint: 'field_first', unitModel: 'year_field_chunk', rawText: [userText] }, sourceText: userText, confidence: 'high' }),candidate({ type: 'set_priority_policy', policy: { kind: 'field_first', order: [hardware] }, sourceText: userText, sourceSegment: hardware, confidence: 'high' })], parseRejections: [] })); const output = await runWeeklyPlanningIntakePipelineWithInterpreter({ ...defaultPipelineInput, userText, planningStartDate: '2026-07-10', currentDateTime: '2026-07-10T15:30:00', interpreter: { interpretUserTurn } }); expect(interpretUserTurn).toHaveBeenCalledWith(expect.objectContaining({ userText })); expect(output.state.range?.calendarDayCount).toBe(2); expect(output.state.examPrepScope?.yearRange).toMatchObject({ startYear: 2024, endYear: 2019 }); expect(output.state.priorityPolicy).toEqual({ kind: 'field_first', order: [hardware] }); });

  it('keeps the existing year range when a later exam scope command omits it', () => {
    const initialState = createInitialPlanningIntakeState();
    const scopedState = applyWeeklyPlanningCommands(initialState, [
      setExamScopeCommand('high'),
    ]);
    const followUpScopeWithoutYearRange: ParsedWeeklyPlanningCommand = {
      type: 'set_exam_scope',
      scope: {
        examType: '院試',
        fields: [...evaluationCase.fields],
        totalFields: evaluationCase.fields.length,
        totalYears: 7,
        strategyHint: 'field_first',
        unitModel: 'year_field_chunk',
        rawText: ['バイト・睡眠・食事・風呂・過去問1年分3時間'],
      },
      sourceText: 'バイト・睡眠・食事・風呂・過去問1年分3時間',
      confidence: 'medium',
    };

    const output = applyWeeklyPlanningCommands(scopedState, [
      followUpScopeWithoutYearRange,
    ]);

    expect(output.examPrepScope).toMatchObject({
      fields: evaluationCase.fields,
      totalYears: 7,
      yearRange: { startYear: 2025, endYear: 2019 },
      unitModel: 'year_field_chunk',
    });
    expect(output.missing).not.toContain('year_range');
  });

  it('exposes AI parser rejections through pipeline interpreter diagnostics', async () => {
    const afterRange = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    });
    const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: [candidate(priorityCommand('low'))],
      parseRejections: [
        { rawCandidate: { command: 'not-an-object', needsConfirmation: false }, reason: 'invalid-candidate-shape' },
      ],
    }));

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: afterRange.state,
      userText: evaluationCase.freeTextExamScopeAndPriority,
      interpreter: { interpretUserTurn },
    });

    expect(output.interpreterDiagnostics?.parseRejections).toEqual([
      { rawCandidate: { command: 'not-an-object', needsConfirmation: false }, reason: 'invalid-candidate-shape' },
    ]);
    expect(output.interpreterDiagnostics?.clarifications).toEqual([
      expect.objectContaining({ command: expect.objectContaining({ type: 'set_priority_policy' }) }),
    ]);
  });

  it('uses deterministic command parsing before AI without applying legacy fallback', async () => {
    const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: [candidate(unitRateCommand(120, 'high'))],
      parseRejections: [],
    }));

    const firstOutput = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      interpreter: { interpretUserTurn },
    });
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: firstOutput.state,
      userText: String.fromCodePoint(0x6765,0x9031,0x3001,0x82f1,0x8a9e,0x3092,0x33,0x6642,0x9593,0x3001,0x6570,0x5b66,0x3092,0x32,0x6642,0x9593),
      interpreter: { interpretUserTurn },
    });
    const bareOutput = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: output.state,
      userText: String.fromCodePoint(0x3060,0x3044,0x305f,0x3044,0x33,0x6642,0x9593,0x304f,0x3089,0x3044),
      interpreter: { interpretUserTurn },
    });

    expect(interpretUserTurn).toHaveBeenCalledTimes(3);
    expect(firstOutput.state.range).toBeDefined();
    expect(output.state.unitRates).toEqual([expect.objectContaining({ minutesPerUnit: 120 })]);
    expect(output.state.tasks).toEqual([]);
    expect(bareOutput.state.unitRates).toEqual([expect.objectContaining({ minutesPerUnit: 120 })]);
    expect(bareOutput.state.tasks).toEqual([]);
  });

  it('uses legacy fallback only after an interpreter error while empty AI keeps deterministic parsing', async () => {
    const userText = String.fromCodePoint(0x6765,0x9031,0x3001,0x82f1,0x8a9e,0x3092,0x33,0x6642,0x9593,0x3001,0x6570,0x5b66,0x3092,0x32,0x6642,0x9593);
    const emptyInterpreter = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: [],
      parseRejections: [],
    }));
    const emptyOutput = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText,
      interpreter: { interpretUserTurn: emptyInterpreter },
    });
    const failingInterpreter = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => {
      throw new Error('provider unavailable');
    });
    const fallbackOutput = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText,
      interpreter: { interpretUserTurn: failingInterpreter },
    });

    expect(emptyInterpreter).toHaveBeenCalledTimes(1);
    expect(emptyOutput.state.tasks).toEqual([]);
    expect(emptyOutput.interpreterDiagnostics).toBeDefined();
    expect(failingInterpreter).toHaveBeenCalledTimes(1);
    expect(fallbackOutput.state.tasks).toHaveLength(2);
    expect(fallbackOutput.interpreterDiagnostics).toBeUndefined();
  });

  it('keeps only the higher confidence candidate when a later candidate targets the same slot', () => {
    const lowCandidate = candidate(unitRateCommand(90, 'low'));
    const highCandidate = candidate(unitRateCommand(120, 'high'));

    const result = validateInterpretedCandidates([
      lowCandidate,
      highCandidate,
    ], baseSummary());

    expect(result.accepted).toEqual([
      expect.objectContaining({
        type: 'set_unit_rate',
        unitRate: expect.objectContaining({ minutesPerUnit: 120 }),
      }),
    ]);
    expect(result.clarifications).toEqual([]);
    expect(result.rejected).toEqual([
      { candidate: lowCandidate, reason: 'conflicting-slot-lower-confidence' },
    ]);
  });

  it('validates interpreted candidates without allowing state-shaped output', () => {
    const result = validateInterpretedCandidates([
      { command: { type: 'unknown_command' }, origin: 'ai_interpreter', needsConfirmation: false } as unknown as InterpretedCommandCandidate,
      candidate(unitRateCommand(-30, 'high')),
      candidate({
        type: 'mark_completed_units',
        field: '物理',
        completedYears: [2025],
        mergeMode: 'append',
        sourceText: '物理の2025は終わった',
        confidence: 'high',
      }),
      candidate(unitRateCommand(120, 'high')),
      candidate(unitRateCommand(180, 'medium'), true),
      candidate({
        type: 'note_no_fixed_events',
        sourceText: '他の固定予定はない',
        confidence: 'low',
      }),
    ], baseSummary());

    expect(result.accepted).toEqual([
      expect.objectContaining({ type: 'set_unit_rate' }),
    ]);
    expect(result.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'mark_completed_units' }),
    ]);
    expect(result.clarifications).toHaveLength(1);
    expect(result.rejected.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        'unknown-command-type',
        'invalid-unit-rate-minutes',
        'conflicting-slot-lower-confidence',
      ]),
    );
  });

  it('rejects interpreted candidates that overwrite confirmed deterministic slots', () => {
    const result = validateInterpretedCandidates([
      candidate(unitRateCommand(180, 'high')),
    ], baseSummary({ confirmedSlots: ['unit_duration_estimate'] }));

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
  });

  it('builds renderer input from code-owned dialogue decisions and facts', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      examPrepScope: {
        examType: '院試',
        fields: ['数学', 'OS'],
        yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025〜2019' },
        rawText: ['scope'],
      },
      unitRates: [{ unit: 'year_field_chunk' as const, minutesPerUnit: 180, source: 'user' as const }],
      priorityPolicy: { kind: 'field_first' as const, order: ['数学', 'OS'] },
      assumptions: ['AI interpreted partial field order'],
    };
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_life_constraints',
      requiredFields: ['fixed_events', 'life_constraints', 'unit_rate'],
      questionPlan: [
        {
          kind: 'missing_life_constraint',
          targetSlot: 'fixed_events',
          missing: ['fixed_events'],
          intent: 'ask_fixed_events',
        },
        {
          kind: 'missing_life_constraint',
          targetSlot: 'meal_bath_constraints',
          missing: ['meal_bath_constraints'],
          intent: 'ask_life_constraints',
        },
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };

    const input = createDialogueRenderInput({ state, decision });

    expect(input.acceptedFacts).toMatchObject({
      fields: ['数学', 'OS'],
      yearRange: { startYear: 2025, endYear: 2019 },
      unitRateMinutes: 180,
      priorityOrder: ['数学', 'OS'],
    });
    expect(input.assumptions).toEqual(['AI interpreted partial field order']);
    expect(input.nextQuestions.map((question) => question.slotKey)).toEqual([
      'fixed_events',
      'meal_bath_constraints',
    ]);
    expect(input.nextQuestions.map((question) => question.intent)).toEqual([
      'ask_fixed_events',
      'ask_life_constraints',
    ]);
    expect(input.nextQuestions.map((question) => question.questionKind)).toEqual([
      'missing_life_constraint',
      'missing_life_constraint',
    ]);
    expect(input.nextQuestions).toEqual([
      expect.not.objectContaining({ missing: expect.anything() }),
      expect.not.objectContaining({ missing: expect.anything() }),
    ]);
  });

  it('renders only the planned questions in plan order even when state has other missing slots', async () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      missing: ['fixed_events', 'sleep_cycle', 'meal_bath_constraints', 'unit_duration_estimate'] as PlanningIntakeMissing[],
    };
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_life_constraints',
      requiredFields: ['fixed_events', 'sleep_cycle', 'unit_rate'],
      questionPlan: [
        {
          kind: 'missing_life_constraint',
          targetSlot: 'fixed_events',
          missing: ['fixed_events'],
          intent: 'ask_fixed_events',
        },
        {
          kind: 'missing_life_constraint',
          targetSlot: 'sleep_cycle',
          missing: ['sleep_cycle'],
          intent: 'ask_life_constraints',
        },
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };
    const renderer: WeeklyPlanningDialogueRenderer = {
      async render(input) {
        expect(input.nextQuestions.map((question) => question.slotKey)).toEqual([
          'fixed_events',
          'sleep_cycle',
        ]);
        expect(input.nextQuestions.map((question) => question.intent)).toEqual([
          'ask_fixed_events',
          'ask_life_constraints',
        ]);

        return {
          acknowledgement: '確認しました。',
          questions: [
            { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
            { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          ],
        };
      },
    };

    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer })).resolves.toBe([
      '確認しました。',
      'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
      '睡眠時間はどうしますか？',
    ].join('\n'));
  });

  it('uses fake renderer output only when every planned question is returned exactly once', async () => {
    const state = createInitialPlanningIntakeState();
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_unit_rate',
      requiredFields: ['unit_rate'],
      questionPlan: [
        {
          kind: 'missing_slot',
          targetSlot: 'unit_rate',
          missing: ['unit_duration_estimate'],
          intent: 'ask_unit_rate',
        },
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };
    const renderer: WeeklyPlanningDialogueRenderer = {
      async render() {
        return {
          acknowledgement: '条件を確認しました。',
          questions: [
            { slotKey: 'unit_rate', text: '1年分は何時間くらいですか？' },
          ],
        };
      },
    };
    const outsidePlanRenderer: WeeklyPlanningDialogueRenderer = {
      async render() {
        return {
          questions: [
            { slotKey: 'daily_target', text: '毎日の目標は？' },
          ],
        };
      },
    };

    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer })).resolves.toBe([
      '条件を確認しました。',
      '1年分は何時間くらいですか？',
    ].join('\n'));
    const deterministicFallback = [
      'ここまでの条件を確認しました。',
      '1年分または1単位あたりの目安時間を教えてください。',
    ].join('\n');

    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer: outsidePlanRenderer })).resolves.toBe(
      deterministicFallback,
    );
    await expect(renderWeeklyPlanningDialogueMessage({ state, decision })).resolves.toBe(
      deterministicFallback,
    );
  });

  it.each([
    ['same day', '2026-08-01T00:00:00', '2026-08-01T24:00:00', 1],
    ['month boundary', '2026-07-31T00:00:00', '2026-08-02T24:00:00', 3],
    ['five days', '2026-08-01T00:00:00', '2026-08-05T24:00:00', 5],
  ])('normalizes AI planning ranges to calendar days: %s', (_label, startDateTime, endDateTime, expected) => {
    const range = toPlanningRangeFromSetPlanningRangeCommand({
      type: 'set_planning_range',
      range: { startDateTime, endDateTime, confidence: 'explicit' },
      sourceText: 'AI range',
      confidence: 'high',
    });

    expect(range.calendarDayCount).toBe(expected);
  });

  it('preserves a deterministic calendarDayCount during range normalization', () => {
    const range = toPlanningRangeFromSetPlanningRangeCommand({
      type: 'set_planning_range',
      range: {
        startDateTime: '2026-08-01T00:00:00',
        endDateTime: '2026-08-05T24:00:00',
        calendarDayCount: 7,
        confidence: 'explicit',
      },
      sourceText: 'deterministic range',
      confidence: 'high',
    });

    expect(range.calendarDayCount).toBe(7);
  });

  it.each([
    ['Friday', '2026-07-10T15:30:00', '2026-07-13', '2026-07-19'],
    ['Sunday', '2026-07-12T15:30:00', '2026-07-13', '2026-07-19'],
    ['Monday', '2026-07-13T15:30:00', '2026-07-20', '2026-07-26'],
  ])('normalizes a next_week pending command from the current date at the %s boundary', (
    _label,
    currentDateTime,
    expectedStartDate,
    expectedEndDate,
  ) => {
    const command = setPendingPlanningRangeCommand({
      scope: { kind: 'next_week', label: 'next week' },
      sourceText: 'next week',
    });

    const normalized = normalizeSetPendingPlanningRangeCommand(command, {
      selectedDate: '2020-01-01',
      currentDateTime,
    });

    expect(normalized.pending).toEqual({
      scope: {
        kind: 'next_week',
        label: 'next week',
        startDate: expectedStartDate,
        endDate: expectedEndDate,
      },
      durationDays: 7,
      sourceText: 'next week',
    });
  });

  it('does not infer dates or duration for a named future period', () => {
    const command = setPendingPlanningRangeCommand({
      scope: { kind: 'named_future_period', label: 'summer break' },
      sourceText: 'summer break',
    });

    expect(normalizeSetPendingPlanningRangeCommand(command, {
      selectedDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
    })).toEqual(command);
  });

  it('accepts a valid pending command and protects a confirmed planning range', () => {
    const pendingCandidate = candidate(setPendingPlanningRangeCommand({
      scope: { kind: 'next_week', label: 'next week' },
      sourceText: 'next week',
    }));
    const accepted = validateInterpretedCandidates([pendingCandidate], baseSummary());
    const protectedRange = validateInterpretedCandidates(
      [pendingCandidate],
      baseSummary({ confirmedSlots: ['planning_range'] }),
    );

    expect(accepted.accepted).toEqual([
      expect.objectContaining({ type: 'set_pending_planning_range' }),
    ]);
    expect(protectedRange.rejected).toEqual([
      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),
    ]);
  });

  it.each([
    [
      'invalid kind',
      { scope: { kind: 'other', label: 'other' }, sourceText: 'other' },
      'invalid-command-shape',
    ],
    [
      'missing label',
      { scope: { kind: 'next_week' }, sourceText: 'next week' },
      'invalid-command-shape',
    ],
    [
      'invalid date',
      { scope: { kind: 'next_week', label: 'next week', startDate: 'not-a-date' }, sourceText: 'next week' },
      'invalid-date',
    ],
    [
      'zero duration',
      { scope: { kind: 'next_week', label: 'next week' }, durationDays: 0, sourceText: 'next week' },
      'invalid-command-shape',
    ],
  ])('rejects a pending command with %s', (_label, pending, reason) => {
    const result = validateInterpretedCandidates([
      candidate(setPendingPlanningRangeCommand(pending)),
    ], baseSummary());

    expect(result.rejected).toEqual([expect.objectContaining({ reason })]);
  });

  it('derives fixed and life confirmation from state facts instead of missing absence', () => {
    const empty = createInitialPlanningIntakeState();
    expect(hasConfirmedFixedEvents({ ...empty, missing: [] })).toBe(false);
    expect(hasConfirmedLifeConstraints({ ...empty, missing: [] })).toBe(false);

    const hardFixed: PlanningIntakeState = {
      ...empty,
      constraints: [{ kind: 'fixed_event', start: '13:00', end: '14:00', hardness: 'hard' }],
      missing: ['fixed_events'],
    };
    expect(hasConfirmedFixedEvents(hardFixed)).toBe(true);
    expect(hasConfirmedFixedEvents({
      ...hardFixed,
      constraints: [{ ...hardFixed.constraints[0], hardness: 'soft' }],
    })).toBe(false);
    expect(hasConfirmedFixedEvents({
      ...empty,
      constraintSourcesInUse: [{ kind: 'timetable', selector: 'active' }],
      missing: ['fixed_events'],
    })).toBe(true);
    expect(hasConfirmedFixedEvents({
      ...empty,
      fixedEventsDeclaredNone: true,
      missing: ['fixed_events'],
    })).toBe(true);

    const completeLife: PlanningIntakeState = {
      ...empty,
      constraints: [
        { kind: 'sleep', start: '23:00', end: '07:00', hardness: 'hard' },
        { kind: 'meal', start: '19:00', durationMinutes: 30, hardness: 'hard' },
      ],
      missing: ['life_constraints', 'meal_bath_constraints'],
    };
    expect(hasConfirmedLifeConstraints({
      ...completeLife,
      constraints: [completeLife.constraints[0]],
    })).toBe(false);
    expect(hasConfirmedLifeConstraints(completeLife)).toBe(true);
    expect(deriveMissingForPlanningRange({
      ...completeLife,
      fixedEventsDeclaredNone: true,
    })).not.toEqual(expect.arrayContaining([
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
    ]));
  });

  it('keeps the no-fixed-events fact through later user turns', () => {
    const declared = applyWeeklyPlanningCommands(createInitialPlanningIntakeState(), [{
      type: 'note_no_fixed_events',
      sourceText: '固定の予定はありません',
      confidence: 'high',
    }]);
    const later = applyWeeklyPlanningUserTurn(
      declared,
      'まだほかの条件を考えています',
      { selectedDate: '2026-07-10', currentDateTime: '2026-07-10T15:30:00' },
    );

    expect(later.fixedEventsDeclaredNone).toBe(true);
    expect(hasConfirmedFixedEvents(later)).toBe(true);
  });

  it('protects a pending range from inferred AI ranges and confirms explicit AI ranges', () => {
    const summary = baseSummary({
      pendingPlanningRange: {
        label: '来週',
        startDate: '2026-07-13',
        endDate: '2026-07-19',
      },
    });
    const rangeCandidate = (
      confidence: 'explicit' | 'inferred',
    ): InterpretedCommandCandidate => candidate({
      type: 'set_planning_range',
      range: {
        startDateTime: '2026-07-15T00:00:00',
        endDateTime: '2026-07-21T24:00:00',
        confidence,
      },
      sourceText: 'range',
      confidence: 'high',
    });

    const inferred = validateInterpretedCandidates([rangeCandidate('inferred')], summary);
    expect(inferred.rejected).toEqual([
      expect.objectContaining({ reason: 'pending-range-clarification' }),
    ]);

    const explicit = validateInterpretedCandidates([rangeCandidate('explicit')], summary);
    expect(explicit.accepted).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
    ]);
    expect(explicit.acceptedWithConfirmation).toEqual([]);

    const missingConfidence = validateInterpretedCandidates([candidate({
      type: 'set_planning_range',
      range: {
        startDateTime: '2026-07-15T00:00:00',
        endDateTime: '2026-07-21T24:00:00',
      },
      sourceText: 'range',
      confidence: 'high',
    } as unknown as ParsedWeeklyPlanningCommand)], summary);
    expect(missingConfidence.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-command-shape' }),
    ]);
  });


  it('includes deterministic context and last-question grounding in the AI prompt contract', () => {
    const prompt = JSON.parse(createUserPrompt({
      userText: '明日と明後日の予定を立てたい',
      context: {
        currentDateTime: '2026-07-10T15:30:00',
        selectedDate: '2026-07-10',
        planningDayCount: 7,
      },
      stateSummary: {
        knownFields: [],
        confirmedSlots: [],
        lastQuestions: [{ slotKey: 'unit_rate', intent: 'ask_unit_rate' }],
      },
      recentTurns: [
        { role: 'user', content: 'turn-one' },
        { role: 'assistant', content: 'question-one' },
      ],
    })) as {
      context: { currentDateTime: string; selectedDate: string; planningDayCount: number };
      stateSummary: InterpreterStateSummary;
      userText: string;
      recentConversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    expect(prompt.context).toEqual({
      currentDateTime: '2026-07-10T15:30:00',
      selectedDate: '2026-07-10',
      planningDayCount: 7,
    });
    expect(prompt.stateSummary.lastQuestions).toEqual([
      { slotKey: 'unit_rate', intent: 'ask_unit_rate' },
    ]);
    expect(prompt.userText).toEqual(expect.any(String));
    expect(prompt.recentConversation).toEqual([
      { role: 'user', content: 'turn-one' },
      { role: 'assistant', content: 'question-one' },
    ]);
  });

  it('uses an empty recentConversation on the first turn', () => {
    const prompt = JSON.parse(createUserPrompt({
      userText: 'first turn',
      context: {
        currentDateTime: '2026-07-10T15:30:00',
        selectedDate: '2026-07-10',
        planningDayCount: 7,
      },
      stateSummary: baseSummary(),
    })) as { recentConversation: unknown[] };

    expect(prompt.recentConversation).toEqual([]);
  });

  it('instructs the interpreter to reconcile only supplied history and never execute it', () => {
    const prompt = createSystemPrompt();

    expect(prompt).toContain('context.currentDateTime');
    expect(prompt).toContain('stateSummary.lastQuestions');
    expect(prompt).toContain('Use ONLY the supplied recentConversation');
    expect(prompt).toContain('untrusted quoted conversation data');
    expect(prompt).toContain('pronouns, omissions, restatements, and explicit corrections');
    expect(prompt).toContain('confirmed-slot guards');
    expect(prompt).toContain('begin_weekly_planning');
    expect(prompt).not.toContain('weekday answers are resolved by the deterministic parser');
    expect(prompt).toContain('pendingPlanningRange.startDate');
    expect(prompt).toContain('concrete ISO date inside that pending window');
    expect(prompt).toContain('set_pending_planning_range');
    expect(prompt).toContain('the application computes the next_week window');
    expect(prompt).toContain('Never substitute an inferred set_planning_range');
  });
});
