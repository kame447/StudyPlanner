import { forwardRef } from 'react';
import type { Actual, Plan, TodoTask, User } from '../types/domain';
import { HomeTopbar } from './HomeTopbar';

interface PrimaryAppHeaderProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
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
      className,
    },
    ref,
  ) {
    const wrapperClassName = [
      'home-dashboard',
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
        />
      </div>
    );
  },
);
