import { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarDays,
  Clock3,
  ListTree,
  ShieldCheck,
} from 'lucide-react';
import type { ObservabilityUserTimelineItem } from '../../shared/productObservabilityAdminReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import {
  getAdminObservabilityUserInvestigation,
  type AdminObservabilityUserInvestigation,
} from '../services/adminObservabilityService';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '未観測';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

function formatCost(value: number | null): string {
  if (value === null) return '費用未確定';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value / 1_000_000);
}

function timelineTitle(item: ObservabilityUserTimelineItem): string {
  if (item.eventType === 'product_activity') return item.productAction ?? 'プロダクト操作';
  if (item.eventType === 'planning_outcome') return item.planningOutcome ?? 'AI計画イベント';
  return item.ai ? `${item.ai.model} · ${item.ai.status}` : 'AIリクエスト';
}

function timelineDetail(item: ObservabilityUserTimelineItem): string {
  if (item.ai) {
    const tokens = item.ai.totalTokens === null ? 'token未計測' : `${item.ai.totalTokens} tokens`;
    return `${item.ai.purpose} / ${item.ai.phase} / ${tokens} / ${formatCost(item.ai.estimatedCostMicros)} / ${Math.round(item.ai.durationMs)}ms`;
  }
  if (item.productAction) return `product activity · ${item.productAction}`;
  if (item.planningOutcome) return `planning outcome · ${item.planningOutcome}`;
  return item.eventType;
}

export function AdminUserDetailPage({
  userId,
  navigate,
}: {
  userId: string;
  navigate: (path: string) => void;
}) {
  const loadDetail = useCallback(
    () => getAdminObservabilityUserInvestigation({
      actorSubjectId: userId,
      environment: 'production',
      limit: 50,
    }),
    [userId],
  );
  const { loadState, data: detail, errorMessage } = useAdminDataLoader<
    AdminObservabilityUserInvestigation | null
  >(
    loadDetail,
    null,
    'actorの観測履歴を取得できませんでした。',
  );
  const [extraTimeline, setExtraTimeline] = useState<ObservabilityUserTimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');

  const timeline = useMemo(
    () => [...(detail?.timeline ?? []), ...extraTimeline],
    [detail?.timeline, extraTimeline],
  );
  const resolvedCursor = nextCursor === undefined ? detail?.nextCursor ?? null : nextCursor;

  async function loadMore() {
    if (!resolvedCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await getAdminObservabilityUserInvestigation({
        actorSubjectId: userId,
        environment: 'production',
        cursor: resolvedCursor,
        limit: 50,
      });
      setExtraTimeline((current) => [...current, ...page.timeline]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : '続きの履歴を取得できませんでした。');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="admin-shell admin-detail-shell">
      <button
        className="ghost-button admin-back-button"
        onClick={() => navigate('/admin/users')}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
        Users
      </button>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>bounded observability timelineを取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' && detail && !detail.summary && detail.timeline.length === 0 ? (
        <section className="admin-state-card panel">
          <strong>actorが見つかりません</strong>
        </section>
      ) : null}

      {detail ? (
        <>
          <section className="admin-profile-card panel">
            <div className="admin-title-row">
              <span className="admin-user-avatar admin-user-avatar-large" aria-hidden="true">
                <Activity size={22} />
              </span>
              <div>
                <p className="admin-overview-eyebrow">Opaque actor</p>
                <h1>ユーザー調査</h1>
                <code>{detail.actorSubjectId}</code>
              </div>
            </div>
            <span className="admin-readonly-badge">
              <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
              read-only
            </span>
          </section>

          <section className="admin-metric-grid" aria-label="actorサマリー">
            <article className="admin-metric-card panel">
              <span><Clock3 aria-hidden="true" size={16} /> 初回観測</span>
              <strong>{formatTimestamp(detail.summary?.firstActivityAt)}</strong>
            </article>
            <article className="admin-metric-card panel">
              <span><Clock3 aria-hidden="true" size={16} /> 最終観測</span>
              <strong>{formatTimestamp(detail.summary?.lastActivityAt)}</strong>
            </article>
            <article className="admin-metric-card panel">
              <span><CalendarDays aria-hidden="true" size={16} /> 利用日数</span>
              <strong>{detail.activeDayCount}日</strong>
            </article>
            <article className="admin-metric-card panel">
              <span><Bot aria-hidden="true" size={16} /> AIリクエスト</span>
              <strong>{detail.summary?.aiRequestCount ?? 0}件</strong>
            </article>
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <div>
                <h2>観測サマリー</h2>
                <p>planner本体のcollectionを読み直さず、集計済みread modelだけを表示します。</p>
              </div>
              <ListTree aria-hidden="true" size={18} />
            </div>
            <div className="admin-overview-status-list">
              <div className="admin-overview-status-row">
                <span />
                <strong>全イベント</strong>
                <span>{detail.summary?.eventCount ?? 0}件</span>
              </div>
              <div className="admin-overview-status-row">
                <span />
                <strong>プロダクト操作</strong>
                <span>{detail.summary?.productActivityCount ?? 0}件</span>
              </div>
              <div className="admin-overview-status-row">
                <span />
                <strong>AI計画outcome</strong>
                <span>{detail.summary?.planningOutcomeCount ?? 0}件</span>
              </div>
              <div className="admin-overview-status-row">
                <span />
                <strong>最終product action</strong>
                <span>{detail.summary?.lastProductAction ?? '未観測'}</span>
              </div>
            </div>
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <div>
                <h2>Timeline</h2>
                <p>保持中のlightweight telemetryを時系列で最大50件ずつ読みます。</p>
              </div>
            </div>
            {timeline.length === 0 ? (
              <p>このactorの保持中イベントはありません。</p>
            ) : (
              <div className="admin-observability-timeline">
                {timeline.map((item) => (
                  <article className="admin-observability-timeline-item" key={item.eventId}>
                    <time>{formatTimestamp(item.occurredAt)}</time>
                    <div>
                      <strong>{timelineTitle(item)}</strong>
                      <p>{timelineDetail(item)}</p>
                      <small>app {item.appVersion}</small>
                      {item.featureSessionId ? <code>feature: {item.featureSessionId}</code> : null}
                      {item.requestId ? <code>request: {item.requestId}</code> : null}
                      {item.traceSessionId ? <code>trace: {item.traceSessionId}</code> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {resolvedCursor ? (
              <button className="ghost-button" type="button" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? '読み込み中…' : '次の50件を読み込む'}
              </button>
            ) : null}
            {loadMoreError ? <p role="alert">{loadMoreError}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
