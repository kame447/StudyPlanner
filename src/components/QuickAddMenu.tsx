import { BookOpenCheck, CalendarPlus, Plus, Sparkles } from 'lucide-react';
import { useEffect, useId, useState, type CSSProperties } from 'react';

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

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  function runAction(action: (typeof ACTIONS)[number]['id']) {
    setIsOpen(false);

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

  return (
    <div className={isOpen ? 'quick-add-menu is-open' : 'quick-add-menu'}>
      <button
        className="quick-add-backdrop print-hide"
        aria-label="クイック追加メニューを閉じる"
        aria-hidden={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        onClick={() => setIsOpen(false)}
        type="button"
      />

      <div
        className="quick-add-options print-hide"
        id={menuId}
        role="menu"
        aria-hidden={!isOpen}
      >
        {ACTIONS.map((action, index) => {
          const Icon = action.icon;
          const revealIndex = ACTIONS.length - 1 - index;

          return (
            <button
              className="quick-add-option"
              key={action.id}
              onClick={() => runAction(action.id)}
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
        className="daily-add-fab schedule-add-fab quick-add-trigger print-hide"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isOpen ? 'クイック追加メニューを閉じる' : 'クイック追加メニューを開く'}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Plus className="quick-add-trigger-icon" aria-hidden="true" />
      </button>
    </div>
  );
}
