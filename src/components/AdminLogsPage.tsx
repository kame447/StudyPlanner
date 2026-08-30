import { ChevronDown, ChevronUp, Download, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ObservabilityLogEntryPage,
  ObservabilityLogSessionSummary,
} from '../../shared/productObservabilityLogReadModel';
import {
  getAdminObservabilityDebugBundle,
  getAdminObservabilityLogEntries,
  getAdminObservabilityLogs,
} from '../services/adminObservabilityService';

const STATUS_OPTIONS = ['', 'active', 'completed', 'abandoned', 'failed'] as const;

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ error: 'detail is not serializable' }, null, 2);
  }
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filtersFromUrl(): { sessionId: string; status: string } {
  if (typeof window === 'undefined') return { sessionId: '', status: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    sessionId: params.get('session')?.trim() ?? '',
    status: params.get('status')?.trim() ?? '',
  };
}

function updateFilterUrl(sessionId: string, status: string): void {
  const params = new URLSearchParams(window.location.search);
  if (sessionId) params.set('session', sessionId); else params.delete('session');
  if (status) params.set('status', status); else params.delete('status');
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function sessionSignalLabel(session: ObservabilityLogSessionSummary): string {
  if (session.hasError) return 'errorあり';
  if (session.hasApprovalFailure) return 'approval failureあり';
  if (session.hasFallback) return 'fallbackあり';
  return session.hasPreview ? 'preview到達' : 'traceあり';
}

export function AdminLogsPage() {
  const initialFilters = useMemo(filtersFromUrl, []);
  const [sessionInput, setSessionInput] = useState(initialFilters.sessionId);
  const [statusInput, setStatusInput] = useState(initialFilters.status);
  const [appliedSession, setAppliedSession] = useState(initialFilters.sessionId);
  const [appliedStatus, setAppliedStatus] = useState(initialFilters.status);
  const [sessions, setSessions] = useState<ObservabilityLogSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [entriesBySession, setEntriesBySession] = useState<Record<string, ObservabilityLogEntryPage>>({});
  const [expandedSessionId, setExpandedSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState('');
  const [exportingKey, setExportingKey] = useState('');
  const [error, setError] = useState('');

  async function loadSessions(options: { append?: boolean; cursor?: string | null } = {}): Promise<void> {
    if (options.append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const page = await getAdminObservabilityLogs({
        cursor: options.cursor ?? null,
        limit: 25,
        status: appliedStatus || null,
        sessionId: appliedSession || null,
      });
      setSessions((current) => options.append ? [...current, ...page.sessions] : page.sessions);
      setNextCursor(page.nextCursor);
      if (!options.append) {
        setExpandedSessionId('');
        setEntriesBySession({});
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ログを取得できませんでした。');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  // Filters are committed explicitly by the apply action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSession, appliedStatus]);

  function applyFilters(): void {
    const nextSession = sessionInput.trim();
    const nextStatus = statusInput.trim();
    updateFilterUrl(nextSession, nextStatus);
    setAppliedSession(nextSession);
    setAppliedStatus(nextStatus);
  }

  function clearFilters(): void {
    setSessionInput('');
    setStatusInput('');
    updateFilterUrl('', '');
    setAppliedSession('');
    setAppliedStatus('');
  }

  async function loadEntries(sessionId: string, afterSequence?: number): Promise<void> {
    setLoadingEntries(sessionId);
    setError('');
    try {
      const page = await getAdminObservabilityLogEntries({
        sessionId,
        afterSequence,
        limit: 20,
      });
      setEntriesBySession((current) => {
        const previous = current[sessionId];
        if (!previous || afterSequence === undefined) return { ...current, [sessionId]: page };
        return {
          ...current,
          [sessionId]: {
            ...page,
            entries: [...previous.entries, ...page.entries],
          },
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '詳細ログを取得できませんでした。');
    } finally {
      setLoadingEntries((current) => current === sessionId ? '' : current);
    }
  }

  function toggleSession(sessionId: string): void {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId('');
      return;
    }
    setExpandedSessionId(sessionId);
    if (!entriesBySession[sessionId]) void loadEntries(sessionId);
  }

  async function exportBundle(sessionId: string, requestId?: string | null): Promise<void> {
    const key = `${sessionId}:${requestId ?? 'session'}`;
    setExportingKey(key);
    setError('');
    try {
      const bundle = await getAdminObservabilityDebugBundle({ sessionId, requestId });
      const requestSuffix = requestId ? `-request-${requestId.slice(0, 24)}` : '';
      downloadJson(`studyplanner-debug-bundle-${sessionId}${requestSuffix}.json`, bundle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Debug Bundleを生成できませんでした。');
    } finally {
      setExportingKey((current) => current === key ? '' : current);
    }
  }

  return (
    <main className="admin-shell admin-logs-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-page-eyebrow">Restricted diagnostics</span>
          <h1>Logs</h1>
          <p>障害調査が必要なときだけ詳細traceへ掘り下げます。通常の分析値はこのログから再集計しません。</p>
        </div>
        <button className="ghost-button" type="button" disabled={loading} onClick={() => { void loadSessions(); }}>
          <RefreshCw aria-hidden="true" size={17} />
          再読込
        </button>
      </header>

      <section className="panel admin-log-filter-panel" aria-label="ログフィルター">
        <label>
          <span>Trace session ID</span>
          <input
            value={sessionInput}
            onChange={(event) => setSessionInput(event.target.value)}
            placeholder="weekly-trace-..."
          />
        </label>
        <label>
          <span>Status</span>
          <select value={statusInput} onChange={(event) => setStatusInput(event.target.value)}>
            {STATUS_OPTIONS.map((value) => (
              <option key={value || 'all'} value={value}>{value || 'すべて'}</option>
            ))}
          </select>
        </label>
        <div className="admin-log-filter-actions">
          <button className="primary-button" type="button" onClick={applyFilters}>
            <Search aria-hidden="true" size={16} />
            適用
          </button>
          <button className="ghost-button" type="button" onClick={clearFilters}>クリア</button>
        </div>
      </section>

      <section className="admin-log-boundary-note" aria-label="診断データの扱い">
        <strong>診断データは高感度です。</strong>
        <span>一覧は要約のみ。本文・state diff・AI response等は展開後のRedacted detailで確認します。</span>
      </section>

      {error ? <section className="admin-state-card panel" role="alert"><strong>Logsを取得できませんでした</strong><p>{error}</p></section> : null}
      {loading ? <section className="admin-state-card panel" aria-live="polite"><strong>ログを読み込んでいます</strong></section> : null}

      {!loading && !error && sessions.length === 0 ? (
        <section className="admin-state-card panel">
          <strong>該当する診断sessionはありません</strong>
          <p>traceが未保存・保持期限切れ・filter対象外の場合があります。0件を「障害なし」とは解釈しません。</p>
        </section>
      ) : null}

      <section className="admin-log-session-list" aria-label="診断session一覧">
        {sessions.map((session) => {
          const expanded = expandedSessionId === session.traceSessionId;
          const page = entriesBySession[session.traceSessionId];
          return (
            <article className="panel admin-log-session" key={session.traceSessionId}>
              <button className="admin-log-session-toggle" type="button" onClick={() => toggleSession(session.traceSessionId)}>
                <div className="admin-log-session-main">
                  <div className="admin-log-session-line">
                    <span className={`admin-log-severity is-${session.severity}`}>{session.severity}</span>
                    <strong>Weekly Planning</strong>
                    <span>{session.status}</span>
                    <span>{formattedDate(session.lastActivityAt)}</span>
                  </div>
                  <code>{session.traceSessionId}</code>
                  <div className="admin-log-session-meta">
                    <span>actor {session.subjectAlias}</span>
                    <span>{session.entryCount} entries</span>
                    <span>{session.turnCount} turns</span>
                    <span>{sessionSignalLabel(session)}</span>
                  </div>
                </div>
                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>

              {expanded ? (
                <div className="admin-log-session-detail">
                  <div className="admin-log-detail-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={exportingKey === `${session.traceSessionId}:session`}
                      onClick={() => { void exportBundle(session.traceSessionId); }}
                    >
                      <Download aria-hidden="true" size={16} />
                      {exportingKey === `${session.traceSessionId}:session` ? '生成中...' : 'Session Debug Bundle'}
                    </button>
                    <span>schema v1・bounded・redacted JSON</span>
                  </div>

                  {loadingEntries === session.traceSessionId && !page ? <p>詳細を読み込んでいます…</p> : null}
                  {page?.entries.map((entry) => (
                    <div className="admin-log-entry" key={entry.id}>
                      <div className="admin-log-entry-heading">
                        <span className={`admin-log-severity is-${entry.severity}`}>{entry.severity}</span>
                        <strong>{entry.eventType}</strong>
                        <time>{formattedDate(entry.occurredAt)}</time>
                      </div>
                      <p>{entry.summary}</p>
                      <div className="admin-log-entry-meta">
                        {entry.requestId ? <code>request {entry.requestId}</code> : <span>request —</span>}
                        <span>revision {entry.stateRevision ?? '—'}</span>
                      </div>
                      <div className="admin-log-entry-actions">
                        {entry.requestId ? (
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={exportingKey === `${session.traceSessionId}:${entry.requestId}`}
                            onClick={() => { void exportBundle(session.traceSessionId, entry.requestId); }}
                          >
                            Request Bundle
                          </button>
                        ) : null}
                        <details>
                          <summary>Redacted detail</summary>
                          <pre>{safeJson(entry.detail)}</pre>
                        </details>
                      </div>
                    </div>
                  ))}

                  {page?.nextAfterSequence !== null && page?.nextAfterSequence !== undefined ? (
                    <button
                      className="ghost-button admin-log-load-more"
                      type="button"
                      disabled={loadingEntries === session.traceSessionId}
                      onClick={() => { void loadEntries(session.traceSessionId, page.nextAfterSequence ?? undefined); }}
                    >
                      {loadingEntries === session.traceSessionId ? '読込中...' : '次のentryを読む'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {nextCursor ? (
        <button
          className="ghost-button admin-log-load-more"
          type="button"
          disabled={loadingMore}
          onClick={() => { void loadSessions({ append: true, cursor: nextCursor }); }}
        >
          {loadingMore ? '読込中...' : '次のsessionを読む'}
        </button>
      ) : null}
    </main>
  );
}
