import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenCheck, CalendarPlus } from 'lucide-react';
import { todayIsoDate } from '../lib/date';
import { MonthEventDialog } from './MonthEventDialog';
import { QuickEntryModal } from './QuickEntryModal';

type Props = Omit<ComponentProps<typeof QuickEntryModal>, 'selectedDate' | 'initialMode'> & {
  monthEvents: ComponentProps<typeof MonthEventDialog>['monthEvents'];
  onSaveMonthEvent: ComponentProps<typeof MonthEventDialog>['onSave'];
  onDeleteMonthEvent: ComponentProps<typeof MonthEventDialog>['onDelete'];
};

/** A Home-only session; persistence remains in the existing application callbacks. */
export function HomeAddFlow({ monthEvents, onSaveMonthEvent, onDeleteMonthEvent, ...props }: Props) {
  const [entry, setEntry] = useState<{ kind: 'schedule' | 'study'; date: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    const trigger = document.activeElement;
    contentRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === 'Escape' && contentRef.current?.querySelector('.home-add-sheet')) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (entry) contentRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus();
  }, [entry]);

  function keepChooserFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (entry || event.key !== 'Tab') return;
    const buttons = contentRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
    if (!buttons?.length) return;
    const first = buttons[0]; const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return createPortal(<div ref={contentRef} onKeyDown={keepChooserFocus}>{entry?.kind === 'schedule' ? (
    <div className="month-event-dialog-motion is-open">
      <MonthEventDialog userId={props.userId} openDate={entry.date} monthEvents={monthEvents}
        onSave={onSaveMonthEvent} onDelete={onDeleteMonthEvent} onClose={props.onClose} />
    </div>
  ) : entry?.kind === 'study' ? (
    <QuickEntryModal {...props} selectedDate={entry.date} initialMode="scheduled" />
  ) : (
    <div className="overlay modal-overlay home-add-overlay" onClick={props.onClose}>
      <div className="panel section-stack home-add-sheet" role="dialog" aria-modal="true"
        aria-label="今日の予定に追加" onClick={(event) => event.stopPropagation()}>
        <button className="secondary-button" type="button" onClick={() => setEntry({ kind: 'schedule', date: todayIsoDate() })}>
          <CalendarPlus size={24} aria-hidden="true" />予定を追加
        </button>
        <button className="secondary-button" type="button" onClick={() => setEntry({ kind: 'study', date: todayIsoDate() })}>
          <BookOpenCheck size={24} aria-hidden="true" />学習を追加
        </button>
        <button className="ghost-button" type="button" onClick={props.onClose}>キャンセル</button>
      </div>
    </div>
  )}</div>, document.body);
}
