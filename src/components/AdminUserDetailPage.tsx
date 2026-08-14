import { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ShieldCheck,
} from 'lucide-react';
import { summarizePeriodReport } from '../lib/adminAnalytics';
import { addDays, addMonths, formatMinutes, todayIsoDate } from '../lib/date';
import { getAdminUserDetail } from '../services/adminDataService';
import { useAdminDataLoader } from '../hooks/useAdminData';
import type { AdminReportMode, AdminUserDetailData } from '../types/domain';
import { AdminAppReturnButton } from './AdminAppReturnButton';
import {
  AdminMetricCard,
  AdminReportPanel,
  formatReportRange,
  getReportModeLabel,
  Last7DaysSummary,
} from './AdminReportViews';

export function AdminUserDetailPage({
  userId,
  navigate,
}: {
  userId: string;
  navigate: (path: string) => void;
}) {
  const loadDetail = useCallback(() => getAdminUserDetail(userId), [userId]);
  const { loadState, data: detail, errorMessage } = useAdminDataLoader<
    AdminUserDetailData | null
  >(
    loadDetail,
    null,
    'ユーザー詳細を取得できませんでした。',
  );
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
