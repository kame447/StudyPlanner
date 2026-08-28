import {
  resolveUserPlanningContextLifecycleDateV1,
} from './userPlanningContextDateExpression';
import {
  USER_PLANNING_CONTEXT_ORIGINS_V1,
  USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1,
  USER_PLANNING_CONTEXT_STORAGE_VERSION,
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextOriginV1,
  type UserPlanningContextRecordV1,
  type UserPlanningContextSemanticFactV1,
  type UserPlanningContextSemanticKindV1,
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
  committedRecords: UserPlanningContextRecordV1[];
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

function isSemanticKind(value: unknown): value is UserPlanningContextSemanticKindV1 {
  return typeof value === 'string'
    && (USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 as readonly string[]).includes(value);
}

function isOrigin(value: unknown): value is UserPlanningContextOriginV1 {
  return typeof value === 'string'
    && (USER_PLANNING_CONTEXT_ORIGINS_V1 as readonly string[]).includes(value);
}

function normalizeRecordValue(
  value: unknown,
  ownerId: string,
): UserPlanningContextRecordV1 | null {
  if (!isRecord(value)) return null;
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
    'origin',
  ])) return null;
  if (!isNonEmptyBoundedString(value.id, 160)
    || value.ownerId !== ownerId
    || !isSemanticKind(value.kind)
    || !isNonEmptyBoundedString(value.label, MAX_LABEL_LENGTH)
    || !isNullableBoundedString(value.value, MAX_VALUE_LENGTH)
    || !isNullableBoundedString(value.dateExpression, 240)
    || !isDate(value.observedDate)
    || (value.resolvedDate !== null && !isDate(value.resolvedDate))
    || !isNonEmptyBoundedString(value.sourceText, MAX_SOURCE_TEXT_LENGTH)
    || !isNonEmptyBoundedString(value.sourceConversationId, 240)
    || !isNonEmptyBoundedString(value.sourceTurnId, 240)
    || !isTimestamp(value.recordedAt)
    || (value.status !== 'active' && value.status !== 'historical')) {
    return null;
  }
  return {
    id: value.id,
    ownerId,
    kind: value.kind,
    label: value.label,
    value: value.value,
    dateExpression: value.dateExpression,
    observedDate: value.observedDate,
    resolvedDate: value.resolvedDate,
    sourceText: value.sourceText,
    sourceConversationId: value.sourceConversationId,
    sourceTurnId: value.sourceTurnId,
    recordedAt: value.recordedAt,
    status: value.status,
    origin: isOrigin(value.origin) ? value.origin : 'migration',
  };
}

export function normalizeUserPlanningContextSnapshotV1(
  value: unknown,
  ownerId: string,
): UserPlanningContextSnapshotV1 | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ['version', 'ownerId', 'records', 'updatedAt'])) return null;
  if (value.version !== USER_PLANNING_CONTEXT_STORAGE_VERSION || value.ownerId !== ownerId) {
    return null;
  }
  if (!Array.isArray(value.records) || value.records.length > MAX_CONTEXT_RECORDS) return null;
  const records = value.records.map((record) => normalizeRecordValue(record, ownerId));
  if (records.some((record) => record === null) || !isTimestamp(value.updatedAt)) return null;
  const normalizedRecords = records as UserPlanningContextRecordV1[];
  const ids = normalizedRecords.map((record) => record.id);
  if (new Set(ids).size !== ids.length) return null;
  return {
    version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
    ownerId,
    records: normalizedRecords,
    updatedAt: value.updatedAt,
  };
}

export function validateUserPlanningContextSnapshotV1(
  value: unknown,
  ownerId: string,
): value is UserPlanningContextSnapshotV1 {
  return normalizeUserPlanningContextSnapshotV1(value, ownerId) !== null;
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
    const normalized = normalizeUserPlanningContextSnapshotV1(parsed, ownerId);
    if (!normalized) {
      removeRaw(ownerId);
      return createEmptyUserPlanningContextSnapshotV1(ownerId);
    }
    return normalized;
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
    records: snapshot.records.map((record) => {
      const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
        record.dateExpression,
        record.observedDate,
      ) ?? record.resolvedDate;
      return {
        ...record,
        resolvedDate,
        status: statusForRecord(resolvedDate, params.currentDate),
      };
    }),
  };
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function userPlanningContextDurableKeyV1(params: {
  kind: UserPlanningContextSemanticKindV1;
  label: string;
}): string {
  return `${params.kind}|${normalizeIdentityPart(params.label)}`;
}

function recordIdentityValue(params: {
  kind: UserPlanningContextSemanticKindV1;
  value: string | null;
  dateExpression: string | null;
}): string {
  if (params.kind === 'study_goal') return '';
  if (params.kind === 'goal_event') return normalizeIdentityPart(params.dateExpression);
  return normalizeIdentityPart(params.value);
}

export function userPlanningContextRecordIdentityV1(params: {
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string | null;
  dateExpression: string | null;
}): string {
  return [
    userPlanningContextDurableKeyV1(params),
    recordIdentityValue(params),
  ].join('|');
}

function recordIdentity(fact: UserPlanningContextSemanticFactV1): string {
  return userPlanningContextRecordIdentityV1(fact);
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
  const confirmedDurableKeys = new Set<string>();
  for (const record of params.snapshot.records) {
    byIdentity.set(userPlanningContextRecordIdentityV1(record), record);
    if (record.origin === 'user_confirmed') {
      confirmedDurableKeys.add(userPlanningContextDurableKeyV1(record));
    }
  }

  for (const fact of params.facts) {
    const durableKey = userPlanningContextDurableKeyV1(fact);
    if (confirmedDurableKeys.has(durableKey)) continue;
    const identity = recordIdentity(fact);
    const previous = byIdentity.get(identity);
    const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
      fact.dateExpression,
      params.observedDate,
    );
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
      origin: 'ai_inferred',
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

export function createUserConfirmedPlanningContextRecordV1(params: {
  ownerId: string;
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string | null;
  dateExpression: string | null;
  currentDate: string;
  now?: string;
  existingId?: string;
}): UserPlanningContextRecordV1 {
  const label = params.label.trim();
  if (!label || label.length > MAX_LABEL_LENGTH) {
    throw new Error('長期記憶の項目名を入力してください。');
  }
  if (params.value !== null && params.value.length > MAX_VALUE_LENGTH) {
    throw new Error('長期記憶の内容が長すぎます。');
  }
  if (params.dateExpression !== null && params.dateExpression.length > 240) {
    throw new Error('長期記憶の日付表現が長すぎます。');
  }
  const now = params.now ?? new Date().toISOString();
  const fact: UserPlanningContextSemanticFactV1 = {
    localId: 'settings',
    kind: params.kind,
    label,
    value: params.value,
    dateExpression: params.dateExpression,
    sourceText: 'ユーザー設定で確認・編集',
  };
  const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
    params.dateExpression,
    params.currentDate,
  );
  return {
    id: params.existingId ?? recordId(params.ownerId, fact),
    ownerId: params.ownerId,
    kind: params.kind,
    label,
    value: params.value,
    dateExpression: params.dateExpression,
    observedDate: params.currentDate,
    resolvedDate,
    sourceText: fact.sourceText,
    sourceConversationId: 'user-settings',
    sourceTurnId: `user-settings:${now}`,
    recordedAt: now,
    status: statusForRecord(resolvedDate, params.currentDate),
    origin: 'user_confirmed',
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
  const committedRecords = staged.snapshot.records.filter(
    (record) => record.sourceConversationId === params.conversationId
      && record.sourceTurnId === params.requestId
      && record.origin === 'ai_inferred',
  );
  writeRaw(params.ownerId, JSON.stringify(staged.snapshot));
  stagedContexts.delete(key);
  return {
    ownerId: params.ownerId,
    previousRaw,
    committedRecords: committedRecords.map((record) => ({ ...record })),
  };
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
  const normalized = normalizeUserPlanningContextSnapshotV1(snapshot, snapshot.ownerId);
  if (!normalized) {
    throw new Error('User planning context snapshot is invalid.');
  }
  writeRaw(normalized.ownerId, JSON.stringify(normalized));
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
