import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Filter,
  ListRestart,
  Search,
  Users,
} from 'lucide-react';
import type {
  ObservabilityAdminIdentityMatch,
  ObservabilityAdminUserListItem,
} from '../../shared/productObservabilityAdminReadModel';
import type {
  ObservabilityDailyRollup,
  ObservabilityOverviewReadModel,
} from '../../shared/productObservabilityReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import {
  getAdminObservabilityOverview,
  getAdminObservabilityUsers,
  resolveAdminObservabilityUserIdentity,
  type AdminObservabilityUserPage,
} from '../services/adminObservabilityService';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '未観測';
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

function formatOpaqueId(value: string): string {
  return value.length > 28
    ? `${value.slice(0, 16)}…${value.slice(-8)}`
    : value;
}

function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function shortDate(localDate: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}

function recentErrorLabel(user: ObservabilityAdminUserListItem): string {
  if (user.recentErrorState === 'unknown') return '未確認';
  if (user.recentErrorState === 'absent') return 'なし';
  const category = user.recentErrorCategory ? ` · ${user.recentErrorCategory}` : '';
  return `${formatTimestamp(user.recentErrorAt)}${category}`;
}

type UserFilter = 'all' | 'product' | 'ai' | 'planning';
type UserSort = 'recent' | 'events' | 'actor';

interface UsersPageData {
  page: AdminObservabilityUserPage;
  trend: ObservabilityOverviewReadModel;
}

function initialFilter(): UserFilter {
  const value = new URLSearchParams(window.location.search).get('filter');
  return value === 'product' || value === 'ai' || value === 'planning' ? value : 'all';
}

function initialSort(): UserSort {
  const value = new URLSearchParams(window.location.search).get('sort');
  return value === 'events' || value === 'actor' ? value : 'recent';
}

function UserTrend({ daily }: { daily: ObservabilityDailyRollup[] }) {
  const max = Math.max(1, ...daily.map((entry) => entry.activeActorCount));
  if (daily.length === 0) {
    return <p className="admin-overview-empty">直近30日の利用データはまだありません。</p>;
  }
  return (
    <div className="admin-users-trend" aria-label="直近30日の利用ユーザー推移">
      <div className="admin-users-trend-bars">
        {daily.map((entry) => (
          <span
            key={entry.localDate}
            style={{ height: `${Math.max(4, (entry.activeActorCount / max) * 100)}%` }}
            title={`${shortDate(entry.localDate)}: ${entry.activeActorCount}人`}
          />
        ))}
      </div>
      <div className="admin-users-trend-axis">
        <span>{shortDate(daily[0].localDate)}</span>
        <span>1日ごとの利用ユーザー数</span>
        <span>{shortDate(daily[daily.length - 1].localDate)}</span>
      </div>
    </div>
  );
}

export function AdminUsersPage({ navigate }: { navigate: (path: string) => void }) {
  const loadUsers = useCallback(async (): Promise<UsersPageData> => {
    const toDate = todayInTokyo();
    const [page, trend] = await Promise.all([
      getAdminObservabilityUsers({ environment: 'production', limit: 25 }),
      getAdminObservabilityOverview({
        environment: 'production',
        fromDate: shiftDate(toDate, -29),
        toDate,
      }),
    ]);
    return { page, trend };
  }, []);
  const { loadState, data, errorMessage } = useAdminDataLoader<UsersPageData>(
    loadUsers,
    {
      page: { users: [], nextCursor: null },
      trend: {
        schemaVersion: 1,
        fromDate: '',
        toDate: '',
        reportingTimeZone: 'Asia/Tokyo',
        registeredUsers: {
          total: 0,
          newInPeriod: null,
          registrationIndexReady: false,
          scope: 'firebase_project',
        },
        period: {
          processedEventCount: 0,
          firstOccurredAt: null,
          lastOccurredAt: null,
          productActivity: { eventCount: 0, actionCounts: {} },
          ai: {
            requestCount: 0,
            successCount: 0,
            failureCount: 0,
            statusCounts: {},
            promptTokens: 0,
            promptTokensUnknownCount: 0,
            completionTokens: 0,
            completionTokensUnknownCount: 0,
            totalTokens: 0,
            totalTokensUnknownCount: 0,
            cachedTokens: 0,
            cachedTokensUnknownCount: 0,
            estimatedCostMicros: 0,
            estimatedCostUnknownCount: 0,
            latency: {
              version: 'latency-ms-v1',
              bucketCounts: Array(10).fill(0),
              sampleCount: 0,
              sumMs: 0,
              minMs: null,
              maxMs: null,
            },
          },
          planning: {
            outcomeCounts: {},
            previewCountSum: 0,
            previewCountUnknownCount: 0,
            unscheduledCountSum: 0,
            unscheduledCountUnknownCount: 0,
          },
        },
        daily: [],
        activeUsers: null,
        aiLatencyP50Ms: null,
        aiLatencyP95Ms: null,
        rollupCheckpoint: {
          schemaVersion: 1,
          cursor: null,
          processedEventCount: 0,
          activeUserDirtySources: [],
          lastRunStartedAt: null,
          lastSuccessfulRunAt: null,
          lastFailureAt: null,
          lastFailureCategory: null,
          updatedAt: new Date(0).toISOString(),
        },
      },
    },
    'ユーザー分析を取得できませんでした。',
  );
  const [searchQuery, setSearchQuery] = useState(
    () => new URLSearchParams(window.location.search).get('actor') ?? '',
  );
  const [filter, setFilter] = useState<UserFilter>(initialFilter);
  const [sort, setSort] = useState<UserSort>(initialSort);
  const [identityQuery, setIdentityQuery] = useState('');
  const [identityMatches, setIdentityMatches] = useState<ObservabilityAdminIdentityMatch[]>([]);
  const [identityState, setIdentityState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [identityError, setIdentityError] = useState('');
  const [extraUsers, setExtraUsers] = useState<ObservabilityAdminUserListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('actor', searchQuery.trim());
    if (filter !== 'all') params.set('filter', filter);
    if (sort !== 'recent') params.set('sort', sort);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [filter, searchQuery, sort]);

  const resolvedCursor = nextCursor === undefined ? data.page.nextCursor : nextCursor;
  const users = useMemo(() => [...data.page.users, ...extraUsers], [data.page.users, extraUsers]);
  const visibleUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = users.filter((user) => {
      const actor = user.actorSubjectId?.toLowerCase() ?? '';
      if (query && !actor.includes(query) && !user.profileSubjectId.toLowerCase().includes(query)) return false;
      if (filter === 'product') return user.productActivityCount > 0;
      if (filter === 'ai') return user.aiRequestCount > 0;
      if (filter === 'planning') return user.planningOutcomeCount > 0;
      return true;
    });
    return [...filtered].sort((left, right) => {
      const leftId = left.actorSubjectId ?? left.profileSubjectId;
      const rightId = right.actorSubjectId ?? right.profileSubjectId;
      if (sort === 'events') {
        return right.eventCount - left.eventCount || leftId.localeCompare(rightId);
      }
      if (sort === 'actor') return leftId.localeCompare(rightId);
      const recency = (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '');
      return recency || leftId.localeCompare(rightId);
    });
  }, [filter, searchQuery, sort, users]);

  async function searchIdentity() {
    const query = identityQuery.trim();
    if (!query) return;
    setIdentityState('loading');
    setIdentityError('');
    try {
      const matches = await resolveAdminObservabilityUserIdentity(query);
      setIdentityMatches(matches);
      setIdentityState('ready');
    } catch (error) {
      setIdentityMatches([]);
      setIdentityError(error instanceof Error ? error.message : 'プロフィールを検索できませんでした。');
      setIdentityState('error');
    }
  }

  async function loadMore() {
    if (!resolvedCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await getAdminObservabilityUsers({
        environment: 'production',
        cursor: resolvedCursor,
        limit: 25,
      });
      setExtraUsers((current) => [...current, ...page.users]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : '追加のユーザーを取得できませんでした。');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-overview-header">
        <div>
          <p className="admin-overview-eyebrow">Product Observability</p>
          <h1>Users</h1>
          <p>プロフィールauthorityと匿名actor集計をserver-sideで制限付きに結合し、個人情報をanalyticsへ複製せず利用状況を確認します。</p>
        </div>
      </header>

      {loadState === 'ready' ? (
        <section className="admin-section-card panel">
          <div className="admin-section-heading">
            <div>
              <h2>利用ユーザーの30日推移</h2>
              <p>日ごとのdistinct actor数を表示します。30日利用者数の単純分解ではありません。</p>
            </div>
            <span>{data.trend.activeUsers?.last30Days ?? '未集計'}人 / 直近30日</span>
          </div>
          <UserTrend daily={data.trend.daily} />
        </section>
      ) : null}

      <section className="admin-identity-search panel">
        <div>
          <strong>プロフィールから調査を開始</strong>
          <p>メールアドレス、Firebase UID、またはユーザー名の完全一致で検索します。個人情報はanalyticsへ保存しません。</p>
        </div>
        <div className="admin-identity-search-row">
          <label className="admin-search-field">
            <Search aria-hidden="true" size={18} strokeWidth={2} />
            <input
              value={identityQuery}
              onChange={(event) => setIdentityQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchIdentity();
              }}
              placeholder="email / UID / ユーザー名"
              type="search"
            />
          </label>
          <button className="ghost-button" type="button" disabled={identityState === 'loading'} onClick={() => void searchIdentity()}>
            {identityState === 'loading' ? '検索中…' : '照合'}
          </button>
        </div>
        {identityState === 'error' ? <p role="alert">{identityError}</p> : null}
        {identityState === 'ready' && identityMatches.length === 0 ? (
          <p>一致するプロフィールはありません。</p>
        ) : null}
        {identityMatches.length > 0 ? (
          <div className="admin-identity-results">
            {identityMatches.map((match) => (
              <article className="admin-identity-result" key={match.firebaseUid}>
                <div>
                  <strong>{match.username}</strong>
                  <span>{match.email || 'メール未設定'}</span>
                  <small>登録 {formatTimestamp(match.registeredAt)}</small>
                  <code>{match.firebaseUid}</code>
                </div>
                {match.actorSubjectId ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => navigate(`/admin/users/${encodeURIComponent(match.actorSubjectId ?? '')}`)}
                  >
                    観測履歴を開く
                  </button>
                ) : (
                  <span className="admin-readonly-badge">まだ観測なし</span>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-search-card panel">
        <label className="admin-search-field">
          <Search aria-hidden="true" size={18} strokeWidth={2} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="actor / profile IDで絞り込み"
            type="search"
          />
        </label>
        <label className="admin-search-field">
          <Filter aria-hidden="true" size={18} strokeWidth={2} />
          <select value={filter} onChange={(event) => setFilter(event.target.value as UserFilter)}>
            <option value="all">すべて</option>
            <option value="product">プロダクト操作あり</option>
            <option value="ai">AI利用あり</option>
            <option value="planning">AI計画の観測あり</option>
          </select>
        </label>
        <label className="admin-search-field">
          <ListRestart aria-hidden="true" size={18} strokeWidth={2} />
          <select value={sort} onChange={(event) => setSort(event.target.value as UserSort)}>
            <option value="recent">最終利用が新しい順</option>
            <option value="events">観測イベントが多い順</option>
            <option value="actor">匿名ID順</option>
          </select>
        </label>
      </section>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>bounded user projectionを取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' ? (
        <>
          <section className="admin-user-list" aria-label="匿名化ユーザー一覧">
            {visibleUsers.length === 0 ? (
              <div className="admin-state-card panel">
                <strong>該当するユーザーがいません</strong>
              </div>
            ) : visibleUsers.map((user) => {
              const displayId = user.actorSubjectId ?? user.profileSubjectId;
              return (
                <button
                  key={user.profileSubjectId}
                  className="admin-user-card panel"
                  disabled={!user.actorSubjectId}
                  onClick={() => {
                    if (user.actorSubjectId) {
                      navigate(`/admin/users/${encodeURIComponent(user.actorSubjectId)}`);
                    }
                  }}
                  type="button"
                >
                  <span className="admin-user-card-main">
                    <span className="admin-user-avatar" aria-hidden="true">
                      <Users size={18} />
                    </span>
                    <span className="admin-user-copy">
                      <strong>{formatOpaqueId(displayId)}</strong>
                      <code>{displayId}</code>
                      <span>登録 {formatTimestamp(user.registeredAt)}</span>
                      <span>初回観測 {formatTimestamp(user.firstActivityAt)}</span>
                    </span>
                  </span>
                  <span className="admin-user-stats">
                    <span>最終利用 <strong>{formatTimestamp(user.lastActivityAt)}</strong></span>
                    <span>利用日数 <strong>{user.activeDayCount}日</strong></span>
                    <span>操作 <strong>{user.productActivityCount}件</strong></span>
                    <span><Bot aria-hidden="true" size={14} /> AI <strong>{user.aiRequestCount}件</strong></span>
                    <span>計画 <strong>{user.planningOutcomeCount}件</strong></span>
                    <span>直近error <strong>{recentErrorLabel(user)}</strong></span>
                  </span>
                  {user.actorSubjectId ? (
                    <ChevronRight className="admin-user-card-icon" aria-hidden="true" size={22} />
                  ) : (
                    <span className="admin-readonly-badge">まだ観測なし</span>
                  )}
                </button>
              );
            })}
          </section>

          {resolvedCursor ? (
            <section className="admin-section-card panel">
              <button className="ghost-button" type="button" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? '読み込み中…' : '次の25件を読み込む'}
              </button>
              {loadMoreError ? <p role="alert">{loadMoreError}</p> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
