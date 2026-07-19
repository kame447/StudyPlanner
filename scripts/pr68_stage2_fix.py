from pathlib import Path
import re


def read(path: Path) -> str:
    return path.read_text()


def write(path: Path, text: str) -> None:
    path.write_text(text)


def replace_once(path: Path, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:180]!r}')
    write(path, text.replace(old, new, 1))


privacy = Path('workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts')
replace_once(
    privacy,
    """function requireDocumentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,240}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
""",
    """const UUID_SUFFIX = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FALLBACK_RANDOM_SUFFIX = '[0-9]{10,16}-[a-z0-9]{6,16}';
const OPAQUE_SUFFIX = `(?:${UUID_SUFFIX}|${FALLBACK_RANDOM_SUFFIX})`;
const TRACE_SESSION_ID_PATTERN = new RegExp(`^weekly-trace-${OPAQUE_SUFFIX}$`, 'i');
const TRACE_CONVERSATION_ID_PATTERN = new RegExp(
  `^(?:weekly-conversation|weekly-planning-conversation)-${OPAQUE_SUFFIX}$`,
  'i',
);
const MAX_TRACE_SESSION_ENTRIES = 100_000;

export function isWeeklyPlanningTraceSessionId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_SESSION_ID_PATTERN.test(value);
}

export function isWeeklyPlanningTraceConversationId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_CONVERSATION_ID_PATTERN.test(value);
}

export function weeklyPlanningTraceEntryId(sessionId: string, sequence: number): string {
  return `${sessionId}-${String(sequence).padStart(8, '0')}`;
}

export function isWeeklyPlanningTraceEntryId(
  value: unknown,
  sessionId?: string,
  sequence?: number,
): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(weekly-trace-.+)-(\\d{8})$/);
  if (!match || !isWeeklyPlanningTraceSessionId(match[1])) return false;
  const parsedSequence = Number(match[2]);
  return Number.isSafeInteger(parsedSequence)
    && (sessionId === undefined || match[1] === sessionId)
    && (sequence === undefined || parsedSequence === sequence);
}

function requireTraceSessionId(value: unknown): string {
  if (!isWeeklyPlanningTraceSessionId(value)) throw new Error('trace session id is invalid');
  return value;
}

function requireTraceConversationId(value: unknown, label: string): string {
  if (!isWeeklyPlanningTraceConversationId(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireTraceEntryCount(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_TRACE_SESSION_ENTRIES) {
    throw new Error('trace session entryCount is invalid');
  }
  return value;
}
""",
)
replace_once(
    privacy,
    """  const sessionId = requireDocumentId(input.session.id, 'trace session id');
  const logicalConversationId = typeof input.session.logicalConversationId === 'string'
    ? requireDocumentId(input.session.logicalConversationId, 'logical conversation id')
    : undefined;
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = {
    ...preparedDocument({ ...input.session, id: sessionId }, subject, expireAt),
    id: sessionId,
    ...(logicalConversationId ? { logicalConversationId } : {}),
  };
  const entries = input.entries.map((entry) => {
""",
    """  const sessionId = requireTraceSessionId(input.session.id);
  const logicalConversationId = requireTraceConversationId(
    input.session.logicalConversationId,
    'logical conversation id',
  );
  const entryCount = requireTraceEntryCount(input.session.entryCount);
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = {
    ...preparedDocument({
      ...input.session,
      id: sessionId,
      logicalConversationId,
      entryCount,
    }, subject, expireAt),
    id: sessionId,
    logicalConversationId,
    entryCount,
  };
  const seenSequences = new Set<number>();
  const entries = input.entries.map((entry) => {
""",
)
replace_once(
    privacy,
    """    const entryId = requireDocumentId(entry.id, 'trace entry id');
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    const entryConversationId = typeof entry.logicalConversationId === 'string'
      ? requireDocumentId(entry.logicalConversationId, 'entry logical conversation id')
      : undefined;
    if (logicalConversationId && entryConversationId && entryConversationId !== logicalConversationId) {
      throw new Error('trace entry conversation mismatch');
    }
    return {
      ...preparedDocument({ ...entry, id: entryId, sessionId }, subject, expireAt),
      id: entryId,
      sessionId,
      ...(entryConversationId ? { logicalConversationId: entryConversationId } : {}),
    };
""",
    """    const sequence = entry.sequence;
    if (typeof sequence !== 'number'
      || !Number.isSafeInteger(sequence)
      || sequence < 0
      || sequence >= entryCount
      || seenSequences.has(sequence)) {
      throw new Error('trace entry sequence is invalid');
    }
    seenSequences.add(sequence);
    const expectedEntryId = weeklyPlanningTraceEntryId(sessionId, sequence);
    if (!isWeeklyPlanningTraceEntryId(entry.id, sessionId, sequence)
      || entry.id !== expectedEntryId) {
      throw new Error('trace entry id is invalid');
    }
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    const entryConversationId = requireTraceConversationId(
      entry.logicalConversationId,
      'entry logical conversation id',
    );
    if (entryConversationId !== logicalConversationId) {
      throw new Error('trace entry conversation mismatch');
    }
    return {
      ...preparedDocument({
        ...entry,
        id: expectedEntryId,
        sessionId,
        logicalConversationId: entryConversationId,
        sequence,
      }, subject, expireAt),
      id: expectedEntryId,
      sessionId,
      logicalConversationId: entryConversationId,
      sequence,
    };
""",
)

api = Path('workers/ai-proxy/src/weeklyPlanningTraceApi.ts')
replace_once(
    api,
    """  isWeeklyPlanningTracePolicyAccepted,
  parseWeeklyPlanningTraceHmacSecrets,
""",
    """  isWeeklyPlanningTraceConversationId,
  isWeeklyPlanningTraceEntryId,
  isWeeklyPlanningTracePolicyAccepted,
  isWeeklyPlanningTraceSessionId,
  parseWeeklyPlanningTraceHmacSecrets,
""",
)
replace_once(
    api,
    "const ADMIN_LIST_LIMIT = 500;\n",
    "const ADMIN_LIST_LIMIT = 500;\nconst TRACE_STORAGE_LAYOUT_VERSION = 1;\n",
)
replace_once(
    api,
    """const TRACE_STRUCTURAL_KEYS = ['id', 'sessionId', 'logicalConversationId'] as const;

export function safeWeeklyPlanningTraceDocumentsForAdmin(
""",
    """function isSafeTraceStructuralValue(
  key: 'id' | 'sessionId' | 'logicalConversationId',
  value: unknown,
  document: Record<string, unknown>,
): value is string {
  if (key === 'sessionId') return isWeeklyPlanningTraceSessionId(value);
  if (key === 'logicalConversationId') return isWeeklyPlanningTraceConversationId(value);
  if (isWeeklyPlanningTraceSessionId(value) || isWeeklyPlanningTraceConversationId(value)) return true;
  return isWeeklyPlanningTraceEntryId(value, typeof document.sessionId === 'string'
    ? document.sessionId
    : undefined);
}

const TRACE_STRUCTURAL_KEYS = ['id', 'sessionId', 'logicalConversationId'] as const;

export function safeWeeklyPlanningTraceDocumentsForAdmin(
""",
)
replace_once(
    api,
    """      if (typeof value === 'string' && /^[A-Za-z0-9:_-]{1,240}$/.test(value)) {
        redacted[key] = value;
      }
""",
    """      if (isSafeTraceStructuralValue(key, value, document)) {
        redacted[key] = value;
      }
""",
)
replace_once(
    api,
    """  if (
    existingSession
    && existingSession.traceSubjectToken !== prepared.session.traceSubjectToken
  ) {
    return error(409, 'trace session ownership conflict');
  }
  const mergedSession = {
    ...(existingSession ?? {}),
    ...prepared.session,
    ...(existingSession?.archivedAt ? { archivedAt: existingSession.archivedAt } : {}),
  };
  delete mergedSession.userId;
  await firestore.setDocument(TRACE_SESSIONS, sessionId, mergedSession);
  for (const entry of prepared.entries) {
    await firestore.setImmutableDocument(TRACE_ENTRIES, String(entry.id), entry);
  }
""",
    """  if (
    existingSession
    && existingSession.traceSubjectToken !== prepared.session.traceSubjectToken
  ) {
    return error(409, 'trace session ownership conflict');
  }
  if (existingSession) {
    if (existingSession.logicalConversationId !== prepared.session.logicalConversationId) {
      return error(409, 'trace session conversation conflict');
    }
    const oldCount = existingSession.entryCount;
    const nextCount = prepared.session.entryCount;
    if (typeof oldCount === 'number'
      && typeof nextCount === 'number'
      && nextCount < oldCount) {
      return error(409, 'trace session entryCount conflict');
    }
  }
  const mergedSession = {
    ...(existingSession ?? {}),
    ...prepared.session,
    storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
    ...(existingSession?.archivedAt ? { archivedAt: existingSession.archivedAt } : {}),
  };
  delete mergedSession.userId;
  for (const entry of prepared.entries) {
    await firestore.setImmutableDocument(TRACE_ENTRIES, String(entry.id), entry);
  }
  await firestore.setDocument(TRACE_SESSIONS, sessionId, mergedSession);
""",
)
replace_once(
    api,
    """  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
""",
    """  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  if (!isWeeklyPlanningTraceSessionId(sessionId)) return error(400, 'sessionId is invalid');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
""",
)
old_admin_entries = """  const rawEntryCount = target.entryCount;
  const entryCount = typeof rawEntryCount === 'number' && Number.isFinite(rawEntryCount)
    ? Math.max(0, Math.min(ADMIN_LIST_LIMIT, Math.trunc(rawEntryCount)))
    : 0;
  const entries = (await Promise.all(
    Array.from({ length: entryCount }, (_, sequence) =>
      firestore.getDocument(
        TRACE_ENTRIES,
        `${sessionId}-${String(sequence).padStart(8, '0')}`,
      )),
  ))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ ...entry, sessionId }));
  return ok({ entries: safeWeeklyPlanningTraceDocumentsForAdmin(entries) });
"""
new_admin_entries = """  let entries: Record<string, unknown>[];
  if (target.storageLayoutVersion === TRACE_STORAGE_LAYOUT_VERSION) {
    entries = (await firestore.queryDocuments(
      TRACE_ENTRIES,
      [{ field: 'sessionId', value: sessionId }],
      ADMIN_LIST_LIMIT,
    ))
      .filter((entry) => isWeeklyPlanningTraceEntryId(
        entry.id,
        sessionId,
        typeof entry.sequence === 'number' ? entry.sequence : undefined,
      ))
      .sort((left, right) => Number(left.sequence) - Number(right.sequence))
      .map((entry) => ({ ...entry, sessionId }));
  } else {
    const rawEntryCount = target.entryCount;
    const entryCount = typeof rawEntryCount === 'number' && Number.isFinite(rawEntryCount)
      ? Math.max(0, Math.min(ADMIN_LIST_LIMIT, Math.trunc(rawEntryCount)))
      : 0;
    entries = (await Promise.all(
      Array.from({ length: entryCount }, (_, sequence) =>
        firestore.getDocument(
          TRACE_ENTRIES,
          `${sessionId}-${String(sequence).padStart(8, '0')}`,
        )),
    ))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({ ...entry, sessionId }));
  }
  return ok({ entries: safeWeeklyPlanningTraceDocumentsForAdmin(entries) });
"""
replace_once(api, old_admin_entries, new_admin_entries)
# Apply the same strict session-id guard to archive, which contains an identical snippet.
api_text = read(api)
archive_old = """  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
"""
archive_new = """  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  if (!isWeeklyPlanningTraceSessionId(sessionId)) return error(400, 'sessionId is invalid');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
"""
if archive_old not in api_text:
    raise RuntimeError('archive session-id guard target was not found')
write(api, api_text.replace(archive_old, archive_new, 1))

privacy_test = Path('workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts')
privacy_test_text = read(privacy_test)
privacy_test_text = privacy_test_text.replace("'session-1'", "'weekly-trace-123e4567-e89b-12d3-a456-426614174000'")
privacy_test_text = privacy_test_text.replace("'session-2'", "'weekly-trace-223e4567-e89b-12d3-a456-426614174000'")
privacy_test_text = privacy_test_text.replace("'conversation-1'", "'weekly-conversation-323e4567-e89b-12d3-a456-426614174000'")
privacy_test_text = privacy_test_text.replace("'entry-1'", "'weekly-trace-123e4567-e89b-12d3-a456-426614174000-00000000'")
privacy_test_text = privacy_test_text.replace(
    """        status: 'active',
      },
      entries: [{
""",
    """        status: 'active',
        entryCount: 1,
      },
      entries: [{
""",
)
privacy_test_text = privacy_test_text.replace(
    """        userId: 'firebase-user-123',
        kind: 'turn',
""",
    """        userId: 'firebase-user-123',
        logicalConversationId: 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000',
        sequence: 0,
        kind: 'turn',
""",
)
privacy_test_text = privacy_test_text.replace(
    """      session: { id: 'weekly-trace-123e4567-e89b-12d3-a456-426614174000' },
      entries: [{ id: 'weekly-trace-123e4567-e89b-12d3-a456-426614174000-00000000', sessionId: 'weekly-trace-223e4567-e89b-12d3-a456-426614174000' }],
""",
    """      session: {
        id: 'weekly-trace-123e4567-e89b-12d3-a456-426614174000',
        logicalConversationId: 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000',
        entryCount: 1,
      },
      entries: [{
        id: 'weekly-trace-123e4567-e89b-12d3-a456-426614174000-00000000',
        sessionId: 'weekly-trace-223e4567-e89b-12d3-a456-426614174000',
        logicalConversationId: 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000',
        sequence: 0,
      }],
""",
)
write(privacy_test, privacy_test_text)

structural = Path('workers/ai-proxy/src/weeklyPlanningTraceStructuralIds.test.ts')
structural_text = read(structural)
structural_text = structural_text.replace(
    """        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
""",
    """        logicalConversationId: CONVERSATION_ID,
        entryCount: 1,
        userId: 'firebase-user-123',
""",
)
structural_text = structural_text.replace(
    """        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
      }],
""",
    """        logicalConversationId: CONVERSATION_ID,
        sequence: 0,
        userId: 'firebase-user-123',
      }],
""",
)
structural_text = structural_text.replace(
    """  it('preserves distinct admin lookup handles instead of collapsing UUIDs', () => {
""",
    """  it('rejects arbitrary or inconsistent structural identifiers at the write boundary', () => {
    expect(() => prepareWeeklyPlanningTraceWrite({
      session: { id: 'john-smith-09012345678', logicalConversationId: CONVERSATION_ID, entryCount: 0 },
      entries: [],
    }, { token: 'wpt_subject', epoch: '100' })).toThrow(/session id is invalid/);

    expect(() => prepareWeeklyPlanningTraceWrite({
      session: { id: SESSION_ID, logicalConversationId: CONVERSATION_ID, entryCount: 1 },
      entries: [{
        id: `${SESSION_ID}-00000001`,
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        sequence: 0,
      }],
    }, { token: 'wpt_subject', epoch: '100' })).toThrow(/entry id is invalid/);
  });

  it('preserves distinct admin lookup handles instead of collapsing UUIDs', () => {
""",
)
structural_text = structural_text.replace(
    """    expect(JSON.stringify(documents)).not.toContain('traceSubjectToken');
  });
""",
    """    expect(JSON.stringify(documents)).not.toContain('traceSubjectToken');
    expect(safeWeeklyPlanningTraceDocumentsForAdmin([{
      id: 'john-smith-09012345678',
      logicalConversationId: 'john-smith-09012345678',
    }])).toEqual([{}]);
  });
""",
)
write(structural, structural_text)

admin_test = Path('workers/ai-proxy/src/weeklyPlanningTraceAdmin.integration.test.ts')
admin_text = read(admin_test)
admin_text = admin_text.replace("    entryCount: 2,\n", "    entryCount: 2,\n    storageLayoutVersion: 1,\n")
admin_text = admin_text.replace(
    """      if (collection === 'weekly_planning_trace_entries') {
        const entry = entryDocuments.get(id);
        return entry ? { ...entry } : null;
      }
""",
    """      if (collection === 'weekly_planning_trace_entries') {
        throw new Error('current layout must use a bounded session query');
      }
""",
)
admin_text = admin_text.replace(
    """      if (collection === 'weekly_planning_trace_entries') {
        throw new Error('legacy sessionId query path must not be used');
      }
""",
    """      if (collection === 'weekly_planning_trace_entries') {
        return Array.from(entryDocuments.values()).map((entry) => ({ ...entry }));
      }
""",
)
write(admin_test, admin_text)

print('stage2 patch prepared')
