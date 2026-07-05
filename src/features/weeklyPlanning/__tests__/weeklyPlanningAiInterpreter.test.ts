import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

const stateSummary = {
  knownFields: ['数学', 'OS'],
  confirmedSlots: ['planning_range'],
  planningRangeSummary: '2026-07-06〜2026-07-12',
};

function createMockClient(content: string): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn(async () => content),
  };
}

describe('weekly planning AI interpreter', () => {
  it('converts a valid structured response into interpreted command candidates', async () => {
    const client = createMockClient(JSON.stringify({
      candidates: [
        {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS'] },
            sourceText: '数学からOS',
            confidence: 'medium',
          },
          needsConfirmation: true,
        },
      ],
    }));
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    const candidates = await interpreter.interpretUserTurn({
      userText: '数学からOSの順で進めたい',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary,
    });

    expect(candidates).toEqual([
      {
        command: expect.objectContaining({
          type: 'set_priority_policy',
          confidence: 'medium',
        }),
        origin: 'ai_interpreter',
        needsConfirmation: true,
      },
    ]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.1,
      responseFormat: expect.objectContaining({ type: 'json_schema' }),
    }));
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: JSON.stringify({
        userText: '数学からOSの順で進めたい',
        stateSummary,
      }),
    });
    expect(request.messages[1].content).not.toContain('2030-01-01');
  });

  it('shrinks to an empty candidate list when the response is not valid JSON or schema-shaped data', async () => {
    const invalidJsonInterpreter = createAiWeeklyPlanningInterpreter(config, createMockClient('not json'));
    const invalidShapeInterpreter = createAiWeeklyPlanningInterpreter(config, createMockClient(JSON.stringify({
      candidates: [
        { command: { type: 'set_priority_policy' }, needsConfirmation: true },
      ],
    })));

    await expect(invalidJsonInterpreter.interpretUserTurn({
      userText: '数学から始めたい',
      context: { selectedDate: '2026-07-06' },
      stateSummary,
    })).resolves.toEqual([]);
    await expect(invalidShapeInterpreter.interpretUserTurn({
      userText: '数学から始めたい',
      context: { selectedDate: '2026-07-06' },
      stateSummary,
    })).resolves.toEqual([]);
  });

  it('shrinks to an empty candidate list when the AI client throws', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => {
        throw new Error('network failed');
      }),
    };
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    await expect(interpreter.interpretUserTurn({
      userText: '数学から始めたい',
      context: { selectedDate: '2026-07-06' },
      stateSummary,
    })).resolves.toEqual([]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });
});