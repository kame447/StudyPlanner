import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from './weeklyPlanningAiInterpreter';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'gpt-5.4-nano-2026-03-17',
  apiKey: 'test-key',
};

function params() {
  return {
    userText: '研究と院試の予定を立てたい',
    context: { selectedDate: '2026-07-21', planningDayCount: 7 },
    stateSummary: { knownFields: [], confirmedSlots: [] },
  };
}

describe('weekly planning AI raw response observability', () => {
  it('preserves the exact valid provider response for trace diagnostics', async () => {
    const raw = JSON.stringify({ candidates: [] });
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => raw),
    };

    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());

    expect(result.rawResponse).toBe(raw);
    expect(result.candidates).toEqual([]);
  });

  it('preserves malformed provider content even when parsing fails closed', async () => {
    const raw = 'not-json';
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => raw),
    };

    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());

    expect(result.rawResponse).toBe(raw);
    expect(result.candidates).toEqual([]);
  });

  it('accepts trace-shaped study goals after structural optional-field canonicalization', async () => {
    const raw = JSON.stringify({
      candidates: [{
        type: 'set_study_goal',
        confidence: 'high',
        sourceText: '3時ぐらいまでは研究の内容やらないといけないです',
        sourceSegment: '3時ぐらいまでは研究の内容やらないといけない',
        goal: {
          title: '研究の進捗を作る',
          subject: '研究',
          unit: 'unknown',
          amount: 1,
          deadlineDeclared: false,
          deadlineDate: '',
          deadlineTime: '',
          executionProfile: {
            activityKind: 'project',
            distributionPolicy: 'single_block',
            cognitiveLoad: 'unknown',
          },
        },
      }],
    });
    const createChatCompletion = vi.fn(async () => raw);
    const client: OpenAiCompatibleClient = { createChatCompletion };

    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());
    const command = result.candidates[0]?.command;

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(command?.type).toBe('set_study_goal');
    if (command?.type !== 'set_study_goal') throw new Error('expected set_study_goal');
    expect(command.goal.deadlineDeclared).toBeUndefined();
    expect(command.goal.deadlineDate).toBeUndefined();
    expect(command.goal.deadlineTime).toBeUndefined();
  });

  it('repairs a contradictory current-week pending range instead of accepting it', async () => {
    const invalid = JSON.stringify({
      candidates: [{
        type: 'set_pending_planning_range',
        confidence: 'high',
        sourceText: '今週です',
        sourceSegment: '今週',
        pending: {
          scope: {
            kind: 'next_week',
            label: '今週',
            windowStartDate: '2026-07-21',
            windowEndDate: '2026-07-27',
          },
          planningStartDate: '2026-07-21',
          durationDays: 7,
          sourceText: '今週です',
        },
      }],
    });
    const repaired = JSON.stringify({
      candidates: [{
        type: 'set_planning_range',
        confidence: 'high',
        sourceText: '今週です',
        sourceSegment: '今週',
        range: {
          startDateTime: '2026-07-21T00:00:00',
          endDateTime: '2026-07-27T24:00:00',
          calendarDayCount: 7,
          sourceText: '今週です',
          confidence: 'explicit',
        },
      }],
    });
    const createChatCompletion = vi.fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(repaired);
    const client: OpenAiCompatibleClient = { createChatCompletion };

    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.repairAttempted).toBe(true);
    expect(result.responseFailure).toBeUndefined();
    expect(result.candidates[0]?.command.type).toBe('set_planning_range');
  });

  it('fails closed when a repair response drops every invalid semantic candidate', async () => {
    const invalid = JSON.stringify({
      candidates: [{
        type: 'set_study_goal',
        confidence: 'high',
        sourceText: '研究を進めたい',
        goal: { title: '' },
      }],
    });
    const emptyRepair = JSON.stringify({ candidates: [] });
    const createChatCompletion = vi.fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(emptyRepair);
    const client: OpenAiCompatibleClient = { createChatCompletion };

    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.repairAttempted).toBe(true);
    expect(result.responseFailure).toBe('invalid_candidates_after_repair');
    expect(result.candidates).toEqual([]);
  });

});
