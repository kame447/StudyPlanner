export const GEMINI_JUDGE_PROMPT_VERSION = 'focused-authorization-judge-v1' as const;
export const GEMINI_JUDGE_SCHEMA_VERSION = 'focused-authorization-judgment-v1' as const;

export const GEMINI_JUDGE_LIMITS = {
  rationaleLength: 500,
  problematicExpressionCount: 8,
  problematicExpressionLength: 160,
  alternativeInterpretationCount: 4,
  alternativeReadingLength: 300,
} as const;

export type GeminiJudgedClass = 'create_plan' | 'fallback' | 'ambiguous';

export interface GeminiAlternativeInterpretation {
  class: 'create_plan' | 'fallback';
  reading: string;
}

export interface GeminiJudgment {
  judgedClass: GeminiJudgedClass;
  reviewRequired: boolean;
  rationale: string;
  problematicExpressions: string[];
  alternativeInterpretations: GeminiAlternativeInterpretation[];
}

export type GeminiJudgeFailureReason =
  | 'configuration'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_response';

export interface GeminiJudgeRecord {
  caseId: string;
  judgeStatus: 'gemini_judged_candidate';
  judgeProvider: 'gemini';
  requestedModel: string;
  servedModel: string | null;
  promptVersion: typeof GEMINI_JUDGE_PROMPT_VERSION;
  schemaVersion: typeof GEMINI_JUDGE_SCHEMA_VERSION;
  runIndex: number;
  temperature: 0;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  status: 'judged' | 'invalid_response' | 'unavailable';
  reason: GeminiJudgeFailureReason | null;
  judgment: GeminiJudgment | null;
}

export const GEMINI_JUDGMENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  additionalProperties: false,
  required: [
    'judgedClass',
    'reviewRequired',
    'rationale',
    'problematicExpressions',
    'alternativeInterpretations',
  ],
  properties: {
    judgedClass: { type: 'STRING', enum: ['create_plan', 'fallback', 'ambiguous'] },
    reviewRequired: { type: 'BOOLEAN' },
    rationale: { type: 'STRING', maxLength: GEMINI_JUDGE_LIMITS.rationaleLength },
    problematicExpressions: {
      type: 'ARRAY',
      maxItems: GEMINI_JUDGE_LIMITS.problematicExpressionCount,
      items: {
        type: 'STRING',
        maxLength: GEMINI_JUDGE_LIMITS.problematicExpressionLength,
      },
    },
    alternativeInterpretations: {
      type: 'ARRAY',
      maxItems: GEMINI_JUDGE_LIMITS.alternativeInterpretationCount,
      items: {
        type: 'OBJECT',
        additionalProperties: false,
        required: ['class', 'reading'],
        properties: {
          class: { type: 'STRING', enum: ['create_plan', 'fallback'] },
          reading: {
            type: 'STRING',
            maxLength: GEMINI_JUDGE_LIMITS.alternativeReadingLength,
          },
        },
      },
    },
  },
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function parseGeminiJudgment(value: unknown): GeminiJudgment | null {
  const root = record(value);
  const keys = [
    'judgedClass',
    'reviewRequired',
    'rationale',
    'problematicExpressions',
    'alternativeInterpretations',
  ] as const;
  if (!root || !hasExactKeys(root, keys)) return null;
  if (root.judgedClass !== 'create_plan'
    && root.judgedClass !== 'fallback'
    && root.judgedClass !== 'ambiguous') return null;
  if (typeof root.reviewRequired !== 'boolean') return null;
  if (!boundedString(root.rationale, GEMINI_JUDGE_LIMITS.rationaleLength)) return null;
  if (!Array.isArray(root.problematicExpressions)
    || root.problematicExpressions.length > GEMINI_JUDGE_LIMITS.problematicExpressionCount
    || !root.problematicExpressions.every((expression) =>
      boundedString(expression, GEMINI_JUDGE_LIMITS.problematicExpressionLength))) return null;
  if (!Array.isArray(root.alternativeInterpretations)
    || root.alternativeInterpretations.length > GEMINI_JUDGE_LIMITS.alternativeInterpretationCount) return null;
  const alternatives: GeminiAlternativeInterpretation[] = [];
  for (const value of root.alternativeInterpretations) {
    const alternative = record(value);
    if (!alternative || !hasExactKeys(alternative, ['class', 'reading'])) return null;
    if (alternative.class !== 'create_plan' && alternative.class !== 'fallback') return null;
    if (!boundedString(alternative.reading, GEMINI_JUDGE_LIMITS.alternativeReadingLength)) return null;
    alternatives.push({ class: alternative.class, reading: alternative.reading });
  }
  return {
    judgedClass: root.judgedClass,
    reviewRequired: root.reviewRequired,
    rationale: root.rationale,
    problematicExpressions: [...root.problematicExpressions],
    alternativeInterpretations: alternatives,
  };
}
