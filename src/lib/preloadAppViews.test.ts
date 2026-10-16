import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const loaded = vi.hoisted(() => new Set<string>());
const streak = vi.hoisted(() => ({ read: vi.fn(), useRestDay: vi.fn() }));

let preloader: typeof import('./preloadAppViews');
beforeEach(async () => {
  vi.resetModules();
  loaded.clear();
  vi.clearAllMocks();
  vi.doMock('../repositories', () => ({ studyStreakRepository: streak }));
  vi.doMock('../components/StudyStreakPage', async importOriginal => {
    loaded.add('streak');
    return await importOriginal();
  });
  vi.doMock('../components/AiPlanningView', () => { loaded.add('ai'); return {}; });
  vi.doMock('../components/WeekView', () => { loaded.add('week'); return {}; });
  vi.doMock('../components/DayView', () => ({}));
  vi.doMock('../components/TodoView', () => ({}));
  vi.doMock('../components/ReportView', () => ({}));
  vi.doMock('../components/TimetableView', () => ({}));
  vi.doMock('../components/BookshelfView', () => ({}));
  vi.doMock('../components/QuickEntryModal', () => ({}));
  vi.doMock('../components/TimetableOcrImportDialog', () => ({}));
  preloader = await import('./preloadAppViews');
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('loads streak and AI code once without mounting their UI, reading history or starting a conversation', async () => {
  expect(loaded.size).toBe(0);
  const first = preloader.preloadAppViews();
  expect(preloader.preloadAppViews()).toBe(first);
  await first;
  expect(loaded).toEqual(new Set(['streak', 'ai', 'week']));
  expect(preloader.preloadAppViews()).toBe(first);
  expect(streak.read).not.toHaveBeenCalled();
  expect(streak.useRestDay).not.toHaveBeenCalled();
});

it('waits for idle with a one-second bound before importing the streak detail', async () => {
  let idle!: () => void;
  const requestIdleCallback = vi.fn((run: () => void) => { idle = run; return 7; });
  vi.stubGlobal('window', { requestIdleCallback });
  preloader.scheduleAppViewPreload();
  expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 1000 });
  expect(loaded.size).toBe(0);
  idle();
  await vi.dynamicImportSettled();
  expect(loaded.has('streak')).toBe(true);
  expect(streak.read).not.toHaveBeenCalled();
});

it('cancels pending idle preloads even if the browser still delivers the callback', async () => {
  let idle!: () => void;
  const cancelIdleCallback = vi.fn();
  vi.stubGlobal('window', { requestIdleCallback: (run: () => void) => { idle = run; return 7; }, cancelIdleCallback });
  const cancel = preloader.scheduleAppViewPreload();
  cancel();
  expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  idle();
  await vi.dynamicImportSettled();
  expect(loaded.size).toBe(0);
});

it('uses the existing 250ms fallback after Home when idle callbacks are unavailable', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  preloader.scheduleAppViewPreload();
  await vi.advanceTimersByTimeAsync(249);
  expect(loaded.size).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await vi.dynamicImportSettled();
  expect(loaded.has('streak')).toBe(true);
  expect(streak.read).not.toHaveBeenCalled();
});

it('cancels the fallback before any optional module is loaded', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  preloader.scheduleAppViewPreload()();
  await vi.advanceTimersByTimeAsync(1000);
  expect(loaded.size).toBe(0);
});

it('does not preload outside the browser', () => {
  vi.stubGlobal('window', undefined);
  expect(preloader.scheduleAppViewPreload()()).toBeUndefined();
  expect(loaded.size).toBe(0);
});
