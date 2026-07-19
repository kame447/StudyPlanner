import { describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';

vi.mock('../../../lib/aiConfig', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/aiConfig')>(
    '../../../lib/aiConfig',
  );
  return {
    ...actual,
    getAiConfig: () => ({
      provider: 'rules' as const,
      baseUrl: '',
      model: '',
      apiKey: '',
    }),
    getAiConfigValidationMessage: () => undefined,
  };
});

import { executeWeeklyPlanningTurn } from '../weeklyPlanningTurnExecutor';

describe('observed weekly planning conversation integration', () => {
  it('runs the reported conversation through turn execution, state carry-over, and rendering', async () => {
    const messages: WeeklyPlanningMessage[] = [];
    let state: PlanningIntakeState | undefined;
    let sequence = 0;

    const submit = async (userText: string) => {
      sequence += 1;
      const result = await executeWeeklyPlanningTurn({
        previousState: state,
        messages: [...messages],
        userText,
        selectedDate: '2026-07-19',
        userId: 'integration-user',
        plans: [],
        scheduleTemplates: [],
        conversationId: 'integration-conversation',
        traceRequestId: `integration-request-${sequence}`,
        weekStartsOn: 'monday',
      });
      const createdAt = `2026-07-19T20:${String(sequence).padStart(2, '0')}:00.000Z`;
      messages.push(
        {
          id: `user-${sequence}`,
          role: 'user',
          content: userText,
          createdAt,
        },
        {
          id: `assistant-${sequence}`,
          role: 'assistant',
          content: result.message,
          createdAt,
        },
      );
      state = result.state;
      return result;
    };

    const first = await submit('今日の勉強計画を立ててください');
    expect(first.state.range?.calendarDayCount).toBe(1);
    expect(first.state.missing).not.toContain('planning_period');
    expect(first.message).not.toContain('今週・来週・週末');

    const second = await submit('院試の過去問 OSとネットワークを進めたいです');
    expect(second.state.examPrepScope?.fields).toEqual(['OS', 'ネットワーク']);
    expect(second.message).toContain('OSとネットワークの2分野');
    expect(second.message).not.toContain('今日の計画ですね');

    const third = await submit('3時間ぐらいです\n予定は特にないです');
    expect(third.state.unitRates).toEqual([
      expect.objectContaining({ minutesPerUnit: 180, source: 'user' }),
    ]);
    expect(third.message).toContain('3時間');
    expect(third.message).not.toContain('180分');

    const fourth = await submit('分野はOSとネットワークだけです');
    expect(fourth.message).toContain('進める順番だけ確認します');
    expect(fourth.message).not.toContain('睡眠時間や');
    expect(fourth.message.match(/？/g) ?? []).toHaveLength(1);

    const fifth = await submit('違う！OSとネットワークで一科目です');
    expect(fifth.state.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(fifth.state.examPrepScope?.totalFields).toBe(1);
    expect(fifth.message).toContain('OSとネットワークを1科目');
  });
});
