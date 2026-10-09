import type { ChatMessage, JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { SEMANTIC_WORKLOAD_UNIT_CODES_V5 } from './weeklyPlanningSemanticTypesV5';

/**
 * Focused replacement-fact repair (Issue #488 x9b, live round 5 C T2). A reading whose ONLY errors are workload
 * `replace` corrections naming a `replacementLocalId` that is declared nowhere ("やっぱり20ページにして": the correction
 * names its target and the id, the 20 pages were never declared). Like the other focused repairs it consumes the turn's single
 * repair in place of the generic one (zero extra dispatches), asks one typed question for exactly the missing facts, merges
 * only those, and revalidates the whole document. The model reads the user's own words; the merge invents nothing.
 */
export const FOCUSED_REPLACEMENT_FACT_REPAIR_MAX_COMPLETION_TOKENS = 260;
/** Own cap for this request (no existing cap is raised). */
export const FOCUSED_REPLACEMENT_FACT_REPAIR_REQUEST_MAX_BYTES = 2_200;

const MAX_REPLACEMENTS = 3;

export const FOCUSED_REPLACEMENT_FACT_REPAIR_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_replacement_fact_repair_v5',
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
            required: ['localId', 'decision', 'quantityRole', 'amount', 'unitCode', 'unitLabel', 'sourceText'],
            properties: {
              localId: { type: 'string' },
              decision: { type: 'string', enum: ['provided', 'fallback'] },
              quantityRole: { type: 'string', enum: ['target', 'remaining'] },
              amount: { type: 'number' },
              unitCode: { type: 'string', enum: [...SEMANTIC_WORKLOAD_UNIT_CODES_V5] },
              unitLabel: { type: 'string' },
              sourceText: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const DANGLING = /^document\.corrections\[(\d+)\]\.replacementLocalId:unknown:(.+)$/;

export interface FocusedReplacementCandidateV5 {
  /** The dangling localId the correction already names. */
  localId: string;
  correctionIndex: number;
  correctionQuote: string;
  /** The accepted workload the correction replaces (typed, from the committed graph). */
  replaces: { amount: number; unitCode: string; unitLabel: string; quantityRole: string; perOccurrence: boolean; periodExpression: string | null };
  /** The task entry (by index) bound to the replaced workload's task; -1 when the reading has no task entry at all (x9c). */
  taskIndex: number;
  /** The accepted task the replaced workload belongs to (typed), used to author the existing-entity shell when taskIndex is -1. */
  task: { id: string; title: string; category: string };
}

export interface FocusedReplacementDecisionV5 {
  replacements: Array<{ localId: string; decision: 'provided' | 'fallback'; quantityRole: 'target' | 'remaining'; amount: number;
    unitCode: string; unitLabel: string; sourceText: string }>;
}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Typed candidate: every error is a dangling workload replacement of an active task-level accepted workload. The raw response is
 * read (not a parsed document): the dangling reference is itself what keeps the validator from returning one.
 */
export function readFocusedReplacementFactRepairCandidatesV5(params: {
  rawResponse: string;
  validationErrors: readonly string[];
  committedGraph?: WeeklyPlanningFactGraphV5;
}): FocusedReplacementCandidateV5[] | null {
  const { validationErrors, committedGraph } = params;
  if (!committedGraph || validationErrors.length === 0 || validationErrors.length > MAX_REPLACEMENTS) return null;
  let document: Record<string, unknown> | null;
  try { document = record(JSON.parse(params.rawResponse)); } catch { return null; }
  if (!document || !Array.isArray(document.corrections) || !Array.isArray(document.tasks)) return null;
  const view = createWeeklyPlanningActiveSchedulerGraphViewV5(committedGraph);
  const candidates: FocusedReplacementCandidateV5[] = [];
  for (const error of validationErrors) {
    const match = DANGLING.exec(error);
    if (!match) return null;
    const correctionIndex = Number(match[1]);
    const correction = record(document.corrections[correctionIndex]);
    const target = record(correction?.target);
    if (!correction || !target || correction.operation !== 'replace' || target.kind !== 'workload'
      || typeof target.publicId !== 'string' || !target.publicId || correction.replacementLocalId !== match[2]) return null;
    const workload = view.workloads.find((fact) => fact.id === target.publicId);
    if (!workload || workload.componentId !== null) return null;
    const acceptedTask = view.tasks.find((fact) => fact.id === workload.taskId);
    if (!acceptedTask) return null;
    // Exactly one task entry bound to the workload's task; or NO task entry at all (live H T2), where the accepted task is
    // unambiguous because it is the replaced workload's own task (checked below to be one task for every candidate).
    let taskIndex = -1;
    if (document.tasks.length > 0) {
      const taskIndexes = document.tasks.flatMap((task, index) => (record(task)?.existingPublicId === workload.taskId ? [index] : []));
      if (taskIndexes.length !== 1) return null;
      taskIndex = taskIndexes[0];
      const task = record(document.tasks[taskIndex])!;
      if (!Array.isArray(task.workloads) || task.workloads.some((item) => record(item)?.localId === match[2])) return null;
    }
    candidates.push({
      localId: match[2], correctionIndex, correctionQuote: typeof correction.sourceText === 'string' ? correction.sourceText : '',
      taskIndex, task: { id: acceptedTask.id, title: acceptedTask.title, category: acceptedTask.category },
      replaces: { amount: workload.amount, unitCode: workload.unitCode, unitLabel: workload.unitLabel, quantityRole: workload.quantityRole,
        perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression },
    });
  }
  if (new Set(candidates.map((candidate) => candidate.localId)).size !== candidates.length) return null;
  // With no task entry every dangling workload must belong to ONE accepted task: one shell, nothing to choose between.
  if (candidates.some((candidate) => candidate.taskIndex === -1) && new Set(candidates.map((candidate) => candidate.task.id)).size !== 1) return null;
  return candidates;
}

export function createFocusedReplacementFactRepairMessagesV5(params: {
  userText: string;
  candidates: readonly FocusedReplacementCandidateV5[];
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'For each listed correction, return the replacement workload the user states in userText: quantityRole, amount, unitCode and unitLabel as the user counts it, and sourceText as an exact substring of userText. Use decision fallback when userText states no replacement quantity. Return only these facts.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        userText: params.userText,
        corrections: params.candidates.map((candidate) => ({
          localId: candidate.localId, quote: candidate.correctionQuote,
          replaces: { amount: candidate.replaces.amount, unitCode: candidate.replaces.unitCode, unitLabel: candidate.replaces.unitLabel },
        })),
      }),
    },
  ];
}

export function parseFocusedReplacementFactRepairDecisionV5(raw: string): FocusedReplacementDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !Array.isArray(record.replacements)) return null;
    const replacements: FocusedReplacementDecisionV5['replacements'] = [];
    for (const item of record.replacements) {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry.localId !== 'string' || (entry.decision !== 'provided' && entry.decision !== 'fallback')
        || (entry.quantityRole !== 'target' && entry.quantityRole !== 'remaining') || typeof entry.amount !== 'number'
        || typeof entry.unitCode !== 'string' || typeof entry.unitLabel !== 'string' || typeof entry.sourceText !== 'string') return null;
      replacements.push({ localId: entry.localId, decision: entry.decision, quantityRole: entry.quantityRole, amount: entry.amount,
        unitCode: entry.unitCode, unitLabel: entry.unitLabel, sourceText: entry.sourceText });
    }
    return { replacements };
  } catch {
    return null;
  }
}

/**
 * Merge ONLY the declared replacement workloads into the raw response; every dangling id must be answered with `provided`
 * (a recognised unit code, a quote), else null (today's recover). Returns the merged raw JSON for full revalidation.
 */
export function applyFocusedReplacementFactRepairV5(params: {
  rawResponse: string;
  candidates: readonly FocusedReplacementCandidateV5[];
  decision: FocusedReplacementDecisionV5;
}): string | null {
  if (params.decision.replacements.length !== params.candidates.length) return null;
  const document = record(JSON.parse(params.rawResponse))!;
  const tasks = [...(document.tasks as unknown[])];
  const shellIndexByTask = new Map<string, number>();
  for (const candidate of params.candidates) {
    const answers = params.decision.replacements.filter((entry) => entry.localId === candidate.localId);
    if (answers.length !== 1 || answers[0].decision !== 'provided' || !answers[0].sourceText.trim()
      || !(SEMANTIC_WORKLOAD_UNIT_CODES_V5 as readonly string[]).includes(answers[0].unitCode)) return null;
    const answer = answers[0];
    let index = candidate.taskIndex;
    if (index === -1) {
      // The reading carried no task entry: add the accepted task's existing-entity shell (bound by existingPublicId), grounded by
      // the correction's own quote; it carries only the recovered workload.
      const known = shellIndexByTask.get(candidate.task.id);
      if (known === undefined) {
        index = tasks.length;
        shellIndexByTask.set(candidate.task.id, index);
        tasks.push({
          localId: `task_${candidate.localId}`, existingPublicId: candidate.task.id, decompositionStatus: 'atomic', category: candidate.task.category,
          title: candidate.task.title, study: null, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
          durableContextSignals: [], sourceText: candidate.correctionQuote,
        });
      } else index = known;
    }
    const task = record(tasks[index])!;
    tasks[index] = {
      ...task,
      workloads: [...(task.workloads as unknown[]), {
        localId: candidate.localId, quantityRole: answer.quantityRole, amount: answer.amount,
        unitCode: answer.unitCode, unitLabel: answer.unitLabel, rangeStart: null, rangeEnd: null,
        // The replacement replaces the same kind of quantity: its recurrence scope is the replaced workload's.
        perOccurrence: candidate.replaces.perOccurrence, periodExpression: candidate.replaces.periodExpression,
        sourceText: answer.sourceText,
      }],
    };
  }
  return JSON.stringify({ ...document, tasks });
}

const recoveredDocuments = new WeakSet<object>();
/** The accepted result came from this recovery (used only for the x9b disclosure; never a gate). */
export function markFocusedReplacementRecoveredV5(result: object): void { recoveredDocuments.add(result); }
export function wasFocusedReplacementRecoveredV5(result: object): boolean { return recoveredDocuments.has(result); }
