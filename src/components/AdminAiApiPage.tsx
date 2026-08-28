import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  CircleDollarSign,
  Clock3,
  Cpu,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilityAiAnalysisReadModel,
  ObservabilityAiDimensionSummary,
} from '../../shared/productObservabilityAdminReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import { getAdminObservabilityAiAnalysis } from '../services/adminObservabilityService';

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

function formatTokens(value: number, unknownCount: number): string {
  if (unknownCount > 0) return `${formatNumber(value)} + 未計測${formatNumber(unknownCount)}件`;
  return formatNumber(value);
}

function formatCost(value: number, unknownCount: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value / 1_000_000);
  return unknownCount > 0 ? `${formatted} + 未算出${formatNumber(unknownCount)}件` : formatted;
}

function formatCostMicros(value: number | null): string {
  if (value === null) return '未確定';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value / 1_000_000);
}

function formatLatency(value: number | null): string {
  if (value === null) return '未計測';
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}秒` : `${value}ms`;
}

function percentage(value: number | null): string {
  return value === null ? '未計測' : `${(value * 100).toFixed(1)}%`;
}

function successRate(success: number, total: number): string {
  return total > 0 ? `${((success / total) * 100).toFixed(1)}%` : '—';
}

function failureBreakdown(row: ObservabilityAiDimensionSummary): string {
  const statuses = row.aggregate.statusCounts;
  const quota = statuses.quota_rejected ?? 0;
  const timeout = statuses.timeout ?? 0;
  const provider = statuses.provider_error ?? 0;
  const known = quota + timeout + provider;
  const other = Math.max(0, row.aggregate.failureCount - known);
  const parts = [
    quota > 0 ? `quota ${formatNumber(quota)}` : null,
    timeout > 0 ? `timeout ${formatNumber(timeout)}` : null,
    provider > 0 ? `provider ${formatNumber(provider)}` : null,
    other > 0 ? `その他 ${formatNumber(other)}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '—';
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

function TokenUsage({ row }: { row: ObservabilityAiDimensionSummary }) {
  return (
    <div className="admin-ai-token-breakdown">
      <span>prompt {formatTokens(row.aggregate.promptTokens, row.aggregate.promptTokensUnknownCount)}</span>
      <span>completion {formatTokens(row.aggregate.completionTokens, row.aggregate.completionTokensUnknownCount)}</span>
      <span>total {formatTokens(row.aggregate.totalTokens, row.aggregate.totalTokensUnknownCount)}</span>
      <span>cached {formatTokens(row.aggregate.cachedTokens, row.aggregate.cachedTokensUnknownCount)}</span>
    </div>
  );
}

function DimensionTable({ title, description, rows }: {
  title: string;
  description: string;
  rows: ObservabilityAiDimensionSummary[];
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
        <p className="admin-overview-empty">この期間のAIリクエストはありません。</p>
      ) : (
        <div className="admin-ai-table-wrap">
          <table className="admin-ai-table">
            <thead>
              <tr>
                <th>分類</th>
                <th>Request</th>
                <th>成功率</th>
                <th>Token usage</th>
                <th>失敗内訳</th>
                <th>p50</th>
                <th>p95</th>
                <th>推定費用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td data-label="分類"><code>{row.key}</code></td>
                  <td data-label="Request">{formatNumber(row.aggregate.requestCount)}</td>
                  <td data-label="成功率">{successRate(row.aggregate.successCount, row.aggregate.requestCount)}</td>
                  <td data-label="Token usage"><TokenUsage row={row} /></td>
                  <td data-label="失敗内訳">{failureBreakdown(row)}</td>
                  <td data-label="p50">{formatLatency(row.latencyP50Ms)}</td>
                  <td data-label="p95">{formatLatency(row.latencyP95Ms)}</td>
                  <td data-label="推定費用">{formatCost(row.aggregate.estimatedCostMicros, row.aggregate.estimatedCostUnknownCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminAiApiPage() {
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
    () => getAdminObservabilityAiAnalysis({ fromDate, toDate, environment }),
    [environment, fromDate, refreshKey, toDate],
  );
  const { loadState, data, errorMessage } = useAdminDataLoader<ObservabilityAiAnalysisReadModel | null>(
    loadAnalysis,
    null,
    'AI・API分析を取得できませんでした。',
  );

  return (
    <main className="admin-shell admin-ai-shell">
      <header className="admin-overview-header">
        <div>
          <p className="admin-overview-eyebrow">Product Observability</p>
          <h1>AI・API</h1>
          <p>providerの実測usageとserver-side read modelだけを使って、利用量・失敗・遅延・推定費用を確認します。</p>
        </div>
        <div className="admin-overview-controls" aria-label="AI・API表示条件">
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
        <section className="admin-state-card panel"><strong>読み込み中</strong><p>AI/API read modelを取得しています。</p></section>
      ) : null}
      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert"><strong>取得できませんでした</strong><p>{errorMessage}</p></section>
      ) : null}

      {data ? (
        <>
          <section className="admin-overview-metric-grid" aria-label="AI・API主要指標">
            <Metric icon={<Bot size={19} />} label="リクエスト" value={formatNumber(data.total.requestCount)} note={`${formatNumber(data.total.failureCount)}件失敗`} />
            <Metric icon={<Sparkles size={19} />} label="成功率" value={successRate(data.total.successCount, data.total.requestCount)} note={`${formatNumber(data.total.successCount)}件成功`} />
            <Metric icon={<Cpu size={19} />} label="総token" value={formatTokens(data.total.totalTokens, data.total.totalTokensUnknownCount)} note="providerが返したusageのみ" />
            <Metric icon={<Clock3 size={19} />} label="p95 latency" value={formatLatency(data.latencyP95Ms)} note={`p50 ${formatLatency(data.latencyP50Ms)}`} />
            <Metric icon={<CircleDollarSign size={19} />} label="推定費用" value={formatCost(data.total.estimatedCostMicros, data.total.estimatedCostUnknownCount)} note="pricing未定義は未算出のまま" />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <div>
                <h2>AI計画の効率</h2>
                <p>planning turnとAI requestをserver-side集計し、repairやcacheの効き方を確認します。</p>
              </div>
            </div>
            <div className="admin-ai-efficiency-grid">
              <div><span>計画turn</span><strong>{formatNumber(data.planningEfficiency.turnCount)}件</strong></div>
              <div><span>1 turnあたりrequest</span><strong>{data.planningEfficiency.requestsPerTurn === null ? '未計測' : data.planningEfficiency.requestsPerTurn.toFixed(2)}</strong></div>
              <div><span>repair request率</span><strong>{percentage(data.planningEfficiency.repairRate)}</strong></div>
              <div><span>1 turn推定原価</span><strong>{formatCostMicros(data.planningEfficiency.estimatedCostPerTurnMicros)}</strong></div>
              <div><span>cached token比率</span><strong>{percentage(data.planningEfficiency.cacheHitTokenRatio)}</strong></div>
            </div>
            {data.planningEfficiency.estimatedCostUnknownCount > 0 ? (
              <p className="admin-overview-empty">費用未算出のplanning requestが {formatNumber(data.planningEfficiency.estimatedCostUnknownCount)}件あるため、turn単価は未確定です。</p>
            ) : null}
          </section>

          {data.total.failureCount > 0 || data.total.totalTokensUnknownCount > 0 || data.total.estimatedCostUnknownCount > 0 ? (
            <section className="admin-overview-alert panel">
              <AlertTriangle aria-hidden="true" size={20} />
              <div>
                <strong>要確認の観測があります</strong>
                <p>失敗 {formatNumber(data.total.failureCount)}件、token未計測 {formatNumber(data.total.totalTokensUnknownCount)}件、費用未算出 {formatNumber(data.total.estimatedCostUnknownCount)}件です。未知値は0として扱っていません。</p>
              </div>
            </section>
          ) : null}

          <DimensionTable title="Model別" description="実際にproviderへ送ったmodel単位の集計です。" rows={data.byModel} />
          <DimensionTable title="Purpose別" description="StudyPlanner内の機能目的ごとの利用量と品質を比較します。" rows={data.byPurpose} />
          <DimensionTable title="Phase別" description="initial / repair / singleを同じ期間条件で比較します。" rows={data.byPhase} />
          <DimensionTable title="Operation別" description="chat completion、OCR、添付解析、文字起こし等のoperation種別で比較します。" rows={data.byOperationKind ?? []} />
        </>
      ) : null}
    </main>
  );
}
