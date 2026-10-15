import { forwardRef } from 'react';
import type { Actual, MonthEvent, Plan, TodoTask, User } from '../types/domain';
import { HomeTopbar } from './HomeTopbar';

interface PrimaryAppHeaderProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  monthEvents?: MonthEvent[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenStudyStreak?: () => void;
  className?: string;
}

export const PrimaryAppHeader = forwardRef<HTMLDivElement, PrimaryAppHeaderProps>(
  function PrimaryAppHeader(
    {
      user,
      plans,
      actuals,
      monthEvents,
      todos,
      onOpenProfile,
      onOpenSettings,
      onOpenStudyStreak,
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
          monthEvents={monthEvents}
          todos={todos}
          onOpenProfile={onOpenProfile}
          onOpenSettings={onOpenSettings}
          onOpenStudyStreak={onOpenStudyStreak}
        />
      </div>
    );
  },
);
