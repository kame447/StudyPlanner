import {
  normalizeUserPlanningContextScopeKeyV2,
  projectUserPlanningContextScopeV2,
  selectUserPlanningContextPromptRecordsV2,
  USER_PLANNING_CONTEXT_SCOPE_TYPES_V2,
  type UserPlanningContextScopeV2,
} from '../../userPlanningContext/userPlanningContextPromptSelectionV2Core';
import type { UserPlanningContextRecordV1 } from '../../userPlanningContext/userPlanningContextTypes';

/**
 * Stored memory the user confirmed, offered to the generic VNext interpreter as read-only background (#294).
 * It is an independent channel: never a Fact Graph source, never evidence for the current utterance's facts, never
 * an approval or save authority, and never copied into a checkpoint or a long-term trace. Pure and shared with the
 * Worker, which validates the same shape before running a durable turn.
 */
export const VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES = 4096;
export const VNEXT_CONFIRMED_USER_CONTEXT_MAX_RECORDS = 20;

export interface VNextConfirmedUserContextRecord {
  id: string;
  ownerId: string;
  kind: UserPlanningContextRecordV1['kind'];
  label: string;
  value: string | null;
  dateExpression: string | null;
  scope: UserPlanningContextScopeV2;
  origin: 'user_confirmed';
  observedDate: string;
  recordedAt: string;
  sourceConversationId: string;
  sourceTurnId: string;
}

export interface VNextConfirmedUserContext { records: VNextConfirmedUserContextRecord[] }

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Reuses V5's selector (global at most 10, scoped at most 10) over records that are already confirmed, owned and active.
 * Only global records and records whose typed scope key matches a typed relevant key enter the pool, and the selector's
 * unrelated "recent" top-up is discarded. A record that does not fit the byte/count bound is left out whole.
 */
export function selectVNextConfirmedUserContext(params: {
  ownerId: string;
  records: readonly UserPlanningContextRecordV1[];
  relevantScopeKeys: readonly string[];
}): VNextConfirmedUserContext | null {
  const relevant = new Set(params.relevantScopeKeys.map(normalizeUserPlanningContextScopeKeyV2).filter(Boolean));
  const pool = params.records.filter(record => {
    if (record.ownerId !== params.ownerId || record.origin !== 'user_confirmed' || record.status !== 'active') return false;
    const scope = projectUserPlanningContextScopeV2(record);
    return scope.type === 'global' || (scope.key !== null && relevant.has(normalizeUserPlanningContextScopeKeyV2(scope.key)));
  });
  const byId = new Map(pool.map(record => [record.id, record]));
  const selected: VNextConfirmedUserContextRecord[] = [];
  for (const prompt of selectUserPlanningContextPromptRecordsV2({ records: pool, relevantScopeKeys: params.relevantScopeKeys })) {
    const record = byId.get(prompt.id);
    // The selector tops its "relevant" tier up with unrelated recent records; this channel takes none of them.
    const typedMatch = prompt.scope.key !== null && relevant.has(normalizeUserPlanningContextScopeKeyV2(prompt.scope.key));
    if (!record || (prompt.relevanceTier !== 'core' && !typedMatch) || selected.length >= VNEXT_CONFIRMED_USER_CONTEXT_MAX_RECORDS) continue;
    const projected: VNextConfirmedUserContextRecord = { id: record.id, ownerId: record.ownerId, kind: record.kind,
      label: record.label, value: record.value, dateExpression: record.dateExpression, scope: prompt.scope,
      origin: 'user_confirmed', observedDate: record.observedDate, recordedAt: record.recordedAt,
      sourceConversationId: record.sourceConversationId, sourceTurnId: record.sourceTurnId };
    if (bytes({ records: [...selected, projected] }) <= VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES) selected.push(projected);
  }
  return selected.length ? { records: selected } : null;
}

const RECORD_KEYS = ['id', 'ownerId', 'kind', 'label', 'value', 'dateExpression', 'scope', 'origin', 'observedDate',
  'recordedAt', 'sourceConversationId', 'sourceTurnId'];
const KINDS = ['study_goal', 'goal_event', 'concern', 'learning_preference'];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length <= 600;
const nullableText = (value: unknown) => value === null || text(value);

/** Structural and owner validation of the wire shape; it never interprets the stored words. */
export function parseVNextConfirmedUserContext(value: unknown, ownerId: string): VNextConfirmedUserContext | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.records)
    || value.records.length === 0 || value.records.length > VNEXT_CONFIRMED_USER_CONTEXT_MAX_RECORDS
    || bytes(value) > VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES) return null;
  const ids = new Set<string>();
  for (const entry of value.records) {
    if (!isRecord(entry) || Object.keys(entry).length !== RECORD_KEYS.length || RECORD_KEYS.some(key => !(key in entry))
      || !text(entry.id) || !entry.id || ids.has(entry.id as string) || entry.ownerId !== ownerId || entry.origin !== 'user_confirmed'
      || !KINDS.includes(entry.kind as string) || !text(entry.label) || !entry.label || !nullableText(entry.value)
      || !nullableText(entry.dateExpression) || !text(entry.observedDate) || !text(entry.recordedAt)
      || !text(entry.sourceConversationId) || !text(entry.sourceTurnId)
      || !isRecord(entry.scope) || Object.keys(entry.scope).length !== 2
      || !USER_PLANNING_CONTEXT_SCOPE_TYPES_V2.includes(entry.scope.type as never) || !nullableText(entry.scope.key)) return null;
    ids.add(entry.id as string);
  }
  return value as unknown as VNextConfirmedUserContext;
}

/** What the model reads: no owner ID, and never the original utterance the memory was made from. */
export function projectVNextConfirmedUserContextForPrompt(context: VNextConfirmedUserContext | undefined) {
  if (!context?.records.length) return null;
  return context.records.map(({ ownerId: _ownerId, ...record }) => record);
}

/** Scope keys come from typed state: active task titles and the UI-selected starter target, never parsed from text. */
export function vnextRelevantScopeKeys(titles: readonly (string | null | undefined)[]): string[] {
  return titles.filter((title): title is string => typeof title === 'string' && title.trim().length > 0);
}
