import type { FocusedContextualQuestionCode, FocusedContextualTargetQuantityRole } from './focusedContextualDecision';

export const FOCUSED_CONTEXTUAL_BINDING_LIMITS = {
  labelBytes: 512,
  unitLabelBytes: 128,
  rangeBytes: 128,
  maximumComponents: 8,
  targetBytes: 8_192,
  maximumAmount: Number.MAX_SAFE_INTEGER,
} as const;

/** Semantic evidence for one request-local slot, never a canonical graph capability. */
export interface FocusedContextualTargetBinding {
  sourceRevision: number;
  targetToken: string;
  questionCode: FocusedContextualQuestionCode;
  task: { category: 'study' | 'non_study' | 'unknown'; title: string };
  componentChain: ReadonlyArray<{
    role: 'subject' | 'field' | 'material' | 'topic' | 'chapter' | 'section' | 'skill' | 'custom';
    label: string;
  }>;
  workload: {
    quantityRole: FocusedContextualTargetQuantityRole;
    amount: number;
    unitCode: 'minute' | 'hour' | 'page' | 'problem' | 'word' | 'lesson' | 'chapter' | 'section'
      | 'exam_year' | 'mock_exam' | 'session' | 'custom';
    unitLabel: string;
    rangeStart: string | null;
    rangeEnd: string | null;
    perOccurrence: boolean;
    periodExpression: string | null;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).length <= limit;
}
function enumString(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value);
}
function range(value: unknown): value is string | null {
  return value === null || text(value, FOCUSED_CONTEXTUAL_BINDING_LIMITS.rangeBytes);
}
function numericRange(value: unknown): number | null {
  if (typeof value !== 'string' || String(Number(value)) !== value) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/** Validate already-typed values; no interpretation of the current utterance. */
export function isFocusedContextualTargetBinding(value: unknown): value is FocusedContextualTargetBinding {
  if (!record(value) || !exact(value, ['sourceRevision', 'targetToken', 'questionCode', 'task', 'componentChain', 'workload'])
    || typeof value.sourceRevision !== 'number' || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0
    || !text(value.targetToken, 160)
    || !enumString(value.questionCode, ['quantity_role_unresolved', 'missing_effort_estimate'])) return false;
  const task = value.task;
  if (!record(task) || !exact(task, ['category', 'title'])
    || !enumString(task.category, ['study', 'non_study', 'unknown'])
    || !text(task.title, FOCUSED_CONTEXTUAL_BINDING_LIMITS.labelBytes)) return false;
  if (!Array.isArray(value.componentChain) || value.componentChain.length > FOCUSED_CONTEXTUAL_BINDING_LIMITS.maximumComponents
    || value.componentChain.some(component => !record(component) || !exact(component, ['role', 'label'])
      || !enumString(component.role, ['subject', 'field', 'material', 'topic', 'chapter', 'section', 'skill', 'custom'])
      || !text(component.label, FOCUSED_CONTEXTUAL_BINDING_LIMITS.labelBytes))) return false;
  const workload = value.workload;
  if (!record(workload) || !exact(workload, ['quantityRole', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression'])
    || !enumString(workload.quantityRole, ['declared', 'scope_total', 'target', 'remaining', 'completed', 'unknown'])
    || typeof workload.amount !== 'number' || !Number.isFinite(workload.amount) || workload.amount <= 0
    || workload.amount > FOCUSED_CONTEXTUAL_BINDING_LIMITS.maximumAmount
    || !enumString(workload.unitCode, ['minute', 'hour', 'page', 'problem', 'word', 'lesson', 'chapter', 'section', 'exam_year', 'mock_exam', 'session', 'custom'])
    || !text(workload.unitLabel, FOCUSED_CONTEXTUAL_BINDING_LIMITS.unitLabelBytes)
    || !range(workload.rangeStart) || !range(workload.rangeEnd)
    || (workload.rangeStart === null) !== (workload.rangeEnd === null)
    || (numericRange(workload.rangeStart) !== null && numericRange(workload.rangeEnd) !== null
      && (Number(workload.rangeStart) < 0 || Number(workload.rangeStart) > Number(workload.rangeEnd)
        || Number(workload.rangeEnd) > Number.MAX_SAFE_INTEGER))
    || typeof workload.perOccurrence !== 'boolean'
    || !(workload.periodExpression === null || text(workload.periodExpression, FOCUSED_CONTEXTUAL_BINDING_LIMITS.labelBytes))
    || (workload.perOccurrence && workload.periodExpression === null)) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= FOCUSED_CONTEXTUAL_BINDING_LIMITS.targetBytes;
}

export function snapshotFocusedContextualTargetBinding(target: FocusedContextualTargetBinding): FocusedContextualTargetBinding {
  return Object.freeze({
    ...target,
    task: Object.freeze({ ...target.task }),
    componentChain: Object.freeze(target.componentChain.map(component => Object.freeze({ ...component }))),
    workload: Object.freeze({ ...target.workload }),
  });
}
