import { Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  SCHEDULE_ITEM_ACTION_INTENT_EVENT,
  type ActiveScheduleItemAction,
} from '../hooks/useScheduleItemActionPress';

interface ScheduleItemDeleteActionProps<TItem> {
  action: ActiveScheduleItemAction<TItem> | null;
  onDelete: (item: TItem) => void | Promise<void>;
  onDismiss: () => void;
}

function signalScheduleActionIntent() {
  window.dispatchEvent(new Event(SCHEDULE_ITEM_ACTION_INTENT_EVENT));
}

export function ScheduleItemDeleteAction<TItem>({
  action,
  onDelete,
  onDismiss,
}: ScheduleItemDeleteActionProps<TItem>) {
  if (!action || typeof document === 'undefined') return null;

  const centerSlots = document.querySelectorAll<HTMLElement>(
    '.drag-undo-redo-controls--schedule [data-drag-undo-redo-center-slot="true"]',
  );
  const centerSlot = centerSlots.item(centerSlots.length - 1);
  if (!centerSlot) return null;

  return createPortal(
    <button
      className="schedule-item-delete-action drag-undo-redo-delete"
      data-schedule-item-delete-action="true"
      data-schedule-action-key={action.key}
      type="button"
      aria-label={`${action.title}を削除`}
      title="この予定を削除"
      onPointerDown={(event) => {
        signalScheduleActionIntent();
        event.stopPropagation();
      }}
      onTouchStart={(event) => {
        signalScheduleActionIntent();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const item = action.item;
        onDismiss();
        void Promise.resolve(onDelete(item)).catch(() => undefined);
      }}
    >
      <Trash2 size={19} strokeWidth={2.2} aria-hidden="true" />
    </button>,
    centerSlot,
  );
}
