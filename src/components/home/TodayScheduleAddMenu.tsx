import { useEffect, useId, useRef, useState } from 'react';
import { BookOpenCheck, CalendarPlus, Plus, X } from 'lucide-react';

export type HomeAddEntry = { kind: 'schedule' | 'study'; date: string };

export function TodayScheduleAddMenu({ date, empty, onAddEntry }: {
  date: string;
  empty: boolean;
  onAddEntry: (entry: HomeAddEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus({ preventScroll: true });
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  }

  function select(kind: HomeAddEntry['kind']) {
    // The existing form owns dialog focus and returns it to this retained toggle.
    close();
    onAddEntry({ kind, date });
  }

  return (
    <div ref={containerRef}
      className={`${empty ? 'home-schedule-empty' : 'home-schedule-add-row'} home-inline-add`}
      role="group" aria-label="今日の予定の追加"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}>
      <div className="home-inline-add-controls">
        {open && (
          <button ref={firstActionRef} id={`${id}-schedule`} className="home-inline-add-action" type="button"
            onClick={() => select('schedule')}>
            <CalendarPlus size={16} aria-hidden="true" /><span>予定を追加</span>
          </button>
        )}
        <button ref={toggleRef} className={open ? 'home-inline-add-toggle is-open' : 'home-inline-add-toggle'}
          type="button" aria-label={open ? '予定の追加を閉じる' : '今日の予定に追加'}
          aria-expanded={open} aria-controls={open ? `${id}-schedule ${id}-study` : undefined}
          onClick={() => open ? close() : setOpen(true)}>
          {open ? <X size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
        </button>
        {open && (
          <button id={`${id}-study`} className="home-inline-add-action" type="button"
            onClick={() => select('study')}>
            <BookOpenCheck size={16} aria-hidden="true" /><span>学習予定を追加</span>
          </button>
        )}
      </div>
    </div>
  );
}
