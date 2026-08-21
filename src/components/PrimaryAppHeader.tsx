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

export function PrimaryAppHeader({
  user,
  plans,
  actuals,
  todos,
  onOpenProfile,
  onOpenSettings,
  className,
}: PrimaryAppHeaderProps) {
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
    <div className={wrapperClassName}>
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
}
