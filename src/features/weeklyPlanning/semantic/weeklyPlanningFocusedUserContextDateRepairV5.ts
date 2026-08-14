import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS = 120;

export const FOCUSED_USER_CONTEXT_DATE_REPAIR_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_user_context_date_repair_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['dateExpression'],
      properties: {
        dateExpression: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
      },
    },
  },
};

const UNSUPPORTED_CONTEXT_DATE =
  /^document\.userContextFacts\[(\d+)]\.dateExpression:unsupported-expression$/;

export interface FocusedUserContextDateRepairCandidateV5 {
  factIndex: number;
  kind: string;
  label: string;
  value: string | null;
  sourceText: string;
  invalidDateExpression: string;
}

export interface FocusedUserContextDateRepairDecisionV5 {
  dateExpression: string;
}

export function readFocusedUserContextDateRepairCandidateV5(params: {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  validationErrors: readonly string[];
}): FocusedUserContextDateRepairCandidateV5 | null {
  if (!params.document || params.validationErrors.length !== 1) return null;
  const match = UNSUPPORTED_CONTEXT_DATE.exec(params.validationErrors[0] ?? '');
  if (!match) return null;

  const factIndex = Number(match[1]);
  const fact = params.document.userContextFacts?.[factIndex];
  if (!fact || typeof fact.dateExpression !== 'string' || !fact.dateExpression) return null;

  return {
    factIndex,
    kind: fact.kind,
    label: fact.label,
    value: fact.value,
    sourceText: fact.sourceText,
    invalidDateExpression: fact.dateExpression,
  };
}

export function createFocusedUserContextDateRepairMessagesV5(params: {
  candidate: FocusedUserContextDateRepairCandidateV5;
  calendarContext: { currentDate?: string | null; timeZone?: string | null } | null;
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'Resolve only the already-interpreted relative event date to one ISO YYYY-MM-DD date using the supplied calendar context.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        sourceText: params.candidate.sourceText,
        relativeDate: params.candidate.invalidDateExpression,
        event: {
          kind: params.candidate.kind,
          label: params.candidate.label,
          value: params.candidate.value,
        },
        calendarContext: params.calendarContext,
      }),
    },
  ];
}

export function parseFocusedUserContextDateRepairDecisionV5(
  raw: string,
): FocusedUserContextDateRepairDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1) return null;
    if (typeof record.dateExpression !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.dateExpression)) return null;
    return { dateExpression: record.dateExpression };
  } catch {
    return null;
  }
}

export function applyFocusedUserContextDateRepairV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  candidate: FocusedUserContextDateRepairCandidateV5;
  decision: FocusedUserContextDateRepairDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 | null {
  const facts = params.document.userContextFacts;
  const fact = facts?.[params.candidate.factIndex];
  if (!facts || !fact) return null;

  const nextFacts = [...facts];
  nextFacts[params.candidate.factIndex] = {
    ...fact,
    dateExpression: params.decision.dateExpression,
  };
  return {
    ...params.document,
    userContextFacts: nextFacts,
  };
}
