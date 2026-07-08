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

type JsonSchemaObject = Record<string, unknown>;

const CONFIDENCE_SCHEMA = {
  type: 'string',
  enum: ['high', 'medium', 'low'],
} as const;

const STUDY_SCOPE_UNIT_SCHEMA = {
  type: 'string',
  enum: ['minutes', 'hours', 'pages', 'problems', 'words', 'lessons', 'chapters', 'year_field_chunk', 'topic', 'unknown'],
} as const;

const HARDNESS_SCHEMA = {
  type: 'string',
  enum: ['hard', 'soft'],
} as const;

function stringSchema(): JsonSchemaObject {
  return { type: 'string' };
}

function numberSchema(): JsonSchemaObject {
  return { type: 'number' };
}

function integerSchema(): JsonSchemaObject {
  return { type: 'integer' };
}

function stringArraySchema(): JsonSchemaObject {
  return {
    type: 'array',
    items: stringSchema(),
  };
}

function yearRangeSchema(): JsonSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['startYear', 'endYear', 'sourceText'],
    properties: {
      startYear: integerSchema(),
      endYear: integerSchema(),
      sourceText: stringSchema(),
    },
  };
}

function commandSchema(params: {
  type: string;
  required?: string[];
  properties?: Record<string, unknown>;
}): JsonSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'confidence', 'sourceText', ...(params.required ?? [])],
    properties: {
      type: { const: params.type },
      confidence: CONFIDENCE_SCHEMA,
      sourceText: stringSchema(),
      sourceSegment: stringSchema(),
      ...(params.properties ?? {}),
    },
  };
}

const WEEKLY_PLANNING_COMMAND_SCHEMAS: JsonSchemaObject[] = [
  commandSchema({
    type: 'add_unavailable',
    required: ['range'],
    properties: {
      range: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'hardness'],
        properties: {
          date: stringSchema(),
          start: stringSchema(),
          end: stringSchema(),
          hardness: HARDNESS_SCHEMA,
          reason: stringSchema(),
        },
      },
    },
  }),
  commandSchema({
    type: 'add_fixed_event',
    required: ['event'],
    properties: {
      event: {
        type: 'object',
        additionalProperties: false,
        required: ['hardness'],
        properties: {
          date: stringSchema(),
          start: stringSchema(),
          end: stringSchema(),
          durationMinutes: numberSchema(),
          hardness: HARDNESS_SCHEMA,
        },
      },
    },
  }),
  commandSchema({
    type: 'update_life_constraint',
    required: ['kind', 'constraint'],
    properties: {
      kind: {
        type: 'string',
        enum: ['sleep', 'meal', 'bath', 'commute', 'club', 'cram_school', 'buffer'],
      },
      constraint: {
        type: 'object',
        additionalProperties: false,
        required: ['hardness'],
        properties: {
          date: stringSchema(),
          start: stringSchema(),
          end: stringSchema(),
          durationMinutes: numberSchema(),
          hardness: HARDNESS_SCHEMA,
        },
      },
    },
  }),
  commandSchema({
    type: 'use_constraint_source',
    required: ['source'],
    properties: {
      source: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'selector'],
        properties: {
          // 現在 active な参照元は timetable と existing_plans のみ。
          // calendar は将来拡張用の内部型のため、AI には現時点で選択させない。
          kind: {
            type: 'string',
            enum: ['timetable', 'existing_plans'],
          },
          selector: { const: 'active' },
        },
      },
    },
  }),
  commandSchema({
    type: 'request_clarification',
    required: ['target'],
    properties: {
      target: {
        type: 'string',
        enum: ['referenced_question', 'referenced_term', 'unresolved_slot'],
      },
      ref: stringSchema(),
    },
  }),
  commandSchema({
    type: 'set_priority_policy',
    required: ['policy'],
    properties: {
      policy: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'order'],
            properties: {
              kind: { const: 'field_first' },
              order: stringArraySchema(),
            },
          },
          ...['deadline_first', 'weakness_first', 'score_weight_first', 'balanced', 'unknown'].map((kind) => ({
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: { kind: { const: kind } },
          })),
        ],
      },
    },
  }),
  commandSchema({
    type: 'mark_completed_units',
    required: ['field', 'completedYears', 'mergeMode'],
    properties: {
      field: stringSchema(),
      completedYears: {
        type: 'array',
        items: integerSchema(),
      },
      mergeMode: {
        type: 'string',
        enum: ['replace', 'append'],
      },
    },
  }),
  commandSchema({
    type: 'mark_completion_target',
    required: ['target'],
    properties: {
      field: stringSchema(),
      target: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'rawText'],
            properties: {
              kind: { const: 'all' },
              rawText: stringSchema(),
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'count', 'rawText'],
            properties: {
              kind: { const: 'latest_n_years' },
              count: integerSchema(),
              rawText: stringSchema(),
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'rawText'],
            properties: {
              kind: { const: 'up_to_reachable' },
              rawText: stringSchema(),
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'startYear', 'endYear', 'rawText'],
            properties: {
              kind: { const: 'year_range' },
              startYear: integerSchema(),
              endYear: integerSchema(),
              rawText: stringSchema(),
            },
          },
        ],
      },
    },
  }),
  commandSchema({
    type: 'note_progress_boundary',
    required: ['boundaryYear', 'ambiguity'],
    properties: {
      field: stringSchema(),
      boundaryYear: integerSchema(),
      ambiguity: { const: 'completion_direction' },
    },
  }),
  commandSchema({
    type: 'note_no_fixed_events',
  }),
  commandSchema({
    type: 'note_uncertainty',
    required: ['uncertainty'],
    properties: {
      uncertainty: { const: 'unknown_fields_may_take_longer' },
    },
  }),
  commandSchema({
    type: 'set_unit_rate',
    required: ['unitRate'],
    properties: {
      unitRate: {
        type: 'object',
        additionalProperties: false,
        required: ['unit', 'minutesPerUnit', 'source'],
        properties: {
          unit: STUDY_SCOPE_UNIT_SCHEMA,
          minutesPerUnit: numberSchema(),
          source: {
            type: 'string',
            enum: ['user', 'assumption', 'default'],
          },
          uncertainty: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
          rawText: stringSchema(),
        },
      },
    },
  }),
  commandSchema({
    type: 'set_exam_scope',
    required: ['scope'],
    properties: {
      scope: {
        type: 'object',
        additionalProperties: false,
        required: ['fields', 'rawText'],
        properties: {
          examType: stringSchema(),
          fields: stringArraySchema(),
          totalFields: integerSchema(),
          totalYears: integerSchema(),
          yearRange: yearRangeSchema(),
          strategyHint: {
            type: 'string',
            enum: ['field_first', 'year_first', 'unknown'],
          },
          unitModel: STUDY_SCOPE_UNIT_SCHEMA,
          unitCountHint: integerSchema(),
          rawText: stringArraySchema(),
        },
      },
    },
  }),
  commandSchema({
    type: 'set_planning_range',
    required: ['range'],
    properties: {
      range: {
        type: 'object',
        additionalProperties: false,
        required: ['confidence'],
        properties: {
          startDateTime: stringSchema(),
          endDateTime: stringSchema(),
          sourceText: stringSchema(),
          confidence: {
            type: 'string',
            enum: ['explicit', 'inferred', 'missing'],
          },
        },
      },
    },
  }),
];

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
            anyOf: WEEKLY_PLANNING_COMMAND_SCHEMAS,
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
  if (!isRecord(candidate)) {
    return null;
  }

  const command = isRecord(candidate.command) ? candidate.command : candidate;
  if (typeof command.type !== 'string') {
    return null;
  }

  const confidence = normalizeConfidence(command.confidence);
  const wrappedNeedsConfirmation = isRecord(candidate.command) && typeof candidate.needsConfirmation === 'boolean'
    ? candidate.needsConfirmation
    : undefined;

  return {
    command: {
      ...command,
      confidence,
    } as unknown as ParsedWeeklyPlanningCommand,
    origin: 'ai_interpreter',
    needsConfirmation: wrappedNeedsConfirmation ?? confidence === 'medium',
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
    'The candidates field must be an array of command objects, not wrapper objects.',
    'Each command must include a confidence field with one of: high, medium, low.',
    'Command types you may emit:',
    '- set_exam_scope: examType, fields, totalFields, totalYears, yearRange, strategyHint, unitModel, rawText.',
    '- set_priority_policy: policy.kind field_first with order when the user describes field order or priority.',
    '- set_unit_rate: minutesPerUnit for a known scope unit.',
    '- mark_completed_units or note_progress_boundary for completed year/field progress. Use mark_completion_target only for the desired future completion target.',
    '- add_fixed_event, add_unavailable, update_life_constraint, note_no_fixed_events, note_uncertainty, set_planning_range only when explicit in the current turn.',
    '- use_constraint_source: when the user says the plan should reuse an existing schedule source instead of listing events. Map ALL such phrasings to this single intent and express the referenced source in source.kind, do not invent a new command per phrasing. The only currently available sources are: timetable (the app\'s class timetable) and existing_plans (schedules already saved in the app). selector is always active. Use source.kind=timetable when the user clearly means the class timetable: 「授業は予定表の通り」「いつもの授業を避けて」「時間割に入っている予定を使って」「登録済みの授業を考慮して」「普段通りの授業があります」. Use source.kind=existing_plans when the user clearly means already-saved plans: 「アプリに保存してある予定と被らないように」「登録してある予定を生かして」. There is no external calendar (Google/Apple/Outlook) integration; never emit a calendar source.',
    '- Ambiguous source: if the phrasing could refer to more than one available source and you cannot uniquely decide between timetable and existing_plans (e.g. 「カレンダーに入れてあるやつ」 which might mean either), do NOT guess a single source. Emit request_clarification (target=unresolved_slot, ref=constraint_source) instead, or at most use_constraint_source with confidence=low. Never hard-apply a guessed source.',
    '- request_clarification: when the user is asking what one of the app\'s question words or terms means, rather than answering it. Map ALL such phrasings to this single intent: 「固定の予定って何ですか？」「それってどういう意味？」「何を答えればいいの？」. Set ref to the term or slot being asked about (e.g. fixed_events) when identifiable. Never map such a question to note_uncertainty or any answer command; the user is not providing information, they are asking for an explanation.',
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
          purpose: 'weekly_planning_interpreter',
        });

        return parseInterpreterResponse(content);
      } catch {
        return emptyInterpreterResult();
      }
    },
  };
}