import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  rememberWeeklyPlanningDialogueRendererPromptContext,
} from '../trace/weeklyPlanningDialogueRendererTrace';

export type WeeklyPlanningStableV5DialogueActionKind =
  | 'question'
  | 'status'
  | 'preview_ready';

export interface WeeklyPlanningStableV5DialogueConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WeeklyPlanningStableV5DialogueRenderInput {
  actionId: string;
  currentUserMessage: string;
  recentConversation: WeeklyPlanningStableV5DialogueConversationTurn[];
  planningInformation: Record<string, unknown> | null;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  requiredLabels: string[];
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

const MAX_RENDERED_TEXT_LENGTH = 800;
const FORBIDDEN_CONTENT = /https?:\/\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|口座番号|クレジットカード)/i;
const CLOCK_EXPRESSION = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:午前|午後)?\s*(?:[01]?\d|2[0-3])\s*時(?:\s*[0-5]?\d\s*分)?/g;
const DATE_EXPRESSION = /(?:今日|明日|明後日|今週|来週|週末)|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const PREVIEW_COUNT_EXPRESSION = /(\d+)\s*件/g;
const EXPLANATION_REQUEST_EXPRESSION = /(?:どういう(?:こと|意味)|なぜ|なんで|理由|説明して|説明してください|分からない|わからない|つまり)/;
const QUESTION_RESPONSE_EXPRESSION = /[?？]|(?:教えて(?:ください)?|確認させて(?:ください)?|確認したい|どれ|どの|どちら|何|いつ|どこ|どう|ありますか|ですか|ますか|でしょうか)/;
const EXECUTION_CLAIM_EXPRESSION = /(?:(?:予定|仮予定|計画).{0,16}(?:作ります|作成します|追加します|登録します|保存します|組みます|反映します)|(?:作ります|作成します|追加します|登録します|保存します|組みます|反映します).{0,16}(?:予定|仮予定|計画))/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayField(
  value: Record<string, unknown> | null,
  key: string,
): unknown[] {
  const field = value?.[key];
  return Array.isArray(field) ? field : [];
}

function isResolvedWorkload(value: unknown): boolean {
  return isRecord(value) && value.quantityRole !== 'unknown';
}

function isResolvedDeclaration(value: unknown): boolean {
  return isRecord(value) && value.resolutionStatus !== 'unresolved';
}

function createDecidedFacts(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!planningInformation) return null;

  return Object.fromEntries(
    Object.entries(planningInformation)
      .filter(([key]) => key !== 'uncertainties')
      .map(([key, value]) => {
        if (key === 'workloads' && Array.isArray(value)) {
          return [key, value.filter(isResolvedWorkload)];
        }
        if (
          (key === 'availabilityDeclarations' || key === 'constraintSourceRequests')
          && Array.isArray(value)
        ) {
          return [key, value.filter(isResolvedDeclaration)];
        }
        return [key, value];
      }),
  );
}

function unresolvedWorkloadFields(
  planningInformation: Record<string, unknown> | null,
): Record<string, unknown>[] {
  return arrayField(planningInformation, 'workloads')
    .filter(isRecord)
    .filter((workload) => workload.quantityRole === 'unknown')
    .map((workload) => ({
      kind: 'workload_field',
      taskId: workload.taskId ?? null,
      componentId: workload.componentId ?? null,
      field: 'quantityRole',
      knownAmount: workload.amount ?? null,
      knownUnitLabel: workload.unitLabel ?? null,
    }));
}

function unresolvedDeclarations(
  planningInformation: Record<string, unknown> | null,
  key: 'availabilityDeclarations' | 'constraintSourceRequests',
): Record<string, unknown>[] {
  return arrayField(planningInformation, key)
    .filter(isRecord)
    .filter((entry) => entry.resolutionStatus === 'unresolved')
    .map((entry) => ({
      sourceCollection: key,
      ...entry,
    }));
}

export function createWeeklyPlanningStableV5DialogueStateSummary(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): Record<string, unknown> {
  const planningInformation = input.planningInformation;

  return {
    decidedFacts: createDecidedFacts(planningInformation),
    undecidedItems: [
      ...arrayField(planningInformation, 'uncertainties'),
      ...unresolvedWorkloadFields(planningInformation),
      ...unresolvedDeclarations(planningInformation, 'availabilityDeclarations'),
      ...unresolvedDeclarations(planningInformation, 'constraintSourceRequests'),
    ],
    currentQuestion: {
      questionCode: input.questionCode,
      relevantLabels: input.requiredLabels,
      referenceResponse: input.fallbackText,
    },
  };
}

export function createWeeklyPlanningStableV5DialoguePrompt(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは学習計画アプリの対話担当です。',
    '会話履歴、ユーザーの最新発話、アプリが把握している情報を踏まえて、次に返す自然な日本語を考えてください。',
    'アプリが把握していない予定や事実は作らないでください。',
    '指定されたJSON形式で、actionIdを変えずに返してください。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    actionId: input.actionId,
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningInformation: input.planningInformation,
    planningStateSummary: createWeeklyPlanningStableV5DialogueStateSummary(input),
    applicationDecision: {
      actionKind: input.actionKind,
      questionCode: input.questionCode,
      relevantLabels: input.requiredLabels,
      referenceResponse: input.fallbackText,
      previewCount: input.previewCount,
    },
    request: [
      '上記の情報を踏まえて、現在のユーザーに返す自然な日本語を考えてください。',
      'planningStateSummaryのdecidedFactsはターンを跨いで確定している情報、undecidedItemsはまだ確認が必要な情報です。',
      'referenceResponseはアプリ側の参考情報であり、そのまま繰り返したり、単に言い換えたりする必要はありません。',
      '最新発話が説明要求や聞き返しなら、直前の質問を繰り返さず、何を確認したいのかを分かりやすく説明してください。',
      'applicationDecision.actionKindがquestionなら、説明要求への説明を除き、必要な情報を尋ねてください。まだ実行されていない予定の作成・追加・保存を開始または完了したとは言わないでください。',
    ].join(''),
  }, null, 2);

  return { systemPrompt, userPrompt };
}

function normalizeProtectedExpression(value: string): string {
  return value.replace(/[\s：]/g, '').replace(/:/g, '');
}

function expressions(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeProtectedExpression(match[0]));
}

function addsUnsupportedExpression(
  rendered: string,
  groundingInformation: string,
  pattern: RegExp,
): boolean {
  const allowed = new Set(expressions(groundingInformation, pattern));
  return expressions(rendered, pattern).some((expression) => !allowed.has(expression));
}

function hasIncorrectPreviewCount(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind !== 'preview_ready') return false;
  const mentionedCounts = [...text.matchAll(PREVIEW_COUNT_EXPRESSION)]
    .map((match) => Number(match[1]));
  return mentionedCounts.some((count) => count !== input.previewCount);
}

function isExplanationRequest(input: WeeklyPlanningStableV5DialogueRenderInput): boolean {
  return EXPLANATION_REQUEST_EXPRESSION.test(input.currentUserMessage);
}

function hasUnsupportedActionShape(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (
    input.actionKind !== 'preview_ready'
    && EXECUTION_CLAIM_EXPRESSION.test(text)
    && !/[?？]|(?:ますか|でしょうか)/.test(text)
  ) {
    return true;
  }
  return input.actionKind === 'question'
    && !isExplanationRequest(input)
    && !QUESTION_RESPONSE_EXPRESSION.test(text);
}

function validateRenderedText(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueFallbackReason | null {
  if (
    text.length === 0
    || text.length > MAX_RENDERED_TEXT_LENGTH
    || FORBIDDEN_CONTENT.test(text)
  ) {
    return 'unsafe_text';
  }

  const groundingInformation = JSON.stringify({
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningInformation: input.planningInformation,
    referenceResponse: input.fallbackText,
    previewCount: input.previewCount,
  });
  if (
    addsUnsupportedExpression(text, groundingInformation, CLOCK_EXPRESSION)
    || addsUnsupportedExpression(text, groundingInformation, DATE_EXPRESSION)
    || hasIncorrectPreviewCount(text, input)
    || hasUnsupportedActionShape(text, input)
  ) {
    return 'ungrounded_text';
  }

  return null;
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

function rendererPromptTraceContext(prompt: {
  systemPrompt: string;
  userPrompt: string;
}): Record<string, unknown> {
  const messages = [
    { role: 'system', content: prompt.systemPrompt },
    { role: 'user', content: prompt.userPrompt },
  ];
  return {
    messages,
    requestBytes: new TextEncoder().encode(JSON.stringify(messages)).byteLength,
  };
}

export function createAiWeeklyPlanningStableV5DialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningStableV5DialogueRenderer {
  return {
    async render(input) {
      try {
        const prompt = createWeeklyPlanningStableV5DialoguePrompt(input);
        rememberWeeklyPlanningDialogueRendererPromptContext(
          input.actionId,
          rendererPromptTraceContext(prompt),
        );
        const rawResponse = await client.createChatCompletion({
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt },
          ],
          temperature: 0.4,
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
