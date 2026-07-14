import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createWeeklyPlanningTraceExportBundle } from './weeklyPlanningTraceExport';
import { getWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceSessionStatus,
} from './weeklyPlanningTraceTypes';

interface WeeklyPlanningTraceDebugPageProps {
  onBack: () => void;
}

const STATUS_OPTIONS: Array<{ value: '' | WeeklyPlanningTraceSessionStatus; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'active', label: 'active' },
  { value: 'completed', label: 'completed' },
  { value: 'abandoned', label: 'abandoned' },
  { value: 'failed', label: 'failed' },
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

function entryTitle(entry: WeeklyPlanningTraceEntry): string {
  if (entry.kind === 'turn') return `${entry.role} turn`;
  if (entry.kind === 'internal_event') return entry.eventType;
  return `snapshot: ${entry.snapshotReason}`;
}

function entryBody(entry: WeeklyPlanningTraceEntry): unknown {
  if (entry.kind === 'turn') return entry.content;
  if (entry.kind === 'internal_event') return entry.payload;
  return entry.state;
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}

export function WeeklyPlanningTraceDebugPage({
  onBack,
}: WeeklyPlanningTraceDebugPageProps) {
  const [sessions, setSessions] = useState<WeeklyPlanningTraceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [entries, setEntries] = useState<WeeklyPlanningTraceEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | WeeklyPlanningTraceSessionStatus>('');
  const [userFilter, setUserFilter] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyFallbacks, setOnlyFallbacks] = useState(false);
  const [onlyPreviews, setOnlyPreviews] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadSessions(): Promise<void> {
    setLoading(true);
    try {
      const nextSessions = await getWeeklyPlanningTraceRepository().listSessionsForAdmin();
      setSessions(nextSessions);
      setSelectedSessionId((current) =>
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id ?? '',
      );
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'sessionを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  useEffect(() => {
    if (!selectedSession) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getWeeklyPlanningTraceRepository()
      .listEntries(selectedSession.userId, selectedSession.id)
      .then((nextEntries) => {
        if (!cancelled) {
          setEntries(nextEntries);
          setError('');
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'traceを取得できませんでした。');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  const visibleSessions = useMemo(() => sessions.filter((session) => {
    if (statusFilter && session.status !== statusFilter) return false;
    if (userFilter.trim() && !session.userId.toLowerCase().includes(userFilter.trim().toLowerCase())) {
      return false;
    }
    if (onlyErrors && !session.hasError) return false;
    if (onlyFallbacks && !session.hasFallback) return false;
    if (onlyPreviews && !session.hasPreview) return false;
    return true;
  }), [onlyErrors, onlyFallbacks, onlyPreviews, sessions, statusFilter, userFilter]);

  return (
    <main className="admin-shell weekly-planning-trace-debug">
      <button className="ghost-button admin-back-button" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
        ユーザー一覧へ戻る
      </button>

      <header className="panel">
        <h1>週間計画ログ</h1>
        <p>管理者として、redaction済みの会話turn、内部event、state snapshotを確認します。</p>
        <div className="button-row">
          <button
            className="ghost-button"
            type="button"
            disabled={loading}
            onClick={() => { void loadSessions(); }}
          >
            再読込
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!selectedSession}
            onClick={() => {
              if (!selectedSession) return;
              downloadJson(
                `weekly-planning-trace-${selectedSession.id}.json`,
                createWeeklyPlanningTraceExportBundle(selectedSession, entries),
              );
            }}
          >
            JSON export
          </button>
        </div>
      </header>

      {error ? <div className="app-notice error">{error}</div> : null}

      <section className="panel">
        <h2>Filter</h2>
        <div className="field-row">
          <label className="field">
            <span>User ID</span>
            <input
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              placeholder="uidで絞り込み"
              type="search"
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | WeeklyPlanningTraceSessionStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label><input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} /> errorあり</label>
          <label><input type="checkbox" checked={onlyFallbacks} onChange={(event) => setOnlyFallbacks(event.target.checked)} /> fallbackあり</label>
          <label><input type="checkbox" checked={onlyPreviews} onChange={(event) => setOnlyPreviews(event.target.checked)} /> previewあり</label>
        </div>
      </section>

      <div className="weekly-planning-trace-debug-grid">
        <section className="panel">
          <h2>Sessions</h2>
          {visibleSessions.length === 0 ? <p>該当sessionはありません。</p> : null}
          <div className="weekly-planning-trace-session-list">
            {visibleSessions.map((session) => (
              <button
                className={session.id === selectedSessionId ? 'trace-session-card active' : 'trace-session-card'}
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
              >
                <strong>{formattedDate(session.startedAt)}</strong>
                <span>{session.status} / turns {session.turnCount} / entries {session.entryCount}</span>
                <code>{session.userId}</code>
                <code>{session.id}</code>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Timeline</h2>
          {selectedSession ? (
            <p>
              user {selectedSession.userId} / {selectedSession.status} / {formattedDate(selectedSession.startedAt)} / {selectedSession.logicalConversationId}
            </p>
          ) : null}
          {entries.length === 0 ? <p>entryはありません。</p> : null}
          <div className="weekly-planning-trace-entry-list">
            {entries.map((entry) => (
              <article className={`trace-entry trace-entry--${entry.kind}`} key={entry.id}>
                <header>
                  <strong>#{entry.sequence} {entryTitle(entry)}</strong>
                  <span>{formattedDate(entry.occurredAt)}</span>
                </header>
                <small>
                  revision {entry.stateRevision ?? '-'} / request {entry.requestId ?? '-'}
                </small>
                {entry.kind === 'turn'
                  ? <p>{entry.content}</p>
                  : <pre>{JSON.stringify(entryBody(entry), null, 2)}</pre>}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
