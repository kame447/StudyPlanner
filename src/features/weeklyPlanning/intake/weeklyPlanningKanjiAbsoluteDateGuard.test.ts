import { applyWeeklyPlanningUserTurn } from './weeklyPlanningLegacyIntakeReducer.testSupport';
import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate, InterpreterStateSummary, WeeklyPlanningIntakeInterpreter } from './weeklyPlanningInterpreterTypes';
import type { PendingPlanningRangeClarification, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import {
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';
import {
  nextWeekScope,
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from '../pipeline/weeklyPlanningIntakePipeline';

function context(selectedDate: string): WeeklyPlanningIntakeContext {
  return {
    selectedDate,
    currentDateTime: `${selectedDate}T09:00:00`,
  };
}

function pendingNextWeek(selectedDate: string): PendingPlanningRangeClarification {
  return {
    scope: nextWeekScope(context(selectedDate)),
    durationDays: 7,
    sourceText: '来週の予定を立てたい',
  };
}

function summaryForPending(selectedDate: string): InterpreterStateSummary {
  const pending = pendingNextWeek(selectedDate);
  return {
    knownFields: [],
    confirmedSlots: [],
    pendingPlanningRange: {
      kind: pending.scope.kind,
      label: pending.scope.label,
      windowStartDate: pending.scope.windowStartDate,
      windowEndDate: pending.scope.windowEndDate,
      durationDays: pending.durationDays,
    },
  };
}

function rangeCandidate(params: {
  sourceText: string;
  startDateTime: string;
  endDateTime: string;
}): InterpretedCommandCandidate {
  return {
    origin: 'ai_interpreter',
    needsConfirmation: false,
    command: {
      type: 'set_planning_range',
      confidence: 'high',
      sourceText: params.sourceText,
      range: {
        startDateTime: params.startDateTime,
        endDateTime: params.endDateTime,
        sourceText: params.sourceText,
        confidence: 'explicit',
      },
    },
  };
}

describe('漢数字を含む絶対日付のguard', () => {
  it.each([
    '8月1日から一週間',
    '8月一日から一週間',
    '八月1日から一週間',
    '八月一日から一週間',
  ])('%sを同じ絶対日付として解決する', (text) => {
    const command = parseSetPlanningRangeCommand(text, context('2026-07-26'));
    expect(command?.range.startDateTime).toBe('2026-08-01T00:00:00');
    expect(command?.range.endDateTime).toBe('2026-08-07T24:00:00');
  });

  it.each([
    '8月1日から',
    '8月一日から',
    '八月1日から',
    '八月一日から',
  ])('pending期間の開始日として%sを受理する', (text) => {
    const command = parseSetPlanningRangeCommand(
      text,
      context('2026-07-26'),
      pendingNextWeek('2026-07-26'),
      'planning_start_date',
    );
    expect(command?.range.startDateTime).toBe('2026-08-01T00:00:00');
    expect(command?.range.startDateTime).not.toBe('2026-08-02T00:00:00');
  });

  it('pending来週の範囲外にある漢数字日付を日曜日へfallbackしない', () => {
    const intakeContext = context('2026-06-26');
    const pending = pendingNextWeek('2026-06-26');

    expect(parseSetPlanningRangeCommand(
      '八月一日から一週間',
      intakeContext,
      pending,
      'planning_start_date',
    )).toBeUndefined();
    expect(parseSetPendingPlanningRangeCommand(
      '八月一日から一週間',
      intakeContext,
      { pending, expectedSlot: 'planning_start_date' },
    )).toBeUndefined();
  });

  it.each(['日曜日から一週間', '日曜から一週間', '来週の日曜日から一週間'])(
    '%sの曜日解決を維持する',
    (text) => {
      const command = parseSetPlanningRangeCommand(
        text,
        context('2026-07-26'),
        pendingNextWeek('2026-07-26'),
        'planning_start_date',
      );
      expect(command?.range.startDateTime).toBe('2026-08-02T00:00:00');
    },
  );

  it.each(['一日だけ勉強する', '一週間で進める'])(
    '%sを絶対日付または日曜日として扱わない',
    (text) => {
      expect(parseSetPlanningRangeCommand(
        text,
        context('2026-07-26'),
        pendingNextWeek('2026-07-26'),
        'planning_start_date',
      )).toBeUndefined();
    },
  );

  it.each(['十三月一日から一週間', '二月三十一日から一週間'])(
    '%sの解決失敗時に曜日へfallbackしない',
    (text) => {
      expect(parseSetPlanningRangeCommand(
        text,
        context('2026-01-01'),
        pendingNextWeek('2026-01-01'),
        'planning_start_date',
      )).toBeUndefined();
    },
  );

  it('AI candidateはsourceTextを再解析せずtyped開始日を受理する', () => {
    const intakeContext = context('2026-07-26');
    const candidate = rangeCandidate({
      sourceText: '八月一日から一週間',
      startDateTime: '2026-08-02T00:00:00',
      endDateTime: '2026-08-08T24:00:00',
    });
    const validation = validateInterpretedCandidates(
      [candidate],
      summaryForPending('2026-07-26'),
      intakeContext,
    );

    expect(validation.accepted).toHaveLength(1);
    expect(validation.rejected).toEqual([]);
  });

  it('AI candidateの開始日がsourceTextの絶対日付と一致する場合は受理する', () => {
    const intakeContext = context('2026-07-26');
    const candidate = rangeCandidate({
      sourceText: '八月一日から一週間',
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
    });
    const validation = validateInterpretedCandidates(
      [candidate],
      summaryForPending('2026-07-26'),
      intakeContext,
    );

    expect(validation.rejected).toHaveLength(0);
    expect(validation.accepted).toHaveLength(1);
  });

  it('pipelineはsourceTextを再解析せずAIのtyped日付をそのまま適用する', async () => {
    const selectedDate = '2026-06-26';
    const intakeContext = context(selectedDate);
    const previousState = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '来週の予定を立てたい',
      intakeContext,
    );
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        return {
          candidates: [rangeCandidate({
            sourceText: '八月一日から一週間',
            startDateTime: '2026-07-05T00:00:00',
            endDateTime: '2026-07-11T24:00:00',
          })],
          parseRejections: [],
        };
      },
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState,
      userText: '八月一日から一週間',
      planningStartDate: selectedDate,
      planningDayCount: 7,
      currentDateTime: `${selectedDate}T09:00:00`,
      interpreter,
    });

    expect(output.state.range).toMatchObject({
      startDateTime: '2026-07-05T00:00:00',
      endDateTime: '2026-07-11T24:00:00',
    });
    expect(output.state.pendingPlanningRange).toBeUndefined();
    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
  });
});
