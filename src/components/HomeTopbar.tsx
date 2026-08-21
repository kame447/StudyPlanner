import { useMemo } from 'react';
import { Bell, Flame, Menu } from 'lucide-react';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan, TodoTask, User } from '../types/domain';
import { HomeDateDisplay } from './HomeDateDisplay';
import { UserAvatar } from './UserAvatar';

interface HomeTopbarProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}

export function HomeTopbar({
  user,
  plans,
  actuals,
  todos,
  onOpenProfile,
  onOpenSettings,
}: HomeTopbarProps) {
  const dashboard = useMemo(
    () => buildHomeDashboardModel({ plans, actuals, todos }),
    [actuals, plans, todos],
  );

  return (
    <header className="home-topbar">
      <div className="home-streak-card" aria-label={`連続学習 ${dashboard.currentStreak}日`}>
        <Flame className="home-streak-flame" aria-hidden="true" size={30} />
        <div>
          <span>連続学習</span>
          <strong>{dashboard.currentStreak}日</strong>
          <small>最高 {dashboard.bestStreak}日</small>
        </div>
      </div>

      <HomeDateDisplay date={dashboard.today} />

      <div className="home-top-actions">
        <button
          className="home-icon-button"
          type="button"
          aria-label="通知"
          title="通知機能は準備中です"
        >
          <Bell aria-hidden="true" size={22} />
        </button>
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
          onClick={onOpenSettings}
          aria-label="メニューを開く"
        >
          <Menu aria-hidden="true" size={24} />
        </button>
      </div>
    </header>
  );
}
