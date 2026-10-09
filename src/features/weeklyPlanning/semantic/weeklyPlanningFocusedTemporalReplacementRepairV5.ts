import type { ChatMessage, JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

/**
 * Focused TEMPORAL replacement-fact repair (Issue #488 D2, live round 7 CAP T2: 「じゃあ来週の金曜までに延ばす」). The sibling of the
 * x9b/x9c workload repair for a deadline-like constraint: a reading whose ONLY errors are `replace` corrections on an accepted
 * temporal constraint naming a `replacementLocalId` that is declared nowhere. One typed question for exactly the missing
 * date(s), merge only those under the replaced constraint's own task, revalidate the whole document. The replaced constraint's
 * kind and level are inherited (a deadline stays a deadline); the model supplies only the new date expression, read from the
 * user's own words, and it must quote them. Zero extra dispatches (it consumes the turn's single repair).
 */
export const FOCUSED_TEMPORAL_REPLACEMENT_REPAIR_MAX_COMPLETION_TOKENS = 200;
export const FOCUSED_TEMPORAL_REPLACEMENT_REPAIR_REQUEST_MAX_BYTES = 2_000;

const MAX_REPLACEMENTS = 2;
const REPLACEABLE_KINDS = ['deadline', 'earliest_start', 'latest_end'] as const;
type ReplaceableKind = (typeof REPLACEABLE_KINDS)[number];

export const FOCUSED_TEMPORAL_REPLACEMENT_REPAIR_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_temporal_replacement_repair_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['replacements'],
      properties: {
        replacements: {
          type: 'array',
          maxItems: MAX_REPLACEMENTS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['localId', 'decision', 'dateExpression', 'sourceText'],
            properties: {
              localId: { type: 'string' },
              decision: { type: 'string', enum: ['provided', 'fallback'] },
              dateExpression: { type: 'string' },
              sourceText: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const DANGLING = /^document\.corrections\[(\d+)\]\.replacementLocalId:unknown:(.+)$/;

export interface FocusedTemporalReplacementCandidateV5 {
  localId: string;
  correctionIndex: number;
  correctionQuote: string;
  /** The accepted constraint the correction replaces (typed, from the committed graph). */
  replaces: { kind: ReplaceableKind; constraintLevel: string; dateExpression: string | null };
  /** -1 when the reading has no task entry at all; the accepted task is then the replaced constraint's own task. */
  taskIndex: number;
  task: { id: string; title: string; category: string };
}

export interface FocusedTemporalReplacementDecisionV5 {
  replacements: Array<{ localId: string; decision: 'provided' | 'fallback'; dateExpression: string; sourceText: string }>;
}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function readFocusedTemporalReplacementCandidatesV5(params: {
  rawResponse: string;
  validationErrors: readonly string[];
  committedGraph?: WeeklyPlanningFactGraphV5;
}): FocusedTemporalReplacementCandidateV5[] | null {
  const { validationErrors, committedGraph } = params;
  if (!committedGraph || validationErrors.length === 0 || validationErrors.length > MAX_REPLACEMENTS) return null;
  let document: Record<string, unknown> | null;
  try { document = record(JSON.parse(params.rawResponse)); } catch { return null; }
  if (!document || !Array.isArray(document.corrections) || !Array.isArray(document.tasks)) return null;
  const view = createWeeklyPlanningActiveSchedulerGraphViewV5(committedGraph);
  const candidates: FocusedTemporalReplacementCandidateV5[] = [];
  for (const error of validationErrors) {
    const match = DANGLING.exec(error);
    if (!match) return null;
    const correctionIndex = Number(match[1]);
    const correction = record(document.corrections[correctionIndex]);
    const target = record(correction?.target);
    if (!correction || !target || correction.operation !== 'replace' || target.kind !== 'temporal_constraint'
      || typeof target.publicId !== 'string' || !target.publicId || correction.replacementLocalId !== match[2]) return null;
    const constraint = view.temporalConstraints.find((fact) => fact.id === target.publicId);
    if (!constraint || !(REPLACEABLE_KINDS as readonly string[]).includes(constraint.kind)) return null;
    const acceptedTask = view.tasks.find((fact) => fact.id === constraint.taskId);
    if (!acceptedTask) return null;
    let taskIndex = -1;
    if (document.tasks.length > 0) {
      const indexes = document.tasks.flatMap((task, index) => (record(task)?.existingPublicId === constraint.taskId ? [index] : []));
      if (indexes.length !== 1) return null;
      taskIndex = indexes[0];
      const task = record(document.tasks[taskIndex])!;
      if (!Array.isArray(task.temporalConstraints) || task.temporalConstraints.some((item) => record(item)?.localId === match[2])) return null;
    }
    candidates.push({
      localId: match[2], correctionIndex, correctionQuote: typeof correction.sourceText === 'string' ? correction.sourceText : '',
      taskIndex, task: { id: acceptedTask.id, title: acceptedTask.title, category: acceptedTask.category },
      replaces: { kind: constraint.kind as ReplaceableKind, constraintLevel: constraint.constraintLevel, dateExpression: constraint.dateExpression },
    });
  }
  if (new Set(candidates.map((candidate) => candidate.localId)).size !== candidates.length) return null;
  if (candidates.some((candidate) => candidate.taskIndex === -1) && new Set(candidates.map((candidate) => candidate.task.id)).size !== 1) return null;
  return candidates;
}

export function createFocusedTemporalReplacementRepairMessagesV5(params: {
  userText: string;
  calendarContext: { currentDate?: string | null; timeZone?: string | null } | null;
  candidates: readonly FocusedTemporalReplacementCandidateV5[];
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'For each listed correction, return the new date the user states in userText as dateExpression (a calendar date YYYY-MM-DD resolved from calendarContext.currentDate, or a range start/end), and sourceText as an exact substring of userText. Use decision fallback when userText states no new date. Return only these facts.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        userText: params.userText,
        calendarContext: params.calendarContext,
        corrections: params.candidates.map((candidate) => ({
          localId: candidate.localId, quote: candidate.correctionQuote,
          replaces: { kind: candidate.replaces.kind, dateExpression: candidate.replaces.dateExpression },
        })),
      }),
    },
  ];
}

export function parseFocusedTemporalReplacementRepairDecisionV5(raw: string): FocusedTemporalReplacementDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || !Array.isArray(body.replacements)) return null;
    const replacements: FocusedTemporalReplacementDecisionV5['replacements'] = [];
    for (const item of body.replacements) {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry.localId !== 'string' || (entry.decision !== 'provided' && entry.decision !== 'fallback')
        || typeof entry.dateExpression !== 'string' || typeof entry.sourceText !== 'string') return null;
      replacements.push({ localId: entry.localId, decision: entry.decision, dateExpression: entry.dateExpression, sourceText: entry.sourceText });
    }
    return { replacements };
  } catch {
    return null;
  }
}

/**
 * Merge ONLY the declared replacement constraints into the raw response. Every dangling id must be answered with `provided`, a
 * canonical date expression and a quote that is an exact substring of the user's text, else null (the existing recovery runs).
 */
export function applyFocusedTemporalReplacementRepairV5(params: {
  rawResponse: string;
  userText: string;
  candidates: readonly FocusedTemporalReplacementCandidateV5[];
  decision: FocusedTemporalReplacementDecisionV5;
}): string | null {
  if (params.decision.replacements.length !== params.candidates.length) return null;
  const document = record(JSON.parse(params.rawResponse))!;
  const tasks = [...(document.tasks as unknown[])];
  const shellIndexByTask = new Map<string, number>();
  for (const candidate of params.candidates) {
    const answers = params.decision.replacements.filter((entry) => entry.localId === candidate.localId);
    if (answers.length !== 1 || answers[0].decision !== 'provided') return null;
    const answer = answers[0];
    if (!answer.sourceText.trim() || !params.userText.includes(answer.sourceText) || !isCanonicalDateExpressionSyntax(answer.dateExpression)) return null;
    let index = candidate.taskIndex;
    if (index === -1) {
      const known = shellIndexByTask.get(candidate.task.id);
      if (known === undefined) {
        index = tasks.length;
        shellIndexByTask.set(candidate.task.id, index);
        tasks.push({
          localId: `task_${candidate.localId}`, existingPublicId: candidate.task.id, decompositionStatus: 'atomic', category: candidate.task.category,
          title: candidate.task.title, study: null, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
          durableContextSignals: [], sourceText: candidate.correctionQuote || answer.sourceText,
        });
      } else index = known;
    }
    const task = record(tasks[index])!;
    tasks[index] = {
      ...task,
      temporalConstraints: [...(task.temporalConstraints as unknown[]), {
        localId: candidate.localId, targetLocalId: task.localId, kind: candidate.replaces.kind,
        constraintLevel: candidate.replaces.constraintLevel, dateExpression: answer.dateExpression,
        namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: answer.sourceText,
      }],
    };
  }
  return JSON.stringify({ ...document, tasks });
}
