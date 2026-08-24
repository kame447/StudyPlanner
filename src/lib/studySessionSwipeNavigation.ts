const EDGE_START_RATIO = 0.4;
const EDGE_START_MIN_PX = 96;
const EDGE_START_MAX_PX = 160;
const INTENT_LOCK_DISTANCE_PX = 6;
const VERTICAL_ABORT_DISTANCE_PX = 14;
const HORIZONTAL_LOCK_RATIO = 0.7;
const VERTICAL_ABORT_RATIO = 1.45;
const TRIGGER_DISTANCE_RATIO = 0.16;
const TRIGGER_DISTANCE_MIN_PX = 48;
const TRIGGER_DISTANCE_MAX_PX = 84;
const FAST_SWIPE_MIN_DISTANCE_PX = 24;
const FAST_SWIPE_VELOCITY_PX_PER_MS = 0.18;
const MAX_PREVIEW_PX = 260;
const MOUSE_AFTER_TOUCH_BLOCK_MS = 700;
const INTERACTIVE_START_SELECTOR = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]';

type SwipeIntent = 'pending' | 'horizontal';
type SwipeSource = 'touch' | 'mouse';

interface ActiveSwipe {
  source: SwipeSource;
  touchIdentifier: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastSampleAt: number;
  velocityX: number;
  page: HTMLElement;
  intent: SwipeIntent;
}

export function getStudySessionSwipeStartLimit(width: number): number {
  return Math.min(
    EDGE_START_MAX_PX,
    Math.max(EDGE_START_MIN_PX, width * EDGE_START_RATIO),
  );
}

export function getStudySessionSwipeTriggerDistance(width: number): number {
  return Math.min(
    TRIGGER_DISTANCE_MAX_PX,
    Math.max(TRIGGER_DISTANCE_MIN_PX, width * TRIGGER_DISTANCE_RATIO),
  );
}

export function getStudySessionSwipeIntent(
  deltaX: number,
  deltaY: number,
): 'pending' | 'horizontal' | 'cancel' {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (deltaX <= -INTENT_LOCK_DISTANCE_PX) return 'cancel';
  if (absX < INTENT_LOCK_DISTANCE_PX && absY < INTENT_LOCK_DISTANCE_PX) {
    return 'pending';
  }
  if (
    absY >= VERTICAL_ABORT_DISTANCE_PX &&
    absY > absX * VERTICAL_ABORT_RATIO
  ) {
    return 'cancel';
  }
  if (deltaX > 0 && absX >= absY * HORIZONTAL_LOCK_RATIO) {
    return 'horizontal';
  }
  return 'pending';
}

export function isStudySessionBackSwipe(
  deltaX: number,
  velocityX: number,
  width: number,
  horizontalLocked = true,
): boolean {
  if (!horizontalLocked || deltaX <= 0) return false;

  const byDistance = deltaX >= getStudySessionSwipeTriggerDistance(width);
  const byVelocity =
    deltaX >= FAST_SWIPE_MIN_DISTANCE_PX &&
    velocityX >= FAST_SWIPE_VELOCITY_PX_PER_MS;
  return byDistance || byVelocity;
}

function getTouchByIdentifier(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

function resolveSwipePage(target: EventTarget | null, clientX: number): HTMLElement | null {
  const element = target instanceof Element ? target : null;
  if (!element || element.closest(INTERACTIVE_START_SELECTOR)) return null;

  const overlay = element.closest(
    '.study-session-overlay[aria-label="学習中"], .study-session-overlay[aria-label="学習を開始"]',
  );
  const page = element.closest('.study-session-page');
  if (!(overlay instanceof HTMLElement) || !(page instanceof HTMLElement)) return null;

  const rect = page.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  if (offsetX < 0 || offsetX > getStudySessionSwipeStartLimit(rect.width)) return null;
  return page;
}

function clearSwipeVisual(page: HTMLElement) {
  page.classList.remove('is-swiping-back');
  page.style.removeProperty('--study-session-swipe-x');
}

function beginSwipe(
  source: SwipeSource,
  page: HTMLElement,
  clientX: number,
  clientY: number,
  now: number,
  touchIdentifier: number | null = null,
): ActiveSwipe {
  return {
    source,
    touchIdentifier,
    startX: clientX,
    startY: clientY,
    lastX: clientX,
    lastSampleAt: now,
    velocityX: 0,
    page,
    intent: 'pending',
  };
}

function updateSwipe(
  swipe: ActiveSwipe,
  clientX: number,
  clientY: number,
  now: number,
): 'pending' | 'horizontal' | 'cancel' {
  const deltaX = clientX - swipe.startX;
  const deltaY = clientY - swipe.startY;

  if (swipe.intent === 'pending') {
    const nextIntent = getStudySessionSwipeIntent(deltaX, deltaY);
    if (nextIntent === 'cancel') {
      clearSwipeVisual(swipe.page);
      return 'cancel';
    }
    if (nextIntent === 'horizontal') {
      swipe.intent = 'horizontal';
      swipe.page.classList.add('is-swiping-back');
    }
  }

  if (swipe.intent !== 'horizontal') return 'pending';

  const elapsed = Math.max(now - swipe.lastSampleAt, 1);
  const instantaneousVelocity = (clientX - swipe.lastX) / elapsed;
  swipe.velocityX = swipe.velocityX === 0
    ? instantaneousVelocity
    : swipe.velocityX * 0.55 + instantaneousVelocity * 0.45;
  swipe.lastX = clientX;
  swipe.lastSampleAt = now;

  const pageWidth = swipe.page.getBoundingClientRect().width;
  const previewLimit = Math.min(MAX_PREVIEW_PX, pageWidth * 0.72);
  const previewX = Math.min(Math.max(deltaX, 0), previewLimit);
  swipe.page.style.setProperty('--study-session-swipe-x', `${previewX}px`);
  return 'horizontal';
}

function finishSwipe(
  swipe: ActiveSwipe,
  clientX: number,
  now: number,
): boolean {
  if (swipe.intent !== 'horizontal') {
    clearSwipeVisual(swipe.page);
    return false;
  }

  const deltaX = clientX - swipe.startX;
  const elapsed = Math.max(now - swipe.lastSampleAt, 1);
  const releaseVelocity = (clientX - swipe.lastX) / elapsed;
  const velocityX = Math.max(swipe.velocityX, releaseVelocity);
  const width = swipe.page.getBoundingClientRect().width;
  const shouldNavigateBack = isStudySessionBackSwipe(
    deltaX,
    velocityX,
    width,
    true,
  );

  if (!shouldNavigateBack) {
    clearSwipeVisual(swipe.page);
    return false;
  }

  swipe.page.classList.remove('is-swiping-back');
  const settleX = Math.max(
    Math.max(deltaX, 0),
    Math.min(width * 0.28, 140),
  );
  swipe.page.style.setProperty('--study-session-swipe-x', `${settleX}px`);

  const backButton = swipe.page.querySelector<HTMLButtonElement>('button[aria-label="戻る"]');
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!swipe.page.isConnected) return;
      backButton?.click();
      window.requestAnimationFrame(() => {
        if (swipe.page.isConnected) clearSwipeVisual(swipe.page);
      });
    });
  });

  return true;
}

export function installStudySessionSwipeNavigation() {
  let activeSwipe: ActiveSwipe | null = null;
  let ignoreMouseUntil = 0;
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

  function cancelActiveSwipe() {
    if (activeSwipe) clearSwipeVisual(activeSwipe.page);
    activeSwipe = null;
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1 || activeSwipe) return;
    const touch = event.touches.item(0);
    if (!touch) return;

    const page = resolveSwipePage(event.target, touch.clientX);
    if (!page) return;

    const now = window.performance.now();
    activeSwipe = beginSwipe(
      'touch',
      page,
      touch.clientX,
      touch.clientY,
      now,
      touch.identifier,
    );
    ignoreMouseUntil = now + MOUSE_AFTER_TOUCH_BLOCK_MS;
    attachTouchTracking();
  }

  function handleTouchMove(event: TouchEvent) {
    const swipe = activeSwipe;
    if (!swipe || swipe.source !== 'touch' || swipe.touchIdentifier === null) return;
    const touch = getTouchByIdentifier(event.touches, swipe.touchIdentifier);
    if (!touch) return;

    const result = updateSwipe(
      swipe,
      touch.clientX,
      touch.clientY,
      window.performance.now(),
    );
    if (result === 'cancel') {
      activeSwipe = null;
      detachTouchTracking();
      return;
    }
    if (result === 'horizontal' && event.cancelable) {
      event.preventDefault();
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    const swipe = activeSwipe;
    if (!swipe || swipe.source !== 'touch' || swipe.touchIdentifier === null) return;
    const touch = getTouchByIdentifier(event.changedTouches, swipe.touchIdentifier);
    activeSwipe = null;
    detachTouchTracking();
    ignoreMouseUntil = window.performance.now() + MOUSE_AFTER_TOUCH_BLOCK_MS;

    if (!touch) {
      clearSwipeVisual(swipe.page);
      return;
    }
    finishSwipe(swipe, touch.clientX, window.performance.now());
  }

  function handleTouchCancel() {
    ignoreMouseUntil = window.performance.now() + MOUSE_AFTER_TOUCH_BLOCK_MS;
    cancelActiveSwipe();
    detachTouchTracking();
  }

  function handleMouseDown(event: MouseEvent) {
    if (event.button !== 0 || activeSwipe || window.performance.now() < ignoreMouseUntil) return;
    const page = resolveSwipePage(event.target, event.clientX);
    if (!page) return;

    activeSwipe = beginSwipe(
      'mouse',
      page,
      event.clientX,
      event.clientY,
      window.performance.now(),
    );
    attachMouseTracking();
  }

  function handleMouseMove(event: MouseEvent) {
    const swipe = activeSwipe;
    if (!swipe || swipe.source !== 'mouse') return;

    const result = updateSwipe(
      swipe,
      event.clientX,
      event.clientY,
      window.performance.now(),
    );
    if (result === 'cancel') {
      activeSwipe = null;
      detachMouseTracking();
      return;
    }
    if (result === 'horizontal') event.preventDefault();
  }

  function handleMouseUp(event: MouseEvent) {
    const swipe = activeSwipe;
    if (!swipe || swipe.source !== 'mouse') return;
    activeSwipe = null;
    detachMouseTracking();
    finishSwipe(swipe, event.clientX, window.performance.now());
  }

  document.addEventListener('touchstart', handleTouchStart, touchPassiveOptions);
  document.addEventListener('mousedown', handleMouseDown, true);

  return () => {
    cancelActiveSwipe();
    detachTouchTracking();
    detachMouseTracking();
    document.removeEventListener('touchstart', handleTouchStart, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
  };
}
