import type { ComponentProps } from 'react';
import type { HomeAddEntry } from './home/TodayScheduleAddMenu';
import { createPortal } from 'react-dom';
import { MonthEventDialog } from './MonthEventDialog';
import { QuickEntryModal } from './QuickEntryModal';

type Props = Omit<ComponentProps<typeof QuickEntryModal>, 'selectedDate' | 'initialMode'> & {
  entry: HomeAddEntry;
  monthEvents: ComponentProps<typeof MonthEventDialog>['monthEvents'];
  onSaveMonthEvent: ComponentProps<typeof MonthEventDialog>['onSave'];
  onDeleteMonthEvent: ComponentProps<typeof MonthEventDialog>['onDelete'];
};

/** A Home-only session; persistence remains in the existing application callbacks. */
export function HomeAddFlow({ entry, monthEvents, onSaveMonthEvent, onDeleteMonthEvent, ...props }: Props) {
  return createPortal(entry.kind === 'schedule' ? (
    <div className="month-event-dialog-motion is-open">
      <MonthEventDialog userId={props.userId} openDate={entry.date} monthEvents={monthEvents}
        onSave={onSaveMonthEvent} onDelete={onDeleteMonthEvent} onClose={props.onClose} />
    </div>
  ) : (
    <QuickEntryModal {...props} selectedDate={entry.date} initialMode="scheduled" />
  ), document.body);
}
