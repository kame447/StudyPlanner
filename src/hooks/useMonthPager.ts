import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type TransitionEvent,
} from 'react';
import { addMonths } from '../lib/date';

const MONTH_PAGER_DRAG_LIMIT_RATIO = 0.92;
const MONTH_PAGER_DRAG_THRESHOLD_RATIO = 0.22;
const MONTH_PAGER_MAX_DRAG_THRESHOLD = 96;
const MONTH_PAGER_MIN_CLICK_SUPPRESS_DELTA = 8;
const MONTH_PAGER_DIRECTION_RATIO = 1.15;
const MONTH_PAGER_CENTER_INDEX = 2;
const MONTH_PAGER_EXTENSION_COUNT = 2;
const MONTH_PAGER_EDGE_BUFFER = 1;

function createPagerMonths(centerMonthDate: string): string[] {
  return Array.from({ length: 5 }, (_, index) =>
    addMonths(centerMonthDate, index - MONTH_PAGER_CENTER_INDEX),
  );
}

function createMonthsBefore(firstMonthDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addMonths(firstMonthDate, index - count),
  );
}

function createMonthsAfter(lastMonthDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addMonths(lastMonthDate, index + 1),
  );
}

export function useMonthPager({
  monthDate,
  disabled,
  onChangeMonth,
}: {
  monthDate: string;
  disabled: boolean;
  onChangeMonth: (date: string) => void;
}) {
  const [visibleMonths, setVisibleMonths] = useState(() =>
    createPagerMonths(monthDate),
  );
  const [activeMonthIndex, setActiveMonthIndex] = useState(
    MONTH_PAGER_CENTER_INDEX,
  );
  const [pagerOffset, setPagerOffset] = useState(0);
  const [pagerTransitionEnabled, setPagerTransitionEnabled] = useState(true);
  const [pendingPagerDirection, setPendingPagerDirection] = useState<-1 | 1 | null>(
    null,
  );
  const pagerViewportRef = useRef<HTMLDivElement | null>(null);
  const pagerPointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    didDrag: boolean;
  } | null>(null);
  const pagerStepRef = useRef(0);
  const suppressNextCellClick = useRef(false);
  const activeMonthDate = visibleMonths[activeMonthIndex] ?? monthDate;

  const measurePagerStep = useCallback(() => {
    const viewport = pagerViewportRef.current;

    if (!viewport) {
      return pagerStepRef.current;
    }

    const nextStep = viewport.clientWidth;

    pagerStepRef.current = nextStep;
    return nextStep;
  }, []);

  useEffect(() => {
    measurePagerStep();

    const viewport = pagerViewportRef.current;

    if (!viewport || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measurePagerStep();
    });

    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [measurePagerStep]);

  useEffect(() => {
    const currentVisibleMonth = visibleMonths[activeMonthIndex];

    if (currentVisibleMonth === monthDate) {
      return;
    }

    setPagerTransitionEnabled(false);
    setPagerOffset(0);
    setPendingPagerDirection(null);
    pagerPointerRef.current = null;
    setVisibleMonths(createPagerMonths(monthDate));
    setActiveMonthIndex(MONTH_PAGER_CENTER_INDEX);

    window.requestAnimationFrame(() => {
      setPagerTransitionEnabled(true);
    });
  }, [monthDate]);

  function animateMonthChange(direction: -1 | 1) {
    if (pendingPagerDirection !== null || disabled) {
      return;
    }

    measurePagerStep();

    setPagerTransitionEnabled(true);
    setPendingPagerDirection(direction);
    setPagerOffset(0);
    setActiveMonthIndex((currentIndex) => currentIndex + direction);
  }

  function handlePagerTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return;
    }

    if (pendingPagerDirection === null) {
      return;
    }

    const settledMonthDate = visibleMonths[activeMonthIndex] ?? activeMonthDate;
    const settledIndex = activeMonthIndex;

    setPagerOffset(0);
    setPendingPagerDirection(null);
    onChangeMonth(settledMonthDate);

    if (settledIndex <= MONTH_PAGER_EDGE_BUFFER) {
      const firstMonthDate = visibleMonths[0] ?? settledMonthDate;
      const prependedMonths = createMonthsBefore(
        firstMonthDate,
        MONTH_PAGER_EXTENSION_COUNT,
      );

      setPagerTransitionEnabled(false);
      setVisibleMonths((currentMonths) => [...prependedMonths, ...currentMonths]);
      setActiveMonthIndex(settledIndex + MONTH_PAGER_EXTENSION_COUNT);

      window.requestAnimationFrame(() => {
        setPagerTransitionEnabled(true);
      });
      return;
    }

    if (settledIndex >= visibleMonths.length - 1 - MONTH_PAGER_EDGE_BUFFER) {
      const lastMonthDate =
        visibleMonths[visibleMonths.length - 1] ?? settledMonthDate;
      const appendedMonths = createMonthsAfter(
        lastMonthDate,
        MONTH_PAGER_EXTENSION_COUNT,
      );

      setVisibleMonths((currentMonths) => [...currentMonths, ...appendedMonths]);
    }

    setPagerTransitionEnabled(true);
  }

  function handlePagerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pendingPagerDirection !== null || disabled) {
      return;
    }

    measurePagerStep();
    pagerPointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
    };
    setPagerTransitionEnabled(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePagerPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pointer = pagerPointerRef.current;

    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const step = pagerStepRef.current || measurePagerStep();
    const clampedOffset = Math.max(
      -step * MONTH_PAGER_DRAG_LIMIT_RATIO,
      Math.min(step * MONTH_PAGER_DRAG_LIMIT_RATIO, deltaX),
    );

    if (Math.abs(deltaX) > MONTH_PAGER_MIN_CLICK_SUPPRESS_DELTA) {
      pointer.didDrag = true;
      suppressNextCellClick.current = true;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) * MONTH_PAGER_DIRECTION_RATIO) {
      event.preventDefault();
    }

    setPagerOffset(clampedOffset);
  }

  function finishPagerDrag(event: PointerEvent<HTMLDivElement>) {
    const pointer = pagerPointerRef.current;

    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const step = pagerStepRef.current || measurePagerStep();
    const threshold = Math.min(
      MONTH_PAGER_MAX_DRAG_THRESHOLD,
      step * MONTH_PAGER_DRAG_THRESHOLD_RATIO,
    );
    const isHorizontalSwipe =
      Math.abs(deltaX) > Math.abs(deltaY) * MONTH_PAGER_DIRECTION_RATIO;

    pagerPointerRef.current = null;
    setPagerTransitionEnabled(true);

    if (pointer.didDrag) {
      window.setTimeout(() => {
        suppressNextCellClick.current = false;
      }, 0);
    }

    if (Math.abs(deltaX) >= threshold && isHorizontalSwipe) {
      const direction = deltaX < 0 ? 1 : -1;

      setPendingPagerDirection(direction);
      setPagerOffset(0);
      setActiveMonthIndex((currentIndex) => currentIndex + direction);
      return;
    }

    setPagerOffset(0);
  }

  const pagerOffsetTerm =
    pagerOffset >= 0 ? `+ ${pagerOffset}px` : `- ${Math.abs(pagerOffset)}px`;
  const pagerBaseOffset = `-${activeMonthIndex * 100}%`;
  const pagerTransform =
    pagerOffset === 0
      ? `translate3d(${pagerBaseOffset}, 0, 0)`
      : `translate3d(calc(${pagerBaseOffset} ${pagerOffsetTerm}), 0, 0)`;

  return {
    activeMonthDate,
    activeMonthIndex,
    visibleMonths,
    pagerViewportRef,
    pagerTransitionEnabled,
    pagerTransform,
    suppressNextCellClick,
    animateMonthChange,
    handlePagerTransitionEnd,
    handlePagerPointerDown,
    handlePagerPointerMove,
    finishPagerDrag,
  };
}
