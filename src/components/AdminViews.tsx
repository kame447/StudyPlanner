import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  filterAdminUserSummaries,
  summarizePeriodReport,
} from '../lib/adminAnalytics';
import {
  addDays,
  addMonths,
  formatMinutes,
  todayIsoDate,
} from '../lib/date';
import {
  getAdminUserDetail,
  getAdminUserSummaries,
} from '../services/adminDataService';
import type {
  AdminReportMode,
  AdminUserDetailData,
  AdminUserSummary,
} from '../types/domain';
import {
  AdminMetricCard,
  AdminReportPanel,
  formatReportRange,
  getReportModeLabel,
  Last7DaysSummary,
} from './AdminReportViews';

interface AdminRoutesProps {
  path: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

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

function AdminAppReturnButton({
  onReturn,
}: {
  onReturn: () => void;
}) {
  return (
    <button
      className="ghost-button admin-app-return-button"
      onClick={onReturn}
      type="button"
    >
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
      通常画面に戻る
    </button>
  );
}

function AdminUsersPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const filteredUsers = useMemo(
    () => filterAdminUserSummaries(users, searchQuery),
    [searchQuery, users],
  );

  useEffect(() => {
    let active = true;

    setLoadState('loading');
    setErrorMessage('');

    getAdminUserSummaries()
      .then((nextUsers) => {
        if (!active) {
          return;
        }

        setUsers(nextUsers);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ユーザー一覧を取得できませんでした。',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="admin-shell">
      <AdminAppReturnButton onReturn={() => navigate('/')} />

      <section className="admin-hero panel">
        <div className="admin-title-row">
          <span className="admin-icon-badge">
            <Users aria-hidden="true" size={22} strokeWidth={1.9} />
          </span>
          <div>
            <h1>管理者画面</h1>
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

function AdminUserDetailPage({
  userId,
  navigate,
}: {
  userId: string;
  navigate: (path: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<AdminUserDetailData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [reportMode, setReportMode] = useState<AdminReportMode>('day');
  const [selectedDate, setSelectedDate] = useState(() => todayIsoDate());
  const reportSummary = useMemo(
    () =>
      detail
        ? summarizePeriodReport({
            mode: reportMode,
            selectedDate,
            plans: detail.plans,
            actuals: detail.actuals,
            todos: detail.todos,
            dayNotes: detail.dayNotes,
            materials: detail.studyMaterials,
          })
        : null,
    [detail, reportMode, selectedDate],
  );

  function moveReportPeriod(amount: number) {
    setSelectedDate((currentDate) => {
      if (reportMode === 'day') {
        return addDays(currentDate, amount);
      }

      if (reportMode === 'week') {
        return addDays(currentDate, amount * 7);
      }

      return addMonths(currentDate, amount);
    });
  }

  useEffect(() => {
    let active = true;

    setLoadState('loading');
    setErrorMessage('');

    getAdminUserDetail(userId)
      .then((nextDetail) => {
        if (!active) {
          return;
        }

        setDetail(nextDetail);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ユーザー詳細を取得できませんでした。',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <main className="admin-shell admin-detail-shell">
      <AdminAppReturnButton onReturn={() => navigate('/')} />

      <button
        className="ghost-button admin-back-button"
        onClick={() => navigate('/admin/users')}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
        ユーザー一覧
      </button>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>対象ユーザーの学習状況を取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' && !detail ? (
        <section className="admin-state-card panel">
          <strong>ユーザーが見つかりません</strong>
        </section>
      ) : null}

      {detail ? (
        <>
          <section className="admin-profile-card panel">
            <div className="admin-title-row">
              <span className="admin-user-avatar admin-user-avatar-large" aria-hidden="true">
                {detail.profile.avatar ||
                  detail.profile.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h1>{detail.profile.username}</h1>
                <p>{detail.profile.email || 'メール未設定'}</p>
                <code>{detail.profile.id}</code>
              </div>
            </div>
            <span className="admin-readonly-badge">
              <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
              read-only
            </span>
          </section>

          <section className="admin-metric-grid" aria-label="学習サマリー">
            <AdminMetricCard
              label="今日"
              value={formatMinutes(detail.stats.todayStudyMinutes)}
            />
            <AdminMetricCard
              label="今週"
              value={formatMinutes(detail.stats.weekStudyMinutes)}
            />
            <AdminMetricCard
              label="今日の記録"
              value={`${detail.stats.todayActualCount}件`}
            />
            <AdminMetricCard
              label="未完了 Todo"
              value={`${detail.stats.incompleteTodoCount}件`}
            />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-report-head">
              <div>
                <h2>レポート</h2>
                <p>過去の日・週・月の学習状況を read-only で確認します。</p>
              </div>
              <span className="admin-readonly-badge">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
                read-only
              </span>
            </div>

            <div className="admin-report-tabs" role="tablist" aria-label="管理者レポート">
              {(['day', 'week', 'month'] as AdminReportMode[]).map((mode) => (
                <button
                  key={mode}
                  className={reportMode === mode ? 'segment active' : 'segment'}
                  onClick={() => setReportMode(mode)}
                  role="tab"
                  aria-selected={reportMode === mode}
                  type="button"
                >
                  {getReportModeLabel(mode)}
                </button>
              ))}
            </div>

            {reportSummary ? (
              <div className="admin-period-nav">
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => moveReportPeriod(-1)}
                  type="button"
                  aria-label={`前の${getReportModeLabel(reportMode)}`}
                >
                  <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
                <strong>{formatReportRange(reportSummary)}</strong>
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => moveReportPeriod(1)}
                  type="button"
                  aria-label={`次の${getReportModeLabel(reportMode)}`}
                >
                  <ChevronRight aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
              </div>
            ) : null}
          </section>

          {reportSummary ? <AdminReportPanel report={reportSummary} /> : null}

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <h2>直近7日間</h2>
              <span>
                <Clock3 aria-hidden="true" size={15} strokeWidth={2} />
                現在基準
              </span>
            </div>
            <Last7DaysSummary entries={detail.last7Days} />
          </section>
        </>
      ) : null}
    </main>
  );
}

export function AdminRoutes({ path, navigate }: AdminRoutesProps) {
  useEffect(() => {
    if (path === '/admin') {
      navigate('/admin/users', { replace: true });
    }
  }, [navigate, path]);

  if (path === '/admin') {
    return (
      <main className="admin-shell">
        <AdminAppReturnButton onReturn={() => navigate('/')} />

        <section className="admin-state-card panel">
          <strong>管理者画面へ移動しています</strong>
        </section>
      </main>
    );
  }

  if (path === '/admin/users') {
    return <AdminUsersPage navigate={(nextPath) => navigate(nextPath)} />;
  }

  const detailMatch = path.match(/^\/admin\/users\/([^/]+)$/);

  if (detailMatch) {
    return (
      <AdminUserDetailPage
        userId={decodeURIComponent(detailMatch[1])}
        navigate={(nextPath) => navigate(nextPath)}
      />
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-state-card panel">
        <strong>ページが見つかりません</strong>
      </section>
    </main>
  );
}
