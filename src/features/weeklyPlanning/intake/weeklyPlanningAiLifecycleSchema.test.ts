import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningInterpreter,
  createSystemPrompt,
  WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT,
} from './weeklyPlanningAiInterpreter';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

describe('weekly planning AI lifecycle schema', () => {
  it('requires high confidence and excludes unsupported restore corrections', () => {
    const schema = WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT.json_schema.schema as {
      properties: {
        correctionEnvelopes: {
          items: {
            required: string[];
            properties: {
              operation: { enum: string[] };
              confidence: { const: string };
            };
          };
        };
      };
    };
    const correction = schema.properties.correctionEnvelopes.items;

    expect(correction.required).toContain('confidence');
    expect(correction.properties.confidence).toEqual({ const: 'high' });
    expect(correction.properties.operation.enum).toEqual(['replace', 'remove', 'supersede']);
  });

  it('preserves AI lifecycle drafts for deterministic canonicalization', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        candidates: [],
        assumptionDecisions: [{
          type: 'accept_assumption',
          proposalId: 'proposal-1',
          confidence: 'high',
        }],
        correctionEnvelopes: [{
          operation: 'remove',
          targetKind: 'task',
          targetRef: 'task:0',
          confidence: 'high',
        }],
      })),
    };
    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn({
      userText: 'その仮定で進めて。英語は外して',
      context: { selectedDate: '2026-07-21' },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });

    expect(result.assumptionDecisions).toEqual([expect.objectContaining({
      type: 'accept_assumption',
      proposalId: 'proposal-1',
    })]);
    expect(result.correctionEnvelopes).toEqual([expect.objectContaining({
      operation: 'remove',
      targetRef: 'task:0',
      confidence: 'high',
    })]);
  });

  it('keeps workload interpretation general while the schema owns command vocabulary', () => {
    const prompt = createSystemPrompt();
    const schema = JSON.stringify(WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT);

    expect(prompt).toContain('Keep per-entity quantities distinct');
    expect(prompt).toContain('do not collapse them into a global total');
    expect(prompt).not.toContain('mark_completion_target records the amount');
    expect(schema).toContain('mark_completion_target');
  });
});
