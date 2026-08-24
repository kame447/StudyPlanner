const EDGE_START_RATIO = 0.25;
const EDGE_START_MIN_PX = 72;
const EDGE_START_MAX_PX = 96;
const TRIGGER_DISTANCE_PX = 56;
const MAX_PREVIEW_PX = 160;
const VERTICAL_CANCEL_MIN_PX = 104;
const VERTICAL_CANCEL_RATIO = 1.35;
const END_VERTICAL_RATIO = 0.75;

interface ActiveSwipe {
  pointerId: number;
  startX: number;
  startY: number;
  page: HTMLElement;
}

export function getStudySessionSwipeStartLimit(width: number): number {
  return Math.min(
    EDGE_START_MAX_PX,
    Math.max(EDGE_START_MIN_PX, width * EDGE_START_RATIO),
  );
}

export function isStudySessionBackSwipe(deltaX: number, deltaY: number): boolean {
  return (
    deltaX >= TRIGGER_DISTANCE_PX &&
    deltaX >= Math.abs(deltaY) * END_VERTICAL_RATIO
  );
}

function resetSwipe(activeSwipe: ActiveSwipe | null) {
  if (!activeSwipe) return;
  activeSwipe.page.classList.remove('is-swiping-back');
  activeSwipe.page.style.removeProperty('--study-session-swipe-x');
}

export function installStudySessionSwipeNavigation() {
  let activeSwipe: ActiveSwipe | null = null;

  function handlePointerDown(event: PointerEvent) {
    if (!event.isPrimary) return;
    const target = event.target instanceof Element ? event.target : null;
    const overlay = target?.closest(
      '.study-session-overlay[aria-label="学習中"], .study-session-overlay[aria-label="学習を開始"]',
    );
    const page = target?.closest('.study-session-page');
    if (!(overlay instanceof HTMLElement) || !(page instanceof HTMLElement)) return;

    const rect = page.getBoundingClientRect();
    if (event.clientX - rect.left > getStudySessionSwipeStartLimit(rect.width)) return;

    activeSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      page,
    };
    page.classList.add('is-swiping-back');
    page.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - activeSwipe.startX;
    const deltaY = event.clientY - activeSwipe.startY;
    if (deltaX <= 0) {
      activeSwipe.page.style.setProperty('--study-session-swipe-x', '0px');
      return;
    }

    if (
      Math.abs(deltaY) > VERTICAL_CANCEL_MIN_PX &&
      Math.abs(deltaY) > deltaX * VERTICAL_CANCEL_RATIO
    ) {
      resetSwipe(activeSwipe);
      activeSwipe = null;
      return;
    }

    activeSwipe.page.style.setProperty(
      '--study-session-swipe-x',
      `${Math.min(deltaX, MAX_PREVIEW_PX)}px`,
    );
  }

  function handlePointerEnd(event: PointerEvent) {
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) return;

    const swipe = activeSwipe;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    const shouldNavigateBack = isStudySessionBackSwipe(deltaX, deltaY);

    resetSwipe(swipe);
    activeSwipe = null;

    if (!shouldNavigateBack) return;
    const backButton = swipe.page.querySelector<HTMLButtonElement>('button[aria-label="戻る"]');
    backButton?.click();
  }

  function handlePointerCancel(event: PointerEvent) {
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) return;
    resetSwipe(activeSwipe);
    activeSwipe = null;
  }

  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('pointerup', handlePointerEnd, true);
  document.addEventListener('pointercancel', handlePointerCancel, true);

  return () => {
    resetSwipe(activeSwipe);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('pointerup', handlePointerEnd, true);
    document.removeEventListener('pointercancel', handlePointerCancel, true);
  };
}
