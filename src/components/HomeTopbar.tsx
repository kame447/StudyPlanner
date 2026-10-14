import { useHomeDisplayClock } from './home/HomeDisplayClockContext';
import { useMemo } from 'react';
import { Menu } from 'lucide-react';
import { collectStudyDates } from '../lib/studyStreak';
import { StudyStreakFlame } from './StudyStreakFlame';
import { useSharedStudyStreak } from './StudyStreakContext';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan, TodoTask, User } from '../types/domain';
import { AnnouncementsButton } from './AnnouncementsButton';
import { HomeDateDisplay } from './HomeDateDisplay';
import { UserAvatar } from './UserAvatar';

interface HomeTopbarProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenStudyStreak?: () => void;
}

export function HomeTopbar({
  user,
  plans,
  actuals,
  todos,
  onOpenProfile,
  onOpenSettings,
  onOpenStudyStreak,
}: HomeTopbarProps) {
  const now = useHomeDisplayClock();
  const dashboard = useMemo(
    () => buildHomeDashboardModel({ plans, actuals, todos, now }),
    [actuals, plans, todos, now],
  );

  const studiedToday = useMemo(() => collectStudyDates({ userId: user.id, plans, actuals, today: dashboard.today }).includes(dashboard.today),
    [user.id, plans, actuals, dashboard.today]);

  const shared = useSharedStudyStreak();
  const verifiedModel = shared?.userId === user.id && shared.today === dashboard.today
    && shared.plans === plans && shared.actuals === actuals && shared.controller.model?.historyComplete
    && shared.controller.model.today === dashboard.today
    ? shared.controller.model : null;
  const currentStreak = verifiedModel?.currentStreak ?? null;
  const bestStreak = verifiedModel?.bestStreak ?? null;

  return (
    <header className="home-topbar">
      <button className="home-streak-card" type="button" aria-busy={shared?.userId === user.id && shared.controller.refreshing} aria-label={`連続学習 ${currentStreak === null ? '未確認' : `${currentStreak}日`}、学習記録を開く`} onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        onOpenStudyStreak?.();
      }}>
        <StudyStreakFlame className="home-streak-flame" studiedToday={studiedToday} size={30} />
        <div>
          <span>連続学習</span>
          <strong>{currentStreak ?? '—'}日</strong>
          <small>最高 {bestStreak ?? '—'}日</small>
        </div>
      </button>

      <HomeDateDisplay date={dashboard.today} />

      <div className="home-top-actions">
        <AnnouncementsButton userId={user.id} />
        <button
          className="home-avatar-button"
          type="button"
          onClick={onOpenProfile}
          aria-label="マイページを開く"
        >
          <UserAvatar user={user} small />
        </button>
        <button
          className="home-icon-button"
          type="button"
          onClick={(event) => {
            // Safari does not focus a button on pointer activation by default.
            event.currentTarget.focus({ preventScroll: true });
            onOpenSettings();
          }}
          aria-label="メニューを開く"
        >
          <Menu aria-hidden="true" size={24} />
        </button>
      </div>
    </header>
  );
}
