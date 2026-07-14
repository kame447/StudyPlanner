import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningInterpreter,
  WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT,
} from './weeklyPlanningAiInterpreter';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

describe('weekly planning AI assumption draft channel', () => {
  it('keeps drafts separate from command candidates and closes the schema', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        candidates: [],
        assumptionProposalDrafts: [{
          slot: 'duration',
          targetRef: 'task-1',
          proposedValue: 30,
          proposedUnit: 'minutes',
          reasonCode: 'missing_duration',
          sourceFactRefs: [],
        }],
      })),
    };
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    const result = await interpreter.interpretUserTurn({
      userText: 'this task takes 30 minutes',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });

    expect(result.candidates).toEqual([]);
    expect(result.assumptionProposalDrafts).toEqual([expect.objectContaining({
      slot: 'duration',
      targetRef: 'task-1',
      reasonCode: 'missing_duration',
    })]);
    const schema = WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT.json_schema.schema as any;
    expect(schema.properties.assumptionProposalDrafts.items.additionalProperties).toBe(false);
  });
});
