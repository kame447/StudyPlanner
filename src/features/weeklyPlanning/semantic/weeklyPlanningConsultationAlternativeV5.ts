import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';

/** A question about hypothetical days, never a fact, preview instruction or authorization. */
export interface WeeklyPlanningConsultationAlternativeV5 {
  scope: 'task' | 'plan';
  /** Canonical weekdays mean their occurrences within the accepted planning horizon. */
  dateExpressions: string[];
  sourceText: string;
}

/** Internal rejection evidence is distinct from absence; it cannot authorize evaluation. */
export type WeeklyPlanningConsultationAlternativeMeaningV5 = WeeklyPlanningConsultationAlternativeV5
  | { unavailable: 'malformed' | 'unknown_target' };

export const weeklyPlanningConsultationAlternativeSchemaV5 = {
  anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false,
    required: ['scope', 'dateExpressions', 'sourceText'],
    properties: {
      scope: { type: 'string', enum: ['task', 'plan'] },
      dateExpressions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 7 },
      sourceText: { type: 'string' },
    },
  }],
};

export function parseWeeklyPlanningConsultationAlternativeV5(value: unknown): WeeklyPlanningConsultationAlternativeV5 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some(key => !['scope', 'dateExpressions', 'sourceText'].includes(key))
    || !['task', 'plan'].includes(String(entry.scope))
    || typeof entry.sourceText !== 'string' || !entry.sourceText.trim()
    || !Array.isArray(entry.dateExpressions) || entry.dateExpressions.length < 1 || entry.dateExpressions.length > 7
    || !entry.dateExpressions.every((date): date is string => typeof date === 'string'
      && !date.startsWith('custom:') && isCanonicalDateExpressionSyntax(date))) return null;
  return { scope: entry.scope as 'task' | 'plan', dateExpressions: [...new Set(entry.dateExpressions)], sourceText: entry.sourceText };
}
