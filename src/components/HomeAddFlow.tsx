import { useState, type ComponentProps } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
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
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLDivElement>(!entry, props.onClose);

  return createPortal(<>{entry?.kind === 'schedule' ? (
    <div className="month-event-dialog-motion is-open">
      <MonthEventDialog userId={props.userId} openDate={entry.date} monthEvents={monthEvents}
        onSave={onSaveMonthEvent} onDelete={onDeleteMonthEvent} onClose={props.onClose} />
    </div>
  ) : entry?.kind === 'study' ? (
    <QuickEntryModal {...props} selectedDate={entry.date} initialMode="scheduled" />
  ) : (
    <div className="overlay modal-overlay home-add-overlay" onClick={props.onClose}>
      <div ref={dialogRef} tabIndex={-1} className="panel section-stack home-add-sheet" role="dialog" aria-modal="true"
        aria-label="今日の予定に追加" onClick={(event) => event.stopPropagation()}>
        <button ref={(node) => { initialFocusRef.current = node; }} className="secondary-button" type="button" onClick={() => setEntry({ kind: 'schedule', date: todayIsoDate() })}>
          <CalendarPlus size={24} aria-hidden="true" />予定を追加
        </button>
        <button className="secondary-button" type="button" onClick={() => setEntry({ kind: 'study', date: todayIsoDate() })}>
          <BookOpenCheck size={24} aria-hidden="true" />学習を追加
        </button>
        <button className="ghost-button" type="button" onClick={props.onClose}>キャンセル</button>
      </div>
    </div>
  )}</>, document.body);
}
