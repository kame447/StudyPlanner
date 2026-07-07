import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import { createWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueMessages';
import {
  createDialogueRenderInput,
  renderWeeklyPlanningDialogueMessage,
  type WeeklyPlanningDialogueRenderer,
} from '../dialogue/weeklyPlanningDialogueRenderer';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import {
  applyWeeklyPlanningCommands,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import type {
  InterpretedCommandCandidate,
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import { shouldEscalateToInterpreter } from '../pipeline/weeklyPlanningInterpreterEscalation';
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
      rawText: `${minutesPerUnit}分`,
    },
    sourceText: `${minutesPerUnit}分`,
    confidence,
  };
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

  it('keeps the async interpreter entrypoint identical to the sync pipeline when no interpreter is injected', async () => {
    const input = {
      ...defaultPipelineInput,
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    };

    await expect(runWeeklyPlanningIntakePipelineWithInterpreter(input)).resolves.toEqual(
      runWeeklyPlanningIntakePipeline(input),
    );
  });

  it('does not escalate parser-handled turns, short answers, or missing interpreter cases', () => {
    expect(shouldEscalateToInterpreter({
      deterministicCommandCount: 1,
      missingBefore: [],
      missingAfter: ['tasks_or_goals'],
      userText: WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      hasInterpreter: true,
    })).toBe(false);
    expect(shouldEscalateToInterpreter({
      deterministicCommandCount: 0,
      missingBefore: ['unit_duration_estimate'],
      missingAfter: ['unit_duration_estimate'],
      userText: '3時間です',
      hasInterpreter: true,
    })).toBe(false);
    expect(shouldEscalateToInterpreter({
      deterministicCommandCount: 0,
      missingBefore: ['tasks_or_goals'],
      missingAfter: ['tasks_or_goals'],
      userText: evaluationCase.freeTextExamScopeAndPriority,
      hasInterpreter: false,
    })).toBe(false);
    expect(shouldEscalateToInterpreter({
      deterministicCommandCount: 0,
      missingBefore: ['tasks_or_goals'],
      missingAfter: ['tasks_or_goals'],
      userText: evaluationCase.freeTextExamScopeAndPriority,
      hasInterpreter: true,
    })).toBe(true);
    expect(shouldEscalateToInterpreter({
      deterministicCommandCount: 1,
      missingBefore: ['tasks_or_goals'],
      missingAfter: ['tasks_or_goals'],
      userText: evaluationCase.freeTextExamScopeAndPriority,
      hasInterpreter: true,
    })).toBe(true);
  });

  it('does not escalate when legacy fallback makes task progress in the current turn', async () => {
    const interpretUserTurn = vi.fn<WeeklyPlanningIntakeInterpreter['interpretUserTurn']>(async () => ({
      candidates: [candidate(unitRateCommand(120, 'high'))],
      parseRejections: [],
    }));

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: '来週、英語を3時間、数学を2時間',
      interpreter: { interpretUserTurn },
    });

    expect(interpretUserTurn).not.toHaveBeenCalled();
    expect(output.state.tasks.map((task) => task.title)).toEqual(['英語', '数学']);
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
  });

  it('uses fake renderer output only for code-planned questions and falls back when output is invalid', async () => {
    const state = createInitialPlanningIntakeState();
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_unit_rate',
      requiredFields: ['unit_rate'],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };
    const renderer: WeeklyPlanningDialogueRenderer = {
      async render() {
        return {
          acknowledgement: '条件を確認しました。',
          questions: [
            { slotKey: 'unit_rate', text: '1年分は何時間くらいですか？' },
            { slotKey: 'daily_target', text: '毎日の目標も教えてください。' },
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
    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer: outsidePlanRenderer })).resolves.toBe(
      createWeeklyPlanningDialogueMessage(decision),
    );
    await expect(renderWeeklyPlanningDialogueMessage({ state, decision })).resolves.toBe(
      createWeeklyPlanningDialogueMessage(decision),
    );
  });
});
