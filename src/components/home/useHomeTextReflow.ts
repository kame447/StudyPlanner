import { useLayoutEffect, useState, type RefObject } from 'react';

/** Text-only enlargement must be observable even when the viewport is unchanged. */
export function useHomeTextReflow(coreRef: RefObject<HTMLDivElement | null>, gettingStarted: boolean) {
  const [textSize, setTextSize] = useState(16);
  useLayoutEffect(() => {
    const dashboard = coreRef.current?.closest<HTMLElement>('.home-dashboard-default');
    if (!dashboard || typeof ResizeObserver === 'undefined') return;
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;inset:0 auto auto 0;inline-size:1rem;block-size:1rem;visibility:hidden;pointer-events:none';
    dashboard.append(probe);
    const measure = () => {
      const size = probe.getBoundingClientRect().height;
      if (size <= 0) return; // A retained hidden screen has no text-size measurement.
      setTextSize(size);
      // The compact dashboard is designed around the standard 16px root text.
      if (size > 16) dashboard.dataset.contentScroll = 'true';
      else delete dashboard.dataset.contentScroll;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    measure();
    return () => {
      observer.disconnect();
      probe.remove();
      delete dashboard.dataset.contentScroll;
    };
  }, [coreRef, gettingStarted]);
  return textSize;
}
