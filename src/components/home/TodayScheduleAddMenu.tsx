import { useEffect, useId, useRef, useState } from 'react';
import { BookOpenCheck, CalendarPlus, Plus } from 'lucide-react';

export type HomeAddEntry = { kind: 'schedule' | 'study'; date: string };

export function TodayScheduleAddMenu({ date, empty, onAddEntry }: {
  date: string;
  empty: boolean;
  onAddEntry: (entry: HomeAddEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus({ preventScroll: true });
  }, [open]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  }

  function select(kind: HomeAddEntry['kind'], button: HTMLButtonElement) {
    // Tapped buttons are not focused by every browser; retain the actual dialog opener.
    button.focus({ preventScroll: true });
    onAddEntry({ kind, date });
  }

  return (
    <div className={`${empty ? 'home-schedule-empty' : 'home-schedule-add-row'} home-inline-add`}
      role="group" aria-label="今日の予定の追加"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}>
      <div className={open ? 'home-add-controls is-open' : 'home-add-controls'}>
        <button ref={firstActionRef} id={`${id}-schedule`} className="home-add-action" type="button"
          disabled={!open} aria-hidden={!open}
          onClick={(event) => select('schedule', event.currentTarget)}>
          <CalendarPlus size={16} aria-hidden="true" /><span>予定を追加</span>
        </button>
        <button ref={toggleRef} className={open ? 'home-add-toggle is-open' : 'home-add-toggle'}
          type="button" aria-label={open ? '予定の追加を閉じる' : '今日の予定に追加'}
          aria-expanded={open} aria-controls={open ? `${id}-schedule ${id}-study` : undefined}
          onClick={() => open ? close() : setOpen(true)}>
          <Plus size={20} aria-hidden="true" />
        </button>
        <button id={`${id}-study`} className="home-add-action" type="button"
          disabled={!open} aria-hidden={!open}
          onClick={(event) => select('study', event.currentTarget)}>
          <BookOpenCheck size={16} aria-hidden="true" /><span>学習予定を追加</span>
        </button>
      </div>
    </div>
  );
}
