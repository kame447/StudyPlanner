import type {
  ChatMessage, JsonSchemaResponseFormat, OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';

/**
 * Focused purpose check of a SHOWN assistant question (Issue #488 S3a v2). A bare, role-less time budget answering a pending
 * amount question is promoted to a plan target only when this check reads the question the user actually saw as a PLAN question
 * (an amount the user wants to schedule: a planned amount, scope, wish or time budget). It reads the question text alone: never the
 * user's answer, never the AI's own declaration. Anything but `plan`, and any failure of the check itself, is not a promotion
 * (the caller demotes to a declared amount, which leads to one role confirmation). Enum-only output; no Japanese parsing.
 *
 * It runs on the existing `weekly_planning_semantic_normalizer` purpose (a new purpose would need a worker deploy) and only on the
 * promotion path, so the extra call is rare. The caller supplies the client (already inside the turn's dispatch pool).
 */
export type ShownQuestionPurposeV5 = 'progress' | 'plan' | 'other';
export type ShownQuestionPurposeCheckResultV5 = ShownQuestionPurposeV5 | 'unavailable';

export const SHOWN_QUESTION_PURPOSE_CHECK_MAX_COMPLETION_TOKENS = 24;
/** Own cap for this request (no existing cap is raised). */
export const SHOWN_QUESTION_PURPOSE_CHECK_REQUEST_MAX_BYTES = 1_400;
const MAX_QUESTION_CHARS = 600;

export const SHOWN_QUESTION_PURPOSE_CHECK_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_shown_question_purpose_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['purpose'],
      properties: { purpose: { type: 'string', enum: ['progress', 'plan', 'other'] } },
    },
  },
};

export function createShownQuestionPurposeCheckMessagesV5(questionText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'Classify the single question an assistant asked a user while planning study time. Read only the question text.',
        'progress: it asks how much the user has ALREADY done or finished (past progress, completed amount, how far along they are).',
        'plan: it asks how much the user WANTS or PLANS to do or spend from now on (a planned amount, the scope to schedule, a goal, or a time budget to schedule).',
        'other: anything else, including questions about when, how long each session lasts, how often, deadlines, preferences, yes/no confirmations, or a question that mixes purposes or is unclear.',
        'When unsure, answer other.',
      ].join(' '),
    },
    { role: 'user', content: JSON.stringify({ question: questionText.slice(0, MAX_QUESTION_CHARS) }) },
  ];
}

export function parseShownQuestionPurposeV5(raw: string): ShownQuestionPurposeV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length !== 1 || entries[0][0] !== 'purpose') return null;
    const purpose = entries[0][1];
    return purpose === 'progress' || purpose === 'plan' || purpose === 'other' ? purpose : null;
  } catch {
    return null;
  }
}

/** One call. Never throws: a dispatch refusal, a provider error or a malformed answer is `unavailable` (never a promotion). */
export async function checkShownQuestionPurposeV5(params: {
  client: Pick<OpenAiCompatibleClient, 'createChatCompletion'>;
  questionText: string;
}): Promise<ShownQuestionPurposeCheckResultV5> {
  if (!params.questionText.trim()) return 'unavailable';
  try {
    const raw = await params.client.createChatCompletion({
      messages: createShownQuestionPurposeCheckMessagesV5(params.questionText),
      temperature: 0,
      responseFormat: SHOWN_QUESTION_PURPOSE_CHECK_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: SHOWN_QUESTION_PURPOSE_CHECK_MAX_COMPLETION_TOKENS,
    });
    return parseShownQuestionPurposeV5(raw) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** The only result that permits promoting a bare time budget to a plan target. */
export const permitsBareBudgetPromotionV5 = (result: ShownQuestionPurposeCheckResultV5): boolean => result === 'plan';

/** The function the pipeline calls (agreed interface with the guard hook): the shown question text in, the enum or `unavailable` out. */
export type ShownQuestionPurposeCheckV5 = (questionText: string) => Promise<ShownQuestionPurposeCheckResultV5>;

export function createShownQuestionPurposeCheckV5(client: Pick<OpenAiCompatibleClient, 'createChatCompletion'>): ShownQuestionPurposeCheckV5 {
  return (questionText) => checkShownQuestionPurposeV5({ client, questionText });
}
