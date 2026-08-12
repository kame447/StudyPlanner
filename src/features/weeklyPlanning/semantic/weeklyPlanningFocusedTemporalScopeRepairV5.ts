import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';

export const FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS = 60;

export const FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_temporal_scope_repair_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: {
        decision: {
          type: 'string',
          enum: ['plan_unavailable', 'uncertain'],
        },
      },
    },
  },
};

const DATE_RULE_CLOCK_ERROR =
  /^document\.tasks\[(\d+)]\.temporalConstraints\[(\d+)]:date-rule-cannot-have-clock$/;

interface MutableRecord {
  [key: string]: unknown;
}

export interface FocusedTemporalScopeRepairCandidateV5 {
  taskIndex: number;
  constraintIndex: number;
  taskTitle: string;
  taskLocalId: string;
  constraintLocalId: string;
  sourceText: string;
  dateExpression: string;
  namedTimePeriod: string | null;
  startTime: string | null;
  endTime: string | null;
  constraintLevel: 'hard' | 'soft' | 'unknown';
}

export interface FocusedTemporalScopeRepairDecisionV5 {
  decision: 'plan_unavailable' | 'uncertain';
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCandidate(params: {
  rawResponse: string;
  validationErrors: readonly string[];
}): FocusedTemporalScopeRepairCandidateV5 | null {
  if (params.validationErrors.length !== 1) return null;
  const match = DATE_RULE_CLOCK_ERROR.exec(params.validationErrors[0] ?? '');
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawResponse) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return null;

  const taskIndex = Number(match[1]);
  const constraintIndex = Number(match[2]);
  const task = parsed.tasks[taskIndex];
  if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return null;
  const constraint = task.temporalConstraints[constraintIndex];
  if (!isRecord(constraint)) return null;

  if (
    typeof task.localId !== 'string'
    || typeof task.title !== 'string'
    || typeof constraint.localId !== 'string'
    || typeof constraint.sourceText !== 'string'
    || typeof constraint.dateExpression !== 'string'
    || !['hard', 'soft', 'unknown'].includes(String(constraint.constraintLevel))
  ) {
    return null;
  }

  const nullableString = (value: unknown): string | null | undefined =>
    value === null ? null : typeof value === 'string' ? value : undefined;
  const namedTimePeriod = nullableString(constraint.namedTimePeriod);
  const startTime = nullableString(constraint.startTime);
  const endTime = nullableString(constraint.endTime);
  if (namedTimePeriod === undefined || startTime === undefined || endTime === undefined) {
    return null;
  }
  if (startTime === null && endTime === null) return null;

  return {
    taskIndex,
    constraintIndex,
    taskTitle: task.title,
    taskLocalId: task.localId,
    constraintLocalId: constraint.localId,
    sourceText: constraint.sourceText,
    dateExpression: constraint.dateExpression,
    namedTimePeriod,
    startTime,
    endTime,
    constraintLevel: constraint.constraintLevel as 'hard' | 'soft' | 'unknown',
  };
}

export function readFocusedTemporalScopeRepairCandidateV5(params: {
  rawResponse: string;
  validationErrors: readonly string[];
}): FocusedTemporalScopeRepairCandidateV5 | null {
  return parseCandidate(params);
}

export function createFocusedTemporalScopeRepairMessagesV5(
  candidate: FocusedTemporalScopeRepairCandidateV5,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'Interpret the scope of one already-extracted temporal statement.',
        'Return plan_unavailable only when the sourceText itself says the user is busy/unavailable or the time should be avoided for the plan generally, rather than constraining the named task specifically.',
        'Return uncertain when that plan-wide scope is not clear. Do not infer task scheduling policy or rewrite any other semantic fact.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        sourceText: candidate.sourceText,
        currentAttachedTask: candidate.taskTitle,
        interpretedTime: {
          dateExpression: candidate.dateExpression,
          namedTimePeriod: candidate.namedTimePeriod,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
        },
      }),
    },
  ];
}

export function parseFocusedTemporalScopeRepairDecisionV5(
  raw: string,
): FocusedTemporalScopeRepairDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || Object.keys(value).length !== 1) return null;
    if (value.decision !== 'plan_unavailable' && value.decision !== 'uncertain') return null;
    return { decision: value.decision };
  } catch {
    return null;
  }
}

function isCanonicalWeekdayExpression(value: string): boolean {
  return /^weekday:(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(value);
}

export function applyFocusedTemporalScopeRepairV5(params: {
  rawResponse: string;
  candidate: FocusedTemporalScopeRepairCandidateV5;
  decision: FocusedTemporalScopeRepairDecisionV5;
}): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawResponse) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return null;
  const task = parsed.tasks[params.candidate.taskIndex];
  if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return null;
  const constraint = task.temporalConstraints[params.candidate.constraintIndex];
  if (!isRecord(constraint) || constraint.localId !== params.candidate.constraintLocalId) {
    return null;
  }

  task.temporalConstraints.splice(params.candidate.constraintIndex, 1);

  if (params.decision.decision === 'plan_unavailable') {
    if (!Array.isArray(parsed.availabilityDeclarations)) return null;
    const weekday = isCanonicalWeekdayExpression(params.candidate.dateExpression);
    parsed.availabilityDeclarations.push({
      localId: `${params.candidate.constraintLocalId}__availability`,
      kind: 'unavailable',
      dateExpression: params.candidate.dateExpression,
      namedTimePeriod: params.candidate.namedTimePeriod,
      startTime: params.candidate.startTime,
      endTime: params.candidate.endTime,
      recurrenceKind: weekday ? 'weekly' : null,
      days: weekday ? [params.candidate.dateExpression] : [],
      constraintLevel: params.candidate.constraintLevel,
      sourceText: params.candidate.sourceText,
    });
  } else {
    if (!Array.isArray(parsed.uncertainties)) return null;
    parsed.uncertainties.push({
      localId: `${params.candidate.constraintLocalId}__scope_uncertainty`,
      targetLocalId: params.candidate.taskLocalId,
      field: 'temporal_scope',
      reason: 'The temporal statement could not be confirmed as plan-wide unavailability.',
      sourceText: params.candidate.sourceText,
    });
  }

  return JSON.stringify(parsed);
}
