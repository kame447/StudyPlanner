import { BookOpenCheck, CalendarPlus, Plus, Sparkles } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

interface QuickAddMenuProps {
  onAddSchedule: () => void;
  onAddStudy: () => void;
  onOpenAiPlanning: () => void;
}

const ACTIONS = [
  {
    id: 'ai',
    label: 'AI計画',
    icon: Sparkles,
  },
  {
    id: 'study',
    label: '学習を追加',
    icon: BookOpenCheck,
  },
  {
    id: 'schedule',
    label: '予定を追加',
    icon: CalendarPlus,
  },
] as const;

export function QuickAddMenu({
  onAddSchedule,
  onAddStudy,
  onOpenAiPlanning,
}: QuickAddMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function closeMenu(restoreFocus = true) {
    setIsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return undefined;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      actionRefs.current[0]?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function runAction(action: (typeof ACTIONS)[number]['id']) {
    closeMenu(false);

    if (action === 'schedule') {
      onAddSchedule();
      return;
    }

    if (action === 'study') {
      onAddStudy();
      return;
    }

    onOpenAiPlanning();
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!isOpen) return;

    const availableActions = actionRefs.current.filter(
      (action): action is HTMLButtonElement => action !== null,
    );
    if (availableActions.length === 0) return;

    const activeIndex = Math.max(
      0,
      availableActions.findIndex((action) => action === document.activeElement),
    );
    let nextIndex = activeIndex;

    if (event.key === 'ArrowDown') {
      nextIndex = (activeIndex + 1) % availableActions.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex =
        (activeIndex - 1 + availableActions.length) % availableActions.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = availableActions.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    availableActions[nextIndex]?.focus();
  }

  return (
    <div className={isOpen ? 'quick-add-menu is-open' : 'quick-add-menu'}>
      <button
        className="quick-add-backdrop print-hide"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => closeMenu()}
        type="button"
      />

      <div
        className="quick-add-options print-hide"
        id={menuId}
        role="menu"
        aria-hidden={!isOpen}
        onKeyDown={handleMenuKeyDown}
      >
        {ACTIONS.map((action, index) => {
          const Icon = action.icon;
          const revealIndex = ACTIONS.length - 1 - index;

          return (
            <button
              className="quick-add-option"
              key={action.id}
              onClick={() => runAction(action.id)}
              ref={(node) => {
                actionRefs.current[index] = node;
              }}
              role="menuitem"
              style={{ '--quick-add-index': revealIndex } as CSSProperties}
              tabIndex={isOpen ? 0 : -1}
              type="button"
            >
              <span className="quick-add-option-label">{action.label}</span>
              <span className="quick-add-option-icon" aria-hidden="true">
                <Icon size={21} strokeWidth={2.1} />
              </span>
            </button>
          );
        })}
      </div>

      <button
        ref={triggerRef}
        className="daily-add-fab schedule-add-fab quick-add-trigger print-hide"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isOpen ? 'クイック追加メニューを閉じる' : 'クイック追加メニューを開く'}
        onClick={() => {
          if (isOpen) closeMenu(false);
          else setIsOpen(true);
        }}
        type="button"
      >
        <Plus className="quick-add-trigger-icon" aria-hidden="true" />
      </button>
    </div>
  );
}
