import {
  USER_PLANNING_CONTEXT_STORAGE_VERSION,
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextRecordV1,
  type UserPlanningContextSemanticFactV1,
  type UserPlanningContextSnapshotV1,
} from './userPlanningContextTypes';

const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_CONTEXT_RECORDS = 200;
const MAX_LABEL_LENGTH = 240;
const MAX_VALUE_LENGTH = 1000;
const MAX_SOURCE_TEXT_LENGTH = 2000;
const MAX_PROMPT_RECORDS = 30;

const inMemoryStorage = new Map<string, string>();
const stagedContexts = new Map<string, {
  ownerId: string;
  conversationId: string;
  requestId: string;
  snapshot: UserPlanningContextSnapshotV1;
}>();

export interface UserPlanningContextFinalizeReceiptV1 {
  ownerId: string;
  previousRaw: string | null;
}

function storageKey(ownerId: string): string {
  return `studyplanner.userPlanningContext.${ownerId}`;
}

function stagedKey(conversationId: string, requestId: string): string {
  return `${conversationId}:${requestId}`;
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readRaw(ownerId: string): string | null {
  const key = storageKey(ownerId);
  try {
    return storageAvailable()
      ? window.localStorage.getItem(key)
      : inMemoryStorage.get(key) ?? null;
  } catch {
    return null;
  }
}

function removeRaw(ownerId: string): void {
  const key = storageKey(ownerId);
  try {
    if (storageAvailable()) window.localStorage.removeItem(key);
    else inMemoryStorage.delete(key);
  } catch {
    // Invalid or unavailable client storage is fail-closed.
  }
}

function writeRaw(ownerId: string, raw: string | null): void {
  const key = storageKey(ownerId);
  try {
    if (raw === null) {
      if (storageAvailable()) window.localStorage.removeItem(key);
      else inMemoryStorage.delete(key);
      return;
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_CONTEXT_BYTES) {
      throw new Error('User planning context exceeds storage limit.');
    }
    if (storageAvailable()) window.localStorage.setItem(key, raw);
    else inMemoryStorage.set(key, raw);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('User planning context storage failed.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength;
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecordValue(value: unknown, ownerId: string): value is UserPlanningContextRecordV1 {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    'id',
    'ownerId',
    'kind',
    'label',
    'value',
    'dateExpression',
    'observedDate',
    'resolvedDate',
    'sourceText',
    'sourceConversationId',
    'sourceTurnId',
    'recordedAt',
    'status',
  ])) return false;
  return isNonEmptyBoundedString(value.id, 160)
    && value.ownerId === ownerId
    && (value.kind === 'study_goal'
      || value.kind === 'goal_event'
      || value.kind === 'concern'
      || value.kind === 'learning_preference')
    && isNonEmptyBoundedString(value.label, MAX_LABEL_LENGTH)
    && isNullableBoundedString(value.value, MAX_VALUE_LENGTH)
    && isNullableBoundedString(value.dateExpression, 240)
    && isDate(value.observedDate)
    && (value.resolvedDate === null || isDate(value.resolvedDate))
    && isNonEmptyBoundedString(value.sourceText, MAX_SOURCE_TEXT_LENGTH)
    && isNonEmptyBoundedString(value.sourceConversationId, 240)
    && isNonEmptyBoundedString(value.sourceTurnId, 240)
    && isTimestamp(value.recordedAt)
    && (value.status === 'active' || value.status === 'historical');
}

export function validateUserPlanningContextSnapshotV1(
  value: unknown,
  ownerId: string,
): value is UserPlanningContextSnapshotV1 {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ['version', 'ownerId', 'records', 'updatedAt'])) return false;
  if (value.version !== USER_PLANNING_CONTEXT_STORAGE_VERSION) return false;
  if (value.ownerId !== ownerId) return false;
  if (!Array.isArray(value.records) || value.records.length > MAX_CONTEXT_RECORDS) return false;
  if (!value.records.every((record) => isRecordValue(record, ownerId))) return false;
  if (!isTimestamp(value.updatedAt)) return false;
  const ids = value.records.map((record) => record.id);
  return new Set(ids).size === ids.length;
}

function addDays(date: string, amount: number): string | null {
  if (!isDate(date) || !Number.isInteger(amount)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function resolveContextDateExpression(
  expression: string | null,
  observedDate: string,
): string | null {
  if (!expression) return null;
  if (isDate(expression)) return expression;
  if (expression === 'today') return observedDate;
  if (expression === 'tomorrow' || expression === 'next_day') return addDays(observedDate, 1);
  if (expression === 'day_after_tomorrow') return addDays(observedDate, 2);
  const dayOffset = /^custom:(\d+)日後$/.exec(expression);
  if (dayOffset) return addDays(observedDate, Number(dayOffset[1]));
  const weekOffset = /^custom:(\d+)週間後$/.exec(expression)
    ?? /^custom:(\d+)週後$/.exec(expression);
  if (weekOffset) return addDays(observedDate, Number(weekOffset[1]) * 7);
  return null;
}

function statusForRecord(
  resolvedDate: string | null,
  currentDate: string,
): 'active' | 'historical' {
  return resolvedDate && isDate(currentDate) && resolvedDate < currentDate
    ? 'historical'
    : 'active';
}

function parseSnapshot(raw: string | null, ownerId: string): UserPlanningContextSnapshotV1 {
  if (!raw) return createEmptyUserPlanningContextSnapshotV1(ownerId);
  if (new TextEncoder().encode(raw).byteLength > MAX_CONTEXT_BYTES) {
    removeRaw(ownerId);
    return createEmptyUserPlanningContextSnapshotV1(ownerId);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validateUserPlanningContextSnapshotV1(parsed, ownerId)) {
      removeRaw(ownerId);
      return createEmptyUserPlanningContextSnapshotV1(ownerId);
    }
    return structuredClone(parsed);
  } catch {
    removeRaw(ownerId);
    return createEmptyUserPlanningContextSnapshotV1(ownerId);
  }
}

export function loadUserPlanningContextSnapshotV1(params: {
  ownerId: string;
  currentDate: string;
}): UserPlanningContextSnapshotV1 {
  const snapshot = parseSnapshot(readRaw(params.ownerId), params.ownerId);
  return {
    ...snapshot,
    records: snapshot.records.map((record) => ({
      ...record,
      status: statusForRecord(record.resolvedDate, params.currentDate),
    })),
  };
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function durableIdentityValue(params: {
  kind: UserPlanningContextRecordV1['kind'];
  value: string | null;
  dateExpression: string | null;
}): string {
  if (params.kind === 'study_goal') return '';
  if (params.kind === 'goal_event') return normalizeIdentityPart(params.dateExpression);
  return normalizeIdentityPart(params.value);
}

function recordIdentity(fact: UserPlanningContextSemanticFactV1): string {
  return [
    fact.kind,
    normalizeIdentityPart(fact.label),
    durableIdentityValue({
      kind: fact.kind,
      value: fact.value,
      dateExpression: fact.dateExpression,
    }),
  ].join('|');
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function recordId(ownerId: string, fact: UserPlanningContextSemanticFactV1): string {
  return `upc_${fnv1a(`${ownerId}|${recordIdentity(fact)}`)}`;
}

function mergeFacts(params: {
  snapshot: UserPlanningContextSnapshotV1;
  facts: readonly UserPlanningContextSemanticFactV1[];
  ownerId: string;
  conversationId: string;
  requestId: string;
  observedDate: string;
  now: string;
}): UserPlanningContextSnapshotV1 {
  const byIdentity = new Map<string, UserPlanningContextRecordV1>();
  for (const record of params.snapshot.records) {
    const identity = [
      record.kind,
      normalizeIdentityPart(record.label),
      durableIdentityValue({
        kind: record.kind,
        value: record.value,
        dateExpression: record.dateExpression,
      }),
    ].join('|');
    byIdentity.set(identity, record);
  }

  for (const fact of params.facts) {
    const identity = recordIdentity(fact);
    const resolvedDate = resolveContextDateExpression(fact.dateExpression, params.observedDate);
    const previous = byIdentity.get(identity);
    byIdentity.set(identity, {
      id: previous?.id ?? recordId(params.ownerId, fact),
      ownerId: params.ownerId,
      kind: fact.kind,
      label: fact.label.trim(),
      value: fact.value,
      dateExpression: fact.dateExpression,
      observedDate: params.observedDate,
      resolvedDate,
      sourceText: fact.sourceText,
      sourceConversationId: params.conversationId,
      sourceTurnId: params.requestId,
      recordedAt: params.now,
      status: statusForRecord(resolvedDate, params.observedDate),
    });
  }

  const records = [...byIdentity.values()]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, MAX_CONTEXT_RECORDS);
  return {
    version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
    ownerId: params.ownerId,
    records,
    updatedAt: params.now,
  };
}

export function stageUserPlanningContextFactsV1(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
  observedDate: string;
  facts: readonly UserPlanningContextSemanticFactV1[];
  now?: string;
}): void {
  const key = stagedKey(params.conversationId, params.requestId);
  if (params.facts.length === 0) {
    stagedContexts.delete(key);
    return;
  }
  const current = loadUserPlanningContextSnapshotV1({
    ownerId: params.ownerId,
    currentDate: params.observedDate,
  });
  stagedContexts.set(key, {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    requestId: params.requestId,
    snapshot: mergeFacts({
      snapshot: current,
      facts: params.facts,
      ownerId: params.ownerId,
      conversationId: params.conversationId,
      requestId: params.requestId,
      observedDate: params.observedDate,
      now: params.now ?? new Date().toISOString(),
    }),
  });
}

export function hasStagedUserPlanningContextV1(params: {
  conversationId: string;
  requestId: string;
}): boolean {
  return stagedContexts.has(stagedKey(params.conversationId, params.requestId));
}

export function finalizeStagedUserPlanningContextV1(params: {
  ownerId: string;
  conversationId: string;
  requestId: string;
}): UserPlanningContextFinalizeReceiptV1 | null {
  const key = stagedKey(params.conversationId, params.requestId);
  const staged = stagedContexts.get(key);
  if (!staged) return null;
  if (staged.ownerId !== params.ownerId) {
    throw new Error('User planning context owner mismatch.');
  }
  const previousRaw = readRaw(params.ownerId);
  writeRaw(params.ownerId, JSON.stringify(staged.snapshot));
  stagedContexts.delete(key);
  return { ownerId: params.ownerId, previousRaw };
}

export function rollbackFinalizedUserPlanningContextV1(
  receipt: UserPlanningContextFinalizeReceiptV1 | null,
): void {
  if (!receipt) return;
  writeRaw(receipt.ownerId, receipt.previousRaw);
}

export function discardStagedUserPlanningContextV1(params: {
  conversationId: string;
  requestId: string;
}): void {
  stagedContexts.delete(stagedKey(params.conversationId, params.requestId));
}

export function userPlanningContextPromptSummaryV1(params: {
  ownerId: string;
  currentDate: string;
}): Array<{
  id: string;
  kind: UserPlanningContextRecordV1['kind'];
  label: string;
  value: string | null;
  dateExpression: string | null;
  observedDate: string;
  resolvedDate: string | null;
  status: UserPlanningContextRecordV1['status'];
}> {
  return loadUserPlanningContextSnapshotV1(params).records
    .filter((record) => record.status === 'active')
    .slice(0, MAX_PROMPT_RECORDS)
    .map((record) => ({
      id: record.id,
      kind: record.kind,
      label: record.label,
      value: record.value,
      dateExpression: record.dateExpression,
      observedDate: record.observedDate,
      resolvedDate: record.resolvedDate,
      status: record.status,
    }));
}

export function exportUserPlanningContextSnapshotV1(params: {
  ownerId: string;
  currentDate: string;
}): UserPlanningContextSnapshotV1 {
  return loadUserPlanningContextSnapshotV1(params);
}

export function hydrateUserPlanningContextSnapshotV1(
  snapshot: UserPlanningContextSnapshotV1,
): void {
  if (!validateUserPlanningContextSnapshotV1(snapshot, snapshot.ownerId)) {
    throw new Error('User planning context snapshot is invalid.');
  }
  writeRaw(snapshot.ownerId, JSON.stringify(snapshot));
}

export function clearUserPlanningContextForOwnerV1(ownerId: string): void {
  removeRaw(ownerId);
  for (const [key, staged] of stagedContexts) {
    if (staged.ownerId === ownerId) stagedContexts.delete(key);
  }
}

export function resetUserPlanningContextRuntimeForTestV1(): void {
  inMemoryStorage.clear();
  stagedContexts.clear();
}
