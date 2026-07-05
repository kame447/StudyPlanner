import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  InterpretedCommandCandidate,
  InterpreterParseRejection,
  InterpreterStateSummary,
  WeeklyPlanningInterpreterResult,
  WeeklyPlanningIntakeInterpreter,
} from './weeklyPlanningInterpreterTypes';

interface AiInterpreterResponse {
  candidates: unknown[];
}

const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);

export const WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_interpreted_commands',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['candidates'],
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['command', 'needsConfirmation'],
            properties: {
              command: {
                type: 'object',
                additionalProperties: true,
                required: ['confidence'],
                properties: {
                  confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                  },
                },
              },
              needsConfirmation: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeConfidence(value: unknown): ParsedWeeklyPlanningCommand['confidence'] {
  return CONFIDENCE_VALUES.has(String(value))
    ? value as ParsedWeeklyPlanningCommand['confidence']
    : 'low';
}

function parseCandidate(candidate: unknown): InterpretedCommandCandidate | null {
  if (!isRecord(candidate) || !isRecord(candidate.command) || typeof candidate.needsConfirmation !== 'boolean') {
    return null;
  }

  if (typeof candidate.command.type !== 'string') {
    return null;
  }

  return {
    command: {
      ...candidate.command,
      confidence: normalizeConfidence(candidate.command.confidence),
    } as unknown as ParsedWeeklyPlanningCommand,
    origin: 'ai_interpreter',
    needsConfirmation: candidate.needsConfirmation,
  };
}

function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {
  return {
    candidates: [],
    parseRejections: [],
  };
}

function parseInterpreterResponse(content: string): WeeklyPlanningInterpreterResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return emptyInterpreterResult();
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
    return emptyInterpreterResult();
  }

  const response = parsed as unknown as AiInterpreterResponse;
  const candidates: InterpretedCommandCandidate[] = [];
  const parseRejections: InterpreterParseRejection[] = [];

  response.candidates.forEach((rawCandidate) => {
    const candidate = parseCandidate(rawCandidate);

    if (!candidate) {
      parseRejections.push({ rawCandidate, reason: 'invalid-candidate-shape' });
      return;
    }

    candidates.push(candidate);
  });

  return { candidates, parseRejections };
}

function createSystemPrompt(): string {
  return [
    'You are an interpreter for a Japanese study-planning intake pipeline.',
    'Return only JSON that matches the response schema. Do not return prose.',
    'Your job is to convert the current user turn into command candidates. The application will validate every command before applying it.',
    'Use only the provided userText and stateSummary. Do not assume saved plans, past turns, or life-constraint history.',
    'Prefer no command over an unsafe command. Return an empty candidates array when the turn is not enough.',
    'Each command must include a confidence field with one of: high, medium, low.',
    'Command types you may emit:',
    '- set_exam_scope: examType, fields, totalFields, totalYears, yearRange, strategyHint, unitModel, rawText.',
    '- set_priority_policy: policy.kind field_first with order when the user describes field order or priority.',
    '- set_unit_rate: minutesPerUnit for a known scope unit.',
    '- mark_completed_units or note_progress_boundary for completed year/field progress.',
    '- add_fixed_event, add_unavailable, update_life_constraint, note_no_fixed_events, note_uncertainty, set_planning_range only when explicit in the current turn.',
    'Confidence rules: high for explicit complete facts, medium for inferred or partially ordered facts that need confirmation, low for ambiguous facts.',
    'For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
  ].join('\n');
}

function createUserPrompt(params: {
  userText: string;
  stateSummary: InterpreterStateSummary;
}): string {
  return JSON.stringify({
    userText: params.userText,
    stateSummary: params.stateSummary,
  });
}

export function createAiWeeklyPlanningInterpreter(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn({ userText, stateSummary }) {
      try {
        const content = await client.createChatCompletion({
          messages: [
            { role: 'system', content: createSystemPrompt() },
            { role: 'user', content: createUserPrompt({ userText, stateSummary }) },
          ],
          temperature: 0.1,
          responseFormat: WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT,
        });

        return parseInterpreterResponse(content);
      } catch {
        return emptyInterpreterResult();
      }
    },
  };
}