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
import { resolveConstraintSourceReferences } from '../intake/weeklyPlanningReferenceResolution';
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

  return schema.properties.candidates.items.anyOf;
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
      purpose: 'weekly_planning_interpreter',
    }));
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: JSON.stringify({
        userText: '数学からOSの順で進めたい',
        recentConversation: [],
        context: {
          currentDateTime: undefined,
          selectedDate: '2030-01-01',
          planningDayCount: 7,
        },
        stateSummary,
      }),
    });
    expect(request.messages[1].content).toContain('2030-01-01');
  });

  it('rejects candidate units with invalid shape or missing required confidence', async () => {
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
      {
        rawCandidate: {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS'] },
            sourceText: '数学からOS',
          },
          needsConfirmation: false,
        },
        reason: 'invalid-candidate-shape',
      },
    ]);
    expect(result.candidates).toEqual([]);
  });

  it('rejects the real smoke response when required confidence is missing', async () => {
    const client = createMockClient(JSON.stringify(
      WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.smokeResponseWithoutConfidence,
    ));
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);

    const result = await interpreter.interpretUserTurn({
      userText: `来週、${WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.freeTextExamScopeAndPriority}`,
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });
    const validation = validateInterpretedCandidates(result.candidates, { knownFields: [], confirmedSlots: [] });

    expect(result.candidates).toEqual([]);
    expect(result.parseRejections).toHaveLength(2);
    expect(result.parseRejections.every((item) => item.reason === 'invalid-candidate-shape')).toBe(true);
    expect(validation.rejected).toEqual([]);
    expect(validation.clarifications).toEqual([]);
  });

  it('accepts the simplified bare command array response and derives needsConfirmation from confidence', async () => {
    const interpreter = createAiWeeklyPlanningInterpreter(
      config,
      createMockClient(JSON.stringify(
        WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.topLevelNeedsConfirmationBareCommandResponse,
      )),
    );

    const result = await interpreter.interpretUserTurn({
      userText: `来週、${WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.freeTextExamScopeAndPriority}`,
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });
    const validation = validateInterpretedCandidates(result.candidates, { knownFields: [], confirmedSlots: [] });

    expect(result.parseRejections).toEqual([]);
    expect(result.candidates.map((candidate) => ({
      type: candidate.command.type,
      needsConfirmation: candidate.needsConfirmation,
    }))).toEqual([
      { type: 'set_exam_scope', needsConfirmation: false },
      { type: 'set_priority_policy', needsConfirmation: true },
    ]);
    expect(validation.accepted).toEqual([
      expect.objectContaining({ type: 'set_exam_scope' }),
    ]);
    expect(validation.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
  });

  it('keeps accepting the legacy candidate wrapper shape', async () => {
    const interpreter = createAiWeeklyPlanningInterpreter(config, createMockClient(JSON.stringify({
      candidates: [
        {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS'] },
            sourceText: '数学からOS',
            confidence: 'high',
          },
          needsConfirmation: true,
        },
      ],
    })));

    const result = await interpreter.interpretUserTurn({
      userText: '数学からOSの順で進めたい',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary,
    });

    expect(result.parseRejections).toEqual([]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({ type: 'set_priority_policy', confidence: 'high' }),
        needsConfirmation: true,
      }),
    ]);
  });

  it('treats null object properties as unspecified without repairing required fields', async () => {
    const interpreter = createAiWeeklyPlanningInterpreter(config, createMockClient(JSON.stringify({
      candidates: [
        {
          command: {
            type: 'set_study_goal',
            goal: {
              title: '全体を先におさらいする',
              subject: '院試全体',
              unit: 'unknown',
              amount: null,
            },
            sourceText: '全体を先におさらいしたい',
            confidence: 'medium',
          },
        },
        {
          command: {
            type: 'set_study_goal',
            goal: { title: null, amount: null },
            sourceText: '壊れた必須項目',
            confidence: 'high',
          },
        },
      ],
    })));

    const result = await interpreter.interpretUserTurn({
      userText: '院試全体を先におさらいしたい',
      context: { selectedDate: '2030-01-01', planningDayCount: 7 },
      stateSummary: { knownFields: [], confirmedSlots: [] },
    });
    const validation = validateInterpretedCandidates(
      result.candidates,
      { knownFields: [], confirmedSlots: [] },
    );

    expect(result.candidates[0]?.command).toEqual(expect.objectContaining({
      type: 'set_study_goal',
      goal: {
        title: '全体を先におさらいする',
        subject: '院試全体',
        unit: 'unknown',
      },
    }));
    expect(validation.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_study_goal' }),
    ]);
    expect(validation.rejected).toEqual([]);
    expect(result.parseRejections).toEqual([
      expect.objectContaining({ reason: 'invalid-candidate-shape' }),
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
      userText: `来週、${WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.freeTextExamScopeAndPriority}`,
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
      userText: `来週、${WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.freeTextExamScopeAndPriority}`,
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

  it('shrinks invalid JSON and rejects candidate-shaped data missing required fields', async () => {
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
    })).resolves.toEqual({
      candidates: [],
      parseRejections: [expect.objectContaining({ reason: 'invalid-candidate-shape' })],
    });
  });

  it('keeps ambiguous constraint source resolution outside the validator natural-language boundary', () => {
    const candidates = resolveConstraintSourceReferences({
      userText: '入れてあるやつをそのまま考慮して',
      stateSummary: {
        knownFields: [],
        confirmedSlots: ['planning_range'],
        availableConstraintSources: { timetable: true, existingPlans: true, calendar: false },
      },
      candidates: [
        {
          command: {
            type: 'use_constraint_source',
            source: { kind: 'existing_plans', selector: 'active' },
            sourceText: '入れてあるやつをそのまま考慮して',
            confidence: 'high',
          },
          origin: 'ai_interpreter',
          needsConfirmation: false,
        },
      ],
    });
    const validation = validateInterpretedCandidates(candidates, {
      knownFields: [],
      confirmedSlots: ['planning_range'],
      availableConstraintSources: { timetable: true, existingPlans: true, calendar: false },
    });

    expect(candidates[0].constraintSourceResolution).toEqual(expect.objectContaining({ status: 'multiple' }));
    expect(validation.accepted).toEqual([]);
    expect(validation.clarificationRequests).toEqual([
      expect.objectContaining({
        type: 'request_clarification',
        target: 'unresolved_slot',
        ref: 'constraint_source',
      }),
    ]);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'constraint-source-reference-multiple' }),
    ]);
  });

  it('propagates an AI client error so the pipeline can use turn-level rules fallback', async () => {
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => { throw new Error('network failed'); }) };
    const interpreter = createAiWeeklyPlanningInterpreter(config, client);
    await expect(interpreter.interpretUserTurn({ userText: 'input', context: { selectedDate: '2026-07-06' }, stateSummary })).rejects.toThrow('network failed');
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });
});