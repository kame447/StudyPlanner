import { ChevronDown, ChevronUp, Download, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ObservabilityLogEntryPage,
  ObservabilityLogSessionPageEvidence,
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
  return session.hasPreview ? 'preview到達' : 'イベント信号なし';
}

function metadataEvidenceLabel(session: ObservabilityLogSessionSummary): string {
  switch (session.metadataEvidence) {
    case 'indexed_activity': return '索引に記録あり（本文未確認）';
    case 'no_indexed_entries': return '索引0件（保存先の空は未確認）';
    case 'activity_without_indexed_entries': return '活動情報あり・索引0件';
    case 'unknown_or_invalid_metadata': return 'メタデータ不明・不正';
    default: return 'メタデータ検証情報なし';
  }
}

type LoadedEntryPage = ObservabilityLogEntryPage & { observedReadIssue?: boolean };

function hasEntryReadIssue(page: ObservabilityLogEntryPage): boolean {
  return Boolean(page.pageEvidence
    && (page.pageEvidence.unavailableSequenceCount > 0 || page.pageEvidence.unprojectableEntryCount > 0));
}

export function AdminLogsPage() {
  const initialFilters = useMemo(filtersFromUrl, []);
  const [sessionInput, setSessionInput] = useState(initialFilters.sessionId);
  const [statusInput, setStatusInput] = useState(initialFilters.status);
  const [appliedSession, setAppliedSession] = useState(initialFilters.sessionId);
  const [appliedStatus, setAppliedStatus] = useState(initialFilters.status);
  const [sessions, setSessions] = useState<ObservabilityLogSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [entriesBySession, setEntriesBySession] = useState<Record<string, LoadedEntryPage>>({});
  const [listEvidence, setListEvidence] = useState<Array<ObservabilityLogSessionPageEvidence | undefined>>([]);
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
      setListEvidence((current) => options.append ? [...current, page.pageEvidence] : [page.pageEvidence]);
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
        const observedReadIssue = hasEntryReadIssue(page);
        if (!previous || afterSequence === undefined) return { ...current, [sessionId]: { ...page, observedReadIssue } };
        return {
          ...current,
          [sessionId]: {
            ...page,
            entries: [...previous.entries, ...page.entries],
            observedReadIssue: previous.observedReadIssue || observedReadIssue,
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
        <span>件数は索引情報です。0件でも保存先全体が空とは断定できません。export履歴は管理していません。</span>
      </section>

      {error ? <section className="admin-state-card panel" role="alert"><strong>Logsを取得できませんでした</strong><p>{error}</p></section> : null}
      {loading ? <section className="admin-state-card panel" aria-live="polite"><strong>ログを読み込んでいます</strong></section> : null}

      {!loading && !error && listEvidence.length > 0 ? (
        <section className="admin-state-card panel" aria-label="一覧の取得状態">
          {listEvidence.map((evidence, index) => evidence ? (
            <p key={index}>取得ページ {index + 1}: 元データ {evidence.rawDocumentCount} 件、
              状態による除外 {evidence.statusFilteredCount} 件、一覧化できない記録 {evidence.unreadableSessionCount} 件</p>
          ) : <p key={index}>取得ページ {index + 1}: このWorkerは一覧の検証情報を返していません。</p>)}
          {listEvidence.some((evidence) => evidence && evidence.unreadableSessionCount > 0)
            ? <strong>一覧に表示できない記録があります。正常な0件とは区別してください。</strong> : null}
        </section>
      ) : null}

      {!loading && !error && sessions.length === 0 ? (
        <section className="admin-state-card panel">
          <strong>この取得範囲に表示対象の診断sessionはありません</strong>
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
                    <span>{session.metadataEvidence === 'unknown_or_invalid_metadata' ? '—' : session.entryCount} entries</span>
                    <span>{session.metadataEvidence === 'unknown_or_invalid_metadata' ? '—' : session.turnCount} turns</span>
                    <span>{metadataEvidenceLabel(session)}</span>
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
                  {!page && loadingEntries !== session.traceSessionId ? <p>本文は未取得です。</p> : null}
                  {page ? (
                    <section aria-label="本文の取得状態">
                      {page.pageEvidence ? <>
                        <p>{page.pageEvidence.indexCountStatus !== 'valid'
                          ? '索引件数の完全性は確認できていません。'
                          : page.pageEvidence.requestedEndSequence < page.pageEvidence.requestedStartSequence
                          ? '索引上の取得対象は0件です。'
                          : `今回の取得番号: ${page.pageEvidence.requestedStartSequence}–${page.pageEvidence.requestedEndSequence}`}
                          {' '}欠損または不正で読めない番号 {page.pageEvidence.unavailableSequenceCount} 件、
                          表示形式に変換できない記録 {page.pageEvidence.unprojectableEntryCount} 件</p>
                        <p>{page.pageEvidence.indexCountStatus === 'invalid' ? '索引件数が不明または不正です。'
                          : page.pageEvidence.indexCountStatus === 'capped' ? '索引件数が読出し上限を超えています。全範囲を読み終えたとは判断できません。'
                          : page.pageEvidence.indexCountStatus !== 'valid' ? '索引件数の検証情報がありません。'
                          : page.pageEvidence.indexedRangeExhausted ? '索引範囲の末尾に到達しました。保存先全体の完全性の証明ではありません。' : '索引範囲の続きがあります。'}
                          {page.pageEvidence.byteLimited ? ' 応答サイズ上限で区切っています。' : ''}</p>
                      </> : <p>このWorkerは本文取得範囲の検証情報を返していません。</p>}
                      {page.observedReadIssue ? <strong>取得済みの範囲に欠損または読めない記録があります。</strong> : null}
                      {page.entries.length === 0 ? <p>表示できるentryは0件です。空のsessionと断定しないでください。</p> : null}
                    </section>
                  ) : null}
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
