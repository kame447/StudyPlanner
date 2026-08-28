import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Filter,
  ListRestart,
  Search,
  Users,
} from 'lucide-react';
import type { ObservabilityAdminIdentityMatch } from '../../shared/productObservabilityAdminReadModel';
import type { ObservabilityUserSummary } from '../../shared/productObservabilityReadModel';
import { useAdminDataLoader } from '../hooks/useAdminData';
import {
  getAdminObservabilityUsers,
  resolveAdminObservabilityUserIdentity,
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

function formatActorId(actorSubjectId: string): string {
  return actorSubjectId.length > 28
    ? `${actorSubjectId.slice(0, 16)}…${actorSubjectId.slice(-8)}`
    : actorSubjectId;
}

type UserFilter = 'all' | 'product' | 'ai' | 'planning';
type UserSort = 'recent' | 'events' | 'actor';

function initialFilter(): UserFilter {
  const value = new URLSearchParams(window.location.search).get('filter');
  return value === 'product' || value === 'ai' || value === 'planning' ? value : 'all';
}

function initialSort(): UserSort {
  const value = new URLSearchParams(window.location.search).get('sort');
  return value === 'events' || value === 'actor' ? value : 'recent';
}

export function AdminUsersPage({ navigate }: { navigate: (path: string) => void }) {
  const loadUsers = useCallback(
    () => getAdminObservabilityUsers({ environment: 'production', limit: 100 }),
    [],
  );
  const { loadState, data, errorMessage } = useAdminDataLoader(
    loadUsers,
    { users: [] as ObservabilityUserSummary[], nextCursor: null as string | null },
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
  const [extraUsers, setExtraUsers] = useState<ObservabilityUserSummary[]>([]);
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

  const resolvedCursor = nextCursor === undefined ? data.nextCursor : nextCursor;
  const users = useMemo(() => [...data.users, ...extraUsers], [data.users, extraUsers]);
  const visibleUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = users.filter((user) => {
      if (query && !user.actorSubjectId.toLowerCase().includes(query)) return false;
      if (filter === 'product') return user.productActivityCount > 0;
      if (filter === 'ai') return user.aiRequestCount > 0;
      if (filter === 'planning') return user.planningOutcomeCount > 0;
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'events') {
        return right.eventCount - left.eventCount
          || left.actorSubjectId.localeCompare(right.actorSubjectId);
      }
      if (sort === 'actor') return left.actorSubjectId.localeCompare(right.actorSubjectId);
      return right.lastActivityAt.localeCompare(left.lastActivityAt)
        || left.actorSubjectId.localeCompare(right.actorSubjectId);
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
        limit: 100,
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
          <p>通常分析は匿名actorだけを使い、必要なときだけプロフィールからactorを制限付きで照合します。</p>
        </div>
      </header>

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
            placeholder="actor IDで絞り込み"
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
            <option value="actor">actor ID順</option>
          </select>
        </label>
      </section>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>bounded user summaryを取得しています。</p>
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
                <strong>該当するactorがいません</strong>
              </div>
            ) : visibleUsers.map((user) => (
              <button
                key={user.actorSubjectId}
                className="admin-user-card panel"
                onClick={() => navigate(`/admin/users/${encodeURIComponent(user.actorSubjectId)}`)}
                type="button"
              >
                <span className="admin-user-card-main">
                  <span className="admin-user-avatar" aria-hidden="true">
                    <Users size={18} />
                  </span>
                  <span className="admin-user-copy">
                    <strong>{formatActorId(user.actorSubjectId)}</strong>
                    <code>{user.actorSubjectId}</code>
                    <span>初回観測 {formatTimestamp(user.firstActivityAt)}</span>
                  </span>
                </span>
                <span className="admin-user-stats">
                  <span>最終利用 <strong>{formatTimestamp(user.lastActivityAt)}</strong></span>
                  <span>イベント <strong>{user.eventCount}件</strong></span>
                  <span>操作 <strong>{user.productActivityCount}件</strong></span>
                  <span><Bot aria-hidden="true" size={14} /> AI <strong>{user.aiRequestCount}件</strong></span>
                  <span>計画 <strong>{user.planningOutcomeCount}件</strong></span>
                </span>
                <ChevronRight className="admin-user-card-icon" aria-hidden="true" size={22} />
              </button>
            ))}
          </section>

          {resolvedCursor ? (
            <section className="admin-section-card panel">
              <button className="ghost-button" type="button" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? '読み込み中…' : '次の100件を読み込む'}
              </button>
              {loadMoreError ? <p role="alert">{loadMoreError}</p> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
