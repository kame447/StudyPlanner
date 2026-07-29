import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createWeeklyPlanningTraceAdminDiagnostics,
  hasArchivedWeeklyPlanningTraceActivity,
  hasUnexportedWeeklyPlanningTraceActivity,
  hasWeeklyPlanningTraceActivity,
} from './weeklyPlanningTraceArchive';
import { weeklyPlanningTraceLocalDate } from './weeklyPlanningTraceDate';
import { createWeeklyPlanningTraceExportBundle } from './weeklyPlanningTraceExport';
import { getWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceAdminDiagnostics,
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceSessionStatus,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

interface WeeklyPlanningTraceDebugPageProps {
  onBack: () => void;
}

type TraceViewMode = 'conversation' | 'events' | 'snapshots' | 'raw';
type SessionListMode = 'unexported' | 'archived' | 'empty';

const EMPTY_DIAGNOSTICS: WeeklyPlanningTraceAdminDiagnostics = {
  rawCount: 0,
  mappedCount: 0,
  malformedCount: 0,
  activityCount: 0,
  emptyCount: 0,
  unexportedCount: 0,
};

const STATUS_OPTIONS: Array<{ value: '' | WeeklyPlanningTraceSessionStatus; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'active', label: 'active' },
  { value: 'completed', label: 'completed' },
  { value: 'abandoned', label: 'abandoned' },
  { value: 'failed', label: 'failed' },
];

const VIEW_MODES: Array<{ value: TraceViewMode; label: string }> = [
  { value: 'conversation', label: 'Conversation' },
  { value: 'events', label: 'Events' },
  { value: 'snapshots', label: 'State diff' },
  { value: 'raw', label: 'Raw JSON' },
];

const SESSION_LIST_MODES: Array<{ value: SessionListMode; label: string; heading: string }> = [
  { value: 'unexported', label: '未export', heading: '未exportの活動があるSessions' },
  { value: 'archived', label: 'アーカイブ済み', heading: 'アーカイブ済みSessions' },
  { value: 'empty', label: 'Empty', heading: 'Empty Sessions' },
];

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ errorCode: 'trace-payload-not-serializable' }, null, 2);
  }
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}

function planningRangeLabel(session: WeeklyPlanningTraceSession): string | null {
  if (!session.planningRangeStart && !session.planningRangeEnd) return null;
  return `${session.planningRangeStart ?? '未設定'} - ${session.planningRangeEnd ?? '未設定'}`;
}

function isDiagnostic(
  entry: WeeklyPlanningTraceEntry,
): entry is WeeklyPlanningTraceTurnDiagnosticEntry {
  return entry.kind === 'turn_diagnostic';
}

function includesStaleEvent(entries: readonly WeeklyPlanningTraceEntry[]): boolean {
  return entries.some((entry) => isDiagnostic(entry)
    ? entry.diagnostics.stale
    : entry.kind === 'internal_event' && (
      entry.eventType === 'stale_async_result_discarded'
      || entry.eventType === 'preview_rejected_stale'
      || (entry.eventType === 'preview_gate_evaluated'
        && safeJson(entry.payload).toLowerCase().includes('stale'))
    ));
}

function entriesForMode(
  entries: readonly WeeklyPlanningTraceEntry[],
  mode: TraceViewMode,
): WeeklyPlanningTraceEntry[] {
  if (mode === 'conversation') {
    return entries.filter((entry) => entry.kind === 'turn' || isDiagnostic(entry));
  }
  if (mode === 'events') {
    return entries.filter((entry) => entry.kind === 'internal_event' || isDiagnostic(entry));
  }
  if (mode === 'snapshots') {
    return entries.filter((entry) => entry.kind === 'state_snapshot' || isDiagnostic(entry));
  }
  return [];
}

function entryTitle(entry: WeeklyPlanningTraceEntry, mode: TraceViewMode): string {
  if (isDiagnostic(entry)) {
    if (mode === 'conversation') return `turn ${entry.turnIndex} conversation`;
    if (mode === 'snapshots') return `turn ${entry.turnIndex} state diff`;
    return `turn ${entry.turnIndex} AI / parser / decision`;
  }
  if (entry.kind === 'turn') return `${entry.role} turn`;
  if (entry.kind === 'internal_event') return entry.eventType;
  return `snapshot: ${entry.snapshotReason}`;
}

function diagnosticEventBody(entry: WeeklyPlanningTraceTurnDiagnosticEntry): unknown {
  return {
    aiInterpreter: entry.aiInterpreter,
    parsers: entry.parsers,
    decision: entry.decision,
    constraintContext: entry.constraintContext,
    diagnostics: entry.diagnostics,
  };
}

function legacyEntryBody(entry: WeeklyPlanningTraceEntry): unknown {
  if (entry.kind === 'turn') return entry.content;
  if (entry.kind === 'internal_event') return entry.payload;
  if (entry.kind === 'state_snapshot') return entry.state;
  return entry;
}

function sessionMatchesListMode(
  session: WeeklyPlanningTraceSession,
  mode: SessionListMode,
): boolean {
  if (mode === 'empty') return !hasWeeklyPlanningTraceActivity(session);
  if (mode === 'archived') return hasArchivedWeeklyPlanningTraceActivity(session);
  return hasUnexportedWeeklyPlanningTraceActivity(session);
}

function sessionListHeading(mode: SessionListMode): string {
  return SESSION_LIST_MODES.find((option) => option.value === mode)?.heading
    ?? '週間計画Sessions';
}

function exportButtonLabel(session: WeeklyPlanningTraceSession, exporting: boolean): string {
  if (exporting) return 'export中...';
  if (hasArchivedWeeklyPlanningTraceActivity(session)) return 'JSONを再エクスポート';
  if (session.archivedAt) return 'JSON exportして再アーカイブ';
  return 'JSON exportしてアーカイブ';
}

export function WeeklyPlanningTraceDebugPage({
  onBack,
}: WeeklyPlanningTraceDebugPageProps) {
  const [sessions, setSessions] = useState<WeeklyPlanningTraceSession[]>([]);
  const [diagnostics, setDiagnostics] = useState(EMPTY_DIAGNOSTICS);
  const [entriesBySession, setEntriesBySession] = useState<
    Record<string, WeeklyPlanningTraceEntry[]>
  >({});
  const [entryErrorsBySession, setEntryErrorsBySession] = useState<Record<string, string>>({});
  const [expandedSessionId, setExpandedSessionId] = useState('');
  const [viewMode, setViewMode] = useState<TraceViewMode>('conversation');
  const [sessionListMode, setSessionListMode] = useState<SessionListMode>('unexported');
  const [statusFilter, setStatusFilter] = useState<'' | WeeklyPlanningTraceSessionStatus>('');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyFallbacks, setOnlyFallbacks] = useState(false);
  const [onlyPreviews, setOnlyPreviews] = useState(false);
  const [onlyApprovalFailures, setOnlyApprovalFailures] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingEntriesSessionId, setLoadingEntriesSessionId] = useState('');
  const [exportingSessionId, setExportingSessionId] = useState('');
  const [error, setError] = useState('');

  async function loadSessions(): Promise<void> {
    setLoadingSessions(true);
    setError('');
    try {
      const repository = getWeeklyPlanningTraceRepository();
      const result = repository.listSessionsForAdminWithDiagnostics
        ? await repository.listSessionsForAdminWithDiagnostics()
        : await repository.listSessionsForAdmin().then((listed) => ({
            sessions: listed,
            diagnostics: createWeeklyPlanningTraceAdminDiagnostics({
              rawCount: listed.length,
              mappedSessions: listed,
            }),
          }));
      setSessions(result.sessions);
      setDiagnostics(result.diagnostics);
      setExpandedSessionId((current) =>
        current && result.sessions.some((session) => session.id === current) ? current : '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'sessionを取得できませんでした。');
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadEntries(session: WeeklyPlanningTraceSession): Promise<WeeklyPlanningTraceEntry[]> {
    const cached = entriesBySession[session.id];
    if (cached) return cached;
    setLoadingEntriesSessionId(session.id);
    setEntryErrorsBySession((current) => {
      const next = { ...current };
      delete next[session.id];
      return next;
    });
    try {
      const nextEntries = await getWeeklyPlanningTraceRepository().listEntries(
        session.userId,
        session.id,
      );
      setEntriesBySession((current) => ({ ...current, [session.id]: nextEntries }));
      return nextEntries;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'traceを取得できませんでした。';
      setEntryErrorsBySession((current) => ({ ...current, [session.id]: message }));
      throw loadError;
    } finally {
      setLoadingEntriesSessionId((current) => current === session.id ? '' : current);
    }
  }

  function toggleSession(session: WeeklyPlanningTraceSession): void {
    if (expandedSessionId === session.id) {
      setExpandedSessionId('');
      return;
    }
    setExpandedSessionId(session.id);
    setViewMode('conversation');
    void loadEntries(session).catch(() => undefined);
  }

  async function exportSession(session: WeeklyPlanningTraceSession): Promise<void> {
    const archiveAfterExport = !hasArchivedWeeklyPlanningTraceActivity(session);
    setExportingSessionId(session.id);
    setError('');
    try {
      const entries = await loadEntries(session);
      downloadJson(
        `weekly-planning-trace-${session.id}.json`,
        createWeeklyPlanningTraceExportBundle(session, entries),
      );
      if (!archiveAfterExport) return;
      await getWeeklyPlanningTraceRepository().archiveSessionForAdmin(
        session.id,
        new Date().toISOString(),
      );
      await loadSessions();
      setEntriesBySession((current) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      });
      setExpandedSessionId('');
    } catch (exportError) {
      setError(exportError instanceof Error
        ? exportError.message
        : 'exportまたはアーカイブに失敗しました。');
    } finally {
      setExportingSessionId((current) => current === session.id ? '' : current);
    }
  }

  async function enableStaleFilter(checked: boolean): Promise<void> {
    setOnlyStale(checked);
    if (!checked) return;
    await Promise.all(sessions.map((session) => loadEntries(session))).catch(() => undefined);
  }

  const archivedCount = useMemo(
    () => sessions.filter(hasArchivedWeeklyPlanningTraceActivity).length,
    [sessions],
  );

  const visibleSessions = useMemo(() => sessions.filter((session) => {
    if (!sessionMatchesListMode(session, sessionListMode)) return false;
    if (statusFilter && session.status !== statusFilter) return false;
    const normalizedUserFilter = userFilter.trim().toLowerCase();
    if (normalizedUserFilter
      && !session.userId.toLowerCase().includes(normalizedUserFilter)
      && !session.logicalConversationId.toLowerCase().includes(normalizedUserFilter)) return false;
    const activityDate = weeklyPlanningTraceLocalDate(session.lastActivityAt);
    if (dateFrom && activityDate < dateFrom) return false;
    if (dateTo && activityDate > dateTo) return false;
    if (onlyErrors && !session.hasError) return false;
    if (onlyFallbacks && !session.hasFallback) return false;
    if (onlyPreviews && !session.hasPreview) return false;
    if (onlyApprovalFailures && !session.hasApprovalFailure) return false;
    if (onlyStale && !includesStaleEvent(entriesBySession[session.id] ?? [])) return false;
    return true;
  }), [
    dateFrom,
    dateTo,
    entriesBySession,
    onlyApprovalFailures,
    onlyErrors,
    onlyFallbacks,
    onlyPreviews,
    onlyStale,
    sessionListMode,
    sessions,
    statusFilter,
    userFilter,
  ]);

  return (
    <main className="admin-shell weekly-planning-trace-debug">
      <button className="ghost-button admin-back-button" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
        ユーザー一覧へ戻る
      </button>

      <header className="panel">
        <h1>週間計画ログ</h1>
        <p>schema v2は1ユーザーターンを1件の診断レコードとして表示します。旧sessionはlegacy traceとして読み取り専用で表示します。</p>
        <button className="ghost-button" type="button" disabled={loadingSessions} onClick={() => { void loadSessions(); }}>
          {loadingSessions ? '読込中...' : '再読込'}
        </button>
      </header>

      {error ? <div className="app-notice error">取得失敗: {error}</div> : null}

      <section className="panel" aria-label="trace診断件数">
        <h2>診断</h2>
        <p>
          raw {diagnostics.rawCount} / mapped {diagnostics.mappedCount} / malformed {diagnostics.malformedCount}
          {' / '}activity {diagnostics.activityCount} / empty {diagnostics.emptyCount}
          {' / '}unexported {diagnostics.unexportedCount} / archived {archivedCount}
          {' / '}rendered {visibleSessions.length}
        </p>
        <div className="segmented-control" aria-label="session表示区分">
          {SESSION_LIST_MODES.map((mode) => (
            <button key={mode.value} className={sessionListMode === mode.value ? 'segment active' : 'segment'} type="button" onClick={() => {
              setSessionListMode(mode.value);
              setExpandedSessionId('');
            }}>
              {mode.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Filter</h2>
        <div className="field-row">
          <label className="field">
            <span>User／conversation</span>
            <input value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="subject aliasまたはconversation ID" />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '' | WeeklyPlanningTraceSessionStatus)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field"><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label className="field"><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>
        <div className="field-row">
          <label><input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} /> errorあり</label>
          <label><input type="checkbox" checked={onlyFallbacks} onChange={(event) => setOnlyFallbacks(event.target.checked)} /> fallbackあり</label>
          <label><input type="checkbox" checked={onlyPreviews} onChange={(event) => setOnlyPreviews(event.target.checked)} /> previewあり</label>
          <label><input type="checkbox" checked={onlyApprovalFailures} onChange={(event) => setOnlyApprovalFailures(event.target.checked)} /> approval失敗あり</label>
          <label><input type="checkbox" checked={onlyStale} onChange={(event) => { void enableStaleFilter(event.target.checked); }} /> stale resultあり</label>
        </div>
      </section>

      <section className="weekly-planning-trace-stream" aria-label="週間計画ログ一覧">
        <div className="weekly-planning-trace-stream-heading">
          <h2>{sessionListHeading(sessionListMode)}</h2>
          <span>{visibleSessions.length}件</span>
        </div>

        {!error && !loadingSessions && visibleSessions.length === 0 ? <div className="panel admin-state-card"><strong>条件に一致するsessionはありません</strong></div> : null}

        {visibleSessions.map((session) => {
          const expanded = expandedSessionId === session.id;
          const entries = entriesBySession[session.id] ?? [];
          const entryError = entryErrorsBySession[session.id] ?? '';
          const loadingEntries = loadingEntriesSessionId === session.id;
          const exporting = exportingSessionId === session.id;
          const visibleEntries = entriesForMode(entries, viewMode);
          return (
            <article className="panel trace-session-panel" key={session.id}>
              <button className="trace-session-summary" type="button" aria-expanded={expanded} onClick={() => toggleSession(session)}>
                <span className="trace-session-summary-main">
                  <strong>{formattedDate(session.lastActivityAt)}</strong>
                  <span>{session.status} / logical turns {session.turnCount} / entries {session.entryCount} / schema {session.schemaVersion}</span>
                  <code>{session.userId}</code>
                  <small>conversation {session.logicalConversationId}</small>
                  {planningRangeLabel(session) ? <small>計画範囲 {planningRangeLabel(session)}</small> : null}
                </span>
                {expanded ? <ChevronUp aria-hidden="true" size={20} strokeWidth={2} /> : <ChevronDown aria-hidden="true" size={20} strokeWidth={2} />}
              </button>

              {expanded ? (
                <div className="trace-session-detail">
                  <div className="trace-session-actions">
                    <span>開始 {formattedDate(session.startedAt)}</span>
                    <button className="primary-button" type="button" disabled={exporting || loadingEntries} onClick={() => { void exportSession(session); }}>
                      {exportButtonLabel(session, exporting)}
                    </button>
                  </div>
                  <div className="segmented-control" aria-label="trace表示モード">
                    {VIEW_MODES.map((mode) => (
                      <button key={mode.value} className={viewMode === mode.value ? 'segment active' : 'segment'} type="button" onClick={() => setViewMode(mode.value)}>{mode.label}</button>
                    ))}
                  </div>
                  {loadingEntries ? <p>timelineを読み込んでいます...</p> : null}
                  {entryError ? <div className="app-notice error">entry取得失敗: {entryError}</div> : null}
                  {!loadingEntries && !entryError && entries.length === 0 ? <p>entryはありません。</p> : null}
                  {!entryError && viewMode === 'raw' && !loadingEntries ? (
                    <pre className="trace-entry">{safeJson(createWeeklyPlanningTraceExportBundle(session, entries))}</pre>
                  ) : (
                    <div className="weekly-planning-trace-entry-list">
                      {visibleEntries.map((entry) => (
                        <article className={`trace-entry trace-entry--${entry.kind}`} key={`${entry.id}:${viewMode}`}>
                          <header><strong>#{entry.sequence} {entryTitle(entry, viewMode)}</strong><span>{formattedDate(entry.occurredAt)}</span></header>
                          <small>request {entry.requestId ?? '-'}</small>
                          {isDiagnostic(entry) && viewMode === 'conversation' ? (
                            <>
                              <p><strong>user:</strong> {entry.userInput.text}</p>
                              <p><strong>assistant:</strong> {entry.assistantOutput.text ?? '(no assistant output)'}</p>
                            </>
                          ) : isDiagnostic(entry) && viewMode === 'events' ? (
                            <pre>{safeJson(diagnosticEventBody(entry))}</pre>
                          ) : isDiagnostic(entry) && viewMode === 'snapshots' ? (
                            <pre>{safeJson(entry.decision.stateDiff)}</pre>
                          ) : entry.kind === 'turn' ? (
                            <p>{entry.content}</p>
                          ) : (
                            <pre>{safeJson(legacyEntryBody(entry))}</pre>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
