type ModuleLoader = () => Promise<unknown>;

type IdleCapableWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const primaryViewLoaders: readonly ModuleLoader[] = [
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

let preloadPromise: Promise<void> | null = null;

async function settleAll(loaders: readonly ModuleLoader[]): Promise<void> {
  await Promise.allSettled(loaders.map((load) => load()));
}

export function preloadAppViews(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = settleAll(primaryViewLoaders).then(() =>
      settleAll(secondaryViewLoaders),
    );
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
