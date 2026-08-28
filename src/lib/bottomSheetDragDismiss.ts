import { isTimelineDragInteractionLocked } from './timelineDragInteractionLock';

const SHEET_SURFACE_SELECTOR = [
  '.ai-planning-preview-dialog-v2',
  '.month-day-sheet',
  '.schedule-action-sheet',
  '.schedule-record-sheet',
  '.quick-entry-modal',
  '.month-event-modal',
  '.timetable-term-sheet',
  '.bookshelf-modal:has(.bookshelf-material-edit-grid)',
].join(',');

const SHEET_OVERLAY_SELECTOR = [
  '.ai-planning-preview-overlay-v2',
  '.month-day-sheet-overlay',
  '.schedule-action-overlay',
  '.quick-entry-overlay',
  '.month-event-modal-overlay',
  '.timetable-term-sheet-overlay',
  '.bookshelf-view > .modal-overlay:has(> .bookshelf-modal .bookshelf-material-edit-grid)',
].join(',');

const EXPLICIT_HANDLE_SELECTOR = [
  '.month-day-sheet-handle',
  '.schedule-action-handle',
  '.timetable-term-sheet-handle',
  '[data-bottom-sheet-drag-handle="true"]',
].join(',');

const BLOCKED_START_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.schedule-week-plan-button',
].join(',');
const START_ZONE_PX = 72;
const INTENT_LOCK_DISTANCE_PX = 8;
const HORIZONTAL_ABORT_DISTANCE_PX = 12;
const HORIZONTAL_ABORT_RATIO = 1.2;
const VERTICAL_LOCK_RATIO = 0.9;
const DISMISS_DISTANCE_RATIO = 0.18;
const DISMISS_DISTANCE_MIN_PX = 72;
const DISMISS_DISTANCE_MAX_PX = 140;
const FAST_DISMISS_MIN_DISTANCE_PX = 28;
const FAST_DISMISS_VELOCITY_PX_PER_MS = 0.34;
const MAX_DRAG_RATIO = 0.88;
const SNAP_DURATION_MS = 190;
const DISMISS_DURATION_MS = 210;
const POST_DISMISS_FALLBACK_MS = 380;
const MOUSE_AFTER_TOUCH_BLOCK_MS = 700;
const DRAG_Y_PROPERTY = '--planner-bottom-sheet-drag-y';

type DragIntent = 'pending' | 'vertical' | 'cancel';
type DragSource = 'touch' | 'mouse';

interface ActiveDrag {
  source: DragSource;
  touchIdentifier: number | null;
  startX: number;
  startY: number;
  lastY: number;
  lastSampleAt: number;
  velocityY: number;
  surface: HTMLElement;
  overlay: HTMLElement;
  intent: Exclude<DragIntent, 'cancel'>;
}

interface DragAnimationPair {
  sheet: Animation | null;
  overlay: Animation | null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function getBottomSheetDismissDistance(height: number): number {
  return Math.min(
    DISMISS_DISTANCE_MAX_PX,
    Math.max(DISMISS_DISTANCE_MIN_PX, height * DISMISS_DISTANCE_RATIO),
  );
}

export function getBottomSheetDragIntent(
  deltaX: number,
  deltaY: number,
): DragIntent {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (deltaY <= -INTENT_LOCK_DISTANCE_PX) return 'cancel';
  if (absX < INTENT_LOCK_DISTANCE_PX && absY < INTENT_LOCK_DISTANCE_PX) {
    return 'pending';
  }
  if (
    absX >= HORIZONTAL_ABORT_DISTANCE_PX &&
    absX > absY * HORIZONTAL_ABORT_RATIO
  ) {
    return 'cancel';
  }
  if (deltaY > 0 && absY >= absX * VERTICAL_LOCK_RATIO) {
    return 'vertical';
  }
  return 'pending';
}

export function isBottomSheetDismissGesture(
  deltaY: number,
  velocityY: number,
  height: number,
  verticalLocked = true,
): boolean {
  if (!verticalLocked || deltaY <= 0) return false;

  const byDistance = deltaY >= getBottomSheetDismissDistance(height);
  const byVelocity =
    deltaY >= FAST_DISMISS_MIN_DISTANCE_PX &&
    velocityY >= FAST_DISMISS_VELOCITY_PX_PER_MS;
  return byDistance || byVelocity;
}

function getTouchByIdentifier(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

function resolveBottomSheet(
  target: EventTarget | null,
  clientY: number,
): { surface: HTMLElement; overlay: HTMLElement } | null {
  const element = target instanceof Element ? target : null;
  if (!element || element.closest(BLOCKED_START_SELECTOR)) return null;

  const surface = element.closest(SHEET_SURFACE_SELECTOR);
  if (!(surface instanceof HTMLElement)) return null;

  const overlay = surface.closest(SHEET_OVERLAY_SELECTOR);
  if (!(overlay instanceof HTMLElement)) return null;
  if (overlay.classList.contains('is-bottom-sheet-drag-dismissing')) return null;
  if (overlay.classList.contains('is-closing') || overlay.closest('.is-closing')) return null;

  const explicitHandle = element.closest(EXPLICIT_HANDLE_SELECTOR);
  const rect = surface.getBoundingClientRect();
  const startedInTopZone = clientY >= rect.top && clientY <= rect.top + START_ZONE_PX;
  if (!explicitHandle && !startedInTopZone) return null;

  return { surface, overlay };
}

function setDragOffset(surface: HTMLElement, offsetY: number) {
  surface.style.setProperty(DRAG_Y_PROPERTY, `${Math.max(offsetY, 0)}px`);
}

function clearDragOffset(surface: HTMLElement) {
  surface.style.removeProperty(DRAG_Y_PROPERTY);
}

function animateTransform(
  surface: HTMLElement,
  fromY: number,
  toY: number,
  duration: number,
): Animation | null {
  if (prefersReducedMotion() || typeof surface.animate !== 'function') {
    return null;
  }

  return surface.animate(
    [
      { transform: `translate3d(0, ${fromY}px, 0) scale(1)` },
      { transform: `translate3d(0, ${toY}px, 0) scale(1)` },
    ],
    {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    },
  );
}

function animateOverlayOut(overlay: HTMLElement): Animation | null {
  if (prefersReducedMotion() || typeof overlay.animate !== 'function') {
    return null;
  }

  const currentOpacity = Number.parseFloat(getComputedStyle(overlay).opacity) || 1;
  return overlay.animate(
    [{ opacity: currentOpacity }, { opacity: 0 }],
    {
      duration: DISMISS_DURATION_MS,
      easing: 'ease-in',
      fill: 'forwards',
    },
  );
}

function cancelAnimations(animations: DragAnimationPair) {
  animations.sheet?.cancel();
  animations.overlay?.cancel();
}

function beginDrag(
  source: DragSource,
  surface: HTMLElement,
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
  now: number,
  touchIdentifier: number | null = null,
): ActiveDrag {
  return {
    source,
    touchIdentifier,
    startX: clientX,
    startY: clientY,
    lastY: clientY,
    lastSampleAt: now,
    velocityY: 0,
    surface,
    overlay,
    intent: 'pending',
  };
}

function updateDrag(
  drag: ActiveDrag,
  clientX: number,
  clientY: number,
  now: number,
): DragIntent {
  const deltaX = clientX - drag.startX;
  const deltaY = clientY - drag.startY;

  if (drag.intent === 'pending') {
    const nextIntent = getBottomSheetDragIntent(deltaX, deltaY);
    if (nextIntent === 'cancel') return 'cancel';
    if (nextIntent === 'vertical') drag.intent = 'vertical';
  }

  if (drag.intent !== 'vertical') return 'pending';

  const elapsed = Math.max(now - drag.lastSampleAt, 1);
  const instantaneousVelocity = (clientY - drag.lastY) / elapsed;
  drag.velocityY = drag.velocityY === 0
    ? instantaneousVelocity
    : drag.velocityY * 0.55 + instantaneousVelocity * 0.45;
  drag.lastY = clientY;
  drag.lastSampleAt = now;

  const height = drag.surface.getBoundingClientRect().height;
  const previewY = Math.min(Math.max(deltaY, 0), height * MAX_DRAG_RATIO);
  setDragOffset(drag.surface, previewY);
  drag.surface.classList.add('is-bottom-sheet-dragging');
  return 'vertical';
}

function snapBack(drag: ActiveDrag, currentY: number) {
  drag.surface.classList.remove('is-bottom-sheet-dragging');
  const animation = animateTransform(
    drag.surface,
    Math.max(currentY, 0),
    0,
    SNAP_DURATION_MS,
  );
  setDragOffset(drag.surface, 0);

  if (!animation) {
    clearDragOffset(drag.surface);
    return;
  }

  window.setTimeout(() => {
    animation.cancel();
    if (drag.surface.isConnected) clearDragOffset(drag.surface);
  }, SNAP_DURATION_MS + 24);
}

function dismissWithMomentum(drag: ActiveDrag, currentY: number) {
  const height = drag.surface.getBoundingClientRect().height;
  const targetY = height + 40;
  drag.surface.classList.remove('is-bottom-sheet-dragging');
  drag.overlay.classList.add('is-bottom-sheet-drag-dismissing');

  const animations: DragAnimationPair = {
    sheet: animateTransform(
      drag.surface,
      Math.max(currentY, 0),
      targetY,
      DISMISS_DURATION_MS,
    ),
    overlay: animateOverlayOut(drag.overlay),
  };
  setDragOffset(drag.surface, targetY);

  const triggerClose = () => {
    if (!drag.overlay.isConnected) return;
    drag.overlay.click();

    window.setTimeout(() => {
      if (!drag.surface.isConnected) return;

      cancelAnimations(animations);
      drag.overlay.classList.remove('is-bottom-sheet-drag-dismissing');
      const restoreAnimation = animateTransform(
        drag.surface,
        targetY,
        0,
        SNAP_DURATION_MS,
      );
      setDragOffset(drag.surface, 0);
      window.setTimeout(() => {
        restoreAnimation?.cancel();
        if (drag.surface.isConnected) clearDragOffset(drag.surface);
      }, SNAP_DURATION_MS + 24);
    }, POST_DISMISS_FALLBACK_MS);
  };

  if (!animations.sheet && !animations.overlay) {
    triggerClose();
    return;
  }

  window.setTimeout(triggerClose, DISMISS_DURATION_MS + 12);
}

function finishDrag(
  drag: ActiveDrag,
  clientY: number,
  now: number,
): boolean {
  const deltaY = clientY - drag.startY;
  if (drag.intent !== 'vertical') {
    drag.surface.classList.remove('is-bottom-sheet-dragging');
    clearDragOffset(drag.surface);
    return false;
  }

  const elapsed = Math.max(now - drag.lastSampleAt, 1);
  const releaseVelocity = (clientY - drag.lastY) / elapsed;
  const velocityY = Math.max(drag.velocityY, releaseVelocity);
  const height = drag.surface.getBoundingClientRect().height;
  const shouldDismiss = isBottomSheetDismissGesture(
    deltaY,
    velocityY,
    height,
    true,
  );

  if (!shouldDismiss) {
    snapBack(drag, deltaY);
    return false;
  }

  dismissWithMomentum(drag, deltaY);
  return true;
}

export function installBottomSheetDragDismiss() {
  let activeDrag: ActiveDrag | null = null;
  let ignoreMouseUntil = 0;
  let suppressClickUntil = 0;
  let suppressedSurface: HTMLElement | null = null;
  let touchTrackingAttached = false;
  let mouseTrackingAttached = false;

  const touchMoveOptions: AddEventListenerOptions = { capture: true, passive: false };
  const touchPassiveOptions: AddEventListenerOptions = { capture: true, passive: true };

  function detachTouchTracking() {
    if (!touchTrackingAttached) return;
    document.removeEventListener('touchmove', handleTouchMove, true);
    document.removeEventListener('touchend', handleTouchEnd, true);
    document.removeEventListener('touchcancel', handleTouchCancel, true);
    touchTrackingAttached = false;
  }

  function attachTouchTracking() {
    if (touchTrackingAttached) return;
    document.addEventListener('touchmove', handleTouchMove, touchMoveOptions);
    document.addEventListener('touchend', handleTouchEnd, touchPassiveOptions);
    document.addEventListener('touchcancel', handleTouchCancel, touchPassiveOptions);
    touchTrackingAttached = true;
  }

  function detachMouseTracking() {
    if (!mouseTrackingAttached) return;
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    mouseTrackingAttached = false;
  }

  function attachMouseTracking() {
    if (mouseTrackingAttached) return;
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    mouseTrackingAttached = true;
  }

  function suppressReleaseClick(surface: HTMLElement) {
    suppressedSurface = surface;
    suppressClickUntil = window.performance.now() + 480;
  }

  function cancelActiveDrag() {
    if (activeDrag) {
      activeDrag.surface.classList.remove('is-bottom-sheet-dragging');
      clearDragOffset(activeDrag.surface);
    }
    activeDrag = null;
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1 || activeDrag) return;
    const touch = event.touches.item(0);
    if (!touch) return;

    const resolved = resolveBottomSheet(event.target, touch.clientY);
    if (!resolved) return;

    const now = window.performance.now();
    activeDrag = beginDrag(
      'touch',
      resolved.surface,
      resolved.overlay,
      touch.clientX,
      touch.clientY,
      now,
      touch.identifier,
    );
    ignoreMouseUntil = now + MOUSE_AFTER_TOUCH_BLOCK_MS;
    attachTouchTracking();
  }

  function handleTouchMove(event: TouchEvent) {
    if (isTimelineDragInteractionLocked()) {
      cancelActiveDrag();
      detachTouchTracking();
      return;
    }

    const drag = activeDrag;
    if (!drag || drag.source !== 'touch' || drag.touchIdentifier === null) return;
    const touch = getTouchByIdentifier(event.touches, drag.touchIdentifier);
    if (!touch) return;

    const result = updateDrag(
      drag,
      touch.clientX,
      touch.clientY,
      window.performance.now(),
    );
    if (result === 'cancel') {
      cancelActiveDrag();
      detachTouchTracking();
      return;
    }
    if (result === 'vertical' && event.cancelable) event.preventDefault();
  }

  function handleTouchEnd(event: TouchEvent) {
    const drag = activeDrag;
    if (!drag || drag.source !== 'touch' || drag.touchIdentifier === null) return;
    const touch = getTouchByIdentifier(event.changedTouches, drag.touchIdentifier);
    activeDrag = null;
    detachTouchTracking();
    ignoreMouseUntil = window.performance.now() + MOUSE_AFTER_TOUCH_BLOCK_MS;

    if (!touch) {
      drag.surface.classList.remove('is-bottom-sheet-dragging');
      clearDragOffset(drag.surface);
      return;
    }

    if (drag.intent === 'vertical') suppressReleaseClick(drag.surface);
    finishDrag(drag, touch.clientY, window.performance.now());
  }

  function handleTouchCancel() {
    ignoreMouseUntil = window.performance.now() + MOUSE_AFTER_TOUCH_BLOCK_MS;
    cancelActiveDrag();
    detachTouchTracking();
  }

  function handleMouseDown(event: MouseEvent) {
    if (event.button !== 0 || activeDrag || window.performance.now() < ignoreMouseUntil) return;
    const resolved = resolveBottomSheet(event.target, event.clientY);
    if (!resolved) return;

    activeDrag = beginDrag(
      'mouse',
      resolved.surface,
      resolved.overlay,
      event.clientX,
      event.clientY,
      window.performance.now(),
    );
    attachMouseTracking();
  }

  function handleMouseMove(event: MouseEvent) {
    const drag = activeDrag;
    if (!drag || drag.source !== 'mouse') return;

    const result = updateDrag(
      drag,
      event.clientX,
      event.clientY,
      window.performance.now(),
    );
    if (result === 'cancel') {
      cancelActiveDrag();
      detachMouseTracking();
      return;
    }
    if (result === 'vertical') event.preventDefault();
  }

  function handleMouseUp(event: MouseEvent) {
    const drag = activeDrag;
    if (!drag || drag.source !== 'mouse') return;
    activeDrag = null;
    detachMouseTracking();
    if (drag.intent === 'vertical') suppressReleaseClick(drag.surface);
    finishDrag(drag, event.clientY, window.performance.now());
  }

  function handleClick(event: MouseEvent) {
    if (!suppressedSurface || window.performance.now() >= suppressClickUntil) {
      suppressedSurface = null;
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !suppressedSurface.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  document.addEventListener('touchstart', handleTouchStart, touchPassiveOptions);
  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('click', handleClick, true);

  return () => {
    cancelActiveDrag();
    detachTouchTracking();
    detachMouseTracking();
    document.removeEventListener('touchstart', handleTouchStart, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.removeEventListener('click', handleClick, true);
  };
}
