import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Search, ShieldCheck, Users } from 'lucide-react';
import { filterAdminUserSummaries } from '../lib/adminAnalytics';
import { formatMinutes } from '../lib/date';
import { getAdminUserSummaries } from '../services/adminDataService';
import { useAdminDataLoader } from '../hooks/useAdminData';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '未更新';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatUid(uid: string): string {
  return uid.length > 18 ? `${uid.slice(0, 8)}...${uid.slice(-6)}` : uid;
}

export function AdminUsersPage({ navigate }: { navigate: (path: string) => void }) {
  const loadUsers = useCallback(() => getAdminUserSummaries(), []);
  const { loadState, data: users, errorMessage } = useAdminDataLoader(
    loadUsers,
    [],
    'ユーザー一覧を取得できませんでした。',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const filteredUsers = useMemo(
    () => filterAdminUserSummaries(users, searchQuery),
    [searchQuery, users],
  );

  return (
    <main className="admin-shell">
      <section className="admin-hero panel">
        <div className="admin-title-row">
          <span className="admin-icon-badge">
            <Users aria-hidden="true" size={22} strokeWidth={1.9} />
          </span>
          <div>
            <h1>Users</h1>
            <p>ユーザーの学習状況を read-only で確認します。</p>
          </div>
        </div>
        <span className="admin-readonly-badge">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          read-only
        </span>
      </section>

      <section className="admin-search-card panel">
        <label className="admin-search-field">
          <Search aria-hidden="true" size={18} strokeWidth={2} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="表示名・メール・uidで検索"
            type="search"
          />
        </label>
      </section>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>ユーザー情報と学習状況を取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' ? (
        <section className="admin-user-list" aria-label="ユーザー一覧">
          {filteredUsers.length === 0 ? (
            <div className="admin-state-card panel">
              <strong>該当するユーザーがいません</strong>
            </div>
          ) : (
            filteredUsers.map(({ profile, stats }) => (
              <button
                key={profile.id}
                className="admin-user-card panel"
                onClick={() =>
                  navigate(`/admin/users/${encodeURIComponent(profile.id)}`)
                }
                type="button"
              >
                <span className="admin-user-card-main">
                  <span className="admin-user-avatar" aria-hidden="true">
                    {profile.avatar || profile.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="admin-user-copy">
                    <strong>{profile.username}</strong>
                    <span>{profile.email || 'メール未設定'}</span>
                    <code>{formatUid(profile.id)}</code>
                  </span>
                </span>
                <span className="admin-user-stats">
                  <span>
                    今日 <strong>{formatMinutes(stats.todayStudyMinutes)}</strong>
                  </span>
                  <span>
                    今週 <strong>{formatMinutes(stats.weekStudyMinutes)}</strong>
                  </span>
                  <span>
                    記録 <strong>{stats.todayActualCount}件</strong>
                  </span>
                  <span>
                    Todo <strong>{stats.incompleteTodoCount}件</strong>
                  </span>
                  <span>
                    更新 <strong>{formatTimestamp(stats.lastUpdatedAt)}</strong>
                  </span>
                </span>
                <ChevronRight
                  className="admin-user-card-icon"
                  aria-hidden="true"
                  size={22}
                  strokeWidth={1.9}
                />
              </button>
            ))
          )}
        </section>
      ) : null}
    </main>
  );
}
