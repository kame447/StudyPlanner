import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import type {
  DialogueRenderInput,
  DialogueRenderOutput,
  WeeklyPlanningDialogueRenderer,
} from './weeklyPlanningDialogueRenderer';

type JsonSchemaObject = Record<string, unknown>;

function stringSchema(): JsonSchemaObject {
  return { type: 'string' };
}

export const WEEKLY_PLANNING_DIALOGUE_RENDERER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_dialogue_rendered_questions',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        acknowledgement: stringSchema(),
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['slotKey', 'text'],
            properties: {
              slotKey: stringSchema(),
              text: stringSchema(),
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

function parseRendererResponse(content: string): DialogueRenderOutput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return { questions: [] };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) {
    return { questions: [] };
  }

  const questions = parsed.questions
    .filter((question): question is { slotKey: string; text: string } =>
      isRecord(question) && typeof question.slotKey === 'string' && typeof question.text === 'string',
    )
    .map((question) => ({
      slotKey: question.slotKey,
      text: question.text,
    }));

  if (questions.length !== parsed.questions.length) {
    return { questions: [] };
  }

  return {
    acknowledgement: typeof parsed.acknowledgement === 'string' ? parsed.acknowledgement : undefined,
    questions,
  };
}

function createSystemPrompt(): string {
  return [
    'You are a Japanese dialogue renderer for a study-planning app.',
    'Return only JSON that matches the response schema. Do not return prose outside JSON.',
    'The application has already decided what to ask. You must only rewrite each planned question in natural concise Japanese.',
    'Do not change the question targets, question count, question order, slot identity, or question kind.',
    'Do not add new questions, omit planned questions, merge slots, split slots, or ask about unplanned slots.',
    'Do not infer missing state or scheduling details. Use only the provided renderer input.',
    'For every item in nextQuestions, return exactly one questions item with the same slotKey.',
    'If nextQuestions contains fixed_events, sleep_cycle, and meal_bath_constraints, keep those slot identities separate.',
    'planningPeriodLabel is the planning period (e.g. 来週/今週/週末). If it is present, use exactly that word and never substitute a different period. If it is absent, do not mention or invent any week or period at all.',
    'Each nextQuestions item may include vocabularyHint: a plain user-facing paraphrase. Prefer the vocabularyHint wording over the raw slotKey or intent so the user understands the question. Do not output internal keys like "fixed_events".',
    'constraintSourcesInUse lists schedule sources already used as constraints. Do not ask again about what those sources already cover; you may briefly acknowledge them.',
    'knownFixedEventSummaries contains exact saved plan summaries. For a fixed_events question, mention only those summaries and ask whether there are any additional immovable events. Never invent another event.',
    'Use a supportive mentor tone, but keep the text short.',
  ].join('\n');
}

function createUserPrompt(input: DialogueRenderInput): string {
  return JSON.stringify({
    planningPeriodLabel: input.planningPeriodLabel,
    targetUnitLabel: input.targetUnitLabel,
    constraintSourcesInUse: input.constraintSourcesInUse,
    knownFixedEventSummaries: input.knownFixedEventSummaries,
    acceptedFacts: input.acceptedFacts,
    assumptions: input.assumptions,
    nextQuestions: input.nextQuestions.map((question) => ({
      slotKey: question.slotKey,
      intent: question.intent,
      questionKind: question.questionKind,
      options: question.options,
      vocabularyHint: question.vocabularyHint,
    })),
    styleConstraints: input.styleConstraints,
  });
}

export function createAiWeeklyPlanningDialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningDialogueRenderer {
  return {
    async render(input) {
      try {
        const content = await client.createChatCompletion({
          messages: [
            { role: 'system', content: createSystemPrompt() },
            { role: 'user', content: createUserPrompt(input) },
          ],
          temperature: 0.2,
          responseFormat: WEEKLY_PLANNING_DIALOGUE_RENDERER_RESPONSE_FORMAT,
          purpose: 'weekly_planning_renderer',
        });

        return parseRendererResponse(content);
      } catch {
        return { questions: [] };
      }
    },
  };
}
