import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, ServerCog, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilitySystemComponentKey,
  ObservabilitySystemHealth,
  ObservabilitySystemReadModel,
} from '../../shared/productObservabilitySystemReadModel';
import { getAdminObservabilitySystemStatus } from '../services/adminObservabilityService';

const COMPONENT_LABELS: Record<ObservabilitySystemComponentKey, string> = {
  ai_proxy: 'AI proxy',
  authentication: 'Authentication',
  telemetry_ingestion: 'Telemetry ingestion',
  aggregation_read_model: 'Aggregation / read model',
  trace_availability: 'Trace availability（全環境）',
};

const STATUS_LABELS: Record<ObservabilitySystemHealth, string> = {
  healthy: '正常',
  warning: '要確認',
  unavailable: '利用不可',
  unknown: '未判定',
};

const ENVIRONMENT_LABELS: Record<ObservabilityEnvironment, string> = {
  production: '本番環境',
  preview: 'プレビュー',
  development: '開発環境',
  test: 'テスト',
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  return `${Math.floor(seconds / 3600)}時間前`;
}

function StatusIcon({ status }: { status: ObservabilitySystemHealth }) {
  if (status === 'healthy') return <CheckCircle2 aria-hidden="true" size={20} />;
  if (status === 'warning') return <AlertTriangle aria-hidden="true" size={20} />;
  if (status === 'unavailable') return <XCircle aria-hidden="true" size={20} />;
  return <CircleHelp aria-hidden="true" size={20} />;
}

export function AdminSystemPage() {
  const [environment, setEnvironment] = useState<ObservabilityEnvironment>('production');
  const [data, setData] = useState<ObservabilitySystemReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setData(await getAdminObservabilitySystemStatus({ environment }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'System statusを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="admin-shell admin-system-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-page-eyebrow">Read-only infrastructure status</span>
          <h1>System</h1>
          <p>利用分析ではなく、観測基盤と主要依存先が調査可能な状態かを確認します。</p>
        </div>
        <div className="admin-overview-controls" aria-label="System表示条件">
          <label>
            <span>環境</span>
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as ObservabilityEnvironment)}
              disabled={loading}
            >
              {(Object.keys(ENVIRONMENT_LABELS) as ObservabilityEnvironment[]).map((key) => (
                <option key={key} value={key}>{ENVIRONMENT_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <button
            className="admin-overview-refresh-button"
            type="button"
            disabled={loading}
            onClick={() => { void load(); }}
            aria-label="System statusを再読み込み"
            title="再読み込み"
          >
            <RefreshCw aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      {loading ? (
        <section className="admin-state-card panel" aria-live="polite"><strong>System statusを確認しています</strong></section>
      ) : null}
      {error ? (
        <section className="admin-state-card panel" role="alert"><strong>System statusを取得できませんでした</strong><p>{error}</p></section>
      ) : null}

      {!loading && !error && data ? (
        <>
          <section className={`panel admin-system-summary is-${data.overallStatus}`}>
            <div className="admin-system-summary-icon"><ServerCog aria-hidden="true" size={24} /></div>
            <div>
              <span>全体状態</span>
              <strong>{STATUS_LABELS[data.overallStatus]}</strong>
              <small>{ENVIRONMENT_LABELS[data.environment]} · {formatTimestamp(data.generatedAt)}</small>
            </div>
          </section>

          <section className="admin-system-grid" aria-label="System components">
            {data.components.map((component) => (
              <article className={`panel admin-system-component is-${component.status}`} key={component.key}>
                <div className="admin-system-component-head">
                  <div className="admin-system-status-icon"><StatusIcon status={component.status} /></div>
                  <div>
                    <span>{COMPONENT_LABELS[component.key]}</span>
                    <strong>{STATUS_LABELS[component.status]}</strong>
                  </div>
                </div>
                <p>{component.summary}</p>
                <dl>
                  <div><dt>最終観測</dt><dd>{formatTimestamp(component.lastObservedAt)}</dd></div>
                  <div><dt>経過</dt><dd>{formatAge(component.ageSeconds)}</dd></div>
                </dl>
                {component.detail ? <small>{component.detail}</small> : null}
              </article>
            ))}
          </section>

          <section className="admin-system-detail-grid">
            <article className="panel admin-system-detail-card">
              <h2>Aggregation</h2>
              <dl>
                <div><dt>処理済みevent（全環境）</dt><dd>{data.aggregation.processedEventCount ?? '—'}</dd></div>
                <div><dt>再集計待ちsource（選択環境）</dt><dd>{data.aggregation.dirtySourceCount ?? '—'}</dd></div>
                <div><dt>最終成功</dt><dd>{formatTimestamp(data.aggregation.lastSuccessfulRunAt)}</dd></div>
                <div><dt>最終失敗</dt><dd>{formatTimestamp(data.aggregation.lastFailureAt)}</dd></div>
              </dl>
              {data.aggregation.lastFailureCategory ? <p>{data.aggregation.lastFailureCategory}</p> : null}
            </article>
            <article className="panel admin-system-detail-card">
              <h2>Trace</h2>
              <dl>
                <div><dt>保存session（全環境）</dt><dd>{data.trace.retainedSessionObserved === null ? '不明' : data.trace.retainedSessionObserved ? 'あり' : 'なし'}</dd></div>
                <div><dt>最終activity</dt><dd>{formatTimestamp(data.trace.latestSessionActivityAt)}</dd></div>
                <div><dt>詳細アクセス</dt><dd>{data.trace.accessMode === 'restricted' ? '制限付き' : data.trace.accessMode}</dd></div>
              </dl>
              <p>詳細trace本文はLogs側の追加権限を通してのみ閲覧します。</p>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
