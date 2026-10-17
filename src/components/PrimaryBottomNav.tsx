import { forwardRef, useCallback, useLayoutEffect, useRef, type ComponentType } from 'react';
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  House,
  MessageCircle,
  type LucideProps,
} from 'lucide-react';
import { playIndicatorTravel } from '../lib/motionEffects';

export type PrimaryNavItem =
  | 'ai-planning'
  | 'schedule'
  | 'home'
  | 'bookshelf'
  | 'timetable';

interface PrimaryBottomNavProps {
  active: PrimaryNavItem;
  onOpenAiPlanning: () => void;
  onOpenSchedule: () => void;
  onOpenHome: () => void;
  onOpenBookshelf: () => void;
  onOpenTimetable: () => void;
  className?: string;
}

/** Where the selected circle was when the user chose `target`, read before the change. */
interface TravelOrigin {
  target: PrimaryNavItem;
  centerX: number;
}

const ACTIVE_CIRCLE_SELECTOR = '.home-nav-active-circle';

function visibleCenterX(element: Element | null | undefined): number | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 ? box.left + box.width / 2 : null;
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
      onOpenTimetable,
      className,
    },
    ref,
  ) {
    const navRef = useRef<HTMLElement | null>(null);
    const previousActive = useRef(active);
    const travelOrigin = useRef<TravelOrigin | null>(null);
    const setNavRef = useCallback((element: HTMLElement | null) => {
      navRef.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    }, [ref]);

    // The circle is rendered inside the selected item, so a selection change
    // mounts a new one. It starts at the previous circle's position — read at
    // the press, so a quick second press continues from mid-flight — or, for
    // a change the user did not press here, at the previous item.
    useLayoutEffect(() => {
      const before = previousActive.current;
      const origin = travelOrigin.current;
      previousActive.current = active;
      travelOrigin.current = null;
      if (before === active) return;
      const nav = navRef.current;
      if (!nav) return;
      const circle = nav.querySelector(ACTIVE_CIRCLE_SELECTOR);
      const fromX = origin?.target === active
        ? origin.centerX
        : visibleCenterX(nav.querySelector(`[data-nav-item="${before}"]`));
      const toX = visibleCenterX(circle);
      if (fromX === null || toX === null) return;
      const offset = Math.round(fromX - toX);
      if (offset !== 0) playIndicatorTravel(circle, offset);
    }, [active]);

    const items: PrimaryNavDefinition[] = [
      { id: 'ai-planning', label: 'AI計画', Icon: MessageCircle, onSelect: onOpenAiPlanning },
      { id: 'schedule', label: '予定', Icon: CalendarDays, onSelect: onOpenSchedule },
      { id: 'home', label: 'ホーム', Icon: House, onSelect: onOpenHome },
      { id: 'bookshelf', label: '教材', Icon: BookOpen, onSelect: onOpenBookshelf },
      { id: 'timetable', label: '時間割', Icon: CalendarRange, onSelect: onOpenTimetable },
    ];
    const navClassName = ['home-bottom-nav', 'primary-bottom-nav', 'print-hide', className]
      .filter(Boolean)
      .join(' ');

    return (
      <nav ref={setNavRef} className={navClassName} aria-label="主要ナビゲーション">
        {items.map(({ id, label, Icon, onSelect }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              className={isActive ? 'active' : undefined}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              data-nav-item={id}
              onClick={() => {
                if (!isActive) {
                  const centerX = visibleCenterX(navRef.current?.querySelector(ACTIVE_CIRCLE_SELECTOR));
                  travelOrigin.current = centerX === null ? null : { target: id, centerX };
                }
                onSelect();
              }}
            >
              {isActive ? (
                <span className="home-nav-active-circle" aria-hidden="true"><Icon aria-hidden="true" /></span>
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