import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';

export type WeeklyPlanningStableV5DialogueActionKind =
  | 'question'
  | 'status'
  | 'preview_ready';

export interface WeeklyPlanningStableV5DialogueRenderInput {
  actionId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  fallbackText: string;
  previewCount: number;
}

export type WeeklyPlanningStableV5DialogueFallbackReason =
  | 'provider_error'
  | 'invalid_json'
  | 'invalid_shape'
  | 'action_mismatch'
  | 'unsafe_text'
  | 'ungrounded_text';

export type WeeklyPlanningStableV5DialogueRenderResult =
  | {
      status: 'rendered';
      text: string;
      rawResponse: string;
    }
  | {
      status: 'fallback';
      reason: WeeklyPlanningStableV5DialogueFallbackReason;
      rawResponse: string | null;
    };

export interface WeeklyPlanningStableV5DialogueRenderer {
  render(
    input: WeeklyPlanningStableV5DialogueRenderInput,
  ): Promise<WeeklyPlanningStableV5DialogueRenderResult>;
}

type JsonSchemaObject = Record<string, unknown>;

function stringSchema(): JsonSchemaObject {
  return { type: 'string' };
}

export const WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_stable_v5_dialogue_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['actionId', 'text'],
      properties: {
        actionId: stringSchema(),
        text: stringSchema(),
      },
    },
  },
};

const MAX_RENDERED_TEXT_LENGTH = 320;
const FORBIDDEN_CONTENT = /https?:\/\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|設定画面|外部サイト|リンクを開|貼り付けて|送信して|睡眠薬|服用|何錠|診断|病歴|住所|メールアドレス|電話番号|口座番号|クレジットカード)/i;
const MARKDOWN_CONTENT = /```|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/m;
const CLOCK_EXPRESSION = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:午前|午後)?\s*(?:[01]?\d|2[0-3])\s*時(?:\s*[0-5]?\d\s*分)?/g;
const DATE_EXPRESSION = /(?:今日|明日|明後日|今週|来週|週末)|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const GROUNDING_TERMS = [
  '計画期間',
  '期間',
  '作業量',
  '量',
  '所要時間',
  '時間',
  '開始時刻',
  '終了時刻',
  '空き時間',
  '固定予定',
  '予定',
  '順序',
  '優先',
  '条件',
  '仮予定',
  '作業',
  'タスク',
  '分野',
  'カレンダー',
  '時間割',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createSystemPrompt(): string {
  return [
    'You are a Japanese dialogue renderer for a planning application.',
    'Return JSON only and follow the response schema exactly.',
    'The application has already decided the action, question target, scheduling state, preview state, and fallback meaning.',
    'Rewrite fallbackText into natural, concise Japanese without changing its meaning.',
    'Return exactly the same actionId.',
    'Do not add, remove, split, or merge questions.',
    'Do not infer a new task, quantity, date, clock time, availability, priority, constraint, schedule placement, preview, approval, or save result.',
    'Preserve every task or component name enclosed in Japanese quotation marks in fallbackText.',
    'When actionKind is question, keep it as one clear question or one direct request for the missing information.',
    'When actionKind is preview_ready, include the exact Arabic previewCount followed by 件 and state only that preview candidates were created.',
    'Do not output Markdown, URLs, instructions to change settings, or requests for sensitive information.',
    'Use a calm conversational tone. Avoid internal terms, error codes, JSON keys, and implementation details.',
  ].join('\n');
}

function createUserPrompt(input: WeeklyPlanningStableV5DialogueRenderInput): string {
  return JSON.stringify({
    actionId: input.actionId,
    actionKind: input.actionKind,
    questionCode: input.questionCode,
    fallbackText: input.fallbackText,
    previewCount: input.previewCount,
    constraints: {
      maximumCharacters: MAX_RENDERED_TEXT_LENGTH,
      maximumQuestions: input.actionKind === 'question' ? 1 : 0,
    },
  });
}

function normalizeProtectedExpression(value: string): string {
  return value.replace(/[\s：]/g, '').replace(/:/g, '');
}

function expressions(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeProtectedExpression(match[0]));
}

function addsUnsupportedExpression(
  rendered: string,
  fallback: string,
  pattern: RegExp,
): boolean {
  const allowed = new Set(expressions(fallback, pattern));
  return expressions(rendered, pattern).some((expression) => !allowed.has(expression));
}

function quotedLabels(value: string): string[] {
  return [...value.matchAll(/「([^」]{1,100})」/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function hasQuestionIntent(text: string): boolean {
  return /[？?]/.test(text)
    || /(?:教えてください|どちら|どれくらい|何を|何日|何時|いつ|ありますか|ですか|ますか|でしょうか)/.test(text);
}

function isGroundedText(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind === 'question') {
    if (!hasQuestionIntent(text)) return false;
    const questionMarks = (text.match(/[？?]/g) ?? []).length;
    if (questionMarks > 1) return false;
  }

  const labels = quotedLabels(input.fallbackText);
  if (labels.some((label) => !text.includes(label))) return false;

  const expectedTerms = GROUNDING_TERMS.filter((term) => input.fallbackText.includes(term));
  if (expectedTerms.length > 0 && !expectedTerms.some((term) => text.includes(term))) {
    return false;
  }

  if (input.actionKind === 'preview_ready') {
    if (input.previewCount <= 0) return false;
    if (!text.includes(`${input.previewCount}件`) || !text.includes('仮予定')) return false;
  }

  return true;
}

function validateRenderedText(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueFallbackReason | null {
  if (
    text.length === 0
    || text.length > MAX_RENDERED_TEXT_LENGTH
    || FORBIDDEN_CONTENT.test(text)
    || MARKDOWN_CONTENT.test(text)
  ) {
    return 'unsafe_text';
  }

  if (
    addsUnsupportedExpression(text, input.fallbackText, CLOCK_EXPRESSION)
    || addsUnsupportedExpression(text, input.fallbackText, DATE_EXPRESSION)
  ) {
    return 'ungrounded_text';
  }

  return isGroundedText(text, input) ? null : 'ungrounded_text';
}

function parseRendererResponse(
  rawResponse: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueRenderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { status: 'fallback', reason: 'invalid_json', rawResponse };
  }

  if (
    !isRecord(parsed)
    || typeof parsed.actionId !== 'string'
    || typeof parsed.text !== 'string'
  ) {
    return { status: 'fallback', reason: 'invalid_shape', rawResponse };
  }

  if (parsed.actionId !== input.actionId) {
    return { status: 'fallback', reason: 'action_mismatch', rawResponse };
  }

  const text = parsed.text.replace(/\r\n/g, '\n').trim();
  const validationError = validateRenderedText(text, input);
  if (validationError) {
    return { status: 'fallback', reason: validationError, rawResponse };
  }

  return { status: 'rendered', text, rawResponse };
}

export function createAiWeeklyPlanningStableV5DialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningStableV5DialogueRenderer {
  return {
    async render(input) {
      try {
        const rawResponse = await client.createChatCompletion({
          messages: [
            { role: 'system', content: createSystemPrompt() },
            { role: 'user', content: createUserPrompt(input) },
          ],
          temperature: 0.2,
          responseFormat: WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
          purpose: 'weekly_planning_renderer',
        });
        return parseRendererResponse(rawResponse, input);
      } catch {
        return { status: 'fallback', reason: 'provider_error', rawResponse: null };
      }
    },
  };
}
