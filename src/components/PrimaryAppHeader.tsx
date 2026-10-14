import { forwardRef } from 'react';
import type { Actual, Plan, TodoTask, User } from '../types/domain';
import { HomeTopbar, type VerifiedStudyStreakSummary } from './HomeTopbar';

interface PrimaryAppHeaderProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenStudyStreak?: () => void;
  streakSummary?: VerifiedStudyStreakSummary | null;
  className?: string;
}

export const PrimaryAppHeader = forwardRef<HTMLDivElement, PrimaryAppHeaderProps>(
  function PrimaryAppHeader(
    {
      user,
      plans,
      actuals,
      todos,
      onOpenProfile,
      onOpenSettings,
      onOpenStudyStreak,
      streakSummary,
      className,
    },
    ref,
  ) {
    const wrapperClassName = [
      'home-dashboard',
      'home-dashboard-default',
      'primary-app-header',
      'print-hide',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={ref} className={wrapperClassName}>
        <HomeTopbar
          user={user}
          plans={plans}
          actuals={actuals}
          todos={todos}
          onOpenProfile={onOpenProfile}
          onOpenSettings={onOpenSettings}
          onOpenStudyStreak={onOpenStudyStreak}
          streakSummary={streakSummary}
        />
      </div>
    );
  },
);
