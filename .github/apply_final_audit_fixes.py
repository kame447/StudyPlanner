from pathlib import Path


def strip_script_indent(value: str) -> str:
    return '\n'.join(line[10:] if line.startswith('          ') else line for line in value.splitlines())


candidate = Path('src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts')
text = candidate.read_text()
old = "new RegExp(`${hour}\\s*時(?!\\s*\\d+\\s*分)`).test(normalized)"
new = "new RegExp(\n      `${hour}\\s*時(?:\\s*0{1,2}\\s*分|(?!\\s*\\d+\\s*分))`,\n    ).test(normalized)"
if text.count(old) != 1:
    raise SystemExit(f'minute grounding expression count={text.count(old)}')
text = text.replace(old, new, 1)
start = text.index('function mentionedFieldOrder(')
end_marker = '\n}\n\nfunction lifeConstraintKindGrounded'
end = text.index(end_marker, start) + 3
replacement = strip_script_indent('''interface PriorityRelation {
          before: string;
          after: string;
        }

        function explicitPriorityRelations(userText: string, knownFields: string[]): PriorityRelation[] {
          const normalized = normalizedEvidence(userText);
          const relations: PriorityRelation[] = [];
          const keys = new Set<string>();
          const addRelation = (before: string, after: string) => {
            const key = `${before}\\u0000${after}`;
            if (before !== after && !keys.has(key)) {
              keys.add(key);
              relations.push({ before, after });
            }
          };

          for (let leftIndex = 0; leftIndex < knownFields.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < knownFields.length; rightIndex += 1) {
              const left = knownFields[leftIndex];
              const right = knownFields[rightIndex];
              const leftPattern = escapeRegExp(normalizedEvidence(left));
              const rightPattern = escapeRegExp(normalizedEvidence(right));
              const leftBeforeRight = [
                new RegExp(`${rightPattern}より(?:も)?${leftPattern}を?(?:先に|優先)`),
                new RegExp(`${leftPattern}を?${rightPattern}より(?:も)?(?:先に|優先)`),
                new RegExp(`${rightPattern}の(?:前|まえ)に${leftPattern}`),
                new RegExp(`${leftPattern}の(?:後|あと)に${rightPattern}`),
              ].some((pattern) => pattern.test(normalized));
              const rightBeforeLeft = [
                new RegExp(`${leftPattern}より(?:も)?${rightPattern}を?(?:先に|優先)`),
                new RegExp(`${rightPattern}を?${leftPattern}より(?:も)?(?:先に|優先)`),
                new RegExp(`${leftPattern}の(?:前|まえ)に${rightPattern}`),
                new RegExp(`${rightPattern}の(?:後|あと)に${leftPattern}`),
              ].some((pattern) => pattern.test(normalized));

              if (leftBeforeRight && !rightBeforeLeft) addRelation(left, right);
              if (rightBeforeLeft && !leftBeforeRight) addRelation(right, left);
            }
          }
          return relations;
        }

        function applyPriorityRelations(
          mentionedFields: string[],
          relations: PriorityRelation[],
        ): string[] {
          const mentionedSet = new Set(mentionedFields);
          const outgoing = new Map<string, Set<string>>(
            mentionedFields.map((field) => [field, new Set<string>()]),
          );
          const indegree = new Map<string, number>(mentionedFields.map((field) => [field, 0]));

          relations.forEach(({ before, after }) => {
            if (!mentionedSet.has(before) || !mentionedSet.has(after)) return;
            const targets = outgoing.get(before);
            if (!targets || targets.has(after)) return;
            targets.add(after);
            indegree.set(after, (indegree.get(after) ?? 0) + 1);
          });

          const ordered: string[] = [];
          const selected = new Set<string>();
          while (ordered.length < mentionedFields.length) {
            const next = mentionedFields.find((field) =>
              !selected.has(field) && (indegree.get(field) ?? 0) === 0);
            if (!next) return mentionedFields;
            selected.add(next);
            ordered.push(next);
            outgoing.get(next)?.forEach((target) => {
              indegree.set(target, (indegree.get(target) ?? 0) - 1);
            });
          }
          return ordered;
        }

        function mentionedFieldOrder(userText: string, knownFields: string[]): string[] {
          const normalized = normalizedEvidence(userText);
          const mentionedFields = knownFields
            .map((field) => ({ field, index: normalized.indexOf(normalizedEvidence(field)) }))
            .filter((item) => item.index >= 0)
            .sort((left, right) => left.index - right.index)
            .map((item) => item.field);
          return applyPriorityRelations(
            mentionedFields,
            explicitPriorityRelations(userText, knownFields),
          );
        }''')
text = text[:start] + replacement + text[end:]
candidate.write_text(text)

life = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningLifeConstraintGrounding.audit.test.ts')
text = life.read_text()
if 'accepts explicitly written zero minutes' not in text:
    marker = '  it.each([\n'
    addition = strip_script_indent('''  it('accepts explicitly written zero minutes as the exact whole-hour range', () => {
          const result = validateInterpretedCandidates([
            sleepCandidate('23時00分から7時00分まで寝ます', '23:00', '07:00'),
          ], EMPTY_SUMMARY);

          expect(result.accepted).toHaveLength(1);
          expect(result.rejected).toEqual([]);
        });

        ''') + '\n'
    life.write_text(text.replace(marker, addition + marker, 1))

priority = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningCandidateAuditHardening.test.ts')
text = priority.read_text()
if 'accepts comparative priority wording' not in text:
    addition = strip_script_indent('''
          it('accepts comparative priority wording according to its semantic relation', () => {
            const userText = 'OSよりネットワークを先にして、最後にデータベースを進めたいです';
            const result = validateInterpretedCandidates([
              candidate({
                type: 'set_priority_policy',
                policy: { kind: 'field_first', order: ['ネットワーク', 'OS', 'データベース'] },
                confidence: 'high',
                sourceText: userText,
              }, userText),
            ], summary({ knownFields: ['OS', 'ネットワーク', 'データベース'] }));

            expect(result.accepted).toHaveLength(1);
            expect(result.rejected).toEqual([]);
          });

          it('rejects literal mention order when comparative wording requires the reverse relation', () => {
            const userText = 'OSよりネットワークを先にして、最後にデータベースを進めたいです';
            const result = validateInterpretedCandidates([
              candidate({
                type: 'set_priority_policy',
                policy: { kind: 'field_first', order: ['OS', 'ネットワーク', 'データベース'] },
                confidence: 'high',
                sourceText: userText,
              }, userText),
            ], summary({ knownFields: ['OS', 'ネットワーク', 'データベース'] }));

            expect(result.accepted).toEqual([]);
            expect(result.rejected).toHaveLength(1);
          });
        ''')
    head, separator, tail = text.rpartition('\n});')
    priority.write_text(head + addition + separator + tail)

privacy = Path('workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts')
text = privacy.read_text()
if 'function requireTraceSessionSchema' not in text:
    helpers = strip_script_indent('''const TRACE_SESSION_STATUSES = new Set(['active', 'completed', 'abandoned', 'failed']);
          const TRACE_RESPONSE_SOURCES = new Set(['ai', 'deterministic_fallback', 'rules', 'system']);
          const TRACE_EVENT_TYPES = new Set([
            'user_turn_received', 'interpreter_started', 'interpreter_completed',
            'candidate_accepted', 'candidate_rejected', 'assumption_proposed',
            'assumption_accepted', 'assumption_rejected', 'assumption_superseded',
            'correction_applied', 'correction_rejected', 'relative_constraint_resolved',
            'relative_constraint_rejected', 'readiness_evaluated', 'feasibility_evaluated',
            'dialogue_planned', 'fallback_used', 'preview_gate_evaluated',
            'preview_generated', 'preview_rejected_stale',
            'preview_rejected_pending_assumption', 'draft_promoted', 'approval_started',
            'approval_item_saved', 'approval_item_failed', 'approval_completed',
            'request_cancelled', 'stale_async_result_discarded', 'trace_write_failed',
          ]);
          const TRACE_SEVERITIES = new Set(['debug', 'info', 'warn', 'error']);
          const TRACE_SNAPSHOT_REASONS = new Set([
            'turn_completed', 'correction_applied', 'preview_generated',
            'approval_started', 'approval_completed', 'error', 'manual_capture',
          ]);

          function isIsoTimestamp(value: unknown): value is string {
            if (typeof value !== 'string') return false;
            const time = new Date(value).getTime();
            return Number.isFinite(time) && new Date(time).toISOString() === value;
          }

          function isNonNegativeInteger(value: unknown): value is number {
            return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
          }

          function requireTraceSessionSchema(session: Record<string, unknown>): void {
            const valid = TRACE_SESSION_STATUSES.has(String(session.status))
              && isIsoTimestamp(session.startedAt)
              && isIsoTimestamp(session.lastActivityAt)
              && (session.endedAt === undefined || isIsoTimestamp(session.endedAt))
              && (session.archivedAt === undefined || isIsoTimestamp(session.archivedAt))
              && (session.planningRangeStart === undefined || isIsoTimestamp(session.planningRangeStart))
              && (session.planningRangeEnd === undefined || isIsoTimestamp(session.planningRangeEnd))
              && isNonNegativeInteger(session.turnCount)
              && typeof session.hasPreview === 'boolean'
              && typeof session.hasApprovalFailure === 'boolean'
              && typeof session.hasFallback === 'boolean'
              && typeof session.hasError === 'boolean'
              && typeof session.appVersion === 'string'
              && session.appVersion.trim().length > 0
              && typeof session.schemaVersion === 'number'
              && Number.isSafeInteger(session.schemaVersion)
              && session.schemaVersion >= 1;
            if (!valid) throw new Error('trace session schema is invalid');
          }

          function requireTraceEntrySchema(entry: Record<string, unknown>): void {
            const validBase = isIsoTimestamp(entry.occurredAt)
              && isIsoTimestamp(entry.observedAt)
              && typeof entry.schemaVersion === 'number'
              && Number.isSafeInteger(entry.schemaVersion)
              && entry.schemaVersion >= 1
              && (entry.requestId === undefined || typeof entry.requestId === 'string')
              && (entry.stateRevision === undefined || isNonNegativeInteger(entry.stateRevision));
            if (!validBase) throw new Error('trace entry schema is invalid');
            if (entry.kind === 'turn') {
              const validSource = TRACE_RESPONSE_SOURCES.has(String(entry.responseSource));
              const validTurn = (entry.role === 'user' || entry.role === 'assistant')
                && typeof entry.content === 'string'
                && isNonNegativeInteger(entry.turnIndex)
                && (entry.role === 'assistant' ? validSource : entry.responseSource === undefined);
              if (!validTurn) throw new Error('trace turn entry schema is invalid');
              return;
            }
            if (entry.kind === 'internal_event') {
              const validEvent = Object.prototype.hasOwnProperty.call(entry, 'payload')
                && entry.payload !== undefined
                && TRACE_EVENT_TYPES.has(String(entry.eventType))
                && TRACE_SEVERITIES.has(String(entry.severity));
              if (!validEvent) throw new Error('trace internal event entry schema is invalid');
              return;
            }
            if (entry.kind === 'state_snapshot') {
              const validSnapshot = Object.prototype.hasOwnProperty.call(entry, 'state')
                && entry.state !== undefined
                && TRACE_SNAPSHOT_REASONS.has(String(entry.snapshotReason));
              if (!validSnapshot) throw new Error('trace state snapshot entry schema is invalid');
              return;
            }
            throw new Error('trace entry kind is invalid');
          }

          ''')
    text = text.replace('function preparedDocument(\n', helpers + 'function preparedDocument(\n', 1)
text = text.replace(
    '  const entryCount = requireTraceEntryCount(input.session.entryCount);\n',
    '  const entryCount = requireTraceEntryCount(input.session.entryCount);\n  requireTraceSessionSchema(input.session);\n',
    1,
)
entry_marker = "    if (entryConversationId !== logicalConversationId) {\n      throw new Error('trace entry conversation mismatch');\n    }\n"
text = text.replace(entry_marker, entry_marker + '    requireTraceEntrySchema(entry);\n', 1)
privacy.write_text(text)

privacy_test = Path('workers/ai-proxy/src/weeklyPlanningTracePrivacy.test.ts')
text = privacy_test.read_text()
marker = "function serialized(value: unknown): string {\n  return JSON.stringify(value);\n}\n"
helpers = strip_script_indent('''

          const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
          const CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000';
          const OCCURRED_AT = '2026-07-18T00:00:00.000Z';

          function validSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
            return {
              id: SESSION_ID, logicalConversationId: CONVERSATION_ID, status: 'active',
              startedAt: OCCURRED_AT, lastActivityAt: OCCURRED_AT, turnCount: 1, entryCount: 1,
              hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false,
              appVersion: 'test', schemaVersion: 1, ...overrides,
            };
          }

          function validTurnEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
            return {
              id: `${SESSION_ID}-00000000`, sessionId: SESSION_ID,
              logicalConversationId: CONVERSATION_ID, sequence: 0,
              occurredAt: OCCURRED_AT, observedAt: OCCURRED_AT, schemaVersion: 1,
              kind: 'turn', role: 'user', content: 'hello', turnIndex: 0, ...overrides,
            };
          }
        ''')
text = text.replace(marker, marker + helpers, 1)
start = text.index("  it('prepares session and entry documents without raw account identifiers'")
call_start = text.index('    const prepared = prepareWeeklyPlanningTraceWrite({', start)
call_end_marker = "    }, subject, '2026-07-18T00:00:00.000Z');"
call_end = text.index(call_end_marker, call_start) + len(call_end_marker)
replacement = strip_script_indent('''    const prepared = prepareWeeklyPlanningTraceWrite({
          session: validSession({ userId: 'firebase-user-123' }),
          entries: [validTurnEntry({ userId: 'firebase-user-123', content: 'person@example.com' })],
        }, subject, '2026-07-18T00:00:00.000Z');''')
text = text[:call_start] + replacement + text[call_end:]
start = text.index("  it('requires matching entry ownership and the current policy version'")
expect_start = text.index('    expect(() => prepareWeeklyPlanningTraceWrite({', start)
expect_end_marker = "    }, { token: 'wpt_token', epoch: '100' })).toThrow(/session mismatch/);"
expect_end = text.index(expect_end_marker, expect_start) + len(expect_end_marker)
replacement = strip_script_indent('''    expect(() => prepareWeeklyPlanningTraceWrite({
          session: validSession(),
          entries: [validTurnEntry({
            sessionId: 'weekly-trace-223e4567-e89b-12d3-a456-426614174000',
          })],
        }, { token: 'wpt_token', epoch: '100' })).toThrow(/session mismatch/);''')
text = text[:expect_start] + replacement + text[expect_end:]
tests = strip_script_indent('''

          it('rejects missing or invalid session schema at the write boundary', () => {
            expect(() => prepareWeeklyPlanningTraceWrite({
              session: validSession({ status: 'unknown' }), entries: [validTurnEntry()],
            }, { token: 'wpt_token', epoch: '100' })).toThrow(/session schema/);
            expect(() => prepareWeeklyPlanningTraceWrite({
              session: validSession({ startedAt: 'not-a-date' }), entries: [validTurnEntry()],
            }, { token: 'wpt_token', epoch: '100' })).toThrow(/session schema/);
          });

          it.each([
            ['invalid turn role', { role: 'admin' }],
            ['non-string turn content', { content: 123 }],
            ['unknown internal event', { kind: 'internal_event', eventType: 'unknown', payload: {}, severity: 'info' }],
            ['snapshot without state', { kind: 'state_snapshot', snapshotReason: 'manual_capture', state: undefined }],
          ])('rejects %s at the server write boundary', (_label, overrides) => {
            expect(() => prepareWeeklyPlanningTraceWrite({
              session: validSession(), entries: [validTurnEntry(overrides)],
            }, { token: 'wpt_token', epoch: '100' })).toThrow(/entry/);
          });
        ''')
head, separator, tail = text.rpartition('\n});')
privacy_test.write_text(head + tests + separator + tail)

for name in ['focused-regressions.log', 'full-tests.log', 'full-build.log', 'full-diff.log']:
    path = Path(name)
    if path.exists():
        path.unlink()
