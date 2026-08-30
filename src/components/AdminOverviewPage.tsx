import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  RefreshCw,
  Save,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilityDailyRollup,
  ObservabilityOverviewReadModel,
} from '../../shared/productObservabilityReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import { getAdminObservabilityOverview } from '../services/adminObservabilityService';

interface AdminOverviewPageProps {
  navigate: (path: string) => void;
}

interface TrendSeries {
  label: string;
  className: string;
  values: number[];
}

const environmentLabels: Record<ObservabilityEnvironment, string> = {
  production: '本番環境',
  preview: 'プレビュー',
  development: '開発環境',
  test: 'テスト',
};

const activitySegments = [
  { key: 'plan_created', label: 'プラン作成', className: 'is-blue' },
  { key: 'plan_updated', label: 'プラン編集', className: 'is-green' },
  { key: 'actual_recorded', label: '学習記録', className: 'is-orange' },
  { key: 'todo_completed', label: 'Todo完了', className: 'is-purple' },
  { key: 'weekly_planning_opened', label: 'AI計画', className: 'is-gray' },
] as const;

function tokyoDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: byType.year,
    month: byType.month,
    day: byType.day,
  };
}

function todayInTokyo(): string {
  const parts = tokyoDateParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftIsoDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUsdMicros(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
}

function formatDuration(value: number | null): string {
  if (value === null) return '未計測';
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}秒`;
  return `${Math.round(value)}ms`;
}

function formatShortDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatTimestamp(value: string | null): string {
  if (!value) return '未実行';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

function percentage(part: number, total: number): string {
  if (total <= 0) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone = 'blue',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: 'blue' | 'green' | 'purple' | 'orange' | 'teal';
}) {
  return (
    <article className="admin-overview-metric panel">
      <span className={`admin-overview-metric-icon is-${tone}`}>{icon}</span>
      <div className="admin-overview-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function TrendChart({ daily }: { daily: ObservabilityDailyRollup[] }) {
  const series: TrendSeries[] = [
    {
      label: '利用ユーザー数',
      className: 'is-primary',
      values: daily.map((entry) => entry.activeActorCount),
    },
    {
      label: 'プラン作成数',
      className: 'is-secondary',
      values: daily.map((entry) => entry.productActivity.actionCounts.plan_created ?? 0),
    },
  ];
  const maxValue = Math.max(1, ...series.flatMap((entry) => entry.values));
  const width = 680;
  const height = 214;
  const left = 18;
  const right = 14;
  const top = 12;
  const bottom = 18;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  function points(values: number[]): string {
    if (values.length === 0) return '';
    const denominator = Math.max(1, values.length - 1);
    return values.map((value, index) => {
      const x = left + (index / denominator) * plotWidth;
      const y = top + (1 - value / maxValue) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  return (
    <div className="admin-overview-chart-body">
      <div className="admin-overview-legend">
        {series.map((entry) => (
          <span key={entry.label}>
            <i className={entry.className} />
            {entry.label}
          </span>
        ))}
      </div>
      {daily.length === 0 ? (
        <p className="admin-overview-empty">この期間の利用データはまだありません。</p>
      ) : (
        <>
          <svg className="admin-overview-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="利用状況の推移">
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                className="admin-overview-grid-line"
                x1={left}
                x2={width - right}
                y1={top + ratio * plotHeight}
                y2={top + ratio * plotHeight}
              />
            ))}
            {series.map((entry) => (
              <polyline
                key={entry.label}
                className={`admin-overview-trend-line ${entry.className}`}
                fill="none"
                points={points(entry.values)}
              />
            ))}
          </svg>
          <div className="admin-overview-chart-labels">
            {daily.map((entry, index) => (
              <span key={entry.localDate} className={index > 0 && index < daily.length - 1 ? 'is-optional' : ''}>
                {formatShortDate(entry.localDate)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityBars({ daily }: { daily: ObservabilityDailyRollup[] }) {
  const totals = daily.map((entry) => activitySegments.reduce(
    (sum, segment) => sum + (entry.productActivity.actionCounts[segment.key] ?? 0),
    0,
  ));
  const maxTotal = Math.max(1, ...totals);

  return (
    <div className="admin-overview-chart-body">
      <div className="admin-overview-legend admin-overview-legend-wrap">
        {activitySegments.map((segment) => (
          <span key={segment.key}>
            <i className={segment.className} />
            {segment.label}
          </span>
        ))}
      </div>
      {daily.length === 0 ? (
        <p className="admin-overview-empty">この期間のアクションデータはまだありません。</p>
      ) : (
        <div className="admin-overview-bar-chart" aria-label="主なプロダクトアクション">
          {daily.map((entry, index) => {
            const total = totals[index] ?? 0;
            return (
              <div className="admin-overview-bar-item" key={entry.localDate}>
                <div className="admin-overview-bar-column" title={`${formatShortDate(entry.localDate)}: ${formatNumber(total)}件`}>
                  <div
                    className="admin-overview-bar-stack"
                    style={{ height: `${Math.max(4, (total / maxTotal) * 100)}%` }}
                  >
                    {activitySegments.map((segment) => {
                      const value = entry.productActivity.actionCounts[segment.key] ?? 0;
                      if (value <= 0 || total <= 0) return null;
                      return (
                        <span
                          key={segment.key}
                          className={segment.className}
                          style={{ height: `${(value / total) * 100}%` }}
                          title={`${segment.label}: ${formatNumber(value)}件`}
                        />
                      );
                    })}
                  </div>
                </div>
                <small>{formatShortDate(entry.localDate)}</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  state = 'ok',
  detail,
}: {
  label: string;
  value: string;
  state?: 'ok' | 'warning' | 'muted';
  detail?: string;
}) {
  return (
    <div className="admin-overview-status-row">
      <span className={`admin-overview-status-dot is-${state}`} />
      <div>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
      <span>{value}</span>
    </div>
  );
}

export function AdminOverviewPage({ navigate }: AdminOverviewPageProps) {
  const defaultToDate = useMemo(() => todayInTokyo(), []);
  const [fromDate, setFromDate] = useState(() => shiftIsoDate(defaultToDate, -6));
  const [toDate, setToDate] = useState(defaultToDate);
  const [environment, setEnvironment] = useState<ObservabilityEnvironment>('production');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadOverview = useCallback(
    () => getAdminObservabilityOverview({ fromDate, toDate, environment }),
    [environment, fromDate, refreshKey, toDate],
  );
  const { loadState, data, errorMessage } = useAdminDataLoader<ObservabilityOverviewReadModel | null>(
    loadOverview,
    null,
    'Overviewを取得できませんでした。',
  );

  const warnings = useMemo(() => {
    if (!data) return [] as Array<{ title: string; detail: string }>;
    const result: Array<{ title: string; detail: string }> = [];
    if (data.rollupCheckpoint.lastFailureAt
      && (!data.rollupCheckpoint.lastSuccessfulRunAt
        || data.rollupCheckpoint.lastFailureAt > data.rollupCheckpoint.lastSuccessfulRunAt)) {
      result.push({
        title: 'データ集計でエラーが発生しています',
        detail: data.rollupCheckpoint.lastFailureCategory ?? '原因分類を確認してください。',
      });
    }
    if (data.rollupCheckpoint.activeUserDirtySources.length > 0) {
      result.push({
        title: '利用ユーザー数を再集計しています',
        detail: `${formatNumber(data.rollupCheckpoint.activeUserDirtySources.length)}件の更新待ちがあります。`,
      });
    }
    if (!data.registeredUsers.registrationIndexReady) {
      result.push({
        title: '登録日時データを移行中です',
        detail: '新規登録者数は移行完了まで未確定として表示されます。',
      });
    }
    if (data.period.ai.estimatedCostUnknownCount > 0) {
      result.push({
        title: 'AIコストに未計測のリクエストがあります',
        detail: `${formatNumber(data.period.ai.estimatedCostUnknownCount)}件は価格を算出できていません。`,
      });
    }
    if (data.period.ai.totalTokensUnknownCount > 0) {
      result.push({
        title: 'トークン使用量に未計測があります',
        detail: `${formatNumber(data.period.ai.totalTokensUnknownCount)}件はtoken usageを取得できていません。`,
      });
    }
    return result;
  }, [data]);

  const planning = data?.period.planning.outcomeCounts;
  const planningRows = data ? [
    { label: 'セッション開始', value: planning?.session_started ?? 0, tone: 'blue' },
    { label: 'プレビュー生成', value: planning?.preview_generated ?? 0, tone: 'purple' },
    { label: '保存完了', value: planning?.save_completed ?? 0, tone: 'green' },
    { label: '未スケジュール', value: planning?.unscheduled_observed ?? 0, tone: 'orange' },
    { label: '失敗', value: planning?.failed ?? 0, tone: 'red' },
  ] : [];
  const planningMax = Math.max(1, ...planningRows.map((row) => row.value));
  const aiSuccessRate = data ? percentage(data.period.ai.successCount, data.period.ai.requestCount) : '—';

  return (
    <main className="admin-shell admin-overview-shell">
      <header className="admin-overview-header">
        <div>
          <p className="admin-overview-eyebrow">Product Observability</p>
          <h1>Overview</h1>
        </div>
        <div className="admin-overview-controls" aria-label="Overview表示条件">
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
          <button
            className="admin-overview-refresh-button"
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label="Overviewを再読み込み"
            title="再読み込み"
          >
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel" aria-live="polite">
          <strong>Overviewを読み込んでいます</strong>
          <p>利用状況・AI/API・Planning・集計状態を取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>Overviewを取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' && data ? (
        <>
          <section className="admin-overview-metric-grid" aria-label="主要指標">
            <MetricCard
              icon={<Users aria-hidden="true" size={23} />}
              label="登録ユーザー数"
              value={`${formatNumber(data.registeredUsers.total)}人`}
              note="Firebase登録プロフィール"
              tone="blue"
            />
            <MetricCard
              icon={<UserPlus aria-hidden="true" size={23} />}
              label="新規登録（選択期間）"
              value={data.registeredUsers.newInPeriod === null
                ? '集計中'
                : `${formatNumber(data.registeredUsers.newInPeriod)}人`}
              note={data.registeredUsers.registrationIndexReady ? `${fromDate}〜${toDate}` : '登録日時データを移行中'}
              tone="green"
            />
            <MetricCard
              icon={<Activity aria-hidden="true" size={23} />}
              label="過去7日間の利用ユーザー"
              value={data.activeUsers ? `${formatNumber(data.activeUsers.last7Days)}人` : '再集計中'}
              note="同じユーザーは1人として集計"
              tone="purple"
            />
            <MetricCard
              icon={<CircleDollarSign aria-hidden="true" size={23} />}
              label="AIコスト（選択期間）"
              value={formatUsdMicros(data.period.ai.estimatedCostMicros)}
              note={data.period.ai.estimatedCostUnknownCount > 0
                ? `未計測 ${formatNumber(data.period.ai.estimatedCostUnknownCount)}件`
                : '計測可能なリクエストは全件反映'}
              tone="orange"
            />
            <MetricCard
              icon={<Save aria-hidden="true" size={23} />}
              label="Planning保存完了"
              value={`${formatNumber(planning?.save_completed ?? 0)}件`}
              note={`失敗 ${formatNumber(planning?.failed ?? 0)}件`}
              tone="teal"
            />
          </section>

          <section className="admin-overview-chart-grid">
            <article className="admin-overview-card panel">
              <div className="admin-overview-card-head">
                <div>
                  <span>利用状況の推移</span>
                  <small>1日ごとの利用ユーザーとプラン作成数</small>
                </div>
                <CalendarDays aria-hidden="true" size={19} />
              </div>
              <TrendChart daily={data.daily} />
            </article>
            <article className="admin-overview-card panel">
              <div className="admin-overview-card-head">
                <div>
                  <span>主なプロダクトアクション</span>
                  <small>選択期間の日別件数</small>
                </div>
                <Sparkles aria-hidden="true" size={19} />
              </div>
              <ActivityBars daily={data.daily} />
            </article>
          </section>

          <section className="admin-overview-detail-grid">
            <article className="admin-overview-card panel">
              <div className="admin-overview-card-head">
                <div>
                  <span>AI・APIの状態</span>
                  <small>専門用語より意味を優先して表示</small>
                </div>
                <Bot aria-hidden="true" size={19} />
              </div>
              <div className="admin-overview-stat-grid">
                <div><span>リクエスト数</span><strong>{formatNumber(data.period.ai.requestCount)}件</strong></div>
                <div><span>成功率</span><strong>{aiSuccessRate}</strong></div>
                <div><span>通常の応答時間</span><strong>{formatDuration(data.aiLatencyP50Ms)}</strong><small>p50</small></div>
                <div><span>遅いケースの応答時間</span><strong>{formatDuration(data.aiLatencyP95Ms)}</strong><small>p95</small></div>
                <div><span>トークン使用量</span><strong>{formatCompact(data.period.ai.totalTokens)}</strong><small>{data.period.ai.totalTokensUnknownCount > 0 ? '一部未計測' : '計測済み'}</small></div>
                <div><span>推定コスト</span><strong>{formatUsdMicros(data.period.ai.estimatedCostMicros)}</strong><small>{data.period.ai.estimatedCostUnknownCount > 0 ? '一部未計測' : '計測済み'}</small></div>
              </div>
              <button className="admin-overview-detail-link" type="button" disabled title="AI・API詳細はPhase 5で実装します">
                AI・APIの詳細は次フェーズ
              </button>
            </article>

            <article className="admin-overview-card panel">
              <div className="admin-overview-card-head">
                <div>
                  <span>Planningの状態</span>
                  <small>週間計画のtyped outcome</small>
                </div>
                <CheckCircle2 aria-hidden="true" size={19} />
              </div>
              <div className="admin-overview-planning-list">
                {planningRows.map((row) => (
                  <div key={row.label} className="admin-overview-planning-row">
                    <div><span>{row.label}</span><strong>{formatNumber(row.value)}件</strong></div>
                    <div className="admin-overview-progress-track">
                      <span className={`is-${row.tone}`} style={{ width: `${(row.value / planningMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <button className="admin-overview-detail-link" type="button" disabled title="Planning詳細はPhase 6で実装します">
                Planningの詳細は次フェーズ
              </button>
            </article>

            <article className="admin-overview-card panel">
              <div className="admin-overview-card-head">
                <div>
                  <span>集計・システムの状態</span>
                  <small>表示データが最新かを確認</small>
                </div>
                <Database aria-hidden="true" size={19} />
              </div>
              <div className="admin-overview-status-list">
                <StatusRow
                  label="データ集計"
                  value={data.rollupCheckpoint.lastFailureAt
                    && (!data.rollupCheckpoint.lastSuccessfulRunAt
                      || data.rollupCheckpoint.lastFailureAt > data.rollupCheckpoint.lastSuccessfulRunAt)
                    ? '要確認'
                    : '正常'}
                  state={data.rollupCheckpoint.lastFailureAt
                    && (!data.rollupCheckpoint.lastSuccessfulRunAt
                      || data.rollupCheckpoint.lastFailureAt > data.rollupCheckpoint.lastSuccessfulRunAt)
                    ? 'warning'
                    : 'ok'}
                  detail={`最終成功: ${formatTimestamp(data.rollupCheckpoint.lastSuccessfulRunAt)}`}
                />
                <StatusRow
                  label="利用ユーザー集計"
                  value={data.activeUsers ? '最新' : '更新中'}
                  state={data.activeUsers ? 'ok' : 'warning'}
                  detail={data.activeUsers ? `基準日: ${data.activeUsers.asOfDate}` : '再集計完了後に表示します'}
                />
                <StatusRow
                  label="登録日時データ"
                  value={data.registeredUsers.registrationIndexReady ? '準備完了' : '移行中'}
                  state={data.registeredUsers.registrationIndexReady ? 'ok' : 'warning'}
                />
                <StatusRow
                  label="再集計待ち"
                  value={`${formatNumber(data.rollupCheckpoint.activeUserDirtySources.length)}件`}
                  state={data.rollupCheckpoint.activeUserDirtySources.length > 0 ? 'warning' : 'ok'}
                />
              </div>
              <button className="admin-overview-detail-link" type="button" disabled title="System詳細はPhase 8で実装します">
                Systemの詳細は次フェーズ
              </button>
            </article>
          </section>

          <section className="admin-overview-alerts panel">
            <div className="admin-overview-card-head">
              <div>
                <span>要確認</span>
                <small>未計測・再集計・集計エラーだけを表示</small>
              </div>
              <AlertTriangle aria-hidden="true" size={19} />
            </div>
            {warnings.length === 0 ? (
              <div className="admin-overview-alert-empty">
                <CheckCircle2 aria-hidden="true" size={19} />
                <span>現在、要確認事項はありません。</span>
              </div>
            ) : (
              <div className="admin-overview-alert-list">
                {warnings.map((warning) => (
                  <div key={`${warning.title}-${warning.detail}`} className="admin-overview-alert-row">
                    <AlertTriangle aria-hidden="true" size={17} />
                    <div><strong>{warning.title}</strong><small>{warning.detail}</small></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <footer className="admin-overview-footer">
            <Clock3 aria-hidden="true" size={15} />
            集計最終更新: {formatTimestamp(data.rollupCheckpoint.updatedAt)}
            <button type="button" onClick={() => navigate('/admin/weekly-planning-traces')}>ログを確認</button>
          </footer>
        </>
      ) : null}
    </main>
  );
}
