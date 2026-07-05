import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningInterpreter,
  WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT,
} from '../intake/weeklyPlanningAiInterpreter';
import {
  KNOWN_COMMAND_TYPES,
  validateInterpretedCandidates,
} from '../intake/weeklyPlanningCandidateValidator';
import { WEEKLY_PLANNING_INTAKE_EVALUATION_CASES } from '../testFixtures/weeklyPlanningEvaluationCases';

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


function commandUnionSchemas() {
  const schema = WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT.json_schema.schema as {
    properties: {
      candidates: {
        items: {
          properties: {
            command: {
              anyOf: Array<{
                additionalProperties?: boolean;
                required?: string[];
                properties?: {
                  type?: { const?: string };
                  confidence?: unknown;
                  [key: string]: unknown;
                };
              }>;
            };
          };
        };
      };
    };
  };

  return schema.properties.candidates.items.properties.command.anyOf;
}
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

    const result = await interpreter.interpretUserTurn({
      userText: '数学からOSの順で進めたい',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary,
    });

    expect(result.candidates).toEqual([
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

  it('keeps valid candidate units when one AI candidate has an invalid shape and defaults missing confidence to low', async () => {
    const client = createMockClient(JSON.stringify({
      candidates: [
        { command: 'not-an-object', needsConfirmation: false },
        {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS'] },
            sourceText: '数学からOS',
          },
          needsConfirmation: false,
        },
      ],
    }));
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    const result = await interpreter.interpretUserTurn({
      userText: '数学からOSの順で進めたい',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary,
    });

    expect(result.parseRejections).toEqual([
      { rawCandidate: { command: 'not-an-object', needsConfirmation: false }, reason: 'invalid-candidate-shape' },
    ]);
    expect(result.candidates).toEqual([
      {
        command: expect.objectContaining({
          type: 'set_priority_policy',
          confidence: 'low',
        }),
        origin: 'ai_interpreter',
        needsConfirmation: false,
      },
    ]);
  });

  it('captures the real smoke response shape with missing confidence and invalid field-year unitModel', async () => {
    const client = createMockClient(JSON.stringify(
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.smokeResponseWithoutConfidence,
    ));
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    const result = await interpreter.interpretUserTurn({
      userText: '実AI応答',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });
    const validation = validateInterpretedCandidates(result.candidates, { knownFields: [], confirmedSlots: [] });

    expect(result.parseRejections).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.command.confidence)).toEqual(['low', 'low']);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-unit-model' }),
    ]);
    expect(validation.clarifications).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({ type: 'set_priority_policy' }),
      }),
    ]);
  });

  it('defines a closed command schema for every known command type', () => {
    const schemas = commandUnionSchemas();
    const schemaTypes = schemas.map((schema) => schema.properties?.type?.const).sort();

    expect(schemaTypes).toEqual([...KNOWN_COMMAND_TYPES].sort());
    schemas.forEach((schema) => {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(expect.arrayContaining(['type', 'confidence']));
      expect(schema.properties?.confidence).toEqual({
        type: 'string',
        enum: ['high', 'medium', 'low'],
      });
    });
  });

  it('drops payload-missing command responses into parse rejections', async () => {
    const interpreter = createAiWeeklyPlanningInterpreter(
      config,
      createMockClient(JSON.stringify(
        WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.payloadMissingSmokeResponse,
      )),
    );

    const result = await interpreter.interpretUserTurn({
      userText: '実AI応答',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary,
    });

    expect(result.candidates).toEqual([]);
    expect(result.parseRejections).toEqual([
      expect.objectContaining({ reason: 'invalid-candidate-shape' }),
      expect.objectContaining({ reason: 'invalid-candidate-shape' }),
    ]);
  });

  it('parses and validates complete planning range, exam scope, and priority commands', async () => {
    const interpreter = createAiWeeklyPlanningInterpreter(
      config,
      createMockClient(JSON.stringify(
        WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.completeCommandResponse,
      )),
    );

    const result = await interpreter.interpretUserTurn({
      userText: '実AI応答',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });
    const validation = validateInterpretedCandidates(result.candidates, { knownFields: [], confirmedSlots: [] });

    expect(result.parseRejections).toEqual([]);
    expect(validation.accepted).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
      expect.objectContaining({ type: 'set_exam_scope' }),
    ]);
    expect(validation.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
    expect(validation.rejected).toEqual([]);
  });

  it('shrinks invalid JSON to an empty result and defaults missing confidence in candidate-shaped data', async () => {
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
    })).resolves.toEqual({ candidates: [], parseRejections: [] });
    await expect(invalidShapeInterpreter.interpretUserTurn({
      userText: '数学から始めたい',
      context: { selectedDate: '2026-07-06' },
      stateSummary,
    })).resolves.toEqual({ candidates: [expect.objectContaining({ command: expect.objectContaining({ confidence: 'low' }) })], parseRejections: [] });
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
    })).resolves.toEqual({ candidates: [], parseRejections: [] });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });
});