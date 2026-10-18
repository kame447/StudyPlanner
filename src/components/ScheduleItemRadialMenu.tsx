import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Copy, Move, Pencil, SquarePen, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  SCHEDULE_ITEM_ACTION_INTENT_EVENT,
  type ActiveScheduleItemAction,
} from '../hooks/useScheduleItemActionPress';
import { useMotionLevel } from '../hooks/useMotionPreference';
import { computeScheduleRadialMenuLayout } from '../lib/scheduleRadialMenuLayout';
import {
  SCHEDULE_RADIAL_ACTION_ORDER,
  type ScheduleRadialActionDescriptor,
  type ScheduleRadialActionId,
} from '../lib/scheduleRadialActions';
import './ScheduleItemRadialMenu.css';

export interface ScheduleItemRadialMenuProps<TItem> {
  action: ActiveScheduleItemAction<TItem> | null;
  actions: readonly ScheduleRadialActionDescriptor[];
  onSelect: (id: ScheduleRadialActionId, item: TItem) => void;
  onDismiss: () => void;
}

const ICONS = { complete: Check, edit: Pencil, duplicate: Copy, delete: Trash2, actual: SquarePen, move: Move };
const EXIT_MS = 140;

export function ScheduleItemRadialMenu<TItem>(props: ScheduleItemRadialMenuProps<TItem>) {
  const level = useMotionLevel();
  const [retainedAction, setRetainedAction] = useState(props.action);
  const [retainedActions, setRetainedActions] = useState(props.actions);
  const [opening, setOpening] = useState(0);
  // Keep only the visual tail after dismissal; action callbacks never wait for it.
  // A fresh object from open() replaces even the same event's closing ring.
  if (props.action && props.action !== retainedAction) {
    setRetainedAction(props.action);
    setOpening(opening + 1);
  }
  if (props.action && props.actions !== retainedActions) setRetainedActions(props.actions);
  useLayoutEffect(() => {
    if (props.action || !retainedAction) return;
    if (level !== 'standard') {
      setRetainedAction(null);
      return;
    }
    const timer = window.setTimeout(() => setRetainedAction(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [props.action, retainedAction, level]);

  const displayed = props.action ?? (level === 'standard' ? retainedAction : null);
  if (!displayed || typeof document === 'undefined') return null;
  return createPortal(
    <RadialRing {...props} key={opening} action={displayed} actions={props.action ? props.actions : retainedActions} closing={!props.action} level={level} />,
    document.body,
  );
}

function RadialRing<TItem>({ action, actions, onSelect, onDismiss, closing, level }: Omit<ScheduleItemRadialMenuProps<TItem>, 'action'> & {
  action: ActiveScheduleItemAction<TItem>;
  closing: boolean;
  level: ReturnType<typeof useMotionLevel>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const descriptionId = useId();
  const [hint, setHint] = useState<string | null>(null);
  const [safeInsets, setSafeInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const descriptors = SCHEDULE_RADIAL_ACTION_ORDER.flatMap(id => actions.filter(action => action.id === id));
  const layout = computeScheduleRadialMenuLayout({
    anchorRect: action.anchorRect,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    safeInsets,
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(root);
      setSafeInsets({
        top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0,
      });
    }
    const firstEnabled = descriptors.findIndex(descriptor => !descriptor.disabledReason);
    buttons.current[firstEnabled < 0 ? 0 : firstEnabled]?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    // Outside touch dismissal can leave focus on a now-hidden menuitem. Move
    // it out only while this ring still owns it; a newly opened dialog wins.
    const focusedButton = buttons.current.find(button => button === document.activeElement);
    if (!focusedButton) return;
    if (action.anchorElement?.isConnected) action.anchorElement.focus({ preventScroll: true });
    else focusedButton.blur();
  }, [closing, action.anchorElement]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (closing) return;
    // Clear long-press click suppression before the native keyboard click
    // traverses the calendar's capture handlers through the portal.
    if (event.key === 'Enter' || event.key === ' ') signalIntent();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      if (action.anchorElement?.isConnected) action.anchorElement.focus({ preventScroll: true });
      return;
    }
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey) ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const current = buttons.current.findIndex(button => button === document.activeElement);
    const next = (current + direction + descriptors.length) % descriptors.length;
    buttons.current[next]?.focus({ preventScroll: true });
  }

  function signalIntent() {
    window.dispatchEvent(new Event(SCHEDULE_ITEM_ACTION_INTENT_EVENT));
  }

  return (
    <div
      ref={rootRef}
      className="schedule-radial-menu"
      role="menu"
      aria-label={`${action.title}の操作`}
      aria-hidden={closing || undefined}
      data-schedule-item-delete-action="true"
      data-schedule-action-key={action.key}
      data-motion={level}
      data-closing={closing || undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={event => event.stopPropagation()}
      onTouchStart={event => event.stopPropagation()}
    >
      <div className="schedule-radial-ring" style={{ left: layout.anchor.x, top: layout.anchor.y }}>
        <span className="schedule-radial-anchor" aria-hidden="true" />
        {descriptors.map((descriptor, index) => {
          const Icon = ICONS[descriptor.id];
          const node = layout.nodes[index];
          return (
            <button
              key={descriptor.id}
              ref={element => { buttons.current[index] = element; }}
              className="schedule-radial-item"
              data-action={descriptor.id}
              type="button"
              role="menuitem"
              aria-label={descriptor.label}
              aria-disabled={descriptor.disabledReason ? true : undefined}
              aria-describedby={descriptor.disabledReason ? `${descriptionId}-${descriptor.id}` : undefined}
              tabIndex={closing ? -1 : 0}
              title={descriptor.disabledReason ?? undefined}
              style={{
                left: node.x - layout.anchor.x - layout.buttonDiameter / 2,
                top: node.y - layout.anchor.y - layout.buttonDiameter / 2,
                width: layout.buttonDiameter, height: layout.buttonDiameter,
                '--radial-index': index,
                '--radial-delay': `${level === 'standard' ? index * 50 : 0}ms`,
              } as CSSProperties}
              onPointerDown={signalIntent}
              onTouchStart={signalIntent}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                if (closing) return;
                signalIntent();
                if (descriptor.disabledReason) {
                  setHint(descriptor.disabledReason);
                  return;
                }
                const item = action.item;
                onDismiss();
                onSelect(descriptor.id, item);
              }}
            >
              <Icon size={20} strokeWidth={2} aria-hidden="true" />
              <span>{descriptor.label}</span>
              {descriptor.disabledReason && <span id={`${descriptionId}-${descriptor.id}`} className="schedule-radial-description">{descriptor.disabledReason}</span>}
            </button>
          );
        })}
        {hint && <span className="schedule-radial-hint" role="status">{hint}</span>}
      </div>
    </div>
  );
}
