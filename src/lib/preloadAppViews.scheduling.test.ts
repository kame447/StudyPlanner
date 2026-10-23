import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const primary = ['streak', 'month', 'ai', 'week', 'day', 'todo', 'report', 'timetable', 'bookshelf'];
const initialPrimary = primary.slice(0, 8);
const secondary = ['quick-entry', 'ocr'];
const modules: Record<string, string> = {
  streak: '../components/StudyStreakPage',
  month: '../components/MonthView',
  ai: '../components/AiPlanningView',
  week: '../components/WeekView',
  day: '../components/DayView',
  todo: '../components/TodoView',
  report: '../components/ReportView',
  timetable: '../components/TimetableView',
  bookshelf: '../components/BookshelfView',
  'quick-entry': '../components/QuickEntryModal',
  ocr: '../components/TimetableOcrImportDialog',
};

let starts: string[];
let pending: Set<string>;
let maxPending: number;
let completions: Map<string, { resolve: () => void; reject: () => void }>;
let preloader: typeof import('./preloadAppViews');

beforeEach(async () => {
  vi.resetModules();
  starts = [];
  pending = new Set();
  maxPending = 0;
  completions = new Map();
  for (const [name, module] of Object.entries(modules)) {
    vi.doMock(module, () => {
      starts.push(name);
      pending.add(name);
      maxPending = Math.max(maxPending, pending.size);
      return new Promise<Record<string, never>>((resolve, reject) => {
        completions.set(name, {
          resolve: () => { pending.delete(name); resolve({}); },
          reject: () => { pending.delete(name); reject(new Error(`failed ${name} import`)); },
        });
      });
    });
  }
  preloader = await import('./preloadAppViews');
});

afterEach(() => { vi.unstubAllGlobals(); });

async function waitForStarted(names: string[]) {
  await vi.waitFor(() => expect(starts).toEqual(names));
}

async function finishAll(result: Promise<void>) {
  for (const completion of completions.values()) completion.resolve();
  await waitForStarted([...primary, ...secondary]);
  for (const completion of completions.values()) completion.resolve();
  await result;
}

it('warms the quick-entry code in a released slot without waiting for a slow primary', async () => {
  const result = preloader.preloadAppViews();
  await waitForStarted(initialPrimary);
  expect(pending.size).toBe(8);
  completions.get('week')!.resolve();
  await waitForStarted(primary);
  expect(pending.size).toBe(8);
  completions.get('month')!.resolve();
  await waitForStarted([...primary, 'quick-entry']);
  expect(pending.has('streak')).toBe(true);
  expect(pending.size).toBe(8);
  completions.get('quick-entry')!.resolve();
  await waitForStarted([...primary, ...secondary]);
  expect(pending.has('streak')).toBe(true);
  expect(maxPending).toBe(8);
  await finishAll(result);
});

it('keeps all secondary work queued while every primary slot is pending', async () => {
  const result = preloader.preloadAppViews();
  await waitForStarted(initialPrimary);
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(starts).toEqual(initialPrimary);
  expect(maxPending).toBe(8);
  await finishAll(result);
});

it('releases failed imports without rejecting the batch or losing secondary work', async () => {
  const result = preloader.preloadAppViews();
  await waitForStarted(initialPrimary);
  completions.get('streak')!.reject();
  await waitForStarted(primary);
  completions.get('bookshelf')!.reject();
  await waitForStarted([...primary, 'quick-entry']);
  completions.get('quick-entry')!.reject();
  await waitForStarted([...primary, ...secondary]);
  expect(maxPending).toBe(8);
  await finishAll(result);
  await expect(result).resolves.toBeUndefined();
});

it('shares one pending and completed batch and waits for every started import to settle', async () => {
  const result = preloader.preloadAppViews();
  const settled = vi.fn();
  void result.then(settled);
  expect(preloader.preloadAppViews()).toBe(result);
  await waitForStarted(initialPrimary);
  for (const name of initialPrimary.filter(name => name !== 'streak')) completions.get(name)!.resolve();
  await waitForStarted([...primary, ...secondary]);
  for (const name of ['bookshelf', ...secondary]) completions.get(name)!.resolve();
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(settled).not.toHaveBeenCalled();
  expect(preloader.preloadAppViews()).toBe(result);
  completions.get('streak')!.resolve();
  await result;
  expect(settled).toHaveBeenCalledOnce();
  expect(preloader.preloadAppViews()).toBe(result);
  expect(starts).toEqual([...primary, ...secondary]);
  expect(maxPending).toBe(8);
});


it('does not abort an already started code-only batch when its idle schedule is cancelled', async () => {
  let idle!: () => void;
  const cancelIdleCallback = vi.fn();
  vi.stubGlobal('window', {
    requestIdleCallback: (run: () => void) => { idle = run; return 7; },
    cancelIdleCallback,
  });
  const cancel = preloader.scheduleAppViewPreload();
  idle();
  const result = preloader.preloadAppViews();
  await waitForStarted(initialPrimary);
  cancel();
  expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  await finishAll(result);
  expect(maxPending).toBe(8);
});
