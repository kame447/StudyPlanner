from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:180]!r}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts',
    """  async setImmutableDocument(
""",
    """  async setDocumentWithMaximumInteger(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    fieldPath: string,
    maximum: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new Error('Firestore maximum integer is invalid');
    }
    const baseValue = { ...value };
    delete baseValue[fieldPath];
    await this.setDocument(collection, id, baseValue, Object.keys(baseValue));

    const documentName = [
      'projects',
      this.projectId(),
      'databases',
      '(default)',
      'documents',
      collection,
      id,
    ].join('/');
    const response = await this.request(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId())}/databases/(default)/documents:commit`,
      {
        method: 'POST',
        body: JSON.stringify({
          writes: [{
            transform: {
              document: documentName,
              fieldTransforms: [{
                fieldPath,
                maximum: { integerValue: String(maximum) },
              }],
            },
          }],
        }),
      },
    );
    if (!response.ok) throw new Error(`Firestore maximum transform failed: ${response.status}`);
  }

  async setImmutableDocument(
""",
)

replace_once(
    'workers/ai-proxy/src/weeklyPlanningTraceApi.ts',
    """async function handleAppend(
""",
    """function traceSessionConflict(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string | null {
  if (!existing) return null;
  if (existing.traceSubjectToken !== next.traceSubjectToken) {
    return 'trace session ownership conflict';
  }
  if (existing.logicalConversationId !== next.logicalConversationId) {
    return 'trace session conversation conflict';
  }
  const oldCount = existing.entryCount;
  const nextCount = next.entryCount;
  if (typeof oldCount === 'number'
    && typeof nextCount === 'number'
    && nextCount < oldCount) {
    return 'trace session entryCount conflict';
  }
  return null;
}

function mergeTraceSession(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = {
    ...(existing ?? {}),
    ...next,
    storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
    ...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
  };
  delete merged.userId;
  return merged;
}

async function handleAppend(
""",
)

replace_once(
    'workers/ai-proxy/src/weeklyPlanningTraceApi.ts',
    """  const sessionId = String(prepared.session.id);
  const existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (
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
    """  const sessionId = String(prepared.session.id);
  let existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  let conflict = traceSessionConflict(existingSession, prepared.session);
  if (conflict) return error(409, conflict);

  let mergedSession = mergeTraceSession(existingSession, prepared.session);
  if (!existingSession) {
    try {
      await firestore.setImmutableDocument(TRACE_SESSIONS, sessionId, {
        ...mergedSession,
        entryCount: 0,
      });
    } catch (caught) {
      if (!(caught instanceof Error)
        || !caught.message.includes('immutable trace document conflict')) {
        throw caught;
      }
      existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
      if (!existingSession) throw caught;
      conflict = traceSessionConflict(existingSession, prepared.session);
      if (conflict) return error(409, conflict);
      mergedSession = mergeTraceSession(existingSession, prepared.session);
    }
  }

  for (const entry of prepared.entries) {
    await firestore.setImmutableDocument(TRACE_ENTRIES, String(entry.id), entry);
  }
  await firestore.setDocumentWithMaximumInteger(
    TRACE_SESSIONS,
    sessionId,
    mergedSession,
    'entryCount',
    Number(prepared.session.entryCount),
  );
""",
)

firestore_test = Path('workers/ai-proxy/src/weeklyPlanningTraceFirestore.integration.test.ts')
text = firestore_test.read_text()
anchor = """  it('uses the Firestore document path ID instead of redacted structural fields for get and query', async () => {
"""
addition = """  it('preserves entryCount during metadata PATCH and applies an atomic maximum transform', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes(`/weekly_planning_trace_sessions/${encodeURIComponent(SESSION_ID)}?`)) {
        expect(init?.method).toBe('PATCH');
        expect(url).not.toContain('updateMask.fieldPaths=entryCount');
        const body = JSON.parse(String(init?.body)) as {
          fields: Record<string, unknown>;
        };
        expect(body.fields.entryCount).toBeUndefined();
        return new Response('{}', { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as {
          writes: Array<{
            transform: {
              document: string;
              fieldTransforms: Array<{
                fieldPath: string;
                maximum: { integerValue: string };
              }>;
            };
          }>;
        };
        expect(body.writes[0]?.transform.document).toContain(SESSION_ID);
        expect(body.writes[0]?.transform.fieldTransforms).toEqual([{
          fieldPath: 'entryCount',
          maximum: { integerValue: '7' },
        }]);
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setDocumentWithMaximumInteger(
      'weekly_planning_trace_sessions',
      SESSION_ID,
      {
        id: SESSION_ID,
        logicalConversationId: 'weekly-conversation-223e4567-e89b-12d3-a456-426614174000',
        entryCount: 7,
      },
      'entryCount',
      7,
    )).resolves.toBeUndefined();
  });

"""
if anchor not in text:
    raise RuntimeError('Firestore concurrency test anchor not found')
firestore_test.write_text(text.replace(anchor, addition + anchor, 1))
