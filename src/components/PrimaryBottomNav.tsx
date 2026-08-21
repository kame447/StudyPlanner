import { forwardRef, type ComponentType } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  House,
  MessageCircle,
  type LucideProps,
} from 'lucide-react';

export type PrimaryNavItem =
  | 'ai-planning'
  | 'schedule'
  | 'home'
  | 'bookshelf'
  | 'report';

interface PrimaryBottomNavProps {
  active: PrimaryNavItem;
  onOpenAiPlanning: () => void;
  onOpenSchedule: () => void;
  onOpenHome: () => void;
  onOpenBookshelf: () => void;
  onOpenReport: () => void;
  className?: string;
}

interface PrimaryNavDefinition {
  id: PrimaryNavItem;
  label: string;
  Icon: ComponentType<LucideProps>;
  onSelect: () => void;
}

export const PrimaryBottomNav = forwardRef<HTMLElement, PrimaryBottomNavProps>(
  function PrimaryBottomNav(
    {
      active,
      onOpenAiPlanning,
      onOpenSchedule,
      onOpenHome,
      onOpenBookshelf,
      onOpenReport,
      className,
    },
    ref,
  ) {
    const items: PrimaryNavDefinition[] = [
      { id: 'ai-planning', label: 'AI計画', Icon: MessageCircle, onSelect: onOpenAiPlanning },
      { id: 'schedule', label: '予定', Icon: CalendarDays, onSelect: onOpenSchedule },
      { id: 'home', label: 'ホーム', Icon: House, onSelect: onOpenHome },
      { id: 'bookshelf', label: '教材', Icon: BookOpen, onSelect: onOpenBookshelf },
      { id: 'report', label: '分析', Icon: BarChart3, onSelect: onOpenReport },
    ];
    const navClassName = ['home-bottom-nav', 'primary-bottom-nav', 'print-hide', className]
      .filter(Boolean)
      .join(' ');

    return (
      <nav ref={ref} className={navClassName} aria-label="主要ナビゲーション">
        {items.map(({ id, label, Icon, onSelect }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              className={isActive ? 'active' : undefined}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={onSelect}
            >
              {isActive ? (
                <span className="home-nav-active-circle"><Icon aria-hidden="true" /></span>
              ) : (
                <Icon aria-hidden="true" />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    );
  },
);
