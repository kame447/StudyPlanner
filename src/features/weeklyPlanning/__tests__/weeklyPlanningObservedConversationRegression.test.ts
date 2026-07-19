import { describe, expect, it } from 'vitest';
import { renderWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueRenderer';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import { runWeeklyPlanningIntakePipeline } from '../pipeline/weeklyPlanningIntakePipeline';

const context = {
  selectedDate: '2026-07-19',
  planningDayCount: 7,
  currentDateTime: '2026-07-19T20:30:00',
  weekStartsOn: 'monday' as const,
};

function runTurn(previousState: ReturnType<typeof createInitialPlanningIntakeState> | undefined, userText: string) {
  return runWeeklyPlanningIntakePipeline({
    previousState,
    userText,
    planningStartDate: context.selectedDate,
    planningDayCount: context.planningDayCount,
    currentDateTime: context.currentDateTime,
    weekStartsOn: context.weekStartsOn,
  });
}

describe('observed weekly planning conversation regressions', () => {
  it('accepts 今日の勉強計画 as a one-day range instead of asking for a week', () => {
    const output = runTurn(undefined, '今日の勉強計画を立ててください');

    expect(output.state.range).toEqual({
      startDateTime: '2026-07-19T20:30:00',
      endDateTime: '2026-07-19T24:00:00',
      sourceText: '今日の勉強計画を立ててください',
      calendarDayCount: 1,
      confidence: 'explicit',
    });
    expect(output.state.missing).not.toContain('planning_period');
    expect(output.decision.questionPlan?.[0]?.targetSlot).toBe('tasks_or_goals');
  });

  it('extracts OS and network as two fields and accepts an explicit one-subject correction', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '今日の勉強計画を立ててください',
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      '院試の過去問 OSとネットワークを進めたいです',
      context,
    );

    expect(afterScope.examPrepScope?.fields).toEqual(['OS', 'ネットワーク']);

    const corrected = applyWeeklyPlanningUserTurn(
      afterScope,
      '違う！OSとネットワークで一科目です',
      context,
    );
    expect(corrected.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(corrected.examPrepScope?.totalFields).toBe(1);
  });

  it('acknowledges only facts accepted in the current turn and keeps 3時間 as written', async () => {
    const first = runTurn(undefined, '今日の勉強計画を立ててください');
    const second = runTurn(first.state, '院試の過去問 OSとネットワークを進めたいです');
    const scopeMessage = await renderWeeklyPlanningDialogueMessage({
      state: second.state,
      previousState: first.state,
      decision: second.decision,
    });

    expect(scopeMessage).toContain('OSとネットワークの2分野');
    expect(scopeMessage).not.toContain('今日の計画ですね');

    const third = runTurn(second.state, '3時間ぐらいです\n予定は特にないです');
    const durationMessage = await renderWeeklyPlanningDialogueMessage({
      state: third.state,
      previousState: second.state,
      decision: third.decision,
    });

    expect(durationMessage).toContain('目安時間は3時間');
    expect(durationMessage).not.toContain('180分');
    expect(durationMessage).not.toContain('今日の計画ですね');
  });

  it('repairs an unanswered repeated question by paraphrasing and narrowing to one question', async () => {
    const first = runTurn(undefined, '今日の勉強計画を立ててください');
    const second = runTurn(first.state, '院試の過去問 OSとネットワークを進めたいです');
    const third = runTurn(second.state, '3時間ぐらいです\n予定は特にないです');
    const fourth = runTurn(third.state, '分野はOSとネットワークだけです');
    const message = await renderWeeklyPlanningDialogueMessage({
      state: fourth.state,
      previousState: third.state,
      decision: fourth.decision,
    });

    expect(message).toContain('OSとネットワークの2分野');
    expect(message).toContain('進める順番だけ確認します');
    expect(message).not.toContain('睡眠時間や');
    expect(message.split('\n').filter((line) => line.includes('？'))).toHaveLength(1);
  });
});
