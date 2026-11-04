import {
  resolveUserPlanningContextLifecycleDateV1,
} from './userPlanningContextDateExpression';
import {
  USER_PLANNING_CONTEXT_ORIGINS_V1,
  USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1,
  USER_PLANNING_CONTEXT_STATUSES_V1,
  USER_PLANNING_CONTEXT_STORAGE_VERSION,
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextOriginV1,
  type UserPlanningContextRecordV1,
  type UserPlanningContextSemanticFactV1,
  type UserPlanningContextSemanticKindV1,
  type UserPlanningContextSnapshotV1,
  type UserPlanningContextStatusV1,
} from './userPlanningContextTypes';

const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_CONTEXT_RECORDS = 200;
const MAX_LABEL_LENGTH = 240;
const MAX_VALUE_LENGTH = 1000;
const MAX_SOURCE_TEXT_LENGTH = 2000;
const MAX_PROMPT_RECORDS = 30;

type UnavailableContextRead = {
  readonly kind: 'unavailable';
  readonly reason: 'storage_unavailable' | 'oversize' | 'invalid_json' | 'invalid_snapshot';
};

type ContextSnapshotRead =
  | { kind: 'ready'; raw: string; snapshot: UserPlanningContextSnapshotV1 }
  | { kind: 'missing'; raw: null; snapshot: UserPlanningContextSnapshotV1 }
  | UnavailableContextRead;

type ContextReadReceipt = Readonly<{ ownerId: string } & (
  | { kind: 'ready' | 'missing' }
  | UnavailableContextRead
)>;

// Keep a read-only fallback's source distinct from a later, recovered read.
let snapshotReadReceipts = new WeakMap<UserPlanningContextSnapshotV1, ContextReadReceipt>();
const inMemoryStorage = new Map<string, string>();
const stagedContexts = new Map<string, {
  ownerId: string;
  conversationId: string;
  requestId: string;
  observedDate: string;
  facts: UserPlanningContextSemanticFactV1[];
  now: string;
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

function readRaw(ownerId: string): { kind: 'available'; raw: string | null } | UnavailableContextRead {
  const key = storageKey(ownerId);
  try {
    const raw = storageAvailable()
      ? window.localStorage.getItem(key)
      : inMemoryStorage.get(key) ?? null;
    return { kind: 'available', raw };
  } catch {
    return { kind: 'unavailable', reason: 'storage_unavailable' };
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

function isStatus(value: unknown): value is UserPlanningContextStatusV1 {
  return typeof value === 'string'
    && (USER_PLANNING_CONTEXT_STATUSES_V1 as readonly string[]).includes(value);
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
    || !isStatus(value.status)) {
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

function refreshedStatusForRecord(
  record: Pick<UserPlanningContextRecordV1, 'kind' | 'status' | 'resolvedDate'>,
  currentDate: string,
): UserPlanningContextStatusV1 {
  if (record.status === 'revoked'
    || record.status === 'superseded'
    || record.status === 'archived') {
    return record.status;
  }
  if (record.resolvedDate && isDate(currentDate) && record.resolvedDate < currentDate) {
    return record.kind === 'goal_event' ? 'needs_review' : 'historical';
  }
  return 'active';
}

function parseSnapshot(raw: string | null, ownerId: string): ContextSnapshotRead {
  if (raw === null) {
    return { kind: 'missing', raw, snapshot: createEmptyUserPlanningContextSnapshotV1(ownerId) };
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_CONTEXT_BYTES) {
    return { kind: 'unavailable', reason: 'oversize' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unavailable', reason: 'invalid_json' };
  }
  const normalized = normalizeUserPlanningContextSnapshotV1(parsed, ownerId);
  return normalized
    ? { kind: 'ready', raw, snapshot: normalized }
    : { kind: 'unavailable', reason: 'invalid_snapshot' };
}

function readSnapshot(ownerId: string): ContextSnapshotRead {
  const read = readRaw(ownerId);
  return read.kind === 'unavailable' ? read : parseSnapshot(read.raw, ownerId);
}

function readAuthoritativeSnapshot(ownerId: string): Exclude<ContextSnapshotRead, UnavailableContextRead> {
  const read = readSnapshot(ownerId);
  if (read.kind === 'unavailable') {
    throw new Error('保存済みの長期記憶を確認できないため、更新できませんでした。');
  }
  return read;
}

/** Check the original object before normalization or migration copies it. */
export function assertUserPlanningContextSnapshotSourceV1(
  snapshot: UserPlanningContextSnapshotV1,
  ownerId: string,
): void {
  const receipt = snapshotReadReceipts.get(snapshot);
  if (snapshot.ownerId !== ownerId || (receipt && receipt.ownerId !== ownerId)) {
    throw new Error('User planning context owner mismatch.');
  }
  if (receipt?.kind === 'unavailable') {
    throw new Error('長期記憶を読み取れなかったため、この内容は保存できません。');
  }
}

function refreshSnapshot(
  snapshot: UserPlanningContextSnapshotV1,
  currentDate: string,
): UserPlanningContextSnapshotV1 {
  return {
    ...snapshot,
    records: snapshot.records.map((record) => {
      const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
        record.dateExpression,
        record.observedDate,
      ) ?? record.resolvedDate;
      const next = { ...record, resolvedDate };
      return {
        ...next,
        status: refreshedStatusForRecord(next, currentDate),
      };
    }),
  };
}

export function loadUserPlanningContextSnapshotV1(params: {
  ownerId: string;
  currentDate: string;
}): UserPlanningContextSnapshotV1 {
  const read = readSnapshot(params.ownerId);
  const snapshot = refreshSnapshot(
    read.kind === 'unavailable'
      ? createEmptyUserPlanningContextSnapshotV1(params.ownerId)
      : read.snapshot,
    params.currentDate,
  );
  snapshotReadReceipts.set(snapshot, Object.freeze(read.kind === 'unavailable'
    ? { ownerId: params.ownerId, kind: read.kind, reason: read.reason }
    : { ownerId: params.ownerId, kind: read.kind }));
  return snapshot;
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? '').normalize('NFKC')
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, '')
    .trim()
    .replace(/\s+/g, ' ');
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

function retentionPriority(record: UserPlanningContextRecordV1): number {
  if (record.status === 'revoked') return 2;
  return record.origin === 'user_confirmed' ? 1 : 0;
}

function compareRecordedAt(left: UserPlanningContextRecordV1, right: UserPlanningContextRecordV1): number {
  return Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
}

/**
 * Storage holds at most 200 records. Revocations and user-confirmed records
 * take the available slots before inferred records; within each authority
 * level the newest records win. The returned order remains newest first.
 */
export function retainUserPlanningContextRecordsV1(
  records: Iterable<UserPlanningContextRecordV1>,
): UserPlanningContextRecordV1[] {
  const byIdentity = new Map<string, UserPlanningContextRecordV1>();
  for (const record of records) {
    const identity = userPlanningContextRecordIdentityV1(record);
    const previous = byIdentity.get(identity);
    if (!previous
      || retentionPriority(record) > retentionPriority(previous)
      || (retentionPriority(record) === retentionPriority(previous)
        && compareRecordedAt(record, previous) >= 0)) {
      byIdentity.set(identity, record);
    }
  }
  return [...byIdentity.values()]
    .sort((left, right) => retentionPriority(right) - retentionPriority(left)
      || compareRecordedAt(right, left))
    .slice(0, MAX_CONTEXT_RECORDS)
    .sort((left, right) => compareRecordedAt(right, left))
    .map((record) => ({ ...record }));
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

function inferredRecordId(ownerId: string, fact: UserPlanningContextSemanticFactV1): string {
  return `upc_${fnv1a(`${ownerId}|${recordIdentity(fact)}`)}`;
}

function userConfirmedRecordId(ownerId: string, now: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `upc_${crypto.randomUUID()}`;
  }
  return `upc_${fnv1a(`${ownerId}|${now}|${Math.random()}`)}`;
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
  const protectedDurableKeys = new Set<string>();
  for (const record of retainUserPlanningContextRecordsV1(params.snapshot.records)) {
    byIdentity.set(userPlanningContextRecordIdentityV1(record), record);
    if (record.status === 'revoked' || record.origin === 'user_confirmed') {
      protectedDurableKeys.add(userPlanningContextDurableKeyV1(record));
    }
  }

  for (const fact of params.facts) {
    const durableKey = userPlanningContextDurableKeyV1(fact);
    if (protectedDurableKeys.has(durableKey)) continue;
    const identity = recordIdentity(fact);
    const previous = byIdentity.get(identity);
    if (previous && Date.parse(previous.recordedAt) > Date.parse(params.now)) continue;
    const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
      fact.dateExpression,
      params.observedDate,
    );
    byIdentity.set(identity, {
      id: previous?.id ?? inferredRecordId(params.ownerId, fact),
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
      status: 'active',
      origin: 'user_stated',
    });
  }

  const records = retainUserPlanningContextRecordsV1(byIdentity.values());
  return {
    version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
    ownerId: params.ownerId,
    records,
    updatedAt: new Date(Math.max(
      Date.parse(params.snapshot.updatedAt),
      Date.parse(params.now),
    )).toISOString(),
  };
}

export function createUserConfirmedPlanningContextRecordV1(params: {
  ownerId: string;
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string | null;
  dateExpression: string | null;
  currentDate: string;
  sourceText?: string;
  now?: string;
  existingId?: string;
}): UserPlanningContextRecordV1 {
  const label = params.label.trim();
  if (!label || label.length > MAX_LABEL_LENGTH) {
    throw new Error('覚えておく内容を整理できませんでした。');
  }
  if (params.value !== null && params.value.length > MAX_VALUE_LENGTH) {
    throw new Error('覚えておく内容が長すぎます。');
  }
  if (params.dateExpression !== null && params.dateExpression.length > 240) {
    throw new Error('覚えておく時期の情報が長すぎます。');
  }
  const now = params.now ?? new Date().toISOString();
  const sourceText = params.sourceText?.trim() || 'ユーザー設定で確認・編集';
  if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    throw new Error('覚えておく内容が長すぎます。');
  }
  const resolvedDate = resolveUserPlanningContextLifecycleDateV1(
    params.dateExpression,
    params.currentDate,
  );
  return {
    id: params.existingId ?? userConfirmedRecordId(params.ownerId, now),
    ownerId: params.ownerId,
    kind: params.kind,
    label,
    value: params.value,
    dateExpression: params.dateExpression,
    observedDate: params.currentDate,
    resolvedDate,
    sourceText,
    sourceConversationId: 'user-settings',
    sourceTurnId: `user-settings:${now}`,
    recordedAt: now,
    status: 'active',
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
  stagedContexts.set(key, {
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    requestId: params.requestId,
    observedDate: params.observedDate,
    facts: params.facts.map((fact) => ({ ...fact })),
    now: params.now ?? new Date().toISOString(),
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
  const current = readAuthoritativeSnapshot(params.ownerId);
  const merged = mergeFacts({
    snapshot: refreshSnapshot(current.snapshot, staged.observedDate),
    facts: staged.facts,
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    requestId: params.requestId,
    observedDate: staged.observedDate,
    now: staged.now,
  });
  const committedRecords = merged.records.filter(
    (record) => record.sourceConversationId === params.conversationId
      && record.sourceTurnId === params.requestId
      && record.origin === 'user_stated',
  );
  if (committedRecords.length > 0) {
    writeRaw(params.ownerId, JSON.stringify(merged));
  }
  stagedContexts.delete(key);
  if (committedRecords.length === 0) return null;
  return {
    ownerId: params.ownerId,
    previousRaw: current.raw,
    committedRecords: committedRecords.map((record) => ({ ...record })),
  };
}

export function rollbackFinalizedUserPlanningContextV1(
  receipt: UserPlanningContextFinalizeReceiptV1 | null,
): void {
  if (!receipt) return;
  readAuthoritativeSnapshot(receipt.ownerId);
  writeRaw(receipt.ownerId, receipt.previousRaw);
}

export function discardStagedUserPlanningContextV1(params: {
  conversationId: string;
  requestId: string;
}): void {
  stagedContexts.delete(stagedKey(params.conversationId, params.requestId));
}

export function isUserPlanningContextVisibleV1(record: UserPlanningContextRecordV1): boolean {
  return record.status === 'active'
    || record.status === 'historical'
    || record.status === 'needs_review';
}

export function userPlanningContextDisplayTextV1(record: UserPlanningContextRecordV1): string {
  const sourceText = record.sourceText.trim();
  if (sourceText && sourceText !== 'ユーザー設定で確認・編集') return sourceText;
  if (record.value) return `${record.label}: ${record.value}`;
  return record.label;
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
  origin: UserPlanningContextRecordV1['origin'];
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
      origin: record.origin,
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
  assertUserPlanningContextSnapshotSourceV1(snapshot, snapshot.ownerId);
  const normalized = normalizeUserPlanningContextSnapshotV1(snapshot, snapshot.ownerId);
  if (!normalized) {
    throw new Error('User planning context snapshot is invalid.');
  }
  readAuthoritativeSnapshot(normalized.ownerId);
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
  snapshotReadReceipts = new WeakMap();
}
