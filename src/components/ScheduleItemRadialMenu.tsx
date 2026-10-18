import { createPortal } from 'react-dom';
import {
  SCHEDULE_ITEM_ACTION_INTENT_EVENT,
  type ActiveScheduleItemAction,
} from '../hooks/useScheduleItemActionPress';
import type {
  ScheduleRadialActionDescriptor,
  ScheduleRadialActionId,
} from '../lib/scheduleRadialActions';

// PLACEHOLDER (base contract): the radial layout, pop animation, focus and
// dismissal behavior are implemented by the presentation work item. Callers may
// rely on: role="menu" named `${title}の操作`, one role="menuitem" per action whose
// accessible name is its label, aria-disabled for disabledReason, and
// data-schedule-item-delete-action="true" on the menu root (outside-press guard).
export interface ScheduleItemRadialMenuProps<TItem> {
  action: ActiveScheduleItemAction<TItem> | null;
  actions: readonly ScheduleRadialActionDescriptor[];
  onSelect: (id: ScheduleRadialActionId, item: TItem) => void;
  onDismiss: () => void;
}

export function ScheduleItemRadialMenu<TItem>({
  action,
  actions,
  onSelect,
  onDismiss,
}: ScheduleItemRadialMenuProps<TItem>) {
  if (!action || typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="menu"
      aria-label={`${action.title}の操作`}
      data-schedule-item-delete-action="true"
      data-schedule-action-key={action.key}
    >
      {actions.map((descriptor) => (
        <button
          key={descriptor.id}
          type="button"
          role="menuitem"
          aria-disabled={descriptor.disabledReason ? true : undefined}
          title={descriptor.disabledReason ?? undefined}
          onPointerDown={() => window.dispatchEvent(new Event(SCHEDULE_ITEM_ACTION_INTENT_EVENT))}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (descriptor.disabledReason) return;
            const item = action.item;
            onDismiss();
            onSelect(descriptor.id, item);
          }}
        >
          {descriptor.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
