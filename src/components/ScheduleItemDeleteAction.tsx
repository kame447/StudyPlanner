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

  return createPortal(
    <button
      className="quick-add-option-icon schedule-item-delete-action"
      data-schedule-item-delete-action="true"
      data-schedule-action-key={action.key}
      type="button"
      aria-label={`${action.title}を削除`}
      title="この予定を削除"
      style={{
        position: 'fixed',
        top: action.top,
        left: action.left,
        zIndex: 1200,
        width: '44px',
        height: '44px',
        minWidth: '44px',
        minHeight: '44px',
        padding: 0,
        animation: 'quick-add-option-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
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
    document.body,
  );
}
