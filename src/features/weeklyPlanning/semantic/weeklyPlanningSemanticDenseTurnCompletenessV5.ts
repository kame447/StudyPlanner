import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES,
} from './weeklyPlanningSemanticNormalizerRunV5';

export const DENSE_TURN_COMPLETENESS_AUDIT_MAX_COMPLETION_TOKENS = 360;

export const DENSE_TURN_COMPLETENESS_AUDIT_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_dense_turn_completeness_audit_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'missingFacts'],
      properties: {
        decision: {
          type: 'string',
          enum: ['complete', 'incomplete'],
        },
        missingFacts: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 240,
          },
        },
      },
    },
  },
};

const AUDIT_SYSTEM_PROMPT = [
  'Audit semantic coverage only. Do not schedule, repair, rewrite, or add meaning.',
  'Compare exact currentUserText with candidateDocument, which is already schema-valid.',
  'Return incomplete only when an explicit current-turn proposition that the weekly-planning semantic contract supports is missing from candidateDocument.',
  'Supported proposition families include planning window, requested tasks/materials/components, workload quantities, effort estimates, task timing/deadlines, recurrence/habits, plan-wide availability or unavailability, ordering/priority relations, durable study goal or goal-event or concern context, corrections, decisions, and explicit uncertainties.',
  'Do not require unsupported measurements to become schedulable facts. In particular, assessment/mock-exam scores are evidence about performance, not textbook completion, and daily total capacity without a clock window may remain unrepresented when the schema has no safe capacity fact.',
  'Equivalent broader representation counts as covered when it preserves the stated meaning. Do not demand redundant duplicates or exact sourceText wording.',
  'For incomplete, list concise summaries of only the missing supported propositions. Never invent facts.',
  'For complete, missingFacts must be an empty array.',
].join('\n');

export interface DenseTurnCompletenessAuditDecisionV5 {
  decision: 'complete' | 'incomplete';
  missingFacts: string[];
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function denseTurnCompletenessAuditEligibleV5(userText: string): boolean {
  return textByteLength(userText) >= SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES;
}

export function createDenseTurnCompletenessAuditMessagesV5(params: {
  userText: string;
  candidateDocument: WeeklyPlanningSemanticDocumentV5;
}): ChatMessage[] {
  return [
    { role: 'system', content: AUDIT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: params.userText,
        candidateDocument: params.candidateDocument,
      }),
    },
  ];
}

export function parseDenseTurnCompletenessAuditDecisionV5(
  rawResponse: string,
): DenseTurnCompletenessAuditDecisionV5 | null {
  try {
    const value = JSON.parse(rawResponse) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.decision !== 'complete' && record.decision !== 'incomplete') return null;
    if (!Array.isArray(record.missingFacts)) return null;
    const missingFacts = record.missingFacts.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    ).map((item) => item.trim());
    if (missingFacts.length !== record.missingFacts.length || missingFacts.length > 12) return null;
    if (record.decision === 'complete' && missingFacts.length !== 0) return null;
    if (record.decision === 'incomplete' && missingFacts.length === 0) return null;
    return {
      decision: record.decision,
      missingFacts,
    };
  } catch {
    return null;
  }
}

export function createDenseTurnCompletenessRetryMessagesV5(params: {
  baseMessages: ChatMessage[];
  priorResponse: string;
  userText: string;
  missingFacts: readonly string[];
}): ChatMessage[] {
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.priorResponse },
    {
      role: 'user',
      content: [
        'The prior semantic document is schema-valid but a separate coverage audit found supported current-turn propositions missing.',
        `The exact current userText is ${JSON.stringify(params.userText)}.`,
        `Coverage-audit hints: ${JSON.stringify(params.missingFacts)}.`,
        'Re-read the exact current userText independently and return one complete semantic document, not a patch.',
        'Preserve all correct facts from the prior document while adding every supported explicit proposition that was omitted.',
        'Do not convert assessment/mock-exam scores into material completion or workload progress.',
        'Do not invent unsupported dates, times, capacities, progress, relations, or task references.',
      ].join(' '),
    },
  ];
}
