import { getAiConfig } from '../../../lib/aiConfig';
import type { AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
} from '../../../lib/openaiCompatibleClient';
import type {
  JsonSchemaResponseFormat,
  OpenAiCompatibleClient,
} from '../../../lib/openaiCompatibleClient';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
import { canonicalizeOptionalCommandNulls, isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import {
  createSystemPrompt as createCoreSystemPrompt,
  createUserPrompt,
  WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT as CORE_RESPONSE_FORMAT,
} from './weeklyPlanningAiInterpreterCore';
import type {
  InterpretedCommandCandidate,
  InterpreterRecentTurn,
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
  WeeklyPlanningInterpreterResult,
} from './weeklyPlanningInterpreterTypes';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';

export interface AiInterpreterResponse {
  candidates: unknown[];
  assumptionProposalDrafts?: unknown[];
}

interface CoreResponseFormat {
  name: string;
  strict?: boolean;
  schema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
      candidates: {
        type: string;
        items: {
          properties: {
            command: {
              anyOf: Record<string, unknown>[];
            };
          };
        };
      };
      assumptionProposalDrafts: Record<string, unknown>;
    };
  };
}

const coreResponseFormat = CORE_RESPONSE_FORMAT as unknown as CoreResponseFormat;
const commandSchemas = coreResponseFormat.schema.properties.candidates.items.properties.command.anyOf;

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
            anyOf: commandSchemas,
          },
        },
        assumptionProposalDrafts:
          coreResponseFormat.schema.properties.assumptionProposalDrafts,
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCandidate(
  candidate: unknown,
  context: WeeklyPlanningIntakeContext,
): InterpretedCommandCandidate | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const rawCommand = isRecord(candidate.command) ? candidate.command : candidate;
  const normalizedCommand = canonicalizeOptionalCommandNulls(rawCommand);
  if (!isRecord(normalizedCommand)
    || typeof normalizedCommand.type !== 'string'
    || !isValidWeeklyPlanningCommand(normalizedCommand)) {
    return null;
  }

  const parsedCommand: ParsedWeeklyPlanningCommand =
    normalizedCommand.type === 'set_pending_planning_range'
      ? normalizeSetPendingPlanningRangeCommand(normalizedCommand, context)
      : normalizedCommand;
  const wrappedNeedsConfirmation = isRecord(candidate.command)
    && typeof candidate.needsConfirmation === 'boolean'
    ? candidate.needsConfirmation
    : undefined;

  return {
    command: parsedCommand,
    origin: 'ai_interpreter',
    needsConfirmation:
      wrappedNeedsConfirmation ?? normalizedCommand.confidence === 'medium',
  };
}

function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {
  return {
    candidates: [],
    parseRejections: [],
  };
}

function parseInterpreterResponse(
  content: string,
  context: WeeklyPlanningIntakeContext,
): WeeklyPlanningInterpreterResult {
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
  const parseRejections: WeeklyPlanningInterpreterResult['parseRejections'] = [];

  response.candidates.forEach((rawCandidate) => {
    const candidate = parseCandidate(rawCandidate, context);

    if (!candidate) {
      parseRejections.push({ rawCandidate, reason: 'invalid-candidate-shape' });
      return;
    }

    candidates.push(candidate);
  });

  const result: WeeklyPlanningInterpreterResult = { candidates, parseRejections };
  if (Array.isArray(response.assumptionProposalDrafts)) {
    result.assumptionProposalDrafts = response.assumptionProposalDrafts;
  }

  return result;
}

export function createSystemPrompt(): string {
  const prompt = createCoreSystemPrompt().replace(
    '- Resolve relative dates such as today, tomorrow, the day after tomorrow, and next week from context.currentDateTime. Emit ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss values only when the resolution is certain.',
    '- Resolve today, tomorrow, and the day after tomorrow from context.currentDateTime. Resolve a planning next_week window from context.selectedDate so deterministic and AI paths use the same selected week. Emit ISO values only when the resolution is certain.',
  );

  return [
    prompt,
    '- Never substitute an inferred set_planning_range for an unresolved pending range.',
  ].join('\n');
}

export { createUserPrompt };

export function createAiWeeklyPlanningInterpreter(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn({ userText, context, stateSummary, recentTurns }) {
      const content = await client.createChatCompletion({
        messages: [
          { role: 'system', content: createSystemPrompt() },
          {
            role: 'user',
            content: createUserPrompt({
              userText,
              context,
              stateSummary,
              recentTurns,
            }),
          },
        ],
        temperature: 0.1,
        responseFormat: WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT,
        purpose: 'weekly_planning_interpreter',
      });

      return parseInterpreterResponse(content, context);
    },
  };
}
