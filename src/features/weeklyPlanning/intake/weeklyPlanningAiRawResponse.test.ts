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
});
