type ModuleLoader = () => Promise<unknown>;

type IdleCapableWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const primaryViewLoaders: readonly ModuleLoader[] = [
  () => import('../components/StudyStreakPage'),
  () => import('../components/MonthView'),
  () => import('../components/AiPlanningView'),
  () => import('../components/WeekView'),
  () => import('../components/DayView'),
  () => import('../components/TodoView'),
  () => import('../components/ReportView'),
  () => import('../components/TimetableView'),
  () => import('../components/BookshelfView'),
];

const secondaryViewLoaders: readonly ModuleLoader[] = [
  () => import('../components/QuickEntryModal'),
  () => import('../components/TimetableOcrImportDialog'),
];

const maxConcurrentPreloads = 8;
let preloadPromise: Promise<void> | null = null;

async function preloadInOrder(loaders: readonly ModuleLoader[]): Promise<void> {
  let nextLoader = 0;
  const run = async () => {
    while (nextLoader < loaders.length) {
      const load = loaders[nextLoader++];
      try {
        await load();
      } catch {
        // Warming is optional. The foreground lazy import owns error recovery.
      }
    }
  };

  // A slow primary must not hold every released slot. Keep the existing peak
  // of eight pending loaders while offering each free slot to the next view.
  await Promise.all(Array.from({ length: Math.min(maxConcurrentPreloads, loaders.length) }, run));
}

export function preloadAppViews(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = preloadInOrder([...primaryViewLoaders, ...secondaryViewLoaders]);
  }

  return preloadPromise;
}

export function scheduleAppViewPreload(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  let cancelled = false;
  const idleWindow = window as IdleCapableWindow;
  const run = () => {
    if (!cancelled) {
      void preloadAppViews();
    }
  };

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(run, { timeout: 1000 });

    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = window.setTimeout(run, 250);

  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}
