import { useHomeDisplayClock } from './home/HomeDisplayClockContext';
import { useMemo } from 'react';
import { Flame, Menu } from 'lucide-react';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan, TodoTask, User } from '../types/domain';
import { AnnouncementsButton } from './AnnouncementsButton';
import { HomeDateDisplay } from './HomeDateDisplay';
import { UserAvatar } from './UserAvatar';

export interface VerifiedStudyStreakSummary {
  userId: string;
  today: string;
  plans: Plan[];
  actuals: Actual[];
  currentStreak: number;
  bestStreak: number;
}

interface HomeTopbarProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenStudyStreak?: () => void;
  streakSummary?: VerifiedStudyStreakSummary | null;
}

export function HomeTopbar({
  user,
  plans,
  actuals,
  todos,
  onOpenProfile,
  onOpenSettings,
  onOpenStudyStreak,
  streakSummary,
}: HomeTopbarProps) {
  const now = useHomeDisplayClock();
  const dashboard = useMemo(
    () => buildHomeDashboardModel({ plans, actuals, todos, now }),
    [actuals, plans, todos, now],
  );

  const verifiedSummary = streakSummary?.userId === user.id && streakSummary.today === dashboard.today
    && streakSummary.plans === plans && streakSummary.actuals === actuals ? streakSummary : null;
  const currentStreak = verifiedSummary?.currentStreak ?? null;
  const bestStreak = verifiedSummary?.bestStreak ?? null;

  return (
    <header className="home-topbar">
      <button className="home-streak-card" type="button" aria-label={`連続学習 ${currentStreak === null ? '未確認' : `${currentStreak}日`}、学習記録を開く`} onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        onOpenStudyStreak?.();
      }}>
        <Flame
          key={`streak-${currentStreak}`}
          className="home-streak-flame"
          aria-hidden="true"
          size={30}
        />
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
