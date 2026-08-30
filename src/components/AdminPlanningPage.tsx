import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  Route,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilityPlanningAnalysisReadModel,
  ObservabilityPlanningDimensionSummary,
  ObservabilityPlanningSessionAggregate,
} from '../../shared/productObservabilityPlanningReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import { getAdminObservabilityPlanningAnalysis } from '../services/adminObservabilityService';

const environmentLabels: Record<ObservabilityEnvironment, string> = {
  production: '本番環境',
  preview: 'プレビュー',
  development: '開発環境',
  test: 'テスト',
};

function tokyoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function validDateParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function initialEnvironment(): ObservabilityEnvironment {
  const value = new URLSearchParams(window.location.search).get('environment');
  return value === 'preview' || value === 'development' || value === 'test' ? value : 'production';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(value);
}

function percentage(value: number | null): string {
  return value === null ? '未計測' : `${(value * 100).toFixed(1)}%`;
}

function decimal(value: number | null): string {
  return value === null ? '未計測' : value.toFixed(2);
}

function formatTimestamp(value: string | null): string {
  if (!value) return '未計測';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未計測';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function Metric({ icon, label, value, note }: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="admin-overview-metric panel">
      <span className="admin-overview-metric-icon is-purple">{icon}</span>
      <div className="admin-overview-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function FunnelStep({ label, count, total, final = false }: {
  label: string;
  count: number;
  total: number;
  final?: boolean;
}) {
  const rate = total > 0 ? count / total : null;
  const width = rate === null ? 0 : Math.max(2, Math.min(100, rate * 100));
  return (
    <div className={`admin-planning-funnel-step${final ? ' is-final' : ''}`}>
      <div className="admin-planning-funnel-label">
        <span>{label}</span>
        <strong>{formatNumber(count)}件</strong>
        <small>{percentage(rate)}</small>
      </div>
      <div className="admin-planning-funnel-track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function QualityGrid({ data }: { data: ObservabilityPlanningAnalysisReadModel }) {
  const rows = [
    ['失敗を観測', data.aggregate.failedCount, data.rates.failureObservedRate],
    ['fallback使用', data.aggregate.fallbackUsedCount, data.rates.fallbackRate],
    ['semantic repair使用', data.aggregate.semanticRepairUsedCount, data.rates.semanticRepairRate],
    ['stale result観測', data.aggregate.staleObservedCount, data.rates.staleObservedRate],
    ['未配置あり', data.aggregate.unscheduledObservedCount, data.rates.unscheduledObservedRate],
    ['承認失敗を観測', data.aggregate.approvalFailureObservedCount, data.rates.approvalFailureObservedRate],
  ] as const;
  return (
    <div className="admin-planning-quality-grid">
      {rows.map(([label, count, rate]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{formatNumber(count)}件</strong>
          <small>{percentage(rate)}</small>
        </div>
      ))}
      <div>
        <span>abandoned</span>
        <strong>{data.abandonedMeasured ? `${formatNumber(data.aggregate.abandonedCount)}件` : '未計測'}</strong>
        <small>{data.abandonedMeasured ? 'session authorityから集計' : 'runtime authority未定義のため0扱いしません'}</small>
      </div>
    </div>
  );
}

function DimensionTable({ title, description, rows }: {
  title: string;
  description: string;
  rows: ObservabilityPlanningDimensionSummary[];
}) {
  return (
    <section className="admin-section-card panel">
      <div className="admin-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="admin-overview-empty">この期間に比較可能なsession cohortはありません。</p>
      ) : (
        <div className="admin-ai-table-wrap">
          <table className="admin-ai-table admin-planning-dimension-table">
            <thead>
              <tr>
                <th>分類</th>
                <th>Session</th>
                <th>Preview</th>
                <th>保存完了</th>
                <th>平均turn</th>
                <th>Previewまで</th>
                <th>失敗</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td data-label="分類"><code>{row.key}</code></td>
                  <td data-label="Session">{formatNumber(row.aggregate.sessionCount)}</td>
                  <td data-label="Preview">{percentage(row.rates.previewRate)}</td>
                  <td data-label="保存完了">{percentage(row.rates.saveRate)}</td>
                  <td data-label="平均turn">{decimal(row.rates.averageTurns)}</td>
                  <td data-label="Previewまで">{decimal(row.rates.averageTurnsToFirstPreview)}</td>
                  <td data-label="失敗">{percentage(row.rates.failureObservedRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DailyTable({ rows }: { rows: Array<{ localDate: string; aggregate: ObservabilityPlanningSessionAggregate }> }) {
  const activeRows = rows.filter((row) => row.aggregate.sessionCount > 0);
  if (activeRows.length === 0) return null;
  return (
    <section className="admin-section-card panel">
      <div className="admin-section-heading">
        <div>
          <h2>開始日別cohort</h2>
          <p>その日に開始したPlanning Sessionが後日どうなったかを、開始日に戻して集計します。</p>
        </div>
      </div>
      <div className="admin-ai-table-wrap">
        <table className="admin-ai-table">
          <thead>
            <tr>
              <th>開始日</th>
              <th>Session</th>
              <th>Preview</th>
              <th>承認開始</th>
              <th>保存</th>
              <th>失敗観測</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row) => {
              const total = row.aggregate.sessionCount;
              return (
                <tr key={row.localDate}>
                  <td data-label="開始日">{row.localDate}</td>
                  <td data-label="Session">{formatNumber(total)}</td>
                  <td data-label="Preview">{percentage(total > 0 ? row.aggregate.previewReachedCount / total : null)}</td>
                  <td data-label="承認開始">{percentage(total > 0 ? row.aggregate.approvalReachedCount / total : null)}</td>
                  <td data-label="保存">{percentage(total > 0 ? row.aggregate.saveCompletedCount / total : null)}</td>
                  <td data-label="失敗観測">{percentage(total > 0 ? row.aggregate.failedCount / total : null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminPlanningPage() {
  const today = useMemo(() => tokyoDate(new Date()), []);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [fromDate, setFromDate] = useState(
    () => validDateParam(params.get('from')) ?? shiftDate(today, -6),
  );
  const [toDate, setToDate] = useState(
    () => validDateParam(params.get('to')) ?? today,
  );
  const [environment, setEnvironment] = useState<ObservabilityEnvironment>(initialEnvironment);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams({ from: fromDate, to: toDate });
    if (environment !== 'production') query.set('environment', environment);
    window.history.replaceState({}, '', `${window.location.pathname}?${query.toString()}`);
  }, [environment, fromDate, toDate]);

  const loadAnalysis = useCallback(
    () => getAdminObservabilityPlanningAnalysis({ fromDate, toDate, environment }),
    [environment, fromDate, refreshKey, toDate],
  );
  const { loadState, data, errorMessage } = useAdminDataLoader<ObservabilityPlanningAnalysisReadModel | null>(
    loadAnalysis,
    null,
    'Planning分析を取得できませんでした。',
  );

  return (
    <main className="admin-shell admin-planning-shell">
      <header className="admin-overview-header">
        <div>
          <p className="admin-overview-eyebrow">Product Observability</p>
          <h1>Planning Analytics</h1>
          <p>週間計画が「開始 → Preview → 承認開始 → 保存」まで進めたかを、typed outcomeからsession単位で追います。</p>
        </div>
        <div className="admin-overview-controls" aria-label="Planning表示条件">
          <label>
            <span>環境</span>
            <select value={environment} onChange={(event) => setEnvironment(event.target.value as ObservabilityEnvironment)}>
              {(Object.keys(environmentLabels) as ObservabilityEnvironment[]).map((key) => (
                <option key={key} value={key}>{environmentLabels[key]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>開始日</span>
            <input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            <span>終了日</span>
            <input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <button className="ghost-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw aria-hidden="true" size={17} />
            更新
          </button>
        </div>
      </header>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel"><strong>読み込み中</strong><p>Planning session cohortを取得しています。</p></section>
      ) : null}
      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert"><strong>取得できませんでした</strong><p>{errorMessage}</p></section>
      ) : null}

      {data ? (
        <>
          <section className="admin-overview-metric-grid" aria-label="Planning主要指標">
            <Metric icon={<CalendarClock size={19} />} label="Planning Session" value={formatNumber(data.aggregate.sessionCount)} note="session_startedを開始日のcohortへ1回だけ計上" />
            <Metric icon={<CheckCircle2 size={19} />} label="保存完了率" value={percentage(data.rates.saveRate)} note={`${formatNumber(data.aggregate.saveCompletedCount)} sessionがsave_completed`} />
            <Metric icon={<GitBranch size={19} />} label="平均turn数" value={decimal(data.rates.averageTurns)} note="開始sessionあたりのturn_started" />
            <Metric icon={<Route size={19} />} label="Previewまでの平均turn" value={decimal(data.rates.averageTurnsToFirstPreview)} note="first previewのturnIndexが既知のsessionのみ" />
            <Metric icon={<Sparkles size={19} />} label="Preview到達率" value={percentage(data.rates.previewRate)} note={`${formatNumber(data.aggregate.previewReachedCount)} sessionがpreview到達`} />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <div>
                <h2>Session funnel</h2>
                <p>期間内に「開始したsession」を母数に固定します。期間中に発生したevent件数同士を割っていません。</p>
              </div>
            </div>
            <div className="admin-planning-funnel">
              <FunnelStep label="開始" count={data.aggregate.sessionCount} total={data.aggregate.sessionCount} />
              <FunnelStep label="Preview到達" count={data.aggregate.previewReachedCount} total={data.aggregate.sessionCount} />
              <FunnelStep label="承認開始" count={data.aggregate.approvalReachedCount} total={data.aggregate.sessionCount} />
              <FunnelStep label="保存完了" count={data.aggregate.saveCompletedCount} total={data.aggregate.sessionCount} final />
            </div>
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <div>
                <h2>品質シグナル</h2>
                <p>1つのsession内で一度でも観測した場合に1件として数えます。同じsessionの複数回発生を水増ししません。</p>
              </div>
            </div>
            <QualityGrid data={data} />
          </section>

          <section className="admin-planning-measurement-note panel">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>計測境界</strong>
              <p>選択期間内で最初に集計対象となったcohort日は {formatTimestamp(data.measurementStartedAt)}、この期間のread model最終更新は {formatTimestamp(data.lastUpdatedAt)} です。Phase 6導入前のweekly-planning traceから過去analyticsを推測していません。promptVersion / modelがoutcomeに未設定のsessionは unknown として残します。</p>
            </div>
          </section>

          <DimensionTable title="App version別" description="session開始時のapp versionで比較します。" rows={data.byAppVersion} />
          <DimensionTable title="Scheduler version別" description="session内で観測されたscheduler versionで比較します。途中で変わった場合は __mixed__ です。" rows={data.bySchedulerVersion} />
          <DimensionTable title="Prompt version別" description="typed outcomeが明示的に保持したprompt versionのみを使います。未設定値は unknown です。" rows={data.byPromptVersion} />
          <DimensionTable title="Model別" description="typed outcomeが明示的に保持したmodelのみを使います。別のAI集計から推測して結合しません。" rows={data.byModel} />
          <DailyTable rows={data.daily} />
        </>
      ) : null}
    </main>
  );
}
