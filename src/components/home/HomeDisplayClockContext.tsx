import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const HomeDisplayClockContext = createContext<Date | null>(null);

// Display time is independent of the selected planner date and persisted data.
export function HomeDisplayClockProvider({ active = true, children }: { active?: boolean; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined'
      || !window.addEventListener || !document.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const instant = Date.now();
      setNow(new Date(instant));
      timer = setTimeout(refresh, 60_000 - ((instant % 60_000) + 60_000) % 60_000);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [active]);
  return <HomeDisplayClockContext.Provider value={now}>{children}</HomeDisplayClockContext.Provider>;
}

export function useHomeDisplayClock(): Date {
  // Standalone renderers get a snapshot without adding another timer.
  return useContext(HomeDisplayClockContext) ?? new Date();
}
