import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  InterpretedCommandCandidate,
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
} from './weeklyPlanningInterpreterTypes';

interface AiInterpreterResponse {
  candidates: InterpretedCommandCandidate[];
}

const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);

const WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
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

function isCommandCandidate(value: unknown): value is Omit<InterpretedCommandCandidate, 'origin'> {
  if (!isRecord(value) || !isRecord(value.command) || typeof value.needsConfirmation !== 'boolean') {
    return false;
  }

  return typeof value.command.type === 'string' && CONFIDENCE_VALUES.has(String(value.command.confidence));
}

function parseInterpreterResponse(content: string): InterpretedCommandCandidate[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
    return [];
  }

  if (!parsed.candidates.every(isCommandCandidate)) {
    return [];
  }

  const response = parsed as unknown as AiInterpreterResponse;

  return response.candidates.map((candidate) => ({
    command: candidate.command as ParsedWeeklyPlanningCommand,
    origin: 'ai_interpreter',
    needsConfirmation: candidate.needsConfirmation,
  }));
}

function createSystemPrompt(): string {
  return [
    'You are an interpreter for a Japanese study-planning intake pipeline.',
    'Return only JSON that matches the response schema. Do not return prose.',
    'Your job is to convert the current user turn into command candidates. The application will validate every command before applying it.',
    'Use only the provided userText and stateSummary. Do not assume saved plans, past turns, or life-constraint history.',
    'Prefer no command over an unsafe command. Return an empty candidates array when the turn is not enough.',
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
        return [];
      }
    },
  };
}